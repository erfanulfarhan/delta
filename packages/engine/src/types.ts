/**
 * A delta reading: `bytes` bytes moved at `at` milliseconds from phase start.
 *
 * Deltas rather than cumulative totals because the two sources disagree.
 * A ReadableStream reader hands us chunk sizes (already deltas); XHR
 * upload progress hands us cumulative `loaded`. Normalising to deltas at
 * the source keeps aggregation ignorant of where samples came from.
 */
export interface ByteSample {
  at: number;
  bytes: number;
}

/** One fixed-width time window of aggregated throughput. */
export interface Bucket {
  /** Window start, ms from phase start. */
  start: number;
  bytes: number;
  mbps: number;
}

export type Phase = 'idle' | 'latency' | 'download' | 'upload' | 'done' | 'error';

export interface LatencyResult {
  /** Median round trip time in ms. */
  pingMs: number;
  /** Mean absolute deviation of successive RTT differences, in ms. */
  jitterMs: number;
  samples: number[];
}

export interface TransferResult {
  mbps: number;
  /** Per-window curve, for drawing the live trace. */
  buckets: Bucket[];
  bytesTotal: number;
  durationMs: number;
}

export interface Meta {
  ip: string;
  isp: string;
  asn: string;
  city: string;
  country: string;
  server: string;
}

export interface RunResult {
  mode: string;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
  download: TransferResult;
  upload: TransferResult;
  latency: LatencyResult;
  meta: Meta | null;
  startedAt: string;
}

export interface EngineConfig {
  /** Base URL of the endpoint. This is the ONLY thing distinguishing BDIX from RAW. */
  baseUrl: string;
  /** Label carried through to the result. Presentation only. */
  mode: string;
  /** Wall clock window per transfer phase. */
  transferMs: number;
  /** Concurrent streams per transfer phase. */
  streams: number;
  /** Ping requests, first discarded as connection warmup. */
  pingSamples: number;
  bucketMs: number;
  /** Fraction of opening buckets discarded to exclude TCP slow start. */
  rampFraction: number;
  /** Fraction trimmed from each tail before averaging. */
  trimFraction: number;
}

export const DEFAULT_CONFIG: Omit<EngineConfig, 'baseUrl' | 'mode'> = {
  transferMs: 8000,
  streams: 6,
  pingSamples: 10,
  bucketMs: 100,
  rampFraction: 0.2,
  trimFraction: 0.1,
};
