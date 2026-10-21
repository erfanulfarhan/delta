import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nearestOrigins, run } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../../services/mock/src/server.js');

const running: ChildProcess[] = [];

async function startMock(port: number, env: Record<string, string>): Promise<string> {
  const child = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  running.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock did not start')), 5000);
    child.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('Mbps') || d.toString().includes('unthrottled')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return `http://127.0.0.1:${port}`;
}

const stats = async (origin: string) =>
  (await (await fetch(`${origin}/stats`)).json()) as Record<string, number>;

// Nothing listens on these, so connecting is refused at once.
const DEAD = ['http://127.0.0.1:8310', 'http://127.0.0.1:8311'];

/**
 * Each mock stands in for one hostname whose connection landed somewhere: a
 * PoP code in /meta and a round trip to match, 2 ms for Dhaka and 60 ms for
 * Marseille.
 */
const near = (port: number) => startMock(port, { MOCK_COLO: 'DAC', MOCK_LATENCY_MS: '2' });
const far = (port: number) => startMock(port, { MOCK_COLO: 'MRS', MOCK_LATENCY_MS: '60' });

let dhaka1: string;
let dhaka2: string;
let marseille1: string;
let marseille2: string;
let dhakaFallback: string;

beforeAll(async () => {
  [dhaka1, dhaka2, marseille1, marseille2, dhakaFallback] = await Promise.all([
    near(8301),
    near(8302),
    far(8303),
    far(8304),
    near(8305),
  ]);
});

afterAll(() => {
  for (const child of running) child.kill();
});

describe('choosing origins by where their connections land', () => {
  it('keeps only the mirrors whose connection reached the nearest PoP', async () => {
    const choice = await nearestOrigins([marseille1, dhaka1, marseille2, dhaka2]);
    expect(choice.origins).toEqual([dhaka1, dhaka2]);
    expect(choice.meta?.colo).toBe('DAC');
  });

  it('follows the nearest PoP even when farther connections outnumber it', async () => {
    const choice = await nearestOrigins([marseille1, marseille2, dhaka1]);
    expect(choice.origins).toEqual([dhaka1]);
  });

  it('turns to the fallback only when no origin reached the nearest PoP', async () => {
    expect((await nearestOrigins([marseille1, marseille2], [dhakaFallback])).origins).toEqual([dhakaFallback]);
    // Never mixed in alongside an origin that made it.
    expect((await nearestOrigins([marseille1, dhaka1], [dhakaFallback])).origins).toEqual([dhaka1]);
  });

  it('keeps every origin that answers when none reports a PoP', async () => {
    const plain = await Promise.all([8306, 8307].map((p) => startMock(p, { MOCK_LATENCY_MS: '2' })));
    expect((await nearestOrigins(plain)).origins).toEqual(plain);
  });

  it('leaves out an origin that does not answer, or answers too slowly', async () => {
    const stalled = await startMock(8308, { MOCK_COLO: 'DAC', MOCK_LATENCY_MS: '5000' });
    const started = performance.now();
    const choice = await nearestOrigins([DEAD[0]!, stalled, dhaka1]);
    expect(choice.origins).toEqual([dhaka1]);
    // Bounded by the metadata time limit, not by the stalled endpoint.
    expect(performance.now() - started).toBeLessThan(4500);
  }, 10_000);

  it('returns the origins unchanged when none of them answers', async () => {
    const choice = await nearestOrigins(DEAD);
    expect(choice).toEqual({ origins: DEAD, meta: null });
  });
});

/**
 * Just enough XMLHttpRequest for the upload phase to run under Node: the body
 * goes by fetch, and progress arrives once, when it has all been sent.
 */
class FetchXhr {
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  private url = '';
  private readonly controller = new AbortController();

  open(_method: string, url: string) {
    this.url = url;
  }

  send(body: Blob) {
    fetch(this.url, { method: 'POST', body, signal: this.controller.signal })
      .then(() => {
        this.upload.onprogress?.({ loaded: body.size });
        this.onload?.();
      })
      .catch(() => this.onabort?.());
  }

  abort() {
    this.controller.abort();
  }

  getResponseHeader() {
    return null;
  }
}

describe('a run through mirrors that landed in different places', () => {
  it('measures ping, download and upload only through the nearest', async () => {
    const [farAway, nearby] = await Promise.all([
      startMock(8309, { MOCK_COLO: 'MRS', MOCK_LATENCY_MS: '60', MOCK_MBPS: '50' }),
      startMock(8312, { MOCK_COLO: 'DAC', MOCK_LATENCY_MS: '2', MOCK_MBPS: '50' }),
    ]);
    vi.stubGlobal('XMLHttpRequest', FetchXhr);
    try {
      const result = await run({
        baseUrl: farAway,
        origins: [farAway, nearby],
        mode: 'test',
        config: { transferMs: 1000, pingSamples: 4 },
      });

      expect(result.meta?.colo).toBe('DAC');
      expect(result.pingMs).toBeLessThan(30);
      expect(result.downloadMbps).toBeGreaterThan(0);
      expect(result.uploadMbps).toBeGreaterThan(0);

      // The far mirror was only asked where it was, and timed once.
      expect(await stats(farAway)).toEqual({ meta: 1, ping: 1, download: 0, upload: 0 });
      const used = await stats(nearby);
      expect(used.download).toBeGreaterThan(0);
      expect(used.upload).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
