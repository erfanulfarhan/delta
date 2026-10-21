import { median, summarise } from './aggregate.js';
import { fetchMeta, liveMeter, type RunEvent } from './runner.js';
import { DEFAULT_CONFIG } from './types.js';
import type { ByteSample, EngineConfig, LatencyResult, Meta, RunResult, TransferResult } from './types.js';

/**
 * Raw measurement against Measurement Lab (M-Lab) servers.
 *
 * Raw used to run against Vercel functions pinned to Singapore, and they were
 * the wrong instrument. Vercel answers from whichever edge is nearest and then
 * hauls the request to the function, so the ping it reported was the edge hop
 * plus the haul (401 ms on a path whose real round trip was 166 ms), and the
 * functions' streaming capped throughput at around 126 Mbps.
 *
 * M-Lab is a non-profit, open measurement platform. Its servers are physical
 * machines on 10 Gbps transit links, with direct public addresses and no CDN in
 * front, so traffic from Bangladesh genuinely crosses the ISP's international
 * capacity to reach them. It is free to use from any site that follows its
 * acceptable use policy, which in practice means: tests start only when the
 * user asks, the user is told that results and IP address are published, and
 * the client fails gracefully when M-Lab is unavailable.
 *
 * The protocol is MSAK's throughput1: several WebSocket streams per test, each
 * carrying binary data one way and periodic JSON measurements, which include
 * the server kernel's TCP_INFO, the other way. Delta implements the client
 * itself rather than using M-Lab's msak-js, so that Raw is reduced to a single
 * figure by exactly the same statistic as Local. The comparison is the product,
 * and a ratio between two different statistics would mean nothing.
 */

export const MLAB_LOCATE_URL = 'https://locate.measurementlab.net';
export const MLAB_PRIVACY_URL = 'https://www.measurementlab.net/privacy/';

const SUBPROTOCOL = 'net.measurementlab.throughput.v1';
const DOWNLOAD_PATH = '///throughput/v1/download';
const UPLOAD_PATH = '///throughput/v1/upload';
const LIBRARY_NAME = 'delta-engine';
const LIBRARY_VERSION = '1.0.0';

/**
 * Four streams, the most M-Lab's own reference client offers. One stream
 * cannot fill a long, fast path: at Singapore's ~50 ms from Dhaka a 500 Mbps
 * line needs about 3 MB in flight, and a single flow is also what any per-flow
 * shaping on an international link bites first.
 */
export const MLAB_STREAMS = 4;

/**
 * How long the server keeps a stream open, beyond Delta's own window.
 *
 * The measurement window starts at the first byte, which arrives a round trip
 * or two after the server starts its clock. Without the margin the server would
 * stop short of the window's end and the closing buckets would read as a
 * collapse in throughput.
 */
const SERVER_MARGIN_MS = 2000;

/**
 * How long a phase may wait, past its own window, for the server's reports to
 * cover that window. Reports travel inside the data stream and can arrive well
 * after the server took them (see `runPhase`); past this the phase ends with
 * what it has.
 */
const COVERAGE_WAIT_MS = 3000;

/**
 * Below this fraction of what the server says it delivered, the browser is
 * taken to have fallen behind, and what it actually received is what counts.
 */
const CLIENT_BEHIND_FRACTION = 0.85;

/** Client-side measurements sent upstream, at the cadence msak-js uses. */
const MEASURE_EVERY_MS = 250;

/** Bytes are sliced into pieces this size when spread over an interval. */
const SPREAD_BYTES = 64 * 1024;

/** Upload message size limits, following the server's own scaling rule. */
const UPLOAD_MIN_MESSAGE = 8 * 1024;
const UPLOAD_MAX_MESSAGE = 1024 * 1024;
const UPLOAD_SCALING_FRACTION = 16;
/** Messages queued in the socket at once, as in msak-js. */
const UPLOAD_QUEUE_MESSAGES = 7;

export interface MlabClient {
  /** Identifies this integration to M-Lab. Required by the protocol. */
  name: string;
  version: string;
}

