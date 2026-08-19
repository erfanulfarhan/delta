import type { IncomingMessage, ServerResponse } from 'node:http';
// Vendored by scripts/sync-attest.sh: Vercel bundles only what lives beneath
// its own project root.
import { sign } from './_attest.js';

/**
 * Node-style handlers, deliberately.
 *
 * Vercel's Node runtime passes (req, res), not Web API Request/Response. The
 * Web style only works on the Edge runtime, and Edge is disqualified here: it
 * runs at the PoP nearest the visitor, so a "Singapore" endpoint would quietly
 * be served from Dhaka and report an international speed that was never
 * international.
 */

const ALLOWED = process.env.ALLOWED_ORIGINS ?? '*';

export function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = (req.headers.origin as string | undefined) ?? '*';
  const allow =
    ALLOWED === '*'
      ? '*'
      : ALLOWED.split(',').map((s) => s.trim()).includes(origin)
        ? origin
        : 'null';

  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Timing-Allow-Origin', '*');
  // Without this the browser cannot read the attestation and every result
  // arrives unverified.
  res.setHeader('Access-Control-Expose-Headers', 'X-Delta-Attest, X-Bytes-Received');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
}

export function urlOf(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);
}

/** Sign the byte count actually moved. The key never reaches the browser. */
export async function attest(
  url: URL,
  direction: 'down' | 'up',
  bytes: number,
): Promise<string | null> {
  const secret = process.env.SIGNING_SECRET;
  if (!secret) return null;
  const session = url.searchParams.get('session');
  if (!session || session.includes('.')) return null;
  return sign({ session, direction, bytes, at: Date.now() }, secret);
}

/** True when the request was a preflight and has been answered. */
export function handledPreflight(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204);
  res.end();
  return true;
}
