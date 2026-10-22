import type { Meta } from './types.js';

/**
 * Metadata is decoration. Losing it must never fail a measurement, and waiting
 * for it must never delay one: both runners start measuring only once it is
 * back, so an endpoint that accepts the connection and then stalls would
 * otherwise hold a run on "Latency" until the browser gave up on it.
 */
const META_TIMEOUT_MS = 3000;

/** One hostname's whole probe, however many requests it takes. */
const PROBE_BUDGET_MS = 4000;

/** Runs `work` under the metadata time limit, and reads any failure as null. */
async function bounded<T>(
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T | null>,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  try {
    return await work(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

export function fetchMeta(baseUrl: string, signal?: AbortSignal): Promise<Meta | null> {
  return bounded(signal, async (limit) => {
    const response = await fetch(`${baseUrl}/meta`, { cache: 'no-store', signal: limit });
    return response.ok ? ((await response.json()) as Meta) : null;
  });
}

interface Probe {
  origin: string;
  meta: Meta;
  rttMs: number;
}

/**
 * Where one hostname's connection lands, and how far away that is.
 *
 * Judged by the last of three requests, not the first. The first opens a
 * connection, and over HTTP/3 Chrome then moves to a QUIC connection of its
 * own, which can reach a different address and so a different PoP: one run
 * read Singapore from the first request and timed Dhaka on the next. By the
 * third the browser is on the connection the measurement goes on to use, and
 * the first one's DNS, TCP and TLS setup is out of the timing too.
 */
async function probe(origin: string, signal?: AbortSignal): Promise<Probe | null> {
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), PROBE_BUDGET_MS);
  const forward = () => budget.abort();
  signal?.addEventListener('abort', forward, { once: true });
  try {
    let last: Probe | null = null;
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      const meta = await fetchMeta(origin, budget.signal);
      if (!meta) return null;
      last = { origin, meta, rttMs: performance.now() - started };
    }
    return last;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

export interface OriginChoice {
  /** The origins to measure through, in the order they were given. */
  origins: string[];
  /** Metadata as the first of them sees it, or null if nothing answered. */
  meta: Meta | null;
}

/**
 * Which of an endpoint's hostnames to measure through.
 *
 * Every hostname is the same Worker, but not every connection reaches the same
 * place. Cloudflare answers each name with two anycast addresses, the browser
 * connects to one of them, and an ISP can route the two to different PoPs. On
 * the line this was written against, one address of the erfanul.me zone was
 * served from Dhaka and the other from Marseille, and Chrome chose between them
 * per hostname: 7 of 19 connections went to France. Measuring through all of
 * them would blend Dhaka and Marseille into a single Local figure.
 *
 * So each hostname is asked which PoP its connection reached (the Worker
 * reports it in /meta) and timed, and only the hostnames on the nearest PoP are
 * kept. The browser keeps using the connections opened here for the requests
 * that follow, which is what makes the answer hold for the measurement.
 *
 * `fallback` is used only when none of `origins` reached that PoP: the same
 * Worker under other names, on other addresses, that may be routed better.
 */
export async function nearestOrigins(
  origins: string[],
  fallback: string[] = [],
  signal?: AbortSignal,
): Promise<OriginChoice> {
  const probes = (await Promise.all([...origins, ...fallback].map((o) => probe(o, signal)))).filter(
    (p): p is Probe => p !== null,
  );
  if (probes.length === 0) return { origins, meta: null };

  const nearest = probes.reduce((best, p) => (p.rttMs < best.rttMs ? p : best));
  // An endpoint that does not report a PoP, such as the mock, reads as one PoP.
  const colo = nearest.meta.colo ?? '';
  const there = (set: string[]) => probes.filter((p) => set.includes(p.origin) && (p.meta.colo ?? '') === colo);
  const chosen = there(origins).length > 0 ? there(origins) : there(fallback);
  return { origins: chosen.map((p) => p.origin), meta: chosen[0]!.meta };
}
