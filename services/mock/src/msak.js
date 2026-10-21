import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

/**
 * Mock of a Measurement Lab server: the Locate service plus MSAK's throughput1
 * protocol, with deliberate shaping.
 *
 * The Raw side of Delta talks to M-Lab, and M-Lab cannot be shaped on demand,
 * so without this the Raw code path could only ever be tested at whatever speed
 * the developer's own connection happens to have. It follows the real server
 * where it matters to the client: the subprotocol, the required `streams`
 * option, message sizes that start at 1 KB and grow to 1 MB, measurements every
 * 100 to 400 ms carrying TCP_INFO in microseconds, and the habit of rejecting
 * any text frame that is not a JSON measurement.
 *
 *   PORT=8181 MOCK_MBPS=13 MOCK_UP_MBPS=8 MOCK_RTT_MS=175 node src/msak.js
 *
 * Point the site at it with VITE_MLAB_LOCATE_URL=http://127.0.0.1:8181.
 */
const PORT = Number(process.env.PORT ?? 8181);
const DOWN_MBPS = Number(process.env.MOCK_MBPS ?? 0); // 0 = unthrottled
const UP_MBPS = Number(process.env.MOCK_UP_MBPS ?? process.env.MOCK_MBPS ?? 0);
const RTT_MS = Number(process.env.MOCK_RTT_MS ?? 50);
const RTTVAR_MS = Number(process.env.MOCK_RTTVAR_MS ?? 2);
// 204 imitates M-Lab's daily limit; any other status imitates an outage.
const LOCATE_STATUS = Number(process.env.MOCK_LOCATE_STATUS ?? 200);
const LOCATE_EMPTY = process.env.MOCK_LOCATE_EMPTY === '1';
// Pins the download message size instead of growing it. A short test never
// reaches the real server's large messages, and slow lines with large messages
// are exactly where counting bytes at arrival goes wrong.
const FIXED_MESSAGE = Number(process.env.MOCK_MESSAGE_BYTES ?? 0);
// Holds download frames and releases them together every this many ms, as a
// congested or tunnelled path does. On localhost every frame otherwise lands
// the instant it is sent, which hides the failure this exists to reproduce:
// several 1 MB messages arriving in the same instant.
const BURST_MS = Number(process.env.MOCK_BURST_MS ?? 0);
// Scales the reported BytesAcked, imitating a TCP-splitting proxy (a VPN, or a
// mobile network's "TCP optimiser") that acknowledges data before the client
// has it. The server's counter then runs ahead of what the client receives.
const ACK_FACTOR = Number(process.env.MOCK_ACK_FACTOR ?? 1);

const SUBPROTOCOL = 'net.measurementlab.throughput.v1';
const MIN_MESSAGE = 1 << 10;
const MAX_MESSAGE = 1 << 20;
const SCALING_FRACTION = 16;
const POOL = randomBytes(MAX_MESSAGE);

