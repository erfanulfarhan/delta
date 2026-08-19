// GENERATED FILE - DO NOT EDIT.
// Copied from packages/attest/src/index.ts by scripts/sync-attest.sh.
// Vercel cannot bundle imports from outside its project root.

/**
 * Byte-count attestation, shared by both endpoints and the verifier.
 *
 * The problem: a leaderboard fed by anonymous submissions can be poisoned by
 * anyone with a script, and a leaderboard that is trivially poisoned is worse
 * than none, because it presents invented data with the authority of an
 * aggregate.
 *
 * The fix: the endpoint knows exactly how many bytes it served and when, so it
 * signs that fact. The browser collects these tokens and hands them to the
 * verifier along with its claimed result. Because the signing key never leaves
 * the servers, a client can drop tokens and under-report, but cannot invent
 * bytes that were never sent. Under-reporting is uninteresting; inflation is
 * the attack.
 *
 * Web Crypto only, so the same module runs in a Cloudflare Worker, in Node, and
 * in a Vercel function without a build step per target.
 */

export interface Attestation {
  session: string;
  direction: 'down' | 'up';
  bytes: number;
  at: number;
}

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * Normalised before signing.
 *
 * `.` separates the fields, so a fractional byte count or timestamp would
 * serialise with a decimal point, split the payload into six parts instead of
 * five, and make every token fail verification for reasons that look nothing
 * like the cause. Both quantities are integers by nature, so they are rounded
 * rather than trusted.
 */
const normalise = (a: Attestation): Attestation => ({
  session: a.session,
  direction: a.direction,
  bytes: Math.round(a.bytes),
  at: Math.round(a.at),
});

const payloadOf = (a: Attestation) => `${a.session}.${a.direction}.${a.bytes}.${a.at}`;

export async function sign(a: Attestation, secret: string): Promise<string> {
  const payload = payloadOf(normalise(a));
  const mac = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(mac))}`;
}

/** Returns the attestation only if the signature is genuine. */
export async function verify(token: string, secret: string): Promise<Attestation | null> {
  const parts = token.split('.');
  if (parts.length !== 5) return null;

  // The signature segment is not read directly: verification recomputes the
  // whole token and compares, which also covers a tampered payload.
  const [session, direction, bytesRaw, atRaw] = parts as [string, string, string, string, string];
  if (direction !== 'down' && direction !== 'up') return null;

  const bytes = Number(bytesRaw);
  const at = Number(atRaw);
  if (!Number.isFinite(bytes) || !Number.isFinite(at) || bytes < 0) return null;

  // A session id containing a dot would also split wrongly; reject rather than
  // silently verifying a truncated payload.
  if (session.includes('.')) return null;
  if (!Number.isInteger(bytes) || !Number.isInteger(at)) return null;

  const attestation: Attestation = { session, direction, bytes, at };
  const expected = await sign(attestation, secret);

  // Constant-time-ish: compare the full recomputed token rather than returning
  // early on the first differing character.
  if (expected.length !== token.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0 ? attestation : null;
}

export interface VerdictInput {
  tokens: string[];
  session: string;
  claimedDownMbps: number;
  claimedUpMbps: number;
  /** Tokens older than this are rejected, to stop replay of a past fast run. */
  maxAgeMs?: number;
  /** How far short of the implied byte count a genuine run may fall. */
  tolerance?: number;
  /** Protocol constant: how long each transfer phase runs. */
  transferMs?: number;
  now?: number;
}

export interface Verdict {
  verified: boolean;
  reason: string;
  attestedDownBytes: number;
  attestedUpBytes: number;
  validTokens: number;
}

const sumBytes = (items: Attestation[]): number => items.reduce((acc, i) => acc + i.bytes, 0);

/**
 * Bytes a claim implies, given the phase duration.
 *
 * Compared against bytes rather than against a rate derived from the token
 * timestamps, which turned out not to work: the endpoint signs a download when
 * it writes the response headers, so six concurrent requests are stamped
 * milliseconds apart and dividing their combined size by that span implies an
 * absurd throughput. In one end-to-end run a 950 Mbps claim passed against
 * tokens from a 100 Mbps link.
 *
 * The phase duration is fixed by the protocol, so the verifier already knows
 * it and need not take the client's word for anything.
 */
const impliedBytes = (mbps: number, transferMs: number): number =>
  ((mbps * 1_000_000) / 8) * (transferMs / 1000);

/**
 * Decide whether a claimed result is consistent with what the servers attest.
 *
 * The duration is taken from the token timestamps, not from the client, since
 * a client that could shorten the window at will could inflate any throughput
 * it liked while presenting genuine byte counts.
 */
export async function judge(input: VerdictInput, secret: string): Promise<Verdict> {
  const {
    tokens,
    session,
    claimedDownMbps,
    claimedUpMbps,
    maxAgeMs = 10 * 60 * 1000,
    tolerance = 2.5,
    transferMs = 8000,
    now = Date.now(),
  } = input;

  const valid: Attestation[] = [];
  for (const token of tokens.slice(0, 2000)) {
    const a = await verify(token, secret);
    if (!a) continue;
    if (a.session !== session) continue;
    if (now - a.at > maxAgeMs) continue;
    if (a.at > now + 60_000) continue; // clock skew, but not the future
    valid.push(a);
  }

  const attestedDownBytes = sumBytes(valid.filter((a) => a.direction === 'down'));
  const attestedUpBytes = sumBytes(valid.filter((a) => a.direction === 'up'));

  const fail = (reason: string): Verdict => ({
    verified: false,
    reason,
    attestedDownBytes,
    attestedUpBytes,
    validTokens: valid.length,
  });

  if (valid.length < 4) return fail('too few valid attestations');
  if (attestedDownBytes <= 0) return fail('no attested download');

  // Tolerance runs one way only, and is deliberately loose.
  //
  // A genuine run attests substantially fewer bytes than its headline figure
  // implies. Requests still in flight when the phase deadline arrives are
  // aborted and never attested, and with six concurrent streams that is a large
  // slice of the transfer: a measured run reading 37.8 MB attested 26.1 MB. The
  // reported speed is also a trimmed mean, which sits above the average across
  // the whole window.
  //
  // So be clear about what this check is for. It catches fabrication, a client
  // posting 950 Mbps having moved 26 MB, by a factor of ten or more. It does not
  // catch a careful attacker shaving 50 percent onto a real result. Marginal
  // noise is the leaderboard's problem, and it handles it with medians and a
  // minimum sample count rather than pretending this check is finer than it is.
  if (attestedDownBytes * tolerance < impliedBytes(claimedDownMbps, transferMs)) {
    return fail('download claim exceeds attested bytes');
  }
  if (
    claimedUpMbps > 0 &&
    attestedUpBytes > 0 &&
    attestedUpBytes * tolerance < impliedBytes(claimedUpMbps, transferMs)
  ) {
    return fail('upload claim exceeds attested bytes');
  }

  return {
    verified: true,
    reason: 'ok',
    attestedDownBytes,
    attestedUpBytes,
    validTokens: valid.length,
  };
}
