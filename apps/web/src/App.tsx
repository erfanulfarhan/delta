import { useMemo, useState } from 'react';
import { Gauge } from './components/Gauge';
import { ModeToggle } from './components/ModeToggle';
import { ParticleField } from './components/ParticleField';
import { StatRow } from './components/StatRow';
import { Trace } from './components/Trace';
import { Comparison } from './components/Comparison';
import { useReducedMotion, useWorld } from './hooks/useWorld';
import { useSpeedtest } from './hooks/useSpeedtest';
import { ENDPOINTS, USING_MOCKS, type ModeId } from './config';

const PHASE_COPY: Record<string, string> = {
  idle: 'Ready',
  latency: 'Measuring latency',
  download: 'Measuring download',
  upload: 'Measuring upload',
  done: 'Complete',
  error: 'Failed',
};

export default function App() {
  const [mode, setMode] = useState<ModeId>('bdix');
  const reducedMotion = useReducedMotion();
  const { state, start, reset } = useSpeedtest();

  // While a run-both test is live the world follows whichever endpoint is
  // actually being measured, so the page travels with the traffic.
  const shownMode = state.active ?? mode;
  const world = useWorld(shownMode, reducedMotion);

  const bothDone = state.kind === 'both' && state.results.bdix && state.results.raw;
  const singleResult = state.kind === 'single' ? state.results[mode] : undefined;

  const displayMbps = state.running
    ? state.live
    : (singleResult?.downloadMbps ?? state.results[shownMode]?.downloadMbps ?? 0);

  const direction = state.phase === 'upload' ? 'up' : state.running ? 'down' : 'idle';

  const stats = useMemo(() => {
    const result = state.results[shownMode];
    return [
      { label: 'Download', value: result ? result.downloadMbps.toFixed(2) : '--', unit: 'Mbps' },
      { label: 'Upload', value: result ? result.uploadMbps.toFixed(2) : '--', unit: 'Mbps' },
      { label: 'Ping', value: result ? result.pingMs.toFixed(0) : '--', unit: 'ms' },
      { label: 'Jitter', value: result ? result.jitterMs.toFixed(1) : '--', unit: 'ms' },
    ];
  }, [state.results, shownMode]);

  const meta = state.results[shownMode]?.meta;

  return (
    <div
      className="relative min-h-full"
      style={
        {
          '--accent': world.accent,
          '--accent-alt': world.accentAlt,
          '--bg-0': world.bg[0],
          '--bg-1': world.bg[1],
          '--glow': world.glowRgb,
        } as React.CSSProperties
      }
    >
      <div className="world-bg" />
      <div className="pointer-events-none fixed inset-0 z-[1]">
        <ParticleField
          world={world}
          mbps={state.running ? state.live : 0}
          direction={direction}
          reducedMotion={reducedMotion}
        />
      </div>

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-7 px-5 py-9">
        <header className="flex w-full items-center justify-between">
          <div className="flex flex-col">
            <span className="display text-[22px] leading-none">Two Speeds</span>
            <span className="mono mt-1 text-[9px] uppercase tracking-[0.3em] text-white/30">
              BDIX vs international
            </span>
          </div>
          {meta && (
            <div className="mono hidden text-right text-[10px] leading-relaxed text-white/35 sm:block">
              <div>{meta.isp}</div>
              <div className="text-white/20">
                {[meta.city, meta.country, meta.asn].filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
        </header>

        {USING_MOCKS && (
          <div className="mono w-full rounded-lg border border-amber-400/25 bg-amber-400/5 px-4 py-2.5 text-center text-[10px] leading-relaxed tracking-wide text-amber-200/70">
            Endpoints point at localhost. These figures come from the local mock server and
            measure nothing real until VITE_BDIX_URL and VITE_RAW_URL are set.
          </div>
        )}

        {!bothDone && (
          <>
            {/* During a run-both the toggle follows whichever endpoint is
                actually being measured. Leaving it pinned to the user's last
                choice while the other endpoint runs contradicts the world
                behind it and reads as a bug. */}
            <ModeToggle
              mode={state.kind === 'both' && state.active ? state.active : mode}
              onChange={setMode}
              disabled={state.running}
              world={world}
            />

            <div className="relative flex flex-col items-center">
              <Gauge
                mbps={displayMbps}
                world={world}
                label={state.running ? PHASE_COPY[state.phase] ?? '' : ENDPOINTS[shownMode].label}
                sublabel={!state.running ? ENDPOINTS[shownMode].description : undefined}
              />
              {state.running && (
                <div
                  className="mono absolute -bottom-2 text-[10px] tracking-[0.24em] text-white/40"
                  aria-live="polite"
                >
                  {Math.round(state.progress * 100)}%
                </div>
              )}
            </div>

            <div className="w-full max-w-2xl opacity-70">
              <Trace mbps={state.live} world={world} active={state.running} />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => start('single', mode)}
                disabled={state.running}
                className="sweep relative cursor-pointer overflow-hidden rounded-full px-9 py-3.5 text-[12px] font-medium tracking-[0.18em] uppercase transition-transform duration-300 hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  color: world.bg[0],
                  background: `linear-gradient(135deg, ${world.accent}, ${world.accentAlt})`,
                  boxShadow: `0 0 46px rgba(${world.glowRgb}, 0.3)`,
                }}
              >
                {state.running ? 'Testing' : `Test ${ENDPOINTS[mode].label}`}
              </button>
              <button
                onClick={() => start('both', mode)}
                disabled={state.running}
                className="panel cursor-pointer rounded-full px-7 py-3.5 text-[12px] tracking-[0.18em] text-white/65 uppercase transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Run both
              </button>
            </div>

            {state.results[shownMode] && !state.running && <StatRow stats={stats} world={world} />}
          </>
        )}

        {bothDone && (
          <>
            <Comparison bdix={state.results.bdix!} raw={state.results.raw!} />
            <button
              onClick={reset}
              className="panel cursor-pointer rounded-full px-7 py-3 text-[11px] tracking-[0.2em] text-white/60 uppercase transition-colors hover:text-white"
            >
              Test again
            </button>
          </>
        )}

        {state.error && (
          <p className="mono max-w-md text-center text-[11px] leading-relaxed text-red-300/70">
            {state.error}
          </p>
        )}

        <footer className="mono mt-auto pt-8 text-center text-[9px] leading-relaxed tracking-wide text-white/20">
          BDIX is measured against a Cloudflare edge inside Bangladesh, which reaches most local
          ISPs over BDIX peering. It approximates a BDIX server rather than being one.
        </footer>
      </main>
    </div>
  );
}
