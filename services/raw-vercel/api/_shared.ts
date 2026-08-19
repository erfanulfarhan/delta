import { sign } from '../../../packages/attest/src/index.js';

const ALLOWED = process.env.ALLOWED_ORIGINS ?? '*';

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '*';
  const allow =
    ALLOWED === '*'
      ? '*'
      : ALLOWED.split(',').map((s) => s.trim()).includes(origin)
        ? origin
        : 'null';

  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Timing-Allow-Origin': '*',
    // Without this the browser cannot read the attestation and every result
    // arrives unverified.
    'Access-Control-Expose-Headers': 'X-Delta-Attest, X-Bytes-Received',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
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

export const preflight = (request: Request): Response =>
  new Response(null, { status: 204, headers: corsHeaders(request) });