/** One machine returned by M-Lab's Locate service, with signed test URLs. */
export interface MlabTarget {
  machine: string;
  site: string;
  city: string;
  country: string;
  downloadUrl: string;
  uploadUrl: string;
}

/** A user-facing failure: the message is written to be shown as it is. */
export class MlabError extends Error {
  override name = 'MlabError';
}

/** Kernel round trip figures from one server measurement, in milliseconds. */
export interface TcpSample {
  at: number;
  minRttMs: number;
  rttMs: number;
  rttVarMs: number;
  /** Time since the server accepted the stream. */
  elapsedMs: number;
}

interface ServerMeasurement {
  remoteAddr?: string;
  /** Kernel count of bytes the client has acknowledged: what a download delivered. */
  bytesAcked?: number;
  /** Kernel count of bytes received from the client: what an upload delivered. */
  bytesReceived?: number;
  /** Server clock: ms since it accepted the connection, when TCP_INFO was read. */
  serverMs?: number;
  /** Server clock: ms since the measurement itself began. */
  measureMs?: number;
  tcp?: Omit<TcpSample, 'at'>;
}

const MICROS_PER_MS = 1000;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function parseServerMeasurement(text: string): ServerMeasurement | null {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null) return null;
  const m = message as {
    RemoteAddr?: unknown;
    ElapsedTime?: unknown;
    Application?: { BytesReceived?: unknown };
    TCPInfo?: Record<string, unknown>;
  };

  const out: ServerMeasurement = {};
  if (typeof m.RemoteAddr === 'string') out.remoteAddr = m.RemoteAddr;
  const measureUs = num(m.ElapsedTime);
  if (measureUs !== undefined) out.measureMs = measureUs / MICROS_PER_MS;

  const t = m.TCPInfo;
  out.bytesReceived = num(t?.BytesReceived) ?? num(m.Application?.BytesReceived);
  out.bytesAcked = num(t?.BytesAcked);
  const serverUs = num(t?.ElapsedTime);
  if (serverUs !== undefined) out.serverMs = serverUs / MICROS_PER_MS;

  const minRtt = num(t?.MinRTT);
  if (minRtt !== undefined && minRtt > 0) {
    out.tcp = {
      minRttMs: minRtt / MICROS_PER_MS,
      rttMs: (num(t?.RTT) ?? minRtt) / MICROS_PER_MS,
      rttVarMs: (num(t?.RTTVar) ?? 0) / MICROS_PER_MS,
      elapsedMs: out.serverMs ?? 0,
    };
  }
  return out;
}

/** "203.0.113.7:51234" or "[2001:db8::1]:51234" to the bare address. */
export function hostOf(addr: string): string {
  const v6 = /^\[([^\]]+)\]:\d+$/.exec(addr);
  if (v6) return v6[1]!;
  const v4 = /^([^:]+):\d+$/.exec(addr);
  return v4 ? v4[1]! : addr;
}

/**
 * Ask M-Lab's Locate service for a machine at one site.
 *
 * The URLs it returns carry an access token that is only valid for about a
 * minute, so this runs at the start of every Raw measurement rather than once
 * on page load.
 */