const stats = {
  invalidClientMessages: 0,
  clientMeasurements: 0,
  connections: { download: 0, upload: 0 },
  lastQuery: null,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One token bucket per direction, shared by every stream, because a real link
 * is shared. Per-stream shaping would let four streams deliver four times the
 * configured rate and make every slow-link test meaningless. Same burst
 * tolerance as the HTTP mock, for the same reason.
 */
function bucket(mbps) {
  const rate = mbps > 0 ? (mbps * 1_000_000) / 8 : Infinity;
  const max = Math.max(rate * 0.04, 64 * 1024);
  let tokens = 0;
  let last = Date.now();
  return {
    unlimited: rate === Infinity,
    /** `onTaken` sees each instalment, as a kernel counter sees each packet. */
    async take(n, onTaken = () => {}) {
      if (rate === Infinity) return onTaken(n);
      let remaining = n;
      while (remaining > 0) {
        const now = Date.now();
        tokens = Math.min(max, tokens + ((now - last) / 1000) * rate);
        last = now;
        const take = Math.min(remaining, tokens);
        tokens -= take;
        remaining -= take;
        if (take > 0) onTaken(take);
        if (remaining > 0) await sleep(Math.max(1, (Math.min(remaining, max) / rate) * 1000));
      }
    },
  };
}

const downBucket = bucket(DOWN_MBPS);
const upBucket = bucket(UP_MBPS);

/** Every 100 to 400 ms, averaging 250, as the real server does. */
const nextInterval = () => 100 + Math.random() * 300;

function measurement(start, counters, first, req) {
  const elapsedUs = Math.round((performance.now() - start) * 1000);
  const m = {
    Application: { BytesSent: counters.sent, BytesReceived: counters.received },
    Network: { BytesSent: counters.sent, BytesReceived: counters.received },
    ElapsedTime: elapsedUs,
    TCPInfo: {
      MinRTT: Math.round(RTT_MS * 1000),
      RTT: Math.round((RTT_MS + Math.random() * RTTVAR_MS) * 1000),
      RTTVar: Math.round(RTTVAR_MS * 1000),
      BytesAcked: Math.round(counters.sent * ACK_FACTOR),
      BytesReceived: counters.received,
      ElapsedTime: elapsedUs,
    },
  };
  if (first) {
    Object.assign(m, {
      CC: 'bbr',
      UUID: `mock_${randomUUID()}`,
      LocalAddr: `127.0.0.1:${PORT}`,
      RemoteAddr: `${req.socket.remoteAddress}:${req.socket.remotePort}`,
    });
  }
  return JSON.stringify(m);
}

function readClientText(data) {
  try {
    const m = JSON.parse(data.toString());
    if (typeof m !== 'object' || m === null || typeof m.Application !== 'object') throw new Error('shape');
    stats.clientMeasurements += 1;
    return true;
  } catch {
    stats.invalidClientMessages += 1;
    return false;
  }
}

async function runDownload(ws, req, durationMs) {
  const start = performance.now();
  // `sent` plays the kernel's BytesAcked: it rises as the shaper releases
  // bytes, packet by packet, while the client only ever sees whole messages.
  // That split is the one the real server has, and the one Delta relies on.
  const counters = { sent: 0, received: 0 };
  let size = FIXED_MESSAGE > 0 ? FIXED_MESSAGE : MIN_MESSAGE;
  let written = 0;
  let first = true;
  let open = true;
  ws.on('close', () => {
    open = false;
  });

  // Frames go out in order either way; with bursts on they wait for the next
  // release. Reports travel in the same stream, so they are held too, and only
  // the server timestamps inside them survive the trip intact.
  const held = [];
  const out = (data, binary) => {
    if (BURST_MS > 0) held.push([data, binary]);
    else ws.send(data, { binary });
  };
  const release = BURST_MS > 0
    ? setInterval(() => {
        for (const [data, binary] of held.splice(0)) if (open) ws.send(data, { binary });
      }, BURST_MS)
    : null;

  // Reports on their own timer, each a snapshot taken when it fires, as the
  // real server's measurer works independently of its writes.
  let timer;
  const report = () => {
    if (!open) return;
    out(measurement(start, counters, first, req), false);
    first = false;
    timer = setTimeout(report, nextInterval());
  };
  timer = setTimeout(report, nextInterval());

  while (open && performance.now() - start < durationMs) {
    await downBucket.take(size, (n) => {
      counters.sent += n;
    });
    if (!open) break;
    // Back off while the client is behind, instead of queueing without limit.
    while (open && ws.bufferedAmount > 8 * MAX_MESSAGE) await sleep(2);
    out(POOL.subarray(0, size), true);
    written += size;
    if (!FIXED_MESSAGE && size < MAX_MESSAGE && size <= written / SCALING_FRACTION) {
      size = Math.min(size * 2, MAX_MESSAGE);
    }
    // Yield, or an unthrottled loop would starve the timers and the reader.
    if (downBucket.unlimited) await new Promise((r) => setImmediate(r));
  }
  clearTimeout(timer);
  if (release) clearInterval(release);
  if (!open) return;
  for (const [data, binary] of held.splice(0)) ws.send(data, { binary });
  ws.send(measurement(start, counters, false, req));
  ws.close(1000, 'Done sending');
}

function runUpload(ws, req, durationMs) {
  const start = performance.now();
  const counters = { sent: 0, received: 0 };
  let first = true;
  let open = true;
  const socket = ws._socket;

  // Shaping by backpressure: stop reading the socket while out of credit, so
  // TCP flow control slows the client down as a real bottleneck would. The
  // client can still pour megabytes into kernel buffers first, which is
  // exactly why Delta counts what the server reports rather than what it sent.
  let reading = Promise.resolve();
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      counters.received += data.length;
      if (!readClientText(data)) ws.close(1003, 'invalid measurement');
      return;
    }
    const n = data.length;
    reading = reading.then(async () => {
      if (upBucket.unlimited) {
        counters.received += n;
        return;
      }
      socket.pause();
      await upBucket.take(n, (k) => {
        counters.received += k;
      });
      if (open) socket.resume();
    });
  });

  const report = () => {
    if (!open) return;
    if (performance.now() - start >= durationMs) {
      ws.send(measurement(start, counters, false, req));
      ws.close(1000, 'Done sending');
      return;
    }
    ws.send(measurement(start, counters, first, req));
    first = false;
    setTimeout(report, nextInterval());
  };
  setTimeout(report, nextInterval());
  ws.on('close', () => {
    open = false;
  });
}

