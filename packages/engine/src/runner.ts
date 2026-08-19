import { measureDownload } from './download.js';
import { measureLatency } from './latency.js';
import { measureUpload } from './upload.js';
import { DEFAULT_CONFIG } from './types.js';
import type { EngineConfig, Meta, Phase, RunResult } from './types.js';

export interface RunEvent {
  phase: Phase;
  /** Live throughput in Mbps for the current phase. */
  mbps: number;
  /** 0..1 through the current phase. */
  progress: number;
  /**
   * The settled download figure, once that phase has finished.
   *
   * Carried through the event stream because the interface shows download and
   * upload side by side throughout: without it the download readout has nothing
   * to display during the upload phase and falls back to zero, so a measured
   * 128 Mbps visibly drains away to nothing while upload runs.
   */
  downloadMbps?: number;
}

export interface RunOptions {
  baseUrl: string;
  mode: string;
  /** Supplied by the caller so a run-both pair can share one session. */
  session?: string;
  config?: Partial<Omit<EngineConfig, 'baseUrl' | 'mode' | 'session'>>;
  onEvent?: (event: RunEvent) => void;
  signal?: AbortSignal;
}

export async function fetchMeta(baseUrl: string, signal?: AbortSignal): Promise<Meta | null> {
  try {
    const response = await fetch(`${baseUrl}/meta`, { cache: 'no-store', signal });
    if (!response.ok) return null;
    return (await response.json()) as Meta;
  } catch {
    // Metadata is decoration. Losing it must never fail a measurement.
    return null;
  }
}

/**
 * A live throughput reading over a short trailing window.
 *
 * Deliberately separate from the trimmed mean used for the final figure: this
 * one is for the gauge and wants to feel responsive, the other is for the
 * result and wants to be accurate. Conflating them gives you either a twitchy
 * result or a gauge that barely moves.
 */
export function liveMeter(windowMs = 900, tauMs = 400) {
  // Running sum over a sliding window, maintained incrementally.
  //
  // The obvious version recomputes the window total with reduce() on every
  // sample and drops expired entries with shift(). Both are O(n) in the window
  // size, and this runs inside the measurement loop at roughly 800 samples a
  // second against a window holding hundreds of entries: over half a million
  // operations per second spent measuring, which slows the very transfer being
  // measured. A running total and a read cursor make it O(1) amortised.
  const times: number[] = [];
  const sizes: number[] = [];
  let head = 0;
  let total = 0;
  let ema: number | null = null;
  let lastAt: number | null = null;

  return (bytes: number, atMs: number): number => {
    times.push(atMs);
    sizes.push(bytes);
    total += bytes;

    const cutoff = atMs - windowMs;
    while (head < times.length && times[head]! < cutoff) {
      total -= sizes[head]!;
      head += 1;
    }

    // Compact occasionally so the discarded prefix cannot grow without bound
    // across a long phase.
    if (head > 4096) {
      times.splice(0, head);
      sizes.splice(0, head);
      head = 0;
    }

    // Always divide by the whole window, never by elapsed time or by the gap
    // between surviving samples. Both shrink early in a phase or between
    // bursts, and dividing megabytes by a few milliseconds reports thousands of
    // Mbps. A partially filled window reads low and climbs, which is the ramp.
    const instant = (total * 8) / (windowMs / 1000) / 1_000_000;

    // Time-constant smoothing rather than a fixed fraction per sample. Upload
    // progress events fire far more often than download chunks arrive, so a
    // per-sample factor smooths the two phases by wildly different amounts.
    const dt = lastAt === null ? windowMs : Math.max(atMs - lastAt, 0);
    lastAt = atMs;
    const alpha = tauMs <= 0 ? 1 : 1 - Math.exp(-dt / tauMs);

    ema = ema === null ? instant : ema + (instant - ema) * alpha;
    return ema;
  };
}

/**
 * Run one full measurement against one endpoint.
 *
 * Note there is no notion of BDIX or RAW anywhere below. A mode is a base URL
 * plus a label, which is the whole reason a third location could be added
 * later as a config entry rather than a code change.
 */
/**
 * How often progress reaches the interface.
 *
 * Emitting per chunk was throttling the measurement itself. Every sample
 * crossed a postMessage boundary out of the Web Worker and triggered a React
 * state update, and at 50 MB/s with 64 KB chunks that is roughly 800 messages
 * and 800 re-renders per second. The result was a real 300 Mbps link reporting
 * 137. The meter still sees every byte; only the reporting is rationed.
 *
 * 20 updates a second is far more than the eye needs, since the gauge and the
 * numerals interpolate between updates on their own animation frame.
 */
const EMIT_INTERVAL_MS = 50;

export async function run(options: RunOptions): Promise<RunResult> {
  const session =
    options.session ??
    // Dots would break the attestation payload's field separator.
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');

  const cfg: EngineConfig = {
    ...DEFAULT_CONFIG,
    ...options.config,
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    mode: options.mode,
    session,
  };

  const tokens: string[] = [];
  const collect = (token: string) => tokens.push(token);
  const emit = options.onEvent ?? (() => {});
  const startedAt = new Date().toISOString();

  emit({ phase: 'latency', mbps: 0, progress: 0 });
  const [latency, meta] = await Promise.all([
    measureLatency(cfg.baseUrl, cfg.pingSamples, options.signal),
    fetchMeta(cfg.baseUrl, options.signal),
  ]);

  emit({ phase: 'download', mbps: 0, progress: 0 });
  const downMeter = liveMeter(900, 400);
  let lastDownEmit = 0;
  const download = await measureDownload(
    cfg,
    (bytes, atMs) => {
      // Every sample feeds the meter; only some reach the interface.
      const mbps = downMeter(bytes, atMs);
      const now = performance.now();
      if (now - lastDownEmit < EMIT_INTERVAL_MS) return;
      lastDownEmit = now;
      emit({
        phase: 'download',
        mbps,
        progress: Math.min(atMs / cfg.transferMs, 1),
      });
    },
    options.signal,
    collect,
  );

  // Same smoothing as download now. The upload phase spreads each progress
  // jump into download-sized pieces before the meter sees it, so the input
  // signal has the same shape and no longer needs heavier filtering to look
  // calm. Matching them also means the two readouts move alike on screen.
  emit({ phase: 'upload', mbps: 0, progress: 0, downloadMbps: download.mbps });
  const upMeter = liveMeter(900, 400);
  let lastUpEmit = 0;
  const upload = await measureUpload(
    cfg,
    (bytes, atMs) => {
      const mbps = upMeter(bytes, atMs);
      const now = performance.now();
      if (now - lastUpEmit < EMIT_INTERVAL_MS) return;
      lastUpEmit = now;
      emit({
        phase: 'upload',
        mbps,
        progress: Math.min(atMs / cfg.transferMs, 1),
        downloadMbps: download.mbps,
      });
    },
    options.signal,
    collect,
  );

  emit({ phase: 'done', mbps: download.mbps, progress: 1, downloadMbps: download.mbps });

  return {
    mode: cfg.mode,
    session,
    tokens,
    downloadMbps: download.mbps,
    uploadMbps: upload.mbps,
    pingMs: latency.pingMs,
    jitterMs: latency.jitterMs,
    download,
    upload,
    latency,
    meta,
    startedAt,
  };
}
