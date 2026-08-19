import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * Mock endpoint implementing the speedtest contract with deliberate throttling.
 *
 * This exists so a 5 Mbps path and a 900 Mbps path can both be exercised on
 * demand. Without it the accuracy decisions in the engine (ramp discarding,
 * trimmed means, adaptive chunk sizing) are untestable, because a developer
 * machine on a fast local link only ever exercises one end of the range.
 *
 *   MOCK_MBPS=5 MOCK_LATENCY_MS=2  node src/server.js
 *   MOCK_MBPS=900 MOCK_LATENCY_MS=180 PORT=8081 node src/server.js
 */
const PORT = Number(process.env.PORT ?? 8080);
const MBPS = Number(process.env.MOCK_MBPS ?? 0); // 0 = unthrottled
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0);
const JITTER_MS = Number(process.env.MOCK_JITTER_MS ?? 0);
const LABEL = process.env.MOCK_LABEL ?? 'mock';

const MAX_BYTES = 128 * 1024 * 1024;
const BLOCK = 64 * 1024;

// Pre-generated pool of random bytes. Regenerating per request would make the
// server CPU the bottleneck and we would be measuring crypto, not the network.
// It stays incompressible, which is the property that actually matters.
const POOL = randomBytes(4 * 1024 * 1024);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const delay = () => {
  const jitter = JITTER_MS > 0 ? (Math.random() - 0.5) * 2 * JITTER_MS : 0;
  return Math.max(0, LATENCY_MS + jitter);
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Timing-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
}

/**
 * Global token bucket shared by every in-flight response.
 *
 * Shaping per request would be wrong in a way that quietly invalidates the
 * whole harness: the engine opens six concurrent streams, so a per-request
 * 5 Mbps limit would deliver 30 Mbps in total and the "slow link" test would
 * never exercise a slow link. A real link is shared, so the budget is shared.
 */
const RATE_BYTES_PER_SEC = MBPS > 0 ? (MBPS * 1_000_000) / 8 : Infinity;
let tokens = 0;
let lastRefill = Date.now();

async function takeTokens(n) {
  if (RATE_BYTES_PER_SEC === Infinity) return;
  for (;;) {
    const now = Date.now();
    tokens = Math.min(RATE_BYTES_PER_SEC, tokens + ((now - lastRefill) / 1000) * RATE_BYTES_PER_SEC);
    lastRefill = now;
    if (tokens >= n) {
      tokens -= n;
      return;
    }
    await sleep(Math.max(1, ((n - tokens) / RATE_BYTES_PER_SEC) * 1000));
  }
}

async function serveDownload(url, res) {
  const requested = Number(url.searchParams.get('bytes') ?? BLOCK);
  const total = Math.min(Math.max(requested, 0) || BLOCK, MAX_BYTES);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(total));
  // Explicitly identity: a compressing proxy in front of zeros is the classic
  // way to accidentally measure a fabricated gigabit.
  res.setHeader('Content-Encoding', 'identity');
  res.writeHead(200);

  let sent = 0;
  while (sent < total) {
    const size = Math.min(BLOCK, total - sent);
    await takeTokens(size);
    if (res.destroyed) return;
    const offset = sent % (POOL.length - size);
    if (!res.write(POOL.subarray(offset, offset + size))) {
      await new Promise((r) => res.once('drain', r));
    }
    sent += size;
  }
  res.end();
}

async function drainUpload(req, res) {
  let received = 0;
  for await (const chunk of req) {
    await takeTokens(chunk.length);
    received += chunk.length;
  }
  res.writeHead(204, { 'X-Bytes-Received': String(received) });
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    switch (url.pathname) {
      case '/ping': {
        const d = delay();
        if (d > 0) await sleep(d);
        res.writeHead(204);
        return res.end();
      }
      case '/download':
        if (LATENCY_MS > 0) await sleep(delay());
        return serveDownload(url, res);
      case '/upload':
        return drainUpload(req, res);
      case '/meta':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            ip: '127.0.0.1',
            isp: `Mock ISP (${LABEL})`,
            asn: 'AS0',
            city: 'Localhost',
            country: 'XX',
            server: `${LABEL} @ ${MBPS || 'unthrottled'} Mbps`,
          }),
        );
      default:
        res.writeHead(404);
        return res.end();
    }
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, () => {
  const shape = MBPS > 0 ? `${MBPS} Mbps` : 'unthrottled';
  console.log(`[mock:${LABEL}] :${PORT} ${shape}, latency ${LATENCY_MS}ms +/-${JITTER_MS}ms`);
});
