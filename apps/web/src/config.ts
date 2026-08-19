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
export const AVAILABLE: Record<ModeId, boolean> = {
  bdix: Boolean(env.VITE_BDIX_URL) || import.meta.env.DEV,
  raw: Boolean(env.VITE_RAW_URL) || import.meta.env.DEV,
};

export const BOTH_AVAILABLE = AVAILABLE.bdix && AVAILABLE.raw;
