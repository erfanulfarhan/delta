import type { IncomingMessage, ServerResponse } from 'node:http';
import { promises as dns } from 'node:dns';
import { cors, handledPreflight } from './_shared.js';

/**
 * What kind of address the ISP has actually handed this connection.
 *
 * The real question behind "is my IP shared" is whether inbound connections can
 * reach you: seeding a torrent, hosting a game, reaching your own NAS from
 * outside. That has exactly one definitive answer, which /api/portcheck gives,
 * plus several strong hints, which is what this returns.
 */

/** RFC 6598 carrier-grade NAT space: 100.64.0.0/10. */
function isSharedAddressSpace(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  return p[0] === 100 && p[1]! >= 64 && p[1]! <= 127;
}

/**
 * ISPs habitually encode the address type in reverse DNS. "cgn" and "shared"
 * are explicit; "pool" and "dynamic" mean a rotating address, which usually
 * cannot accept inbound connections either even when it is not carrier NAT.
 */
const CGNAT_HINTS = ['cgn', 'cgnat', 'shared'];
const DYNAMIC_HINTS = ['pool', 'dynamic', 'dhcp', 'dyn-'];

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(req, res);
  if (handledPreflight(req, res)) return;

  const forwarded = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  const ip = forwarded.split(',')[0]?.trim() ?? '';

  if (!ip) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'could not determine address' }));
    return;
  }

  // Bounded, because an address with no PTR record does not fail fast: the
  // resolver retries until its own timeout, which measured 28 seconds and left
  // the interface saying "checking" for half a minute. A missing PTR is a
  // perfectly good answer, so stop waiting for one after 1.5s.
  const ptr = await Promise.race([
    dns.reverse(ip).then((names) => names[0] ?? null).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
  ]);

  const lower = (ptr ?? '').toLowerCase();
  const shared = isSharedAddressSpace(ip);
  const ptrCgnat = CGNAT_HINTS.some((h) => lower.includes(h));
  const ptrDynamic = DYNAMIC_HINTS.some((h) => lower.includes(h));

  const verdict = shared
    ? 'shared'
    : ptrCgnat
      ? 'likely-shared'
      : ptrDynamic
        ? 'dynamic'
        : 'likely-public';

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      ip,
      family: ip.includes(':') ? 'IPv6' : 'IPv4',
      reverseDns: ptr,
      isSharedAddressSpace: shared,
      verdict,
      // Never presented as proof: only an inbound connection attempt settles it.
      confidence: shared ? 'certain' : ptr ? 'hint' : 'unknown',
    }),
  );
}
