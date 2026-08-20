import type { IncomingMessage, ServerResponse } from 'node:http';
import net from 'node:net';
import { cors, handledPreflight } from './_shared.js';

/**
 * Try to open inbound TCP connections back to the caller.
 *
 * SECURITY: the target is always the requesting address, read from the proxy
 * header, never anything the caller supplies. An endpoint that connected to a
 * caller-specified host would be an open port scanner running at our expense.
 *
 * The ports are probed to answer "can the internet reach me", not "is this
 * service up". No ISP leaves inbound ports open by default: a home router drops
 * or rejects everything unsolicited. So the interesting outcome is not `open`,
 * it is the difference between a refusal and silence:
 *
 *   refused  - something answered and said no, so packets DO arrive. The address
 *              is genuinely yours and forwarding a port would work.
 *   silence  - nothing answered on any port. Either a drop-all firewall or the
 *              ISP has you behind a shared address with nowhere to forward to.
 *
 * These particular ports are chosen because consumer and ISP-managed routers
 * commonly have something bound to them, so they are the likeliest to reply.
 */

const DEFAULT_PORTS = [80, 443, 8080, 7547, 22];
const MAX_PORTS = 8;
const CONNECT_TIMEOUT_MS = 4000;

type Outcome = 'open' | 'refused' | 'silent' | 'error';

interface Probe {
  port: number;
  outcome: Outcome;
  detail: string;
}

function attempt(host: string, port: number): Promise<Probe> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (outcome: Outcome, detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, outcome, detail });
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => done('open', 'accepted'));
    socket.once('timeout', () => done('silent', 'no reply'));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') done('refused', 'refused');
      else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
        done('error', 'unreachable');
      } else done('silent', err.code ?? 'failed');
    });

    socket.connect(port, host);
  });
}

function verdictFor(probes: Probe[]): { reachable: boolean | null; headline: string; detail: string } {
  const anyOpen = probes.some((p) => p.outcome === 'open');
  const anyRefused = probes.some((p) => p.outcome === 'refused');

  if (anyOpen) {
    return {
      reachable: true,
      headline: 'Reachable',
      detail:
        'A connection from the internet reached you and was accepted. You have a genuinely public address, so port forwarding, seeding and hosting will all work.',
    };
  }
  if (anyRefused) {
    return {
      reachable: true,
      headline: 'Reachable',
      detail:
        'Your router answered and refused the connection, which means traffic from the internet does arrive at your address. Nothing is listening yet, so forward a port on your router and the service will be reachable.',
    };
  }
  return {
    reachable: false,
    headline: 'Not reachable',
    detail:
      'Nothing answered on any port. Either your router silently drops unsolicited traffic, or your ISP has placed you behind a shared address you cannot forward through. If forwarding a port on your router changes nothing, it is a shared address.',
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(req, res);
  if (handledPreflight(req, res)) return;

  const forwarded = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  const ip = forwarded.split(',')[0]?.trim() ?? '';
  const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);

  const fail = (code: number, error: string) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
  };

  if (!ip || ip.includes(':')) {
    return fail(400, 'This test needs an IPv4 address to connect back to.');
  }

  const requested = url.searchParams.get('ports');
  let ports = DEFAULT_PORTS;
  if (requested) {
    ports = requested
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
      .slice(0, MAX_PORTS);
    if (ports.length === 0) return fail(400, 'Ports must be between 1 and 65535.');
  }

  const probes = await Promise.all(ports.map((p) => attempt(ip, p)));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ip, testedFrom: 'Singapore', probes, ...verdictFor(probes) }));
}
