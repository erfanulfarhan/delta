import type { Meta } from './types.js';

/**
 * Metadata is decoration. Losing it must never fail a measurement, and waiting
 * for it must never delay one: both runners start measuring only once it is
 * back, so an endpoint that accepts the connection and then stalls would
 * otherwise hold a run on "Latency" until the browser gave up on it.
 */
const META_TIMEOUT_MS = 3000;

const salt = () => Math.random().toString(36).slice(2);

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

async function probe(origin: string, signal?: AbortSignal): Promise<Probe | null> {
  const meta = await fetchMeta(origin, signal);
  if (!meta) return null;
  // Timed on the connection the metadata request just opened, so this is one
  // round trip rather than DNS, TCP and TLS setup.
  const rttMs = await bounded(signal, async (limit) => {
    const started = performance.now();
    const response = await fetch(`${origin}/ping?salt=${salt()}`, { cache: 'no-store', signal: limit });
    return response.ok ? performance.now() - started : null;
  });
  return rttMs === null ? null : { origin, meta, rttMs };
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
