import type { RunResult } from '@speedtest/engine';
import type { ModeId } from '../config';
import { supabase } from './supabase';
import { shortId as makeShortId } from './shortId';

export interface SharedResult {
  short_id: string;
  created_at: string;
  mode: 'bdix' | 'raw' | 'both';
  bdix_down: number | null;
  bdix_up: number | null;
  bdix_ping: number | null;
  bdix_jitter: number | null;
  raw_down: number | null;
  raw_up: number | null;
  raw_ping: number | null;
  raw_jitter: number | null;
  isp: string | null;
  city: string | null;
  country: string | null;
}

export interface LeaderboardRow {
  isp: string;
  samples: number;
  median_local_down: number | null;
  median_raw_down: number | null;
  median_raw_ping: number | null;
}

const measured = (r?: RunResult) =>
  r
    ? {
        downloadMbps: r.downloadMbps,
        uploadMbps: r.uploadMbps,
        pingMs: r.pingMs,
        jitterMs: r.jitterMs,
      }
    : undefined;

/**
 * Save a run and return its share id.
 *
 * Goes through /api/results rather than writing to the database directly,
 * because the endpoint's signed byte counts have to be checked by something the
 * user does not control. Returns null when storage is not configured or the
 * save fails; the result stays on screen and in local history either way.
 */
export async function saveResult(
  kind: 'single' | 'both',
  results: Partial<Record<ModeId, RunResult>>,
): Promise<{ shortId: string; verified: boolean } | null> {
  const bdix = results.bdix;
  const raw = results.raw;
  const primary = bdix ?? raw;
  if (!primary) return null;

  const mode: 'bdix' | 'raw' | 'both' = kind === 'both' ? 'both' : bdix ? 'bdix' : 'raw';
  const id = makeShortId();

  // Both legs of a run-both share a session, so their attestations judge together.
  const tokens = [...(bdix?.tokens ?? []), ...(raw?.tokens ?? [])];

  try {
    const response = await fetch('/api/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shortId: id,
        session: primary.session,
        tokens,
        mode,
        bdix: measured(bdix),
        raw: measured(raw),
        isp: primary.meta?.isp,
        asn: primary.meta?.asn,
        city: primary.meta?.city,
        country: primary.meta?.country,
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { shortId: string; verified: boolean };
    return { shortId: json.shortId, verified: json.verified };
  } catch {
    return null;
  }
}

/** Read one shared result. The id is the capability; the table is not readable. */
export async function fetchResult(id: string): Promise<SharedResult | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_result', { p_short_id: id });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data[0] as SharedResult;
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('isp_leaderboard', {
    p_min_samples: 20,
    p_days: 30,
  });
  if (error || !Array.isArray(data)) return [];
  return data as LeaderboardRow[];
}
