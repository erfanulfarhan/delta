import { attest, corsHeaders, preflight } from './_shared.js';

export const config = { runtime: 'nodejs' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request);

  const url = new URL(request.url);
  let received = 0;

  // The body must actually be drained. Replying before reading it truncates the
  // client's upload, and the figure measured becomes socket buffer size rather
  // than throughput. A client aborting mid-upload is routine here, because the
  // engine cuts every upload at its duration boundary, so a read error is not
  // an error condition.
  const reader = request.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
      }
    } catch {
      // client went away mid-upload
    }
  }

  const token = await attest(url, 'up', received);

  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      'X-Bytes-Received': String(received),
      ...(token ? { 'X-Delta-Attest': token } : {}),
    },
  });
}
