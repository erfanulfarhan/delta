import { createClient } from '@supabase/supabase-js';
import { judge } from '../../../packages/attest/src/index.js';

/**
 * The only way a result reaches the database.
 *
 * Browser keys have no insert policy at all, so this function is the sole
 * writer, using the service role. Everything it stores has been checked against
 * the endpoint's signed byte counts first. Without that, an ISP leaderboard
 * built from anonymous submissions is just a list of whatever numbers people
 * felt like posting, presented with the authority of an aggregate.
 */

interface Body {
  session?: string;
  tokens?: string[];
  mode?: 'bdix' | 'raw' | 'both';
  bdix?: Measured;
  raw?: Measured;
  isp?: string;
  asn?: string;
  city?: string;
  country?: string;
  shortId?: string;
}

interface Measured {
  downloadMbps?: number;
  uploadMbps?: number;
  pingMs?: number;
  jitterMs?: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.round(n * 100) / 100 : null;
};

const text = (v: unknown, max = 120): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.SIGNING_SECRET;

  if (!url || !serviceKey || !secret) {
    return Response.json({ error: 'results storage is not configured' }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const shortId = text(body.shortId, 32);
  const session = text(body.session, 64);
  const mode = body.mode;

  if (!shortId || !/^[0-9a-z]{8,32}$/.test(shortId)) {
    return Response.json({ error: 'invalid id' }, { status: 400 });
  }
  if (!session || (mode !== 'bdix' && mode !== 'raw' && mode !== 'both')) {
    return Response.json({ error: 'invalid submission' }, { status: 400 });
  }

  const bdixDown = num(body.bdix?.downloadMbps);
  const bdixUp = num(body.bdix?.uploadMbps);
  const rawDown = num(body.raw?.downloadMbps);
  const rawUp = num(body.raw?.uploadMbps);

  if (mode === 'both' && (bdixDown === null || rawDown === null)) {
    return Response.json({ error: 'a both-run needs both sides' }, { status: 400 });
  }

  // Verify against what the endpoints attest. A failure is not an error: the
  // result is still the user's own and still worth saving and sharing, it is
  // simply not eligible to influence anyone else's view of their ISP.
  const verdict = await judge(
    {
      tokens: Array.isArray(body.tokens) ? body.tokens.slice(0, 2000).filter(t => typeof t === 'string') : [],
      session,
      claimedDownMbps: Math.max(bdixDown ?? 0, rawDown ?? 0),
      claimedUpMbps: Math.max(bdixUp ?? 0, rawUp ?? 0),
    },
    secret,
  );

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { error } = await supabase.from('results').insert({
    short_id: shortId,
    mode,
    bdix_down: bdixDown,
    bdix_up: bdixUp,
    bdix_ping: num(body.bdix?.pingMs),
    bdix_jitter: num(body.bdix?.jitterMs),
    raw_down: rawDown,
    raw_up: rawUp,
    raw_ping: num(body.raw?.pingMs),
    raw_jitter: num(body.raw?.jitterMs),
    isp: text(body.isp),
    asn: text(body.asn, 24),
    city: text(body.city, 80),
    country: text(body.country, 8),
    verified: verdict.verified,
  });

  if (error) {
    // A duplicate id means the client retried; treat it as success rather than
    // making the user lose a result they can see on screen.
    if (error.code === '23505') {
      return Response.json({ shortId, verified: verdict.verified, duplicate: true });
    }
    return Response.json({ error: 'could not save result' }, { status: 500 });
  }

  return Response.json({
    shortId,
    verified: verdict.verified,
    reason: verdict.reason,
    attestedDownBytes: verdict.attestedDownBytes,
  });
}
