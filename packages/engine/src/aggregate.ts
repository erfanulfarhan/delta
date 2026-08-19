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
 * Discard the opening ramp, then take a symmetrically trimmed mean.
 *
 * TCP slow start makes the opening of every transfer slower than the link,
 * so a plain average understates every connection and understates fast ones
 * most. Trimming both tails afterwards removes a stalled window or a burst
 * from a competing download without letting either dominate.
 *
 * Guards matter more than the maths here: a very short or very slow phase
 * can leave too few windows to trim meaningfully, and in that case reporting
 * something slightly noisy beats reporting zero.
 */
export function trimmedMeanMbps(
  buckets: Bucket[],
  rampFraction: number,
  trimFraction: number,
): number {
  if (buckets.length === 0) return 0;

  const rampCount = Math.ceil(buckets.length * rampFraction);
  let considered = buckets.slice(rampCount);

  // Too little left to be meaningful: fall back to everything.
  if (considered.length < 3) considered = buckets;

  const sorted = considered.map((b) => b.mbps).sort((a, b) => a - b);
  // Rounded up, not down: at 8 windows a 10 percent trim floors to zero and
  // the guarantee this function exists to make quietly evaporates, letting one
  // stalled window poison a short measurement. Rounding up keeps the intent at
  // every sample size; the `kept` guard below stops it over-trimming tiny sets.
  const trim = Math.ceil(sorted.length * trimFraction);
  const kept = sorted.length - 2 * trim >= 1 ? sorted.slice(trim, sorted.length - trim) : sorted;

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
  const bytesTotal = samples.reduce((acc, s) => acc + s.bytes, 0);
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
