import { summarise } from './aggregate.js';
import type { ByteSample, EngineConfig, TransferResult } from './types.js';

// Progress jumps are sliced into pieces this size before being handed to the
// meter, matching the granularity of download chunks.
const SPREAD_BYTES = 64 * 1024;

const MIN_CHUNK = 128 * 1024;
// Capped well below the download ceiling on purpose. XHR upload progress
// reports bytes handed to the OS socket buffer, not bytes acknowledged by the
// far end, so a single large request lets the buffer swallow megabytes at once
// and report them as instantaneous throughput. Smaller requests keep the
// progress events closer to what is actually crossing the wire.
const MAX_CHUNK = 4 * 1024 * 1024;
const TARGET_REQUEST_MS = 1500;

/**
 * Incompressible payload.
 *
 * A body of zeros gets transparently compressed by intermediate proxies, so
 * the bytes on the wire bear no relation to the bytes we counted and the
 * result is fabricated. Random data cannot be compressed, so what we count is
 * what actually crossed the link.
 */
const blobCache = new Map<number, Blob>();

function randomBlob(bytes: number): Blob {
  // Cached by size. Incompressibility is the property that matters; uniqueness
  // is not. Regenerating megabytes of randomness for every request on every
  // stream makes the CPU the bottleneck and measures entropy, not bandwidth.
  const cached = blobCache.get(bytes);
  if (cached) return cached;

  const buf = new Uint8Array(bytes);
  const CRYPTO_MAX = 65536; // getRandomValues rejects anything larger
  for (let offset = 0; offset < bytes; offset += CRYPTO_MAX) {
    crypto.getRandomValues(buf.subarray(offset, Math.min(offset + CRYPTO_MAX, bytes)));
  }
  const blob = new Blob([buf], { type: 'application/octet-stream' });

  if (blobCache.size > 12) blobCache.clear();
  blobCache.set(bytes, blob);
  return blob;
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
  onToken?: (token: string) => void,
): Promise<TransferResult> {
  const samples: ByteSample[] = [];
  let firstByteAt: number | null = null;
  let chunkSize = MIN_CHUNK * 4;
  let stopped = false;

  // The measurement clock starts at the first byte acknowledged, but the phase
  // needs a separate wall clock. If no progress event ever arrives (the far end
  // died, a proxy swallowed the body) the byte clock never starts, so a
  // deadline derived from it can never fire and the phase hangs forever.
  const phaseStart = performance.now();
  const hardDeadline = phaseStart + cfg.transferMs * 3;

  const elapsed = () => (firstByteAt === null ? 0 : performance.now() - firstByteAt);
  const expired = () =>
    performance.now() >= hardDeadline || (firstByteAt !== null && elapsed() >= cfg.transferMs);

  const recordAt = (bytes: number, at: number) => {
    if (bytes <= 0) return;
    if (firstByteAt === null) firstByteAt = at;
    const offset = Math.max(at - firstByteAt, 0);
    samples.push({ at: offset, bytes });
    onSample(bytes, offset);
  };

  let lastProgressAt: number | null = null;
  const origins = cfg.origins && cfg.origins.length > 0 ? cfg.origins : [cfg.baseUrl];

  const inflight = new Set<XMLHttpRequest>();
  const stopAll = () => {
    stopped = true;
    for (const xhr of inflight) xhr.abort();
    inflight.clear();
  };
  signal?.addEventListener('abort', stopAll, { once: true });

  const send = (body: Blob, origin: string): Promise<number> =>
    new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const started = performance.now();
      let lastLoaded = 0;
      inflight.add(xhr);

      xhr.upload.onprogress = (e) => {
        const delta = e.loaded - lastLoaded;
        lastLoaded = e.loaded;

        // Split into fixed-size pieces spread across the interval since the last
        // event, instead of recording one lump at one instant.
        //
        // This is what made upload stutter while download stayed smooth. A
        // download arrives as a steady trickle of small chunks, but XHR upload
        // progress fires occasionally and reports a large jump, so the sample
        // stream feeding the meter was spiky at source. Slicing a 2 MB jump into
        // 64 KB pieces spaced over the elapsed interval gives the meter the same
        // shape of input the download path gives it, which is why both readouts
        // now behave alike.
        if (delta > 0) {
          const now = performance.now();
          const since = lastProgressAt === null ? 0 : now - lastProgressAt;
          lastProgressAt = now;

          const pieces = Math.max(1, Math.min(Math.ceil(delta / SPREAD_BYTES), 64));
          const per = delta / pieces;
          const step = pieces > 1 && since > 0 ? since / pieces : 0;
          const base = now - since;

          for (let i = 0; i < pieces; i += 1) {
            recordAt(per, step > 0 ? base + step * (i + 1) : now);
          }
        }

        if (expired()) stopAll();
      };
      const finish = () => {
        inflight.delete(xhr);
        // Only a completed request carries an attestation; an aborted one
        // never got a response, and its bytes are correctly not counted.
        try {
          const token = xhr.getResponseHeader('X-Delta-Attest');
          if (token) onToken?.(token);
        } catch {
          /* headers unavailable on an aborted request */
        }
        resolve(performance.now() - started);
      };
      xhr.onload = finish;
      xhr.onerror = finish;
      xhr.onabort = finish;

      // Independent of the phase deadline: a single request that neither
      // completes nor errors would otherwise pin its stream loop open.
      xhr.timeout = cfg.transferMs * 2;
      xhr.ontimeout = finish;

      xhr.open(
        'POST',
        `${origin}/upload?salt=${Math.random().toString(36).slice(2)}&session=${cfg.session}`,
      );
      xhr.send(body);
    });

  const stream = async (streamIndex: number): Promise<void> => {
    const origin = origins[streamIndex % origins.length]!;
    while (!expired() && !stopped) {
      const body = randomBlob(chunkSize);
      const took = await send(body, origin);
      if (took > 0) {
        const scaled = chunkSize * (TARGET_REQUEST_MS / took);
        chunkSize = Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Math.round(scaled)));
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: cfg.streams }, (_, i) => stream(i)));
  } finally {
    stopAll();
    signal?.removeEventListener('abort', stopAll);
  }

  const duration = firstByteAt === null ? 0 : Math.min(elapsed(), cfg.transferMs);
  return summarise(samples, duration, cfg.bucketMs, cfg.rampFraction, cfg.trimFraction);
}
