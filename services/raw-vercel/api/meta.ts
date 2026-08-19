import { corsHeaders, preflight } from './_shared.js';

export const config = { runtime: 'nodejs' };

/**
 * Reports where this function actually ran.
 *
 * Not decoration: if these functions are not pinned to Singapore the Raw
 * measurement is meaningless, and this is how the interface and the deploy
 * script can tell.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request);

  return Response.json(
    {
      server: 'Singapore (sin1)',
      region: process.env.VERCEL_REGION ?? 'unknown',
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '',
      isp: '',
      asn: '',
      city: '',
      country: request.headers.get('x-vercel-ip-country') ?? '',
    },
    { headers: corsHeaders(request) },
  );
}