const wss = new WebSocketServer({ noServer: true });

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (url.pathname === '/v2/nearest/msak/throughput1') {
    if (LOCATE_STATUS !== 200) {
      res.writeHead(LOCATE_STATUS);
      return res.end();
    }
    const site = url.searchParams.get('site') ?? 'mock01';
    const query = new URLSearchParams({
      access_token: 'mock-token',
      client_name: url.searchParams.get('client_name') ?? '',
      client_version: url.searchParams.get('client_version') ?? '',
      site,
    });
    const base = `ws://127.0.0.1:${PORT}/throughput/v1`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        results: LOCATE_EMPTY
          ? []
          : [
              {
                machine: `mlab1-${site}.mock.measurement-lab.org`,
                location: { city: 'Mockville', country: 'ZZ' },
                urls: {
                  'ws:///throughput/v1/download': `${base}/download?${query}`,
                  'ws:///throughput/v1/upload': `${base}/upload?${query}`,
                },
              },
            ],
      }),
    );
  }

  if (url.pathname === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(stats));
  }

  res.writeHead(404);
  res.end();
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const kind = url.pathname.endsWith('/download') ? 'download' : url.pathname.endsWith('/upload') ? 'upload' : null;
  const reject = (status) => {
    socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  // The real server answers 400 to both of these before upgrading.
  if (!kind || req.headers['sec-websocket-protocol'] !== SUBPROTOCOL) return reject(400);
  if (!url.searchParams.get('streams') || !url.searchParams.get('access_token')) return reject(400);

  stats.lastQuery = Object.fromEntries(url.searchParams);
  wss.handleUpgrade(req, socket, head, (ws) => {
    stats.connections[kind] += 1;
    const durationMs = Number(url.searchParams.get('duration') ?? 5000);
    ws.on('error', () => {});
    if (kind === 'download') {
      ws.on('message', (data, isBinary) => {
        if (!isBinary && !readClientText(data)) ws.close(1003, 'invalid measurement');
      });
      runDownload(ws, req, durationMs).catch(() => {});
    } else {
      runUpload(ws, req, durationMs);
    }
  });
});

process.on('unhandledRejection', (err) => console.error('[unhandled]', err?.code ?? err));

server.listen(PORT, '127.0.0.1', () => {
  const shape = (m) => (m > 0 ? `${m} Mbps` : 'unthrottled');
  console.log(
    `[msak mock] http://127.0.0.1:${PORT}  down ${shape(DOWN_MBPS)}, up ${shape(UP_MBPS)}, rtt ${RTT_MS} ms`,
  );
});
