import { corsHeaders, preflight } from './_shared.js';

export const config = { runtime: 'nodejs' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
