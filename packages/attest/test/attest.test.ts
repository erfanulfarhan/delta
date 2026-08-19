import { describe, expect, it } from 'vitest';
import { judge, sign, verify, type Attestation } from '../src/index.js';

const SECRET = 'test-secret-value';
const NOW = 1_760_000_000_000;

const att = (over: Partial<Attestation> = {}): Attestation => ({
  session: 'sess-1',
  direction: 'down',
  bytes: 1_000_000,
  at: NOW,
  ...over,
});

/** A run that genuinely moved `bytes` per token across `spanMs`. */
async function tokensFor(count: number, bytes: number, spanMs: number, direction: 'down' | 'up') {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(await sign(att({ direction, bytes, at: NOW + (spanMs * i) / (count - 1) }), SECRET));
  }
  return out;
}

describe('attestation signing', () => {
  it('round-trips a genuine token', async () => {
    const token = await sign(att(), SECRET);
    expect(await verify(token, SECRET)).toEqual(att());
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await sign(att(), 'other-secret');
    expect(await verify(token, SECRET)).toBeNull();
  });

  it('rejects a token whose byte count has been edited', async () => {
    const token = await sign(att({ bytes: 1_000 }), SECRET);
    const forged = token.replace('.1000.', '.999999999.');
    expect(await verify(forged, SECRET)).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    for (const junk of ['', 'a.b.c', 'a.b.c.d.e.f', 'not-a-token']) {
      expect(await verify(junk, SECRET)).toBeNull();
    }
  });
});

describe('judging a claimed result', () => {
  it('accepts a claim consistent with the attested bytes', async () => {
    // 20 tokens x 1MB across 8s = 20MB/8s = 20 Mbps
    const tokens = [
      ...(await tokensFor(20, 1_000_000, 8000, 'down')),
      ...(await tokensFor(20, 1_000_000, 8000, 'up')),
    ];
    const verdict = await judge(
      { tokens, session: 'sess-1', claimedDownMbps: 20, claimedUpMbps: 20, now: NOW + 1000 },
      SECRET,
    );
    expect(verdict.verified).toBe(true);
    expect(verdict.attestedDownBytes).toBe(20_000_000);
  });

  it('rejects a claim far above what the servers actually sent', async () => {
    // The attack: real bytes, invented speed.
    const tokens = await tokensFor(20, 1_000_000, 8000, 'down');
    const verdict = await judge(
      { tokens, session: 'sess-1', claimedDownMbps: 950, claimedUpMbps: 0, now: NOW + 1000 },
      SECRET,
    );
    expect(verdict.verified).toBe(false);
    expect(verdict.reason).toContain('exceeds attested bytes');
  });

  it('rejects tokens replayed from an earlier run', async () => {
    const tokens = await tokensFor(20, 1_000_000, 8000, 'down');
    const verdict = await judge(
      {
        tokens,
        session: 'sess-1',
        claimedDownMbps: 20,
        claimedUpMbps: 0,
        now: NOW + 60 * 60 * 1000, // an hour later
      },
      SECRET,
    );
    expect(verdict.verified).toBe(false);
    expect(verdict.reason).toContain('too few');
  });

  it('rejects tokens minted for a different session', async () => {
    const tokens = await tokensFor(20, 1_000_000, 8000, 'down');
    const verdict = await judge(
      {
        tokens,
        session: 'someone-elses-session',
        claimedDownMbps: 20,
        claimedUpMbps: 0,
        now: NOW + 1000,
      },
      SECRET,
    );
    expect(verdict.verified).toBe(false);
  });

  it('cannot be inflated by shortening the window, because the servers timestamp it', async () => {
    // A client claiming the transfer took 1s instead of 8s gains nothing: the
    // span is derived from the signed timestamps, not from anything it sends.
    const tokens = await tokensFor(20, 1_000_000, 8000, 'down');
    const verdict = await judge(
      { tokens, session: 'sess-1', claimedDownMbps: 160, claimedUpMbps: 0, now: NOW + 1000 },
      SECRET,
    );
    expect(verdict.verified).toBe(false);
  });
});
