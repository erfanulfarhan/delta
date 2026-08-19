import type { IncomingMessage, ServerResponse } from 'node:http';
import { cors, handledPreflight } from './_shared.js';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  cors(req, res);
  if (handledPreflight(req, res)) return;
  res.writeHead(204);
  res.end();
}