export async function locateMlab(
  site: string,
  client: MlabClient,
  options: { locateUrl?: string; label?: string; signal?: AbortSignal } = {},
): Promise<MlabTarget> {
  const base = (options.locateUrl ?? MLAB_LOCATE_URL).replace(/\/$/, '');
  const url = new URL(`${base}/v2/nearest/msak/throughput1`);
  url.searchParams.set('site', site);
  url.searchParams.set('client_name', client.name);
  url.searchParams.set('client_version', client.version);
  url.searchParams.set('client_library_name', LIBRARY_NAME);
  url.searchParams.set('client_library_version', LIBRARY_VERSION);
  const where = options.label ?? site;

  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: options.signal });
  } catch {
    throw new MlabError(
      'Could not reach Measurement Lab to find a Raw server. Check your connection and try again.',
    );
  }

  // M-Lab limits each client to 40 tests a day and answers the excess with an
  // empty response rather than an error code.
  if (response.status === 204 || response.status === 429) {
    throw new MlabError(
      "Measurement Lab's limit of 40 tests a day has been reached for your connection. Raw will work again tomorrow; Local is unaffected.",
    );
  }
  if (!response.ok) {
    throw new MlabError(
      `Measurement Lab's server finder answered HTTP ${response.status}. Try again in a minute.`,
    );
  }

  type LocateResult = {
    machine?: string;
    location?: { city?: string; country?: string };
    urls?: Record<string, string>;
  };
  let results: LocateResult[] = [];
  try {
    const json = (await response.json()) as { results?: LocateResult[] };
    results = Array.isArray(json.results) ? json.results : [];
  } catch {
    results = [];
  }

  for (const r of results) {
    // wss first: the site is served over HTTPS, and a browser refuses a plain
    // ws:// socket from an HTTPS page. ws:// only ever comes from a local mock.
    const download = r.urls?.[`wss:${DOWNLOAD_PATH}`] ?? r.urls?.[`ws:${DOWNLOAD_PATH}`];
    const upload = r.urls?.[`wss:${UPLOAD_PATH}`] ?? r.urls?.[`ws:${UPLOAD_PATH}`];
    if (!download || !upload) continue;
    return {
      machine: r.machine ?? site,
      site,
      city: r.location?.city ?? '',
      country: r.location?.country ?? '',
      downloadUrl: download,
      uploadUrl: upload,
    };
  }

  throw new MlabError(`Measurement Lab has no ${where} server free right now. Try another location.`);
}

/** Protocol options and client metadata, added to a Locate URL. */
export function streamUrl(base: string, streams: number, durationMs: number, client: MlabClient): string {
  const url = new URL(base);
  url.searchParams.set('streams', String(streams));
  url.searchParams.set('duration', String(Math.round(durationMs)));
  url.searchParams.set('cc', 'bbr');
  url.searchParams.set('client_name', client.name);
  url.searchParams.set('client_version', client.version);
  url.searchParams.set('client_library_name', LIBRARY_NAME);
  url.searchParams.set('client_library_version', LIBRARY_VERSION);
  return url.toString();
}

const sizeOf = (data: unknown): number => {
  if (typeof data === 'string') return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  return 0;
};

/** Attribute `bytes` evenly to the interval (from, to]. */
function spread(bytes: number, from: number, to: number, record: (bytes: number, at: number) => void) {
  const pieces = Math.max(1, Math.min(Math.ceil(bytes / SPREAD_BYTES), 64));
  const per = bytes / pieces;
  const span = Math.max(to - from, 0);
  const step = pieces > 1 && span > 0 ? span / pieces : 0;
  for (let i = 0; i < pieces; i += 1) {
    record(per, step > 0 ? from + step * (i + 1) : to);
  }
}

/** Byte samples on one clock, summarised exactly as Local's are. */
function sampleSet() {
  const samples: ByteSample[] = [];
  let first: number | null = null;
  let last: number | null = null;
  return {
    record(bytes: number, at: number) {
      if (bytes <= 0) return;
      if (first === null) first = at;
      samples.push({ at: Math.max(at - first, 0), bytes });
      last = Math.max(last ?? at, at);
    },
    first: (): number | null => first,
    /** Over the window, or as far as `until` reaches if that is sooner. */
    summary(cfg: TransferConfig, until: number | null): TransferResult | null {
      if (first === null) return null;
      const end = until ?? last ?? first;
      const duration = Math.min(cfg.transferMs, Math.max(end - first, 0));
      return summarise(samples, duration, cfg.bucketMs, cfg.rampFraction, cfg.trimFraction);
    },
  };
}

