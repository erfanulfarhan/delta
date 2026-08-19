import { useCallback, useEffect, useState } from 'react';
import { Gauge } from './components/Gauge';
import { GoButton } from './components/GoButton';
import { ModeToggle } from './components/ModeToggle';
import { DistanceLine } from './components/DistanceLine';
import { Readouts } from './components/Readouts';
import { Trace } from './components/Trace';
import { Comparison } from './components/Comparison';
import { useReducedMotion, useWorld } from './hooks/useWorld';
import { useMeta } from './hooks/useMeta';
import { ServerCard } from './components/ServerCard';
import { useSpeedtest } from './hooks/useSpeedtest';
import { SharedResultView } from './components/SharedResultView';
import { Leaderboard } from './components/Leaderboard';
import { HistoryPanel } from './components/HistoryPanel';
import { ShareBar } from './components/ShareBar';
import { appendHistory, loadHistory, type HistoryEntry } from './lib/history';
import { saveResult } from './lib/results';
import { SHARING_ENABLED } from './lib/supabase';
import { navigate, parseRoute, type Route } from './lib/route';
import {
  AVAILABLE,
  BOTH_AVAILABLE,
  DEFAULT_RAW_SERVER,
  ENDPOINTS,
  USING_MOCKS,
  type ModeId,
} from './config';
import { ServerPicker } from './components/ServerPicker';

const PHASE_LABEL: Record<string, string> = {
  idle: 'Ready',
  latency: 'Latency',
  download: 'Download',
  upload: 'Upload',
  done: 'Complete',
  error: 'Failed',
};

