import { randomBytes } from 'node:crypto';
import { attest, corsHeaders, preflight } from './_shared.js';

export const config = { runtime: 'nodejs' };

const MAX_BYTES = 128 * 1024 * 1024;
const BLOCK = 256 * 1024;

// Pre-generated pool, reused across requests in a warm instance. Incompressible
// is the property that matters; regenerating per request would make CPU the
// bottleneck and measure entropy generation rather than bandwidth.
let POOL: Buffer | null = null;
const pool = (): Buffer => (POOL ??= randomBytes(4 * 1024 * 1024));

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request);

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('bytes') ?? BLOCK);
  const total = Math.min(Math.max(requested, 0) || BLOCK, MAX_BYTES);

  const token = await attest(url, 'down', total);
  const buf = pool();

  // Streamed rather than buffered, so the client starts receiving immediately.
  // Assembling the whole body first would put this function's own assembly time
  // inside the measurement window.
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const size = Math.min(BLOCK, total - sent);
      const offset = sent % (buf.length - size);
      controller.enqueue(new Uint8Array(buf.subarray(offset, offset + size)));
      sent += size;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(total),
      'Content-Encoding': 'identity',
      ...(token ? { 'X-Delta-Attest': token } : {}),
    },
  });
}