/**
 * One stream's kernel byte counter, placed on the client's clock.
 *
 * Counting WebSocket messages as they reach the page is a poor instrument on
 * its own: the server's messages grow to 1 MB and can land several at once, so
 * 100 ms windows swing between nothing and several times the line rate, and a
 * statistic that keeps the fastest windows reports the bursts. The server's
 * reports carry its kernel's byte counter together with the server's own clock
 * at the moment TCP_INFO was read, which no burst on the way can disturb.
 *
 * The clocks are tied by the least-delayed observation: every candidate
 * overstates the one-way delay and none understates it, so the smallest is the
 * best estimate. Bytes between two reports are spread across the server's own
 * interval between them.
 */
function serverTimeline(record: (bytes: number, at: number) => void) {
  let offset: number | null = null;
  let openedAt: number | null = null;
  let prevServerMs: number | null = null;
  let prevArrival: number | null = null;
  let prevCount = 0;
  let covered: number | null = null;

  return {
    /** The stream's open event: the moment the server's measurement began, seen from here. */
    opened(at: number) {
      openedAt = at;
    },
    /** Feed one report's counter. Returns the bytes it added. */
    add(count: number, m: ServerMeasurement, now: number): number {
      let at: number;
      let from: number;
      if (m.serverMs !== undefined) {
        // The open event is a candidate too: the server starts measuring as it
        // completes the upgrade, which is what fires `open` here, and it often
        // lands sooner than any report.
        let delay = now - m.serverMs;
        if (openedAt !== null && m.measureMs !== undefined) {
          delay = Math.min(delay, openedAt - (m.serverMs - m.measureMs));
        }
        offset = offset === null ? delay : Math.min(offset, delay);
        // Never in the future: a report cannot describe bytes not yet sent.
        at = Math.min(m.serverMs + offset, now);
        // The first report covers everything since the measurement began.
        from =
          prevServerMs !== null
            ? prevServerMs + offset
            : m.measureMs !== undefined
              ? at - m.measureMs
              : at;
        prevServerMs = m.serverMs;
      } else {
        // No server clock in the report: arrival time is all there is.
        at = now;
        from = prevArrival ?? now;
      }
      prevArrival = now;

      const delta = count - prevCount;
      prevCount = Math.max(prevCount, count);
      if (delta > 0) spread(delta, Math.min(from, at), at, record);
      covered = Math.max(covered ?? at, at);
      return Math.max(delta, 0);
    },
    /** Client time up to which this stream's bytes are accounted for. */
    coveredUntil: (): number | null => covered,
  };
}

function clientMeasurement(bytesReceived: number, bytesSent: number, elapsedMs: number): string {
  // The server parses every text frame as a measurement and drops the stream
  // on anything else, so this shape is part of the protocol.
  return JSON.stringify({
    Application: { BytesReceived: bytesReceived, BytesSent: bytesSent },
    ElapsedTime: Math.round(elapsedMs * MICROS_PER_MS),
  });
}

function safeClose(ws: WebSocket) {
  try {
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
  } catch {
    /* already closing */
  }
}

type TransferConfig = Pick<EngineConfig, 'transferMs' | 'streams' | 'bucketMs' | 'rampFraction' | 'trimFraction'>;

interface PhaseResult {
  transfer: TransferResult;
  tcp: TcpSample[];
  clientAddr: string | null;
}

interface StreamContext {
  ws: WebSocket;
  /** A server report: its counter goes on the server timeline, its TCP figures to latency. */
  onReport: (m: ServerMeasurement, count: number | undefined, now: number) => void;
  /** Bytes that reached the browser on this stream (download only). */
  onArrival: (bytes: number, now: number) => void;
  expired: () => boolean;
}

/**
 * Shared skeleton of both directions: open the streams, run the window, wait
 * for the server's reports to cover it, and decide where to count.
 *
 * Reports travel inside the data stream, so they can arrive long after the
 * server took them. Through a VPN that splits TCP, a report taken 4.6 s into a
 * test was read 8.2 s after the stream opened: the VPN's server acknowledged
 * bytes on the client's behalf and was still delivering them seconds later.
 * The phase therefore waits, within limits, for coverage on the server's
 * timeline rather than stopping on the local clock.
 *
 * The same case decides where a download is counted. On a direct path the
 * server's kernel counter and the bytes reaching the browser agree, and the
 * counter is smoother, so it is used. When the browser received clearly less
 * than the server says it delivered, something between them took the bytes
 * (a TCP-splitting proxy, which some mobile networks run as well as VPNs) or
 * the device could not keep up; either way the server's figure describes a
 * path that ends somewhere else, and what reached the browser counts instead.
 *
 * The server's close is no signal. M-Lab's server stops sending at the
 * requested duration but does not always finish the closing handshake, so a
 * phase that waited for `close` events could sit there for most of a minute.
 */
