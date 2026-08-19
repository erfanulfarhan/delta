import type { IncomingMessage, ServerResponse } from 'node:http';
import { attest, cors, handledPreflight, urlOf } from './_shared.js';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  cors(req, res);
  if (handledPreflight(req, res)) return;

  const url = urlOf(req);
  let received = 0;

  // The body must be fully drained. Replying before reading it truncates the
  // client's upload and the figure measured becomes socket buffer size. A
  // client aborting mid-upload is routine, because the engine cuts every upload
  // at its duration boundary, so the resulting error is expected rather than
  // exceptional: swallowing it keeps one aborted request from taking down the
  // instance and every other measurement in flight on it.
  req.on('error', () => {});
  try {
    for await (const chunk of req) {
      received += (chunk as Buffer).length;
    }
  } catch {
    return;
  }
  if (res.destroyed) return;

  const token = await attest(url, 'up', received);
  res.setHeader('X-Bytes-Received', String(received));
  if (token) res.setHeader('X-Delta-Attest', token);
  res.writeHead(204);
  res.end();
}
