import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { attest, cors, handledPreflight, urlOf } from './_shared.js';

const MAX_BYTES = 128 * 1024 * 1024;
const BLOCK = 256 * 1024;

// Pre-generated pool, reused while the instance stays warm. Incompressible is
// the property that matters; regenerating per request would make CPU the
// bottleneck and measure entropy generation rather than bandwidth.
let POOL: Buffer | null = null;
const pool = (): Buffer => (POOL ??= randomBytes(4 * 1024 * 1024));

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  cors(req, res);
  if (handledPreflight(req, res)) return;

  const url = urlOf(req);
  const requested = Number(url.searchParams.get('bytes') ?? BLOCK);
  const total = Math.min(Math.max(requested, 0) || BLOCK, MAX_BYTES);

  const token = await attest(url, 'down', total);
  const buf = pool();

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(total));
  res.setHeader('Content-Encoding', 'identity');
  if (token) res.setHeader('X-Delta-Attest', token);
  res.writeHead(200);

  // Written in blocks with backpressure honoured, so the client starts
  // receiving immediately rather than after the whole body is assembled.
  let sent = 0;
  while (sent < total && !res.destroyed) {
    const size = Math.min(BLOCK, total - sent);
    const offset = sent % (buf.length - size);
    if (!res.write(buf.subarray(offset, offset + size))) {
      await new Promise<void>((resolve) => res.once('drain', () => resolve()));
    }
    sent += size;
  }
  res.end();
}