function runPhase(
  url: string,
  cfg: TransferConfig,
  label: string,
  countClient: boolean,
  signal: AbortSignal | undefined,
  attach: (ctx: StreamContext) => void,
): Promise<PhaseResult> {
  const server = sampleSet();
  const client = sampleSet();
  const tcp: TcpSample[] = [];
  let clientAddr: string | null = null;
  const phaseStart = performance.now();

  // The local clock starts at the first byte seen in either count.
  const started = () => {
    const a = server.first();
    const b = countClient ? client.first() : null;
    return a === null ? b : b === null ? a : Math.min(a, b);
  };
  const expired = () => {
    const s = started();
    return s !== null && performance.now() - s >= cfg.transferMs;
  };

  return new Promise<PhaseResult>((resolve, reject) => {
    const sockets: WebSocket[] = [];
    const timelines: Array<ReturnType<typeof serverTimeline>> = [];
    const lastArrival: number[] = [];
    let failed = 0;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      clearTimeout(hardStop);
      signal?.removeEventListener('abort', onAbort);
      for (const ws of sockets) safeClose(ws);
      if (error) return reject(error);

      const reportedUntil = timelines.reduce<number | null>((acc, t) => {
        const c = t.coveredUntil();
        return c === null ? acc : Math.max(acc ?? c, c);
      }, null);
      const byServer = server.summary(cfg, reportedUntil);
      const byClient = countClient ? client.summary(cfg, null) : null;

      const rate = (t: TransferResult | null) => (t && t.durationMs > 0 ? t.bytesTotal / t.durationMs : 0);
      const useClient =
        byClient !== null && (byServer === null || rate(byClient) < CLIENT_BEHIND_FRACTION * rate(byServer));
      const chosen = useClient ? byClient : byServer;

      if (chosen === null) {
        return reject(
          new MlabError(`No data arrived from the ${label} server. Try again, or pick another location.`),
        );
      }
      resolve({ transfer: { ...chosen, basis: useClient ? 'client' : 'server' }, tcp, clientAddr });
    };

    const onAbort = () => finish();
    signal?.addEventListener('abort', onAbort, { once: true });

    const closed = (ws: WebSocket) => ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED;

    // Polled rather than event driven, because what ends a phase (reports
    // covering the window, a deadline, streams going quiet) is not all events.
    const tick = setInterval(() => {
      const s = started();
      if (s === null) {
        // Every stream closed before a single byte: a server or middlebox that
        // completes the upgrade and then drops the connection. Nothing more is
        // coming, so say so now rather than at the hard stop.
        if (sockets.length > 0 && sockets.every(closed)) finish();
        return;
      }
      const windowEnd = (server.first() ?? s) + cfg.transferMs;
      const covered = sockets.every(
        (ws, i) => closed(ws) || (timelines[i]!.coveredUntil() ?? -Infinity) >= windowEnd,
      );
      const late = performance.now() - s >= cfg.transferMs + COVERAGE_WAIT_MS;
      if (covered || late) finish();
    }, 50);

    // A server that accepts the connection and then sends nothing would
    // otherwise hold the phase open forever.
    const hardStop = setTimeout(() => finish(), cfg.transferMs * 3);

    for (let i = 0; i < cfg.streams; i += 1) {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url, SUBPROTOCOL);
      } catch {
        failed += 1;
        continue;
      }
      // ArrayBuffer rather than the default Blob. A Blob frame is registered
      // with the browser's blob storage, a megabyte-sized allocation per frame
      // in another process; the bytes are never read here, and an ArrayBuffer
      // is simply garbage collected.
      ws.binaryType = 'arraybuffer';
      const timeline = serverTimeline(server.record);
      const index = sockets.length;
      sockets.push(ws);
      timelines.push(timeline);

      let opened = false;
      ws.addEventListener('open', () => {
        opened = true;
        const now = performance.now();
        timeline.opened(now);
        lastArrival[index] = now;
      });
      ws.addEventListener('error', () => {
        if (opened) return; // a stream dying mid-test loses its share, not the test
        failed += 1;
        if (failed >= cfg.streams) {
          finish(
            new MlabError(
              `Could not connect to Measurement Lab's ${label} server. It may be busy; try again or pick another location.`,
            ),
          );
        }
      });

      attach({
        ws,
        expired,
        onReport: (m, count, now) => {
          if (m.remoteAddr && clientAddr === null) clientAddr = hostOf(m.remoteAddr);
          if (m.tcp) tcp.push({ at: now - phaseStart, ...m.tcp });
          if (count !== undefined) timeline.add(count, m, now);
        },
        onArrival: (bytes, now) => {
          if (!countClient) return;
          // A message is delivered whole when its last byte lands, so its
          // bytes belong to the gap since this stream's previous message (or
          // since the stream opened, for the first).
          spread(bytes, lastArrival[index] ?? now, now, client.record);
          lastArrival[index] = now;
        },
      });
    }

    if (sockets.length === 0) {
      finish(new MlabError('This browser cannot open WebSocket connections, which Raw needs.'));
    }
  });
}

