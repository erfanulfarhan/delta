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
  config?: Partial<Omit<EngineConfig, 'baseUrl' | 'mode'>>;
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
function liveMeter(windowMs = 500) {
  const recent: Array<{ at: number; bytes: number }> = [];
  return (bytes: number, atMs: number): number => {
    recent.push({ at: atMs, bytes });
    const cutoff = atMs - windowMs;
    while (recent.length > 0 && recent[0]!.at < cutoff) recent.shift();
    const total = recent.reduce((acc, s) => acc + s.bytes, 0);
    const span = Math.max(recent.length > 1 ? atMs - recent[0]!.at : windowMs, 1);
    return (total * 8) / (span / 1000) / 1_000_000;
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
  const cfg: EngineConfig = {
    ...DEFAULT_CONFIG,
    ...options.config,
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    mode: options.mode,
  };
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
  );

  emit({ phase: 'done', mbps: download.mbps, progress: 1 });

  return {
    mode: cfg.mode,
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
