import type { IncomingMessage, ServerResponse } from 'node:http';
import net from 'node:net';
import { cors, handledPreflight } from './_shared.js';

/**
 * Try to open a TCP connection back to the caller on a port they nominate.
 *
 * This is the only test that actually answers "can I seed a torrent". Every
 * other signal is inference; this either connects or it does not. The caller
 * needs something already listening, which for the intended use is their
 * torrent client.
 *
 * SECURITY: the target is always the requesting address, read from the proxy
 * header, and never anything the caller supplies. An endpoint that connected to
 * a caller-specified host would be an open port scanner running at our expense,
 * and would deserve to be shut down.
 */

const CONNECT_TIMEOUT_MS = 6000;

type Outcome = 'open' | 'closed' | 'filtered' | 'error';

function attempt(host: string, port: number): Promise<{ outcome: Outcome; detail: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (outcome: Outcome, detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ outcome, detail });
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => done('open', 'inbound connection accepted'));
    // Silence means a router dropping packets, or carrier NAT with nowhere to
    // forward them to.
    socket.once('timeout', () => done('filtered', 'no response before timeout'));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      // Something answered and refused: the address is reachable, so nothing is
      // listening rather than the address being unreachable. That distinction is
      // the whole value of this test.
      if (err.code === 'ECONNREFUSED') done('closed', 'connection refused');
      else done('error', err.code ?? 'connect failed');
    });

    socket.connect(port, host);
  });
}

const MEANING: Record<Outcome, string> = {
  open: 'Reachable from the internet. Inbound connections work, so seeding and hosting will work on this port.',
  closed:
    'Your address is reachable, but nothing is listening on this port. Start the application, forward the port on your router, then test again.',
  filtered:
    'Nothing answered. Either the port is not forwarded, a firewall is dropping it, or your ISP has placed you behind a shared address you cannot forward through.',
  error: 'The attempt failed before it could reach a conclusion.',
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(req, res);
  if (handledPreflight(req, res)) return;

  const forwarded = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  const ip = forwarded.split(',')[0]?.trim() ?? '';
  const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);
  const port = Number(url.searchParams.get('port'));

  const fail = (code: number, error: string) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
  };

  if (!ip || ip.includes(':')) return fail(400, 'This test needs an IPv4 address to connect back to.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fail(400, 'Port must be between 1 and 65535.');
  }

  const { outcome, detail } = await attempt(ip, port);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({ ip, port, outcome, detail, meaning: MEANING[outcome], testedFrom: 'Singapore' }),
  );
}
