/// <reference lib="webworker" />
import { run, type RunEvent, type RunResult } from '@speedtest/engine';

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
 * XMLHttpRequest, which the upload phase depends on for progress events, is
 * available in dedicated workers. Service workers would not do.
 */

export type WorkerRequest = {
  type: 'run';
  baseUrl: string;
  mode: string;
  transferMs?: number;
};

export type WorkerResponse =
  | { type: 'event'; event: RunEvent }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; message: string };

const post = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (e.data?.type !== 'run') return;

  try {
    const result = await run({
      baseUrl: e.data.baseUrl,
      mode: e.data.mode,
      config: e.data.transferMs ? { transferMs: e.data.transferMs } : undefined,
      onEvent: (event) => post({ type: 'event', event }),
    });
    post({ type: 'result', result });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
