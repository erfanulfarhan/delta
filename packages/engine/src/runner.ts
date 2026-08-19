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
  const recent: Array<{ at: number; bytes: number }> = [];
  let ema: number | null = null;
  let lastAt: number | null = null;

  return (bytes: number, atMs: number): number => {
    recent.push({ at: atMs, bytes });
    const cutoff = atMs - windowMs;
    while (recent.length > 0 && recent[0]!.at < cutoff) recent.shift();
    const total = recent.reduce((acc, s) => acc + s.bytes, 0);

    // Always divide by the whole window, never by the elapsed time or by the
    // gap between surviving samples. Both of those shrink early in a phase or
    // between bursts, and dividing megabytes by a few milliseconds reports
    // thousands of Mbps. A partially filled window simply reads low and climbs,
    // which looks like the ramp it actually is.
    const instant = (total * 8) / (windowMs / 1000) / 1_000_000;

    // Time-constant smoothing rather than a fixed fraction per sample. Upload
    // progress events fire far more often than download chunks arrive, so a
    // per-sample factor smooths the two phases by wildly different amounts and
    // barely touches upload at all.
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
  const downMeter = liveMeter();
  const download = await measureDownload(
    cfg,
    (bytes, atMs) =>
      emit({
        phase: 'download',
        mbps: downMeter(bytes, atMs),
        progress: Math.min(atMs / cfg.transferMs, 1),
      }),
    options.signal,
    collect,
  );

  emit({ phase: 'upload', mbps: 0, progress: 0 });
  const upMeter = liveMeter();
  const upload = await measureUpload(
    cfg,
    (bytes, atMs) =>
      emit({
        phase: 'upload',
        mbps: upMeter(bytes, atMs),
        progress: Math.min(atMs / cfg.transferMs, 1),
      }),
    options.signal,
    collect,
  );

  emit({ phase: 'done', mbps: download.mbps, progress: 1 });

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