/**
 * Download: the server sends; its kernel counts what the client acknowledged,
 * and the browser counts what reached it. See `runPhase` for which is used.
 */
export async function measureMlabDownload(
  target: MlabTarget,
  cfg: TransferConfig,
  client: MlabClient,
  onSample: (bytes: number, atMs: number) => void,
  label: string,
  signal?: AbortSignal,
): Promise<PhaseResult> {
  const url = streamUrl(target.downloadUrl, cfg.streams, cfg.transferMs + SERVER_MARGIN_MS, client);
  let firstArrival: number | null = null;

  return runPhase(url, cfg, label, true, signal, ({ ws, onReport, onArrival }) => {
    let openedAt = 0;
    let lastClientReport = 0;
    let received = 0;
    let sent = 0;

    ws.addEventListener('open', () => {
      openedAt = performance.now();
      lastClientReport = openedAt;
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      const now = performance.now();
      const size = sizeOf(ev.data);
      received += size;
      if (typeof ev.data === 'string') {
        const m = parseServerMeasurement(ev.data);
        if (m) onReport(m, m.bytesAcked, now);
      } else if (size > 0) {
        onArrival(size, now);
        // The gauge follows what is arriving now, as Local's does.
        firstArrival ??= now;
        onSample(size, now - firstArrival);
      }
      if (now - lastClientReport >= MEASURE_EVERY_MS && ws.readyState === WebSocket.OPEN) {
        const report = clientMeasurement(received, sent, now - openedAt);
        ws.send(report);
        sent += report.length;
        lastClientReport = now;
      }
    });
  });
}

/** Incompressible upload payload, generated once and sliced per message. */
let uploadPool: Uint8Array | null = null;
function payload(size: number): Uint8Array {
  if (uploadPool === null) {
    uploadPool = new Uint8Array(UPLOAD_MAX_MESSAGE);
    const CRYPTO_MAX = 65536; // getRandomValues rejects anything larger
    for (let offset = 0; offset < uploadPool.length; offset += CRYPTO_MAX) {
      crypto.getRandomValues(uploadPool.subarray(offset, Math.min(offset + CRYPTO_MAX, uploadPool.length)));
    }
  }
  return uploadPool.subarray(0, size);
}

/**
 * Upload: send as fast as the socket drains, and count what the server's
 * kernel says it received.
 *
 * Always the server's count here, because in this direction the browser's
 * view is the one that overstates: it can only see bytes handed to its own
 * socket buffer, which on a long path swallows megabytes before any arrive,
 * and a TCP-splitting proxy acknowledges them sooner still. The server's
 * reports come back on the idle direction, so they are not held up.
 */
