import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  hostOf,
  latencyFromTcp,
  locateMlab,
  measureMlabDownload,
  measureMlabUpload,
  MlabError,
  runMlab,
  type MlabClient,
} from '../src/index.js';
import { DEFAULT_CONFIG } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../../services/mock/src/msak.js');

const running: ChildProcess[] = [];

async function startMock(env: Record<string, string>): Promise<string> {
  const child = spawn('node', [serverPath], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  running.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('msak mock did not start')), 5000);
    child.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('[msak mock]')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return `http://127.0.0.1:${env.PORT}`;
}

afterAll(() => {
  for (const child of running) child.kill();
});

const client: MlabClient = { name: 'delta-test', version: '0.0.0' };

const cfg = {
  transferMs: 3000,
  streams: 4,
  bucketMs: DEFAULT_CONFIG.bucketMs,
  rampFraction: DEFAULT_CONFIG.rampFraction,
  trimFraction: DEFAULT_CONFIG.trimFraction,
};

const average = (r: { bytesTotal: number; durationMs: number }) =>
  (r.bytesTotal * 8) / (r.durationMs / 1000) / 1_000_000;

// On the bursty path below, kernel counters read 103 to 105 Mbps against a
// shaped 100; counting arrivals read 131 to 136.
const BURST_LIMIT = 120;

describe('M-Lab locate', () => {
  it('returns signed stream URLs for the requested site', async () => {
    const base = await startMock({ PORT: '8191', MOCK_MBPS: '50' });
    const target = await locateMlab('sin01', client, { locateUrl: base });
    expect(target.site).toBe('sin01');
    expect(target.machine).toContain('sin01');
    expect(target.downloadUrl).toContain('/throughput/v1/download');
    expect(target.downloadUrl).toContain('access_token=');
    expect(target.uploadUrl).toContain('/throughput/v1/upload');
  });

  it("reports M-Lab's daily limit in words, not as a crash", async () => {
    const base = await startMock({ PORT: '8192', MOCK_LOCATE_STATUS: '204' });
    const error = await locateMlab('sin01', client, { locateUrl: base, label: 'Singapore' }).catch((e) => e);
    expect(error).toBeInstanceOf(MlabError);
    expect((error as Error).message).toMatch(/40 tests a day/);
  });

  it('says which location is unavailable when Locate has nothing', async () => {
    const base = await startMock({ PORT: '8193', MOCK_LOCATE_EMPTY: '1' });
    const error = await locateMlab('hnd02', client, { locateUrl: base, label: 'Tokyo' }).catch((e) => e);
    expect(error).toBeInstanceOf(MlabError);
    expect((error as Error).message).toMatch(/no Tokyo server/);
  });

  it('fails gracefully when M-Lab cannot be reached at all', async () => {
    const error = await locateMlab('sin01', client, { locateUrl: 'http://127.0.0.1:9' }).catch((e) => e);
    expect(error).toBeInstanceOf(MlabError);
  });
});