export default function App() {
  // Start on an endpoint that exists, so a half-deployed site is usable rather
  // than opening on a disabled control.
  const [mode, setMode] = useState<ModeId>(AVAILABLE.bdix ? 'bdix' : 'raw');
  const reducedMotion = useReducedMotion();
  const { state, start, reset } = useSpeedtest();

  const [rawServerId, setRawServerId] = useState<string>(DEFAULT_RAW_SERVER);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [share, setShare] = useState<{ id: string | null; verified: boolean; saving: boolean }>({
    id: null,
    verified: false,
    saving: false,
  });

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const finished = state.phase === 'done' && !state.running;

  // Persist exactly once per completed run. Local history is written first and
  // unconditionally, so a failed or unconfigured save never costs the user the
  // record of their own test.
  useEffect(() => {
    if (!finished) return;
    const results = state.results;
    if (!results.bdix && !results.raw) return;

    setHistory(appendHistory(state.kind, results));
    if (!SHARING_ENABLED) return;

    let alive = true;
    setShare({ id: null, verified: false, saving: true });
    saveResult(state.kind, results).then((saved) => {
      if (!alive) return;
      setShare({ id: saved?.shortId ?? null, verified: saved?.verified ?? false, saving: false });
      if (saved) setHistory(appendHistory(state.kind, results, saved.shortId));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const restart = useCallback(() => {
    setShare({ id: null, verified: false, saving: false });
    reset();
  }, [reset]);

  const shownMode = state.active ?? mode;
  const { meta: liveMeta, loading: metaLoading } = useMeta(mode, rawServerId);
  const world = useWorld(shownMode, reducedMotion);

  const bothDone = state.kind === 'both' && state.results.bdix && state.results.raw;
  const result = state.results[shownMode];

  // During a run the gauge follows whichever phase is live, so the handoff from
  // download to upload is visible rather than something you have to infer.
  const gaugeValue = state.running ? state.live : (result?.downloadMbps ?? 0);
  const direction = state.phase === 'upload' ? 'up' : state.running ? 'down' : 'idle';

  // Go occupies the dial until a run starts, and again once results are cleared.
  const showGoInDial = !state.running && !result;

  // Falls back to the settled figure the engine reports once the download phase
  // ends, not to zero. Otherwise the measured download number drains away to
  // nothing while the upload phase runs, which reads as the display breaking.
  const downloadValue =
    state.phase === 'download' && state.running
      ? state.live
      : (result?.downloadMbps ?? state.settledDownload);
  const uploadValue = state.phase === 'upload' && state.running
    ? state.live
    : (result?.uploadMbps ?? 0);

  const meta = result?.meta ?? liveMeta;

  return (
    <div
      className="relative min-h-full"
      style={
        {
          '--accent': world.accent,
          '--accent-2': world.accent2,
          '--glow': world.glowRgb,
        } as React.CSSProperties
      }
    >
      <div className="shell" />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-5 px-5 py-7">
        <header className="flex w-full items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <span className="display accent-text text-[21px] font-bold tracking-tight">Delta</span>
            <span className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--faint)]">
              Local vs Raw
            </span>
          </div>
          {meta && (
            <div className="mono hidden text-right text-[10px] leading-relaxed text-[var(--muted)] sm:block">
              <div>{meta.isp}</div>
              <div className="text-[var(--faint)]">
                {[meta.city, meta.country].filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
        </header>

        {!USING_MOCKS && !BOTH_AVAILABLE && (
          <div className="mono w-full rounded-lg border border-[var(--line)] bg-white/[0.02] px-4 py-2.5 text-center text-[10px] leading-relaxed text-[var(--muted)]">
            {AVAILABLE.bdix ? 'Raw' : 'Local'} is not deployed yet, so only{' '}
            {AVAILABLE.bdix ? 'local' : 'raw'} speed can be measured. The comparison needs both.
          </div>
        )}

        {USING_MOCKS && (
          <div className="mono w-full rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-2.5 text-center text-[10px] leading-relaxed text-amber-200/70">
            Endpoints point at localhost. These figures come from the local mock server and measure
            nothing real until VITE_BDIX_URL and VITE_RAW_URL are set.
          </div>
        )}

        {route.name === 'shared' && <SharedResultView id={route.id} />}
        {route.name === 'leaderboard' && <Leaderboard />}

        {route.name === 'home' && !bothDone && (
          <>
            <ModeToggle
              mode={state.kind === 'both' && state.active ? state.active : mode}
              onChange={setMode}
              disabled={state.running}
              accent={world.accent}
              glowRgb={world.glowRgb}
            />

            <Gauge
              mbps={gaugeValue}
              accent={world.accent}
              accent2={world.accent2}
              glowRgb={world.glowRgb}
              label={state.running ? PHASE_LABEL[state.phase] ?? '' : ENDPOINTS[shownMode].label}
              size={300}
              armed={state.running}
              center={
                showGoInDial ? (
                  <GoButton
                    onClick={() => start('single', mode, rawServerId)}
                    disabled={state.running}
                    accent={world.accent}
                    glowRgb={world.glowRgb}
                  />
                ) : undefined
              }
            />

            <Readouts
              downloadMbps={downloadValue}
              uploadMbps={uploadValue}
              pingMs={result ? result.pingMs.toFixed(0) : '—'}
              jitterMs={result ? result.jitterMs.toFixed(1) : '—'}
              phase={state.running ? state.phase : result ? 'done' : 'idle'}
              accent={world.accent}
              glowRgb={world.glowRgb}
            />

            {/* The signature element: how far the traffic actually went. */}
            <div className="w-full max-w-xl">
              <div className="h-[72px] w-full">
                <DistanceLine
                  world={world}
                  mbps={state.running ? state.live : 0}
                  direction={direction}
                  reducedMotion={reducedMotion}
                />
              </div>
              {/* The trace only earns its space once there is a curve to draw. */}
              {state.running && (
                <div className="h-[44px] w-full opacity-70">
                  <Trace
                    mbps={state.live}
                    accent={world.accent}
                    glowRgb={world.glowRgb}
                    active={state.running}
                    height={44}
                  />
                </div>
              )}
            </div>

            {/* Raw only. Local has exactly one path by definition, so offering a
                choice there would imply an option that does not exist. Keyed on
                the toggle rather than on the endpoint being measured, so the
                layout does not shift underneath a run-both mid-test. */}
            {mode === 'raw' && (
              <div className="rise w-full max-w-xl">
                <ServerPicker
                  selected={rawServerId}
                  onSelect={setRawServerId}
                  disabled={state.running}
                  accent={world.accent}
                  glowRgb={world.glowRgb}
                />
              </div>
            )}

            {/* Shown before anything is pressed: which server will be used, and
                what it sees of your connection. */}
            <ServerCard
              meta={meta}
              loading={metaLoading && !meta}
              mode={shownMode}
              accent={world.accent}
              rawServerId={rawServerId}
            />

            {finished && state.kind === 'single' && (
              <ShareBar shortId={share.id} verified={share.verified} saving={share.saving} />
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              {!showGoInDial && (
                <button
                  onClick={() => start('single', mode, rawServerId)}
                  disabled={state.running}
                  className="relative cursor-pointer rounded-full px-9 py-3 text-[12px] font-semibold tracking-[0.16em] uppercase transition-transform duration-300 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    color: '#06040f',
                    background: `linear-gradient(120deg, ${world.accent}, ${world.accent2})`,
                    boxShadow: `0 10px 34px -10px rgba(${world.glowRgb}, 0.65)`,
                  }}
                >
                  {state.running && (
                    <span
                      className="go-ring absolute inset-0 rounded-full"
                      style={{ border: `1px solid ${world.accent}` }}
                      aria-hidden="true"
                    />
                  )}
                  {state.running ? 'Testing' : 'Test again'}
                </button>
              )}
              <button
                onClick={() => start('both', mode, rawServerId)}
                disabled={state.running || !BOTH_AVAILABLE}
                title={BOTH_AVAILABLE ? undefined : 'Needs both endpoints deployed'}
                className="panel cursor-pointer rounded-full px-7 py-3 text-[12px] tracking-[0.16em] text-[var(--muted)] uppercase transition-colors hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Run both
              </button>
            </div>
          </>
        )}

        {route.name === 'home' && bothDone && (
          <>
            <Comparison bdix={state.results.bdix!} raw={state.results.raw!} />
            <ShareBar shortId={share.id} verified={share.verified} saving={share.saving} />
            <button
              onClick={restart}
              className="panel cursor-pointer rounded-full px-7 py-3 text-[11px] tracking-[0.18em] text-[var(--muted)] uppercase transition-colors hover:text-[var(--text)]"
            >
              Test again
            </button>
          </>
        )}

        {route.name === 'home' && !state.running && (
          <HistoryPanel entries={history} onCleared={() => setHistory([])} />
        )}

        {state.error && (
          <p className="mono max-w-md text-center text-[11px] leading-relaxed text-red-300/70">
            {state.error}
          </p>
        )}

        <footer className="mono mt-auto flex flex-col items-center gap-3 pt-6 text-center text-[9px] leading-relaxed text-[var(--faint)]">
          {SHARING_ENABLED && route.name === 'home' && (
            <button
              onClick={() => navigate('/leaderboard')}
              className="cursor-pointer uppercase tracking-[0.2em] transition-colors hover:text-[var(--text)]"
            >
              ISP leaderboard
            </button>
          )}
          <span className="max-w-xl">
            Local is measured against a Cloudflare edge inside Bangladesh, which reaches most local
            ISPs over BDIX peering. It approximates a BDIX server rather than being one.
          </span>
        </footer>
      </main>
    </div>
  );
}