export async function measureMlabUpload(
  target: MlabTarget,
  cfg: TransferConfig,
  client: MlabClient,
  onSample: (bytes: number, atMs: number) => void,
  label: string,
  signal?: AbortSignal,
): Promise<PhaseResult> {
  const url = streamUrl(target.uploadUrl, cfg.streams, cfg.transferMs + SERVER_MARGIN_MS, client);
  let firstReport: number | null = null;

  return runPhase(url, cfg, label, false, signal, ({ ws, onReport, expired }) => {
    let openedAt = 0;
    let sent = 0;
    let received = 0;
    let size = UPLOAD_MIN_MESSAGE;
    let lastClientReport = 0;
    let lastCount = 0;
    let stopped = false;

    const pump = () => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (expired()) {
        // Stop feeding, but leave the socket open for the final reports.
        stopped = true;
        return;
      }
      // Fill the queue, not one message per tick: a timer tick in a worker is
      // several milliseconds, and on a fast line one message per tick starves
      // the socket between them. Bounded per tick as well, so a runtime that
      // never reports bufferedAmount cannot spin here forever.
      for (let budget = UPLOAD_QUEUE_MESSAGES; budget > 0; budget -= 1) {
        if (!(ws.bufferedAmount < UPLOAD_QUEUE_MESSAGES * size)) break;
        ws.send(payload(size));
        sent += size;
        if (size < UPLOAD_MAX_MESSAGE && size <= sent / UPLOAD_SCALING_FRACTION) {
          size = Math.min(size * 2, UPLOAD_MAX_MESSAGE);
        }
      }
      const now = performance.now();
      if (now - lastClientReport >= MEASURE_EVERY_MS) {
        const report = clientMeasurement(received, sent, now - openedAt);
        ws.send(report);
        sent += report.length;
        lastClientReport = now;
      }
      setTimeout(pump, 0);
    };

    ws.addEventListener('open', () => {
      openedAt = performance.now();
      lastClientReport = openedAt;
      pump();
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      const now = performance.now();
      received += sizeOf(ev.data);
      if (typeof ev.data !== 'string') return;
      const m = parseServerMeasurement(ev.data);
      if (!m) return;
      onReport(m, m.bytesReceived, now);
      // The gauge takes each report's increase as it lands, in arrival order.
      if (m.bytesReceived !== undefined && m.bytesReceived > lastCount) {
        firstReport ??= now;
        onSample(m.bytesReceived - lastCount, now - firstReport);
        lastCount = m.bytesReceived;
      }
    });

    ws.addEventListener('close', () => {
      stopped = true;
    });
  });
}

export interface MlabRunOptions {
  /** M-Lab site code, for example `sin01`. */
  site: string;
  /** Human name for the site, used in messages. */
  label?: string;
  client: MlabClient;
  mode: string;
  session?: string;
  locateUrl?: string;
  /**
   * An endpoint whose `/meta` describes the visitor's connection. M-Lab
   * reports only an address, so ISP and city come from Delta's own endpoint.
   */
  metaUrl?: string;
  config?: Partial<TransferConfig>;
  onEvent?: (event: RunEvent) => void;
  signal?: AbortSignal;
}

/** See runner.ts: the interface needs updates, not every sample. */
const EMIT_INTERVAL_MS = 50;

/**
 * Latency from the server's TCP stack rather than from timed requests.
 *
 * Ping is the kernel's minimum round trip time: the path itself, with no HTTP
 * handling and no queueing in it. Jitter is the kernel's RTT variation
 * (RTTVAR, RFC 6298), taking the median across streams once the opening second
 * is past, because the estimator starts at half the first sample and means
 * nothing until it has settled. Both are measured while data is flowing, so
 * jitter here includes whatever queueing the transfer itself causes.
 */
