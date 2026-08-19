import { describe, expect, it } from 'vitest';
import { liveMeter } from '../src/runner.js';

/**
 * Regression: the live readout used to divide by the gap between surviving
 * samples rather than by the window.
 *
 * Upload progress events arrive in large irregular bursts across six streams,
 * so two 1 MB bursts 4 ms apart divided 2 MB by 0.004 seconds and reported
 * roughly 4000 Mbps. On screen the number flapped violently. Download chunks
 * arrive steadily, which is why only upload visibly broke.
 */
describe('liveMeter', () => {
  it('never exceeds what the window can physically represent', () => {
    // The failure the user actually saw: a 400 Mbps link reporting 1115 Mbps.
    const meter = liveMeter(900, 0);
    // A burst of 4 MB arriving 60ms into the phase, the shape a socket buffer
    // absorbing a whole request produces.
    const reading = meter(4_000_000, 60);
    // 4 MB across the 900ms window is ~35.5 Mbps. Dividing by the 60ms elapsed
    // instead would have returned ~533.
    expect(reading).toBeLessThan(45);
  });

  it('reports a steady rate for a steady stream', () => {
    const meter = liveMeter(800, 0); // smoothing off, to test the maths alone
    let last = 0;
    // 100 KB every 10ms = 10 MB/s = 80 Mbps
    for (let t = 0; t <= 2000; t += 10) last = meter(100_000, t);
    expect(last).toBeGreaterThan(75);
    expect(last).toBeLessThan(85);
  });

  it('does not spike when two large bursts land milliseconds apart', () => {
    const meter = liveMeter(800, 0);
    meter(1_000_000, 1000);
    const reading = meter(1_000_000, 1004);

    // 2 MB inside an 800ms window is 20 Mbps. The old form divided by the 4ms
    // gap instead and returned about 4000.
    expect(reading).toBeLessThan(40);
  });

  it('smooths the readout so it settles instead of chasing every burst', () => {
    const smooth = liveMeter(800, 400);
    const raw = liveMeter(800, 0);

    // A quiet stream interrupted by one large burst.
    const feed = (meter: (b: number, t: number) => number) => {
      const seen: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        const t = i * 20;
        seen.push(meter(i === 20 ? 4_000_000 : 50_000, t));
      }
      return seen;
    };

    const smoothed = feed(smooth);
    const unsmoothed = feed(raw);

    const jump = (xs: number[]) =>
      Math.max(...xs.slice(1).map((v, i) => Math.abs(v - xs[i]!)));

    expect(jump(smoothed)).toBeLessThan(jump(unsmoothed));
  });

  it('never returns a non-finite reading', () => {
    const meter = liveMeter();
    expect(Number.isFinite(meter(0, 0))).toBe(true);
    expect(Number.isFinite(meter(1_000_000, 0))).toBe(true);
  });
});
