import { describe, expect, it } from 'vitest';
import {
  bucketize,
  median,
  summarise,
  summariseLatency,
  toMbps,
  trimmedMeanMbps,
} from '../src/aggregate.js';
import type { Bucket, ByteSample } from '../src/types.js';

const bucketsOf = (mbps: number[]): Bucket[] =>
  mbps.map((m, i) => ({ start: i * 100, bytes: 0, mbps: m }));

/** Steady stream: `bytes` every `everyMs` for `durationMs`. */
const steady = (bytes: number, everyMs: number, durationMs: number): ByteSample[] => {
  const out: ByteSample[] = [];
  for (let t = 0; t < durationMs; t += everyMs) out.push({ at: t, bytes });
  return out;
};

describe('toMbps', () => {
  it('converts bytes over time to megabits per second', () => {
    // 1_000_000 bytes in 1s = 8 Mbps
    expect(toMbps(1_000_000, 1000)).toBe(8);
    expect(toMbps(125_000, 1000)).toBe(1);
  });

  it('returns zero rather than Infinity for a zero window', () => {
    expect(toMbps(500, 0)).toBe(0);
  });
});

describe('bucketize', () => {
  it('groups deltas into fixed windows', () => {
    const samples: ByteSample[] = [
      { at: 0, bytes: 100 },
      { at: 50, bytes: 100 },
      { at: 150, bytes: 300 },
    ];
    const buckets = bucketize(samples, 100, 200);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.bytes).toBe(200);
    expect(buckets[1]!.bytes).toBe(300);
  });

  it('drops an incomplete trailing window', () => {
    // 250ms of data with 100ms windows yields 2 complete windows, not 3.
    const buckets = bucketize(steady(100, 50, 250), 100, 250);
    expect(buckets).toHaveLength(2);
  });

  it('ignores samples landing beyond the measured duration', () => {
    const samples: ByteSample[] = [
      { at: 0, bytes: 100 },
      { at: 9999, bytes: 999_999 },
    ];
    const buckets = bucketize(samples, 100, 200);
    expect(buckets.reduce((a, b) => a + b.bytes, 0)).toBe(100);
  });

  it('rejects a non-positive window size', () => {
    expect(() => bucketize([], 0, 100)).toThrow(RangeError);
  });
});

describe('trimmedMeanMbps', () => {
  it('discards the opening ramp so slow start does not drag the result down', () => {
    // First 2 of 10 windows are the ramp; the link is really 100 Mbps.
    const buckets = bucketsOf([5, 20, 100, 100, 100, 100, 100, 100, 100, 100]);
    expect(trimmedMeanMbps(buckets, 0.2, 0.1)).toBe(100);
  });

  it('is not dragged down by a single stalled window', () => {
    const buckets = bucketsOf([5, 20, 100, 100, 100, 0, 100, 100, 100, 100]);
    expect(trimmedMeanMbps(buckets, 0.2, 0.1)).toBe(100);
  });

  it('falls back to all windows when too few survive the ramp cut', () => {
    const buckets = bucketsOf([10, 20]);
    expect(trimmedMeanMbps(buckets, 0.2, 0.1)).toBe(15);
  });

  it('returns zero for no data rather than NaN', () => {
    expect(trimmedMeanMbps([], 0.2, 0.1)).toBe(0);
  });
});

describe('summarise', () => {
  it('measures a steady 80 Mbps stream', () => {
    // 1_000_000 bytes every 100ms = 10 MB/s = 80 Mbps
    const result = summarise(steady(1_000_000, 100, 8000), 8000, 100, 0.2, 0.1);
    expect(result.mbps).toBeCloseTo(80, 5);
    expect(result.buckets).toHaveLength(80);
    expect(result.bytesTotal).toBe(80_000_000);
  });

  it('measures a slow connection with the same code path', () => {
    // 62_500 bytes every 100ms = 625 KB/s = 5 Mbps
    const result = summarise(steady(62_500, 100, 8000), 8000, 100, 0.2, 0.1);
    expect(result.mbps).toBeCloseTo(5, 5);
  });
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns zero when empty', () => {
    expect(median([])).toBe(0);
  });
});

describe('summariseLatency', () => {
  it('reports high ping with near-zero jitter for a steady slow link', () => {
    const result = summariseLatency([300, 300, 300, 300]);
    expect(result.pingMs).toBe(300);
    expect(result.jitterMs).toBe(0);
  });

  it('reports jitter as variation between consecutive samples', () => {
    // diffs: 10, 10, 10 -> MAD 10
    const result = summariseLatency([10, 20, 30, 40]);
    expect(result.jitterMs).toBe(10);
  });

  it('separates a jittery link from a merely slow one', () => {
    const steadyLink = summariseLatency([100, 100, 100, 100]);
    const jitteryLink = summariseLatency([40, 160, 40, 160]);
    expect(jitteryLink.pingMs).toBe(100);
    expect(steadyLink.pingMs).toBe(100);
    expect(jitteryLink.jitterMs).toBeGreaterThan(steadyLink.jitterMs);
  });

  it('handles zero and one sample without dividing by zero', () => {
    expect(summariseLatency([]).pingMs).toBe(0);
    expect(summariseLatency([42]).jitterMs).toBe(0);
  });
});
