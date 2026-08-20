import type { Bucket, ByteSample, LatencyResult, TransferResult } from './types.js';

const BITS_PER_BYTE = 8;
const BITS_PER_MEGABIT = 1_000_000;

export function toMbps(bytes: number, ms: number): number {
  if (ms <= 0) return 0;
  return (bytes * BITS_PER_BYTE) / (ms / 1000) / BITS_PER_MEGABIT;
}

/**
 * Group deltas into fixed windows.
 *
 * The trailing window is dropped unless it is complete. A phase that is
 * aborted mid-window would otherwise contribute a window holding a
 * fraction of a window's worth of bytes, which reads as a sudden collapse
 * in throughput and drags the average down.
 */
export function bucketize(
  samples: ByteSample[],
  bucketMs: number,
  durationMs: number,
): Bucket[] {
  if (bucketMs <= 0) throw new RangeError('bucketMs must be positive');
  const completeWindows = Math.floor(durationMs / bucketMs);
  if (completeWindows <= 0) return [];

  const totals = new Array<number>(completeWindows).fill(0);
  for (const s of samples) {
    if (s.at < 0) continue;
    const index = Math.floor(s.at / bucketMs);
    if (index >= completeWindows) continue;
    totals[index] = (totals[index] ?? 0) + s.bytes;
  }

  return totals.map((bytes, i) => ({
    start: i * bucketMs,
    bytes,
    mbps: toMbps(bytes, bucketMs),
  }));
}

/**
 * Discard the opening ramp, then average the fastest 70 percent of windows.
 *
 * This is asymmetric on purpose, and it is a change from the symmetric trim
 * this used to do. A symmetric trim lands near the median of the throughput
 * distribution, which is defensible in isolation but produced numbers roughly
 * half of what every other speedtest reports on the same connection: one
 * measured run had a median window of 251 Mbps and a peak of 503.
 *
 * Ookla's published method drops the slowest 30 percent of samples and averages
 * the remainder, so speedtest.net reports something close to the sustained peak
 * rather than the middle. Since the entire purpose of a speed figure is to be
 * comparable with the number the user gets elsewhere, matching that convention
 * matters more than statistical neutrality. The raw samples are kept in the
 * result either way, so the honest average is still recoverable.
 *
 * TCP slow start means the opening of every transfer is slower than the link,
 * so the ramp is dropped first and separately.
 */
export function trimmedMeanMbps(
  buckets: Bucket[],
  rampFraction: number,
  slowFraction: number,
): number {
  if (buckets.length === 0) return 0;

  const rampCount = Math.ceil(buckets.length * rampFraction);
  let considered = buckets.slice(rampCount);

  // Too little left to be meaningful: fall back to everything.
  if (considered.length < 3) considered = buckets;

  const sorted = considered.map((b) => b.mbps).sort((a, b) => a - b);

  // Rounded up so the guarantee holds at every sample size; the guard below
  // stops it discarding everything on a very short phase.
  const drop = Math.ceil(sorted.length * slowFraction);
  const kept = sorted.length - drop >= 1 ? sorted.slice(drop) : sorted;

  const sum = kept.reduce((acc, v) => acc + v, 0);
  return sum / kept.length;
}

export function summarise(
  samples: ByteSample[],
  durationMs: number,
  bucketMs: number,
  rampFraction: number,
  trimFraction: number,
): TransferResult {
  const buckets = bucketize(samples, bucketMs, durationMs);

  // Only bytes inside the measured window count.
  //
  // Chunks already in flight when the deadline passes still arrive and are still
  // recorded, but `durationMs` is clamped to the window. Summing every sample
  // against a clamped duration describes two different intervals and overstates
  // throughput: on a 5 Mbps shaped link it reported 6.1. `bucketize` already
  // drops out-of-window samples, so the reported figure was unaffected, but
  // bytesTotal is what any bytes-over-time check uses.
  const bytesTotal = samples.reduce((acc, s) => (s.at < durationMs ? acc + s.bytes : acc), 0);
  return {
    mbps: trimmedMeanMbps(buckets, rampFraction, trimFraction),
    buckets,
    bytesTotal,
    durationMs,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Jitter as the mean absolute deviation of successive differences, which is
 * what RFC 3550 style jitter measures: variation between consecutive packets,
 * not spread around the mean. A connection with a steady 300 ms ping has high
 * latency and near zero jitter, and the distinction matters to the user.
 */
export function summariseLatency(rtts: number[]): LatencyResult {
  if (rtts.length === 0) return { pingMs: 0, jitterMs: 0, samples: [] };
  if (rtts.length === 1) return { pingMs: rtts[0]!, jitterMs: 0, samples: rtts };

  let deviationSum = 0;
  for (let i = 1; i < rtts.length; i += 1) {
    deviationSum += Math.abs(rtts[i]! - rtts[i - 1]!);
  }

  return {
    pingMs: median(rtts),
    jitterMs: deviationSum / (rtts.length - 1),
    samples: rtts,
  };
}
