import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { measureDownload } from '../src/index.js';
import { DEFAULT_CONFIG, type EngineConfig } from '../src/types.js';
import { judge } from '../../attest/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../../services/mock/src/server.js');
const SECRET = 'e2e-signing-secret';

let child: ChildProcess | null = null;
afterAll(() => child?.kill());

async function startMock(port: string, mbps: string): Promise<string> {
  child = spawn('node', [serverPath], {
    env: { ...process.env, PORT: port, MOCK_MBPS: mbps, MOCK_LABEL: 'attest', SIGNING_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock did not start')), 5000);
    child!.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('Mbps')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return `http://127.0.0.1:${port}`;
}

/**
 * The whole verification chain, end to end: a real measurement against a real
 * signing endpoint, judged by the real verifier. Every piece is individually
 * unit tested, but the parts that break in practice are the joins between them
 * (a session that differs between legs, a header the browser cannot read, a
 * payload separator that collides with a field).
 */
describe('attestation flow', () => {
  it('produces tokens that verify a genuine result and reject an inflated one', async () => {
    const baseUrl = await startMock('8097', '100');
    const cfg: EngineConfig = {
      ...DEFAULT_CONFIG,
      baseUrl,
      mode: 'test',
      session: 'e2esession',
      transferMs: 3000,
    };

    const tokens: string[] = [];
    const result = await measureDownload(cfg, () => {}, undefined, (t) => tokens.push(t));

    expect(tokens.length).toBeGreaterThan(3);
    expect(result.mbps).toBeGreaterThan(70);

    // The honest claim passes.
    const honest = await judge(
      {
        tokens,
        session: 'e2esession',
        claimedDownMbps: result.mbps,
        claimedUpMbps: 0,
        // The verifier never takes the phase duration from the client; it is a
        // protocol constant. These tests shorten it, so they must say so.
        transferMs: 3000,
      },
      SECRET,
    );
    expect(honest.verified, `verdict: ${honest.reason}`).toBe(true);

    // The same tokens cannot support a claim of gigabit.
    const inflated = await judge(
      { tokens, session: 'e2esession', claimedDownMbps: 950, claimedUpMbps: 0, transferMs: 3000 },
      SECRET,
    );
    expect(inflated.verified).toBe(false);

    // And the tokens are worthless to anyone without the signing key.
    const wrongKey = await judge(
      {
        tokens,
        session: 'e2esession',
        claimedDownMbps: result.mbps,
        claimedUpMbps: 0,
        transferMs: 3000,
      },
      'not-the-secret',
    );
    expect(wrongKey.verified).toBe(false);
  }, 30_000);
});
