import type { IncomingMessage, ServerResponse } from 'node:http';
import { cors, handledPreflight } from './_shared.js';

/**
 * Reports where this function actually ran.
 *
 * Not decoration: if these functions are not pinned to Singapore the Raw
 * measurement is meaningless, and this is how the deploy script and the
 * interface can tell.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  cors(req, res);
  if (handledPreflight(req, res)) return;

  const forwarded = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  const region = process.env.VERCEL_REGION ?? 'unknown';

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      server: region === 'sin1' ? 'Singapore (sin1)' : `Vercel ${region}`,
      region,
      colo: region,
      ip: forwarded.split(',')[0]?.trim() ?? '',
      isp: '',
      asn: '',
      city: '',
      country: (req.headers['x-vercel-ip-country'] as string | undefined) ?? '',
    }),
  );
}
