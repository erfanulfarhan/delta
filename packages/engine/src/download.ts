import { summarise } from './aggregate.js';
import type { ByteSample, EngineConfig, TransferResult } from './types.js';

const salt = () => Math.random().toString(36).slice(2);

const MIN_CHUNK = 256 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;
const TARGET_REQUEST_MS = 1500;

/**
 * Measure download throughput over a fixed wall clock window.
 *
 * Fixed duration rather than fixed payload: a payload sized for a 5 Mbps line
 * completes in 200ms on a fast one, which is too short to measure anything,
 * and a payload sized for a fast line takes a minute on a slow one. Chunk size
 * adapts within the window so both ends of the range spend the same 8 seconds
 * transferring.
 *
 * Six concurrent streams because a single TCP connection cannot saturate a
 * fast link: receive window limits and per-flow shaping mean single-stream
 * measurement systematically understates fast connections.
 */
export async function measureDownload(
  cfg: EngineConfig,
  onSample: (bytes: number, atMs: number) => void,
  signal?: AbortSignal,
): Promise<TransferResult> {
  const samples: ByteSample[] = [];
  let firstByteAt: number | null = null;
  let chunkSize = MIN_CHUNK * 4;

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  const elapsed = () => (firstByteAt === null ? 0 : performance.now() - firstByteAt);
  const expired = () => firstByteAt !== null && elapsed() >= cfg.transferMs;

  const record = (bytes: number) => {
    const now = performance.now();
    // The clock starts at first byte, not at request dispatch, so connection
    // setup is not counted as transfer time and charged against the link.
    if (firstByteAt === null) firstByteAt = now;
    samples.push({ at: now - firstByteAt, bytes });
    onSample(bytes, now - firstByteAt);
  };

  const stream = async (): Promise<void> => {
    while (!expired() && !controller.signal.aborted) {
      const requestStarted = performance.now();
      let received = 0;
      try {
        const response = await fetch(
          `${cfg.baseUrl}/download?bytes=${chunkSize}&salt=${salt()}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const reader = response.body?.getReader();
        if (!reader) return;
        for (;;) {
          const { done, value } = await reader.read();
          if (done || value === undefined) break;
          received += value.byteLength;
          record(value.byteLength);
          if (expired()) {
            // Cancel rather than drain: without this a fast link keeps pulling
            // bytes after the measurement window has closed, which measures
            // nothing and bills the endpoint's egress for the privilege.
            await reader.cancel().catch(() => {});
            break;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        continue;
      }

      const took = performance.now() - requestStarted;
      if (took > 0 && received > 0) {
        const scaled = chunkSize * (TARGET_REQUEST_MS / took);
        chunkSize = Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Math.round(scaled)));
      }
    }
  };

  const timer = setTimeout(abort, cfg.transferMs * 3); // hard ceiling if a stream wedges
  try {
    await Promise.all(Array.from({ length: cfg.streams }, stream));
  } finally {
    clearTimeout(timer);
    abort();
    signal?.removeEventListener('abort', abort);
  }

  const duration = firstByteAt === null ? 0 : Math.min(elapsed(), cfg.transferMs);
  return summarise(samples, duration, cfg.bucketMs, cfg.rampFraction, cfg.trimFraction);
}
