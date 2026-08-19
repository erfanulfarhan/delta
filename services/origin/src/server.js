import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * RAW endpoint. Runs on the Singapore host.
 *
 * Traffic here crosses the ISP's international (IIG) capacity, which on a
 * typical Bangladeshi package is a fraction of local capacity. That gap is the
 * entire point of the product, so this endpoint must NOT sit behind a CDN: a
 * proxy with a Dhaka presence in front of it would serve from Bangladesh and
 * turn the RAW number into a second BDIX number.
 *
 * Serves bytes only. /meta lives on the Worker, which gets ISP and ASN for
 * free from request.cf.
 */
const PORT = Number(process.env.PORT ?? 8080);
const SERVER_LABEL = process.env.SERVER_LABEL ?? 'Singapore origin';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? '*';

const MAX_BYTES = 128 * 1024 * 1024;
const BLOCK = 64 * 1024;

// 4 MB of pre-generated randomness, cycled. Generating per request would make
// the CPU the bottleneck on a free-tier ARM box and we would be measuring
// entropy generation rather than the network.
const POOL = randomBytes(4 * 1024 * 1024);

function cors(req, res) {
  const origin = req.headers.origin ?? '*';
  const allow =
    ALLOWED_ORIGINS === '*'
      ? '*'
      : ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin)
        ? origin
        : 'null';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Timing-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
}

async function serveDownload(url, res) {
  const requested = Number(url.searchParams.get('bytes') ?? BLOCK);
  const total = Math.min(Math.max(requested, 0) || BLOCK, MAX_BYTES);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(total));
  res.setHeader('Content-Encoding', 'identity');
  res.writeHead(200);

  let sent = 0;
  while (sent < total && !res.destroyed) {
    const size = Math.min(BLOCK, total - sent);
    const offset = sent % (POOL.length - size);
    if (!res.write(POOL.subarray(offset, offset + size))) {
      await new Promise((r) => res.once('drain', r));
    }
    sent += size;
  }
  res.end();
}

// Last-resort guard. A speedtest deliberately aborts connections constantly,
// and a stray socket error must degrade one request rather than end the
// process and take every other in-flight measurement with it.
process.on('unhandledRejection', (err) => console.error('[unhandled]', err?.code ?? err));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    switch (url.pathname) {
      case '/ping':
        res.writeHead(204);
        return res.end();

      case '/download':
        return serveDownload(url, res);

      case '/upload': {
        // Must be fully drained. Responding early truncates the client's
        // upload and the measured figure becomes socket buffer size.
        let received = 0;
        // Clients abort uploads at the duration boundary by design, so the
        // resulting ECONNRESET is routine. Unhandled it becomes an unhandled
        // rejection and kills the process on every test.
        req.on('error', () => {});
        try {
          for await (const chunk of req) received += chunk.length;
        } catch {
          return;
        }
        if (res.destroyed) return;
        res.writeHead(204, { 'X-Bytes-Received': String(received) });
        return res.end();
      }

      case '/health':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, server: SERVER_LABEL }));

      default:
        res.writeHead(404);
        return res.end();
    }
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// Speedtest connections are long-lived by design; the default 5s header
// timeout would cut transfers off mid-measurement.
server.keepAliveTimeout = 30_000;
server.headersTimeout = 35_000;

server.listen(PORT, () => console.log(`[origin] ${SERVER_LABEL} listening on :${PORT}`));
