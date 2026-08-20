import { RAW_SERVERS } from '../config';

/** Tools live on the Singapore endpoint, which runs Node and can open sockets. */
const TOOLS_BASE = RAW_SERVERS.find((s) => s.id === 'sin1')?.baseUrl ?? '';

export interface IpInfo {
  ip: string;
  family: string;
  reverseDns: string | null;
  isSharedAddressSpace: boolean;
  verdict: 'shared' | 'likely-shared' | 'dynamic' | 'likely-public';
  confidence: 'certain' | 'hint' | 'unknown';
}

export type PortOutcome = 'open' | 'refused' | 'silent' | 'error';

export interface Probe {
  port: number;
  outcome: PortOutcome;
  detail: string;
}

export interface Reachability {
  ip: string;
  testedFrom: string;
  probes: Probe[];
  /** null when the result is genuinely inconclusive. */
  reachable: boolean | null;
  headline: string;
  detail: string;
}

export async function fetchIpInfo(): Promise<IpInfo | null> {
  try {
    const r = await fetch(`${TOOLS_BASE}/ipinfo`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as IpInfo;
  } catch {
    return null;
  }
}

/**
 * Ask whether the internet can reach this connection at all.
 *
 * With no ports argument the server probes a default set that consumer routers
 * commonly answer on. Pass ports only when checking a specific forwarded
 * service.
 */
export async function checkReachability(
  ports?: number[],
): Promise<Reachability | { error: string }> {
  const query = ports && ports.length > 0 ? `?ports=${ports.join(',')}` : '';
  try {
    const r = await fetch(`${TOOLS_BASE}/portcheck${query}`, { cache: 'no-store' });
    const json = await r.json();
    if (!r.ok) return { error: (json as { error?: string }).error ?? 'Check failed.' };
    return json as Reachability;
  } catch {
    return { error: 'Could not reach the test server.' };
  }
}
