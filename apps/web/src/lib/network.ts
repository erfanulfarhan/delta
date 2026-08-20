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

export type PortOutcome = 'open' | 'closed' | 'filtered' | 'error';

export interface PortResult {
  ip: string;
  port: number;
  outcome: PortOutcome;
  detail: string;
  meaning: string;
  testedFrom: string;
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

export async function checkPort(port: number): Promise<PortResult | { error: string }> {
  try {
    const r = await fetch(`${TOOLS_BASE}/portcheck?port=${port}`, { cache: 'no-store' });
    const json = await r.json();
    if (!r.ok) return { error: (json as { error?: string }).error ?? 'Check failed.' };
    return json as PortResult;
  } catch {
    return { error: 'Could not reach the test server.' };
  }
}
