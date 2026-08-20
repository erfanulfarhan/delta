/**
 * The two endpoints.
 *
 * These URLs are the entire difference between BDIX and RAW. The engine has no
 * concept of a mode; it takes a base URL. Adding a third location later means
 * adding an entry here, not touching measurement code.
 */
export type ModeId = 'bdix' | 'raw';

export interface EndpointConfig {
  id: ModeId;
  label: string;
  shortLabel: string;
  /** What this endpoint actually measures, stated honestly. */
  description: string;
  baseUrl: string;
}

const env = import.meta.env;

export const ENDPOINTS: Record<ModeId, EndpointConfig> = {
  bdix: {
    id: 'bdix',
    label: 'LOCAL',
    shortLabel: 'BDIX peering',
    description: 'Served over local peering inside Bangladesh. Never leaves the country.',
    baseUrl: env.VITE_BDIX_URL ?? 'http://127.0.0.1:8080',
  },
  raw: {
    id: 'raw',
    label: 'RAW',
    shortLabel: 'International',
    description: 'Singapore. Crosses your ISP’s international bandwidth.',
    baseUrl: env.VITE_RAW_URL ?? 'http://127.0.0.1:8081',
  },
};

/**
 * True when an endpoint still points at localhost, meaning nothing real is
 * being measured. The interface says so out loud rather than presenting mock
 * figures as though they came from a network.
 */
export const USING_MOCKS =
  ENDPOINTS.bdix.baseUrl.includes('127.0.0.1') || ENDPOINTS.raw.baseUrl.includes('127.0.0.1');

/**
 * Which endpoints actually exist.
 *
 * The two sides can go live at different times: a Cloudflare Worker is a single
 * command, while the Singapore host has to be provisioned by hand. Pointing Raw
 * at whatever is available in the meantime would be the worst possible
 * behaviour, because it would produce plausible numbers for a path nobody
 * measured. An endpoint with no URL is reported as unavailable instead.
 */
/**
 * Selectable locations for the Raw side.
 *
 * Every one of these is a server this project operates, pinned to that region
 * and verified at deploy time to actually run there. None of them are Ookla's
 * servers: the ones speedtest.net offers (AmberIT, NextGen and the rest) are
 * Ookla infrastructure hosted by those ISPs, they do not speak this protocol,
 * and pointing a browser at them would be using someone else's servers without
 * their agreement.
 *
 * Local stays fixed at Dhaka. It is not a choice in the same sense: the whole
 * point of that side is the one path that never leaves the country.
 */
export interface RawServer {
  id: string;
  city: string;
  country: string;
  flag: string;
  baseUrl: string;
  /**
   * How far along the distance line this server sits, relative to the furthest.
   * Roughly proportional to great-circle distance from Bangladesh, so the
   * drawing says something true rather than treating every destination as
   * equally remote.
   */
  reach: number;
}

export const RAW_SERVERS: RawServer[] = [
  {
    id: 'sin1',
    city: 'Singapore',
    country: 'SG',
    flag: '🇸🇬',
    baseUrl: 'https://delta-sin1.vercel.app/api',
    reach: 0.84,
  },
  {
    id: 'bom1',
    city: 'Mumbai',
    country: 'IN',
    flag: '🇮🇳',
    baseUrl: 'https://delta-bom1.vercel.app/api',
    reach: 0.58,
  },
  {
    id: 'hnd1',
    city: 'Tokyo',
    country: 'JP',
    flag: '🇯🇵',
    baseUrl: 'https://delta-hnd1.vercel.app/api',
    reach: 1,
  },
];

export const DEFAULT_RAW_SERVER = 'sin1';

/**
 * Mirrors of the local endpoint.
 *
 * All four are the same Worker code served from the same Dhaka PoP. They exist
 * purely so the browser can open more than one connection: requests to a single
 * origin share one HTTP/2 connection whose throughput is the real ceiling, and
 * on a 470 Mbps link that capped the result at about 234 Mbps no matter how many
 * streams were opened.
 */
export const LOCAL_ORIGINS: string[] = [
  ENDPOINTS.bdix.baseUrl,
  'https://delta-local-2.erfanul100.workers.dev',
  'https://delta-local-3.erfanul100.workers.dev',
  'https://delta-local-4.erfanul100.workers.dev',
];

/** Every equivalent origin for a mode, for sharding streams across connections. */
export const originsFor = (mode: ModeId, rawServerId: string): string[] =>
  mode === 'raw' ? [rawServer(rawServerId).baseUrl] : LOCAL_ORIGINS;

export const rawServer = (id: string): RawServer =>
  RAW_SERVERS.find((s) => s.id === id) ?? RAW_SERVERS[0]!;

/** Base URL for a mode, honouring the chosen Raw location. */
export const baseUrlFor = (mode: ModeId, rawServerId: string): string =>
  (mode === 'raw' ? rawServer(rawServerId).baseUrl : ENDPOINTS.bdix.baseUrl).replace(/\/$/, '');

export const AVAILABLE: Record<ModeId, boolean> = {
  bdix: Boolean(env.VITE_BDIX_URL) || import.meta.env.DEV,
  raw: true, // its own servers are deployed and verified per region
};

export const BOTH_AVAILABLE = AVAILABLE.bdix && AVAILABLE.raw;
