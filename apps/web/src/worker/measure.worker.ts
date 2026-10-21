/// <reference lib="webworker" />
import { run, runMlab, type MlabClient, type RunEvent, type RunResult } from '@speedtest/engine';

/**
 * The measurement runs here, off the main thread, and this is a correctness
 * requirement rather than an optimisation.
 *
 * The interface animates a canvas particle field and a repainting gauge during
 * the test. On the main thread that work competes with the loop draining the
 * download stream, so bytes get counted late and the measured speed comes out
 * low. The effect is worst on weak devices, which means the site would be
 * least accurate for exactly the users whose connections are most in doubt.
 *
 * XMLHttpRequest, which Local's upload depends on for progress events, and
 * WebSocket, which Raw runs over, are both available in dedicated workers.
 * Service workers would not do.
 */

/** Local: Delta's own endpoint, over HTTP. */
export type LocalRequest = {
  type: 'run';
  provider: 'delta';
  baseUrl: string;
  origins?: string[];
  mode: string;
  /** Shared across both legs of a run-both so their attestations judge as one. */
  session: string;
  transferMs?: number;
};

/** Raw: a Measurement Lab site, over WebSocket. */
export type MlabRequest = {
  type: 'run';
  provider: 'mlab';
  site: string;
  label: string;
  locateUrl: string;
  /** Delta's endpoint, which knows the visitor's ISP and city. M-Lab does not. */
  metaUrl: string;
  client: MlabClient;
  mode: string;
  session: string;
  transferMs?: number;
};

export type WorkerRequest = LocalRequest | MlabRequest;

export type WorkerResponse =
  | { type: 'event'; event: RunEvent }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; message: string };

const post = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req?.type !== 'run') return;
  const onEvent = (event: RunEvent) => post({ type: 'event', event });
  const config = req.transferMs ? { transferMs: req.transferMs } : undefined;

  try {
    const result =
      req.provider === 'mlab'
        ? await runMlab({
            site: req.site,
            label: req.label,
            client: req.client,
            mode: req.mode,
            session: req.session,
            locateUrl: req.locateUrl,
            metaUrl: req.metaUrl,
            config,
            onEvent,
          })
        : await run({
            baseUrl: req.baseUrl,
            origins: req.origins,
            mode: req.mode,
            session: req.session,
            config,
            onEvent,
          });
    post({ type: 'result', result });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