describe('M-Lab throughput against a shaped link', () => {
  it('measures a 20 Mbps download within tolerance, with four streams sharing it', async () => {
    const base = await startMock({ PORT: '8194', MOCK_MBPS: '20' });
    const target = await locateMlab('sin01', client, { locateUrl: base });
    const { transfer } = await measureMlabDownload(target, cfg, client, () => {}, 'Singapore');

    // Four streams over one shared bucket. If each stream got its own budget
    // this would read about 80.
    expect(transfer.mbps).toBeGreaterThan(16);
    expect(transfer.mbps).toBeLessThan(28);
    expect(average(transfer)).toBeGreaterThan(16);
    expect(average(transfer)).toBeLessThan(24);
  }, 30_000);

  it('measures a 200 Mbps download within tolerance, with the same code path', async () => {
    const base = await startMock({ PORT: '8195', MOCK_MBPS: '200' });
    const target = await locateMlab('sin01', client, { locateUrl: base });
    const { transfer } = await measureMlabDownload(target, cfg, client, () => {}, 'Singapore');
    expect(transfer.mbps).toBeGreaterThan(160);
    expect(transfer.mbps).toBeLessThan(260);
  }, 30_000);

  it('measures a slow line carrying large messages', async () => {
    // At 8 Mbps shared by four streams, a 256 KB message takes each stream about
    // a second to arrive, so any per-message accounting is coarse here. The
    // kernel counter is not, and the average lands on the shaped rate.
    const base = await startMock({ PORT: '8196', MOCK_MBPS: '8', MOCK_MESSAGE_BYTES: '262144' });
    const target = await locateMlab('sin01', client, { locateUrl: base });
    const { transfer } = await measureMlabDownload(target, cfg, client, () => {}, 'Singapore');
    expect(average(transfer)).toBeGreaterThan(7);
    expect(average(transfer)).toBeLessThan(9);
    // The headline keeps the fastest 70 percent of windows, as Local's does;
    // measured 9.1 to 10.1 here.
    expect(transfer.mbps).toBeGreaterThan(7);
    expect(transfer.mbps).toBeLessThan(11);
  }, 30_000);

  it('is not fooled when the path delivers messages in bursts', async () => {
    // What a real path did: 1 MB messages landing several at once. Counted on
    // arrival, the windows swing between nothing and several times the line
    // rate, and keeping the fastest of them reports the bursts. The client
    // still received everything, so the server's smooth counter is trusted.
    const base = await startMock({ PORT: '8190', MOCK_MBPS: '100', MOCK_BURST_MS: '300' });
    const target = await locateMlab('sin01', client, { locateUrl: base });
    const { transfer } = await measureMlabDownload(target, cfg, client, () => {}, 'Singapore');
    expect(transfer.basis).toBe('server');
    expect(average(transfer)).toBeGreaterThan(85);
    expect(average(transfer)).toBeLessThan(112);
    expect(transfer.mbps).toBeGreaterThan(85);
    expect(transfer.mbps).toBeLessThan(BURST_LIMIT);
  }, 30_000);

  it('counts what reached the browser when a proxy acknowledges for it', async () => {
    // A TCP-splitting proxy (a VPN, a mobile "TCP optimiser") acknowledges data
    // the client does not have yet, so the server's counter runs ahead. Here it
    // claims twice what was delivered; the figure must follow delivery.
    const base = await startMock({ PORT: '8189', MOCK_MBPS: '40', MOCK_ACK_FACTOR: '2' });
    const target = await locateMlab('sin01', client, { locateUrl: base });
    const { transfer } = await measureMlabDownload(target, cfg, client, () => {}, 'Singapore');
    expect(transfer.basis).toBe('client');
    expect(average(transfer)).toBeGreaterThan(32);
    expect(average(transfer)).toBeLessThan(46);
    expect(transfer.mbps).toBeLessThan(56);
  }, 30_000);

  it('counts upload from what the server reports receiving', async () => {
    const base = await startMock({ PORT: '8197', MOCK_MBPS: '100', MOCK_UP_MBPS: '15' });
    const target = await locateMlab('sin01', client, { locateUrl: base });
    const { transfer } = await measureMlabUpload(target, cfg, client, () => {}, 'Singapore');
    expect(transfer.basis).toBe('server');
    expect(average(transfer)).toBeGreaterThan(13);
    expect(average(transfer)).toBeLessThan(17);
    expect(transfer.mbps).toBeGreaterThan(11);
    expect(transfer.mbps).toBeLessThan(20);
  }, 30_000);

  it('speaks the protocol: four streams, BBR, a duration past the window, valid measurements', async () => {
    const base = await startMock({ PORT: '8198', MOCK_MBPS: '50' });
    const target = await locateMlab('sin01', client, { locateUrl: base });
    await measureMlabDownload(target, cfg, client, () => {}, 'Singapore');
    await measureMlabUpload(target, cfg, client, () => {}, 'Singapore');

    const stats = (await (await fetch(`${base}/stats`)).json()) as {
      invalidClientMessages: number;
      clientMeasurements: number;
      connections: { download: number; upload: number };
      lastQuery: Record<string, string>;
    };
    expect(stats.connections).toEqual({ download: 4, upload: 4 });
    expect(stats.invalidClientMessages).toBe(0);
    expect(stats.clientMeasurements).toBeGreaterThan(0);
    expect(stats.lastQuery.streams).toBe('4');
    expect(stats.lastQuery.cc).toBe('bbr');
    expect(Number(stats.lastQuery.duration)).toBeGreaterThan(cfg.transferMs);
    expect(stats.lastQuery.client_name).toBe('delta-test');
  }, 30_000);
});

describe('M-Lab full run', () => {
  it('takes ping from the kernel, not from timed requests, and names the machine', async () => {
    const base = await startMock({
      PORT: '8199',
      MOCK_MBPS: '60',
      MOCK_UP_MBPS: '30',
      MOCK_RTT_MS: '175',
      MOCK_RTTVAR_MS: '3',
    });
    const phases: string[] = [];
    const result = await runMlab({
      site: 'sin01',
      label: 'Singapore',
      client,
      mode: 'raw',
      locateUrl: base,
      config: { transferMs: 3000 },
      onEvent: (e) => {
        if (phases.at(-1) !== e.phase) phases.push(e.phase);
      },
    });

    expect(phases).toEqual(['latency', 'download', 'upload', 'done']);
    expect(result.pingMs).toBeCloseTo(175, 0);
    expect(result.jitterMs).toBeCloseTo(3, 0);
    expect(result.downloadMbps).toBeGreaterThan(48);
    expect(result.downloadMbps).toBeLessThan(80);
    expect(result.uploadMbps).toBeGreaterThan(22);
    expect(result.uploadMbps).toBeLessThan(40);
    expect(result.server).toMatchObject({ provider: 'mlab', site: 'sin01' });
    expect(result.meta?.ip).toBe('127.0.0.1');
    expect(result.tokens).toEqual([]);
  }, 40_000);
});

describe('M-Lab helpers', () => {
  it('strips ports from IPv4 and IPv6 addresses', () => {
    expect(hostOf('203.0.113.7:51234')).toBe('203.0.113.7');
    expect(hostOf('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(hostOf('2001:db8::1')).toBe('2001:db8::1');
  });

  it('ignores the opening second when reading jitter', () => {
    const latency = latencyFromTcp([
      { at: 0, minRttMs: 52, rttMs: 60, rttVarMs: 30, elapsedMs: 200 },
      { at: 1, minRttMs: 51, rttMs: 53, rttVarMs: 2, elapsedMs: 1200 },
      { at: 2, minRttMs: 51, rttMs: 54, rttVarMs: 4, elapsedMs: 1500 },
    ]);
    expect(latency.pingMs).toBe(51);
    expect(latency.jitterMs).toBe(3);
  });
});
