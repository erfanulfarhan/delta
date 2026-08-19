import { summariseLatency } from './aggregate.js';
import type { LatencyResult } from './types.js';

const salt = () => Math.random().toString(36).slice(2);

/**
 * Sequential pings, never concurrent.
 *
 * Parallel probes queue against each other on a saturated or narrow link and
 * report the queueing delay as latency, which inflates both ping and jitter.
 * The first response is discarded because it pays for DNS, TCP and TLS setup
 * that later requests reuse, and would otherwise show up as a large opening
 * jitter spike on every run.
 */
export async function measureLatency(
  baseUrl: string,
  count: number,
  signal?: AbortSignal,
): Promise<LatencyResult> {
  const rtts: number[] = [];

  for (let i = 0; i < count; i += 1) {
    if (signal?.aborted) break;
    const started = performance.now();
    try {
      await fetch(`${baseUrl}/ping?salt=${salt()}`, {
        cache: 'no-store',
        signal,
      });
    } catch {
      continue; // A dropped probe is data about the link, not a reason to fail.
    }
    const elapsed = performance.now() - started;
    if (i > 0) rtts.push(elapsed);
  }

  return summariseLatency(rtts);
}
