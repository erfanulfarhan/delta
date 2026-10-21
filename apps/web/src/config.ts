import { MLAB_LOCATE_URL, MLAB_PRIVACY_URL } from '@speedtest/engine';

/**
 * The two paths.
 *
 * Local is Delta's own endpoint, a Cloudflare Worker served from Dhaka. Raw is
 * Measurement Lab's open servers abroad. The engine takes a base URL for one
 * and a site code for the other, and reduces both to figures with the same
 * statistic, which is what makes the ratio between them mean something.
 */
export type ModeId = 'bdix' | 'raw';

export interface EndpointConfig {
  id: ModeId;
  label: string;
  shortLabel: string;
  /** What this path actually measures, stated honestly. */
  description: string;
}

const env = import.meta.env;

export const ENDPOINTS: Record<ModeId, EndpointConfig> = {
  bdix: {
    id: 'bdix',
    label: 'LOCAL',
    shortLabel: 'BDIX peering',
    description: 'Served over local peering inside Bangladesh. Never leaves the country.',
  },
  raw: {
    id: 'raw',
    label: 'RAW',
    shortLabel: 'International',
    description: "Measurement Lab's servers abroad. Crosses your ISP's international bandwidth.",
  },
};

/** Delta's own endpoint. It also answers /meta for both modes. */
export const LOCAL_URL = (env.VITE_BDIX_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');

/**
 * Measurement Lab, for Raw.
 *
 * The client name identifies this integration in M-Lab's data, which is what
 * the protocol asks of third-party clients. The locate URL is overridable only
 * so local development can point at services/mock/src/msak.js.
 */
export const MLAB = {
  // `||`, not `??`: the deploy script sets this to an empty string so a local
  // override in .env.local can never reach the live site.
  locateUrl: (env.VITE_MLAB_LOCATE_URL || MLAB_LOCATE_URL).replace(/\/$/, ''),
  client: { name: 'delta-speedtest', version: '1.1.0' },
  privacyUrl: MLAB_PRIVACY_URL,
};

/**
 * Which paths point at localhost, meaning nothing real is measured there. The
 * interface says so out loud rather than presenting mock figures as though
 * they came from a network, and names the path, because the two are set
 * separately and a development build often mocks only one.
 */
export const MOCKED: Record<ModeId, boolean> = {
  bdix: LOCAL_URL.includes('127.0.0.1'),
  raw: MLAB.locateUrl.includes('127.0.0.1'),
};
export const USING_MOCKS = MOCKED.bdix || MOCKED.raw;

/**
 * Selectable locations for the Raw side.
 *
 * Each is a physical M-Lab site: rack servers with a 10 Gbps uplink straight
 * onto a transit network, with no CDN in front, so a test really does cross
 * the ISP's international capacity and the server is never the bottleneck of a
 * home connection. The ids are M-Lab's site codes and go to its Locate service
 * as they are.
 *
 * None of them are Ookla's servers. The ones speedtest.net offers (AmberIT,
 * NextGen and the rest) are Ookla infrastructure hosted by those ISPs under
 * Ookla's terms, and pointing a browser at them would be using someone else's
 * servers without their agreement. M-Lab exists to be used this way.
 *
 * Local stays fixed at Dhaka. It is not a choice in the same sense: the whole
 * point of that side is the one path that never leaves the country.
 */
export interface RawServer {
  id: string;
  city: string;
  country: string;
  flag: string;
  /** Great-circle distance from Dhaka, shown until a test has measured the ping. */
  km: number;
  /** The network the site's uplink connects to, as M-Lab lists it. */
  transit: string;
  /**
   * How far along the distance line this server sits, relative to the furthest.
   * Scaled from great-circle distance from Bangladesh, so the drawing says
   * something true rather than treating every destination as equally remote.
   */
  reach: number;
}

export const RAW_SERVERS: RawServer[] = [
  { id: 'sin01', city: 'Singapore', country: 'SG', flag: '🇸🇬', km: 2885, transit: 'TATA', reach: 0.84 },
  // bom02 rather than bom04: TATA, as in Singapore, and one of the upstreams
  // Bangladeshi IIGs actually buy from.
  { id: 'bom02', city: 'Mumbai', country: 'IN', flag: '🇮🇳', km: 1888, transit: 'TATA', reach: 0.58 },
  { id: 'hnd02', city: 'Tokyo', country: 'JP', flag: '🇯🇵', km: 4880, transit: 'BIGLOBE', reach: 1 },
];

export const DEFAULT_RAW_SERVER = 'sin01';

export const rawServer = (id: string): RawServer =>
  RAW_SERVERS.find((s) => s.id === id) ?? RAW_SERVERS[0]!;

/**
 * Every hostname the Local Worker answers on.
 *
 * They are on erfanul.me, a Cloudflare zone with HTTP/3 switched off, rather
 * than on workers.dev, because Chrome's HTTP/3 was the ceiling. On a wired
 * 1 Gbps line the same Worker read 501 Mbps in Chrome over HTTP/3 and 826 over
 * HTTP/2, against 833 for plain curl: Chrome's QUIC runs in user space and
 * gives out first. workers.dev advertises HTTP/3 with no way to turn it off,
 * and only a zone of your own has the switch.
 *
 * Four names rather than one because each is a separate draw of the zone's two
 * anycast addresses, and an ISP can route those to different PoPs; the engine
 * keeps the names that reached the nearest (see nearestOrigins). The
 * workers.dev mirrors are the fallback for when none of them did: on HTTP/3,
 * so slower in Chrome, but on other addresses.
 *
 * Any other LOCAL_URL, such as the mock in development, is used on its own.
 */
const ZONE_ORIGINS = [1, 2, 3, 4].map((n) => `https://local${n}.erfanul.me`);
const WORKERS_DEV_ORIGINS = ['', '-2', '-3', '-4'].map((n) => `https://delta-local${n}.erfanul100.workers.dev`);

const onZone = ZONE_ORIGINS.includes(LOCAL_URL);
export const LOCAL_ORIGINS: string[] = onZone ? ZONE_ORIGINS : [LOCAL_URL];
export const LOCAL_FALLBACK: string[] = onZone ? WORKERS_DEV_ORIGINS : [];

export const AVAILABLE: Record<ModeId, boolean> = {
  bdix: Boolean(env.VITE_BDIX_URL) || import.meta.env.DEV,
  // M-Lab needs nothing deployed. When it is unreachable the run fails with a
  // message saying so, which is the graceful failure M-Lab asks for.
  raw: true,
};

export const BOTH_AVAILABLE = AVAILABLE.bdix && AVAILABLE.raw;
