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
  session: string;
  /** Signed byte-count attestations from the endpoint, for server-side checking. */
  tokens: string[];
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
  /** Base URL of the endpoint. This is the ONLY thing distinguishing local from raw. */
  baseUrl: string;
  /**
   * Equivalent origins for the same server, used round-robin across streams.
   *
   * A browser multiplexes every request to one origin over a single HTTP/2
   * connection, and that connection is the ceiling: measured on a 470 Mbps link,
   * eight streams to one origin reached 234 Mbps and sixteen reached no more,
   * while eight streams split across two origins reached 423. Extra hostnames
   * are the only way a browser can open extra connections. curl never hit this
   * because separate processes already meant separate connections.
   *
   * Every origin must share the signing secret, or attestations from the
   * mirrors will not verify.
   */
  origins?: string[];
  /**
   * Ties every attestation from this run together. Sent on each request so the
   * endpoint can bind its signed byte counts to one measurement, which is what
   * stops tokens being replayed from an earlier, faster run.
   */
  session: string;
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
  /** Fraction of slowest windows discarded before averaging (Ookla uses 0.3). */
  trimFraction: number;
}

export const DEFAULT_CONFIG: Omit<EngineConfig, 'baseUrl' | 'mode' | 'session'> = {
  transferMs: 8000,
  // Eight rather than six. With a ~16ms RTT to the edge and a 400 Mbps line the
  // bandwidth-delay product is around 760 KB, so more concurrent flows fill the
  // pipe sooner; speedtest.net opens a comparable number.
  streams: 8,
  pingSamples: 10,
  bucketMs: 100,
  rampFraction: 0.2,
  trimFraction: 0.3,
};
