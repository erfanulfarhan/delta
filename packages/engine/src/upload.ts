import { summarise } from './aggregate.js';
import type { ByteSample, EngineConfig, TransferResult } from './types.js';

const MIN_CHUNK = 128 * 1024;
const MAX_CHUNK = 16 * 1024 * 1024;
const TARGET_REQUEST_MS = 1500;

/**
 * Incompressible payload.
 *
 * A body of zeros gets transparently compressed by intermediate proxies, so
 * the bytes on the wire bear no relation to the bytes we counted and the
 * result is fabricated. Random data cannot be compressed, so what we count is
 * what actually crossed the link.
 */
function randomBlob(bytes: number): Blob {
  const buf = new Uint8Array(bytes);
  const CRYPTO_MAX = 65536; // getRandomValues rejects anything larger
  for (let offset = 0; offset < bytes; offset += CRYPTO_MAX) {
    crypto.getRandomValues(buf.subarray(offset, Math.min(offset + CRYPTO_MAX, bytes)));
  }
  return new Blob([buf], { type: 'application/octet-stream' });
}

/**
 * Measure upload throughput.
 *
 * XMLHttpRequest rather than fetch, and not by preference: fetch still exposes
 * no upload progress events in most browsers, so it can only report a single
 * figure once the whole body has gone. Live upload throughput, and therefore
 * the trimmed-mean treatment applied to download, requires XHR's
 * `upload.onprogress`.
 */
export async function measureUpload(
  cfg: EngineConfig,
  onSample: (bytes: number, atMs: number) => void,
  signal?: AbortSignal,
): Promise<TransferResult> {
  const samples: ByteSample[] = [];
  let firstByteAt: number | null = null;
  let chunkSize = MIN_CHUNK * 4;
  let stopped = false;

  const elapsed = () => (firstByteAt === null ? 0 : performance.now() - firstByteAt);
  const expired = () => firstByteAt !== null && elapsed() >= cfg.transferMs;

  const record = (bytes: number) => {
    if (bytes <= 0) return;
    const now = performance.now();
    if (firstByteAt === null) firstByteAt = now;
    samples.push({ at: now - firstByteAt, bytes });
    onSample(bytes, now - firstByteAt);
  };

  const inflight = new Set<XMLHttpRequest>();
  const stopAll = () => {
    stopped = true;
    for (const xhr of inflight) xhr.abort();
    inflight.clear();
  };
  signal?.addEventListener('abort', stopAll, { once: true });

  const send = (body: Blob): Promise<number> =>
    new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const started = performance.now();
      let lastLoaded = 0;
      inflight.add(xhr);

      xhr.upload.onprogress = (e) => {
        record(e.loaded - lastLoaded);
        lastLoaded = e.loaded;
        if (expired()) stopAll();
      };
      const finish = () => {
        inflight.delete(xhr);
        resolve(performance.now() - started);
      };
      xhr.onload = finish;
      xhr.onerror = finish;
      xhr.onabort = finish;

      xhr.open('POST', `${cfg.baseUrl}/upload?salt=${Math.random().toString(36).slice(2)}`);
      xhr.send(body);
    });

  const stream = async (): Promise<void> => {
    while (!expired() && !stopped) {
      const body = randomBlob(chunkSize);
      const took = await send(body);
      if (took > 0) {
        const scaled = chunkSize * (TARGET_REQUEST_MS / took);
        chunkSize = Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Math.round(scaled)));
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: cfg.streams }, stream));
  } finally {
    stopAll();
    signal?.removeEventListener('abort', stopAll);
  }

  const duration = firstByteAt === null ? 0 : Math.min(elapsed(), cfg.transferMs);
  return summarise(samples, duration, cfg.bucketMs, cfg.rampFraction, cfg.trimFraction);
}
