/**
 * BDIX endpoint.
 *
 * Cloudflare is a BDIX member with a Dhaka PoP, so for most Bangladeshi ISPs
 * a request to this Worker is served over local peering and never crosses the
 * ISP's international capacity. That is what makes it stand in for a BDIX
 * server. It is an approximation, not a certified BDIX host, and the interface
 * says so rather than overclaiming.
 *
 * This Worker also owns /meta for the whole application, because `request.cf`
 * gives ISP, ASN and city for free and accurate. The Singapore origin serves
 * bytes only.
 */

const MAX_BYTES = 128 * 1024 * 1024;
const BLOCK = 64 * 1024;

// One block of random bytes, reused. Incompressible is the property that
// matters; regenerating per request would just burn CPU time.
const POOL = (() => {
  const buf = new Uint8Array(BLOCK);
  crypto.getRandomValues(buf);
  return buf;
})();

function corsHeaders(env, request) {
  const allowed = env.ALLOWED_ORIGINS ?? '*';
  const origin = request.headers.get('Origin') ?? '*';
  const allow =
    allowed === '*' ? '*' : allowed.split(',').map((s) => s.trim()).includes(origin) ? origin : 'null';

  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Without this, cross-origin Resource Timing is redacted and any fallback
    // timing path silently reports zeros.
    'Timing-Allow-Origin': '*',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    switch (url.pathname) {
      case '/ping':
        return new Response(null, { status: 204, headers: cors });

      case '/download': {
        const requested = Number(url.searchParams.get('bytes') ?? BLOCK);
        const total = Math.min(Math.max(requested, 0) || BLOCK, MAX_BYTES);

        // Streamed rather than buffered so the browser starts receiving
        // immediately. Buffering the whole body first would put the Worker's
        // own assembly time inside the measurement window.
        let sent = 0;
        const stream = new ReadableStream({
          pull(controller) {
            if (sent >= total) return controller.close();
            const size = Math.min(BLOCK, total - sent);
            controller.enqueue(size === BLOCK ? POOL : POOL.subarray(0, size));
            sent += size;
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            ...cors,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(total),
            'Content-Encoding': 'identity',
          },
        });
      }

      case '/upload': {
        // The body must actually be consumed. Returning without draining it
        // means the client's upload is cut short and the measured figure is
        // whatever fit in the socket buffer.
        let received = 0;
        const reader = request.body?.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
          }
        }
        return new Response(null, {
          status: 204,
          headers: { ...cors, 'X-Bytes-Received': String(received) },
        });
      }

      case '/meta': {
        const cf = request.cf ?? {};
        return new Response(
          JSON.stringify({
            ip: request.headers.get('CF-Connecting-IP') ?? '',
            isp: cf.asOrganization ?? 'Unknown',
            asn: cf.asn ? `AS${cf.asn}` : '',
            city: cf.city ?? '',
            country: cf.country ?? '',
            server: env.SERVER_LABEL ?? 'Cloudflare edge',
            colo: cf.colo ?? '',
          }),
          { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }

      default:
        return new Response('Not found', { status: 404, headers: cors });
    }
  },
};
