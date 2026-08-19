import type { RunResult } from '@speedtest/engine';
import type { ModeId } from '../config';

const KEY = 'delta.history.v1';
const LIMIT = 30;

export interface HistoryEntry {
  at: string;
  kind: 'single' | 'both';
  shortId?: string;
  results: Partial<Record<ModeId, {
    downloadMbps: number;
    uploadMbps: number;
    pingMs: number;
    jitterMs: number;
  }>>;
  isp?: string;
}

/**
 * History is local first and works with no backend.
 *
 * The product has no accounts, and asking someone to sign in to see their own
 * speed over time would be absurd. Storing only the figures, never anything
 * identifying, means this needs no consent banner either.
 */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    // Corrupt or unavailable storage must never take the page down with it.
    return [];
  }
}

export function appendHistory(
  kind: 'single' | 'both',
  results: Partial<Record<ModeId, RunResult>>,
  shortId?: string,
): HistoryEntry[] {
  const entry: HistoryEntry = {
    at: new Date().toISOString(),
    kind,
    shortId,
    isp: results.bdix?.meta?.isp ?? results.raw?.meta?.isp,
    results: Object.fromEntries(
      Object.entries(results).map(([mode, r]) => [
        mode,
        {
          downloadMbps: r.downloadMbps,
          uploadMbps: r.uploadMbps,
          pingMs: r.pingMs,
          jitterMs: r.jitterMs,
        },
      ]),
    ),
  };

  const next = [entry, ...loadHistory()].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked. The run still happened and is still on screen.
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
