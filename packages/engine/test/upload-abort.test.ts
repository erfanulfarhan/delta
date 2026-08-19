import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../../services/mock/src/server.js');

let child: ChildProcess | null = null;
afterAll(() => child?.kill());

/**
 * Regression: a client aborting an upload mid-flight used to kill the server.
 *
 * The engine cuts every upload at the duration boundary, so this happens on
 * every single test run. `for await (const chunk of req)` raises ECONNRESET,
 * which inside an async handler became an unhandled rejection and exited the
 * process, taking every other in-flight measurement down with it.
 */
describe('endpoint survives aborted uploads', () => {
  it('stays alive and serving after a client disconnects mid-upload', async () => {
    child = spawn('node', [serverPath], {
      env: { ...process.env, PORT: '8096', MOCK_MBPS: '20', MOCK_LABEL: 'abort' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('did not start')), 5000);
      child!.stdout!.on('data', (d: Buffer) => {
        if (d.toString().includes('Mbps')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const base = 'http://127.0.0.1:8096';

    // Abort several uploads mid-flight, the way the engine does.
    for (let i = 0; i < 4; i += 1) {
      const controller = new AbortController();
      const body = new Uint8Array(8 * 1024 * 1024);
      const request = fetch(`${base}/upload`, {
        method: 'POST',
        body,
        signal: controller.signal,
        // @ts-expect-error node-specific, required to stream a body
        duplex: 'half',
      }).catch(() => {});
      setTimeout(() => controller.abort(), 25);
      await request;
    }

    await new Promise((r) => setTimeout(r, 300));

    // The process must still be alive and still answering.
    expect(child!.exitCode).toBeNull();
    const ping = await fetch(`${base}/ping`);
    expect(ping.status).toBe(204);

    // And a normal upload must still succeed afterwards.
    const ok = await fetch(`${base}/upload`, {
      method: 'POST',
      body: new Uint8Array(256 * 1024),
    });
    expect(ok.status).toBe(204);
  }, 30_000);
});
