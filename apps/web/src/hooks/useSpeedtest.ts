import { useCallback, useEffect, useRef, useState } from 'react';
import type { Phase, RunResult } from '@speedtest/engine';
import { baseUrlFor, type ModeId } from '../config';
import type { WorkerRequest, WorkerResponse } from '../worker/measure.worker';

export type TestKind = 'single' | 'both';

export interface SpeedtestState {
  phase: Phase;
  /** Live throughput for the gauge, Mbps. */
  live: number;
  /** Settled download figure for the endpoint being measured, once known. */
  settledDownload: number;
  progress: number;
  /** Which endpoint is being measured right now. */
  active: ModeId | null;
  results: Partial<Record<ModeId, RunResult>>;
  kind: TestKind;
  error: string | null;
  running: boolean;
}

const IDLE: SpeedtestState = {
  phase: 'idle',
  live: 0,
  settledDownload: 0,
  progress: 0,
  active: null,
  results: {},
  kind: 'single',
  error: null,
  running: false,
};

function createWorker(): Worker {
  return new Worker(new URL('../worker/measure.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * One session id for the whole test, both legs included.
 *
 * Attestations are bound to a session, so a run-both whose two legs used
 * different ids would have half its tokens rejected as belonging to someone
 * else's run, and every comparison would come out unverified.
 */
function newSession(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/** Run one endpoint to completion in a fresh worker. */
function measure(
  mode: ModeId,
  session: string,
  baseUrl: string,
  onEvent: (phase: Phase, mbps: number, progress: number, downloadMbps?: number) => void,
): { promise: Promise<RunResult>; cancel: () => void } {
  const worker = createWorker();

  const promise = new Promise<RunResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'event')
        onEvent(msg.event.phase, msg.event.mbps, msg.event.progress, msg.event.downloadMbps);
      else if (msg.type === 'result') {
        worker.terminate();
        resolve(msg.result);
      } else {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'measurement worker failed'));
    };

    const request: WorkerRequest = {
      type: 'run',
      baseUrl,
      mode,
      session,
    };
    worker.postMessage(request);
  });

  return { promise, cancel: () => worker.terminate() };
}

export function useSpeedtest() {
  const [state, setState] = useState<SpeedtestState>(IDLE);
  const cancelRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelRef.current?.();
    };
  }, []);

  const start = useCallback(async (kind: TestKind, mode: ModeId, rawServerId: string) => {
    // Run both always goes BDIX first, then RAW. Fixed order so the ratio
    // means the same thing on every run and repeat runs stay comparable.
    const sequence: ModeId[] = kind === 'both' ? ['bdix', 'raw'] : [mode];
    const session = newSession();

    setState({ ...IDLE, kind, running: true, active: sequence[0]!, phase: 'latency' });

    const collected: Partial<Record<ModeId, RunResult>> = {};

    for (const id of sequence) {
      if (!aliveRef.current) return;
      setState((s) => ({
        ...s,
        active: id,
        live: 0,
        settledDownload: 0,
        progress: 0,
        phase: 'latency',
      }));

      const url = baseUrlFor(id, rawServerId);
      const { promise, cancel } = measure(id, session, url, (phase, mbps, progress, downloadMbps) => {
        if (!aliveRef.current) return;
        setState((s) =>
          s.active === id
            ? {
                ...s,
                phase,
                live: mbps,
                progress,
                settledDownload: downloadMbps ?? s.settledDownload,
              }
            : s,
        );
      });
      cancelRef.current = cancel;

      try {
        const result = await promise;
        if (!aliveRef.current) return;
        collected[id] = result;
        setState((s) => ({ ...s, results: { ...s.results, [id]: result } }));
      } catch (error) {
        if (!aliveRef.current) return;
        setState((s) => ({
          ...s,
          running: false,
          phase: 'error',
          active: null,
          error: error instanceof Error ? error.message : String(error),
        }));
        return;
      }
    }

    if (!aliveRef.current) return;
    setState((s) => ({ ...s, running: false, phase: 'done', active: null, live: 0, progress: 1 }));
  }, []);

  const reset = useCallback(() => {
    cancelRef.current?.();
    setState(IDLE);
  }, []);

  return { state, start, reset };
}
