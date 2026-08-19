import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { measureDownload, measureLatency } from '../src/index.js';
import { DEFAULT_CONFIG, type EngineConfig } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../../services/mock/src/server.js');

const running: ChildProcess[] = [];

async function startMock(env: Record<string, string>): Promise<string> {
  const child = spawn('node', [serverPath], {
    env: { ...process.env, ...env },
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
  return `http://127.0.0.1:${env.PORT}`;
}

const config = (baseUrl: string): EngineConfig => ({
  ...DEFAULT_CONFIG,
  baseUrl,
  mode: 'test',
  transferMs: 3000,
});

afterAll(() => {
  for (const child of running) child.kill();
});

describe('engine against a shaped link', () => {
  it('measures a 5 Mbps link within tolerance', async () => {
    const baseUrl = await startMock({ PORT: '8091', MOCK_MBPS: '5', MOCK_LABEL: 'slow' });
    const result = await measureDownload(config(baseUrl), () => {});
    expect(result.mbps).toBeGreaterThan(4);
    expect(result.mbps).toBeLessThan(6.5);
  }, 30_000);

  it('measures a 200 Mbps link within tolerance, with the same code path', async () => {
    const baseUrl = await startMock({ PORT: '8092', MOCK_MBPS: '200', MOCK_LABEL: 'fast' });
    const result = await measureDownload(config(baseUrl), () => {});
    expect(result.mbps).toBeGreaterThan(150);
    expect(result.mbps).toBeLessThan(260);
  }, 30_000);

  it('does not let six concurrent streams multiply the shaped rate', async () => {
    // Guards the shared token bucket in the mock. If shaping were per-request
    // this reads ~6x the configured rate and every slow-link test is a lie.
    const baseUrl = await startMock({ PORT: '8093', MOCK_MBPS: '20', MOCK_LABEL: 'shared' });
    const result = await measureDownload(config(baseUrl), () => {});
    expect(result.mbps).toBeLessThan(35);
  }, 30_000);

  it('reports latency close to the shaped delay, and low jitter when steady', async () => {
    const baseUrl = await startMock({
      PORT: '8094',
      MOCK_MBPS: '100',
      MOCK_LATENCY_MS: '40',
      MOCK_LABEL: 'latent',
    });
    const result = await measureLatency(baseUrl, 8);
    expect(result.pingMs).toBeGreaterThan(35);
    expect(result.pingMs).toBeLessThan(70);
    expect(result.jitterMs).toBeLessThan(20);
  }, 30_000);

  it('emits live samples during the transfer for the gauge to consume', async () => {
    const baseUrl = await startMock({ PORT: '8095', MOCK_MBPS: '50', MOCK_LABEL: 'live' });
    const seen: number[] = [];
    await measureDownload(config(baseUrl), (bytes) => seen.push(bytes));
    expect(seen.length).toBeGreaterThan(10);
  }, 30_000);
});