export function latencyFromTcp(samples: TcpSample[]): LatencyResult {
  if (samples.length === 0) return { pingMs: 0, jitterMs: 0, samples: [] };
  const pingMs = Math.min(...samples.map((s) => s.minRttMs));
  const settled = samples.filter((s) => s.elapsedMs >= 1000);
  const jitterMs = median((settled.length > 0 ? settled : samples).map((s) => s.rttVarMs));
  return { pingMs, jitterMs, samples: samples.map((s) => s.rttMs) };
}

export async function runMlab(options: MlabRunOptions): Promise<RunResult> {
  const session =
    options.session ??
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

  const cfg: TransferConfig = {
    transferMs: DEFAULT_CONFIG.transferMs,
    bucketMs: DEFAULT_CONFIG.bucketMs,
    rampFraction: DEFAULT_CONFIG.rampFraction,
    trimFraction: DEFAULT_CONFIG.trimFraction,
    streams: MLAB_STREAMS,
    ...options.config,
  };
  const label = options.label ?? options.site;
  const emit = options.onEvent ?? (() => {});
  const startedAt = new Date().toISOString();

  emit({ phase: 'latency', mbps: 0, progress: 0 });
  const [target, meta] = await Promise.all([
    locateMlab(options.site, options.client, {
      locateUrl: options.locateUrl,
      label,
      signal: options.signal,
    }),
    options.metaUrl ? fetchMeta(options.metaUrl.replace(/\/$/, ''), options.signal) : Promise.resolve(null),
  ]);

  emit({ phase: 'download', mbps: 0, progress: 0 });
  const downMeter = liveMeter(900, 400);
  let lastDownEmit = 0;
  const down = await measureMlabDownload(
    target,
    cfg,
    options.client,
    (bytes, atMs) => {
      const mbps = downMeter(bytes, atMs);
      const now = performance.now();
      if (now - lastDownEmit < EMIT_INTERVAL_MS) return;
      lastDownEmit = now;
      emit({ phase: 'download', mbps, progress: Math.min(atMs / cfg.transferMs, 1) });
    },
    label,
    options.signal,
  );

  emit({ phase: 'upload', mbps: 0, progress: 0, downloadMbps: down.transfer.mbps });
  const upMeter = liveMeter(900, 400);
  let lastUpEmit = 0;
  const up = await measureMlabUpload(
    target,
    cfg,
    options.client,
    (bytes, atMs) => {
      const mbps = upMeter(bytes, atMs);
      const now = performance.now();
      if (now - lastUpEmit < EMIT_INTERVAL_MS) return;
      lastUpEmit = now;
      emit({
        phase: 'upload',
        mbps,
        progress: Math.min(atMs / cfg.transferMs, 1),
        downloadMbps: down.transfer.mbps,
      });
    },
    label,
    options.signal,
  );

  emit({ phase: 'done', mbps: down.transfer.mbps, progress: 1, downloadMbps: down.transfer.mbps });

  const latency = latencyFromTcp(down.tcp.length > 0 ? down.tcp : up.tcp);

  // The address M-Lab saw is the one that crossed the international path,
  // which on some networks is not the address the local endpoint saw.
  const seenAs = down.clientAddr ?? up.clientAddr;
  const resultMeta: Meta = {
    ip: seenAs ?? meta?.ip ?? '',
    isp: meta?.isp ?? '',
    asn: meta?.asn ?? '',
    city: meta?.city ?? '',
    country: meta?.country ?? '',
    server: `M-Lab ${target.machine}`,
  };

  return {
    mode: options.mode,
    session,
    // M-Lab signs nothing for Delta, so a Raw result carries no attestations.
    tokens: [],
    downloadMbps: down.transfer.mbps,
    uploadMbps: up.transfer.mbps,
    pingMs: latency.pingMs,
    jitterMs: latency.jitterMs,
    download: down.transfer,
    upload: up.transfer,
    latency,
    meta: resultMeta,
    server: {
      provider: 'mlab',
      site: target.site,
      machine: target.machine,
      city: target.city,
      country: target.country,
    },
    startedAt,
  };
}
