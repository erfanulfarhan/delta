import { useCallback, useEffect, useState } from 'react';
import { Core } from './components/Core';
import { HistoryPanel } from './components/HistoryPanel';
import { Leaderboard } from './components/Leaderboard';
import type { Selection } from './components/ModeSwitch';
import { NetworkTools } from './components/NetworkTools';
import { PrivacyView } from './components/PrivacyView';
import { Reveal } from './components/Reveal';
import { RiverField, type Flow } from './components/RiverField';
import { ServerPicker } from './components/ServerPicker';
import { ShareBar } from './components/ShareBar';
import { SharedResultView } from './components/SharedResultView';
import { Metric, Stat } from './components/Stat';
import { TopBar } from './components/TopBar';
import { Trace } from './components/Trace';
import { Whereabouts } from './components/Whereabouts';
import { useMeta } from './hooks/useMeta';
import { useSpeedtest } from './hooks/useSpeedtest';
import { useReducedMotion, useWorld } from './hooks/useWorld';
import { compare } from './lib/compare';
import { formatMbps, formatMs } from './lib/format';
import { appendHistory, loadHistory, type HistoryEntry } from './lib/history';
import { saveResult } from './lib/results';
import { navigate, parseRoute, type Route } from './lib/route';
import { SHARING_ENABLED } from './lib/supabase';
import {
  AVAILABLE,
  BOTH_AVAILABLE,
  DEFAULT_RAW_SERVER,
  MLAB,
  MOCKED,
  rawServer,
  USING_MOCKS,
  type ModeId,
} from './config';
import { WORLDS } from './worlds';

const LEG: Record<ModeId, string> = { bdix: 'Local', raw: 'Raw' };

export default function App() {
  // Start on an endpoint that exists, so a half-deployed site is usable rather
  // than opening on a disabled control.
  const [selection, setSelection] = useState<Selection>(AVAILABLE.bdix ? 'bdix' : 'raw');
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

  // The ping each Raw location measured this session, for the picker. Keyed on
  // the site the result came from, not the current selection, which may have
  // moved on since the test started.
  const [rawPings, setRawPings] = useState<Record<string, number>>({});
  const rawResult = state.results.raw;
  useEffect(() => {
    const site = rawResult?.server?.site;
    if (!site || !(rawResult.pingMs > 0)) return;
    setRawPings((p) => ({ ...p, [site]: rawResult.pingMs }));
  }, [rawResult]);

  const go = useCallback(() => {
    setShare({ id: null, verified: false, saving: false });
    start(selection === 'both' ? 'both' : 'single', selection === 'raw' ? 'raw' : 'bdix', rawServerId);
  }, [selection, rawServerId, start]);

  // Stop abandons the run: whatever was half measured is not a result.
  const stop = useCallback(() => reset(), [reset]);

  const running = state.running;
  const shownMode: ModeId = state.active ?? (selection === 'raw' ? 'raw' : 'bdix');
  const world = useWorld(shownMode, reducedMotion);
  const { meta: liveMeta, loading: metaLoading } = useMeta();

  const bothDone = !running && state.kind === 'both' && !!state.results.bdix && !!state.results.raw && selection === 'both';
  // With Both selected and idle, a leftover single result is not the answer to
  // the question on screen, so it is not shown as one.
  const result = selection === 'both' && !running ? undefined : state.results[shownMode];
  const meta = result?.meta ?? liveMeta;
  const server = rawServer(rawServerId);

  // A figure moves out to its side of GO once its phase is over. While it is
  // running it lives in the ring, and showing it twice would split the eye.
  const download: number | null = running
    ? state.phase === 'upload'
      ? state.settledDownload
      : null
    : (result?.downloadMbps ?? null);
  const upload: number | null = running ? null : (result?.uploadMbps ?? null);
  const showResult = !running && !!result;

  const flow: Flow = running ? 'testing' : result || bothDone ? 'done' : 'idle';

  const caption = running
    ? `${LEG[shownMode]}${state.kind === 'both' ? (shownMode === 'bdix' ? ' · 1 of 2' : ' · 2 of 2') : ''}`
    : selection === 'both'
      ? 'Both · home, then abroad'
      : selection === 'raw'
        ? `Raw · out to ${server.city}`
        : 'Local · inside Bangladesh';

  const description =
    selection === 'both'
      ? 'Local first, then Raw, then the gap between them. About 40 seconds.'
      : selection === 'raw'
        ? `Your speed abroad, to Measurement Lab's servers in ${server.city}. About 20 seconds.`
        : 'Your speed to Dhaka over BDIX peering, without leaving the country. About 20 seconds.';

  // Only while nothing is on screen: straight after a run it would repeat it.
  const lastRun = running || result || bothDone ? undefined : history.find((h) => h.results[shownMode]);
  const comparison = bothDone ? compare(state.results.bdix!.downloadMbps, state.results.raw!.downloadMbps) : null;

  return (
    <div
      data-world={shownMode}
      className="relative min-h-screen"
      style={
        {
          '--accent': world.accent,
          '--accent-2': world.accent2,
          '--glow': world.glowRgb,
        } as React.CSSProperties
      }
    >
      <div className="backdrop" aria-hidden="true">
        <div className="land" />
        <div className="sea" />
      </div>
      <RiverField
        glowRgb={world.glowRgb}
        toSea={shownMode === 'raw'}
        flow={route.name === 'home' ? flow : 'idle'}
        mbps={running ? state.live : 0}
        reducedMotion={reducedMotion}
        dim={route.name !== 'home'}
      />

      <div className="relative z-10">
        {/* The top bar, any notice and the test share the first screen exactly,
            so the server line at the bottom of the test is never below the fold. */}
        <div className="flex min-h-[100svh] flex-col">
          <TopBar
            home={route.name === 'home'}
            selection={selection}
            onSelect={setSelection}
            disabled={running}
          />

          {(USING_MOCKS || !BOTH_AVAILABLE) && (
            <div className="mx-auto mt-4 w-full max-w-3xl px-5">
              <p className="chip px-5 py-2.5 text-center text-[12px] leading-relaxed text-amber-200/80" style={{ borderRadius: 14 }}>
                {USING_MOCKS
                  ? MOCKED.bdix && MOCKED.raw
                    ? 'Both paths point at local mock servers, so neither measures anything real until VITE_BDIX_URL is set and VITE_MLAB_LOCATE_URL is removed.'
                    : MOCKED.bdix
                      ? 'Local points at a local mock server and measures nothing real until VITE_BDIX_URL is set. Raw is measuring against M-Lab for real.'
                      : 'Raw points at a local mock of M-Lab and measures nothing real until VITE_MLAB_LOCATE_URL is removed. Local is measuring for real.'
                  : `${AVAILABLE.bdix ? 'Raw' : 'Local'} is not deployed yet, so only ${AVAILABLE.bdix ? 'local' : 'raw'} speed can be measured. The comparison needs both.`}
              </p>
            </div>
          )}

          {route.name === 'home' && (
            <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 sm:px-8">
              <div className="flex flex-1 flex-col items-center justify-center gap-7 py-8 lg:gap-8">
                <p key={caption} className="label fade" style={{ color: 'var(--accent-2)' }}>
                  {caption}
                </p>

                <div className="lift grid w-full grid-cols-2 items-center gap-x-4 gap-y-8 lg:grid-cols-[1fr_auto_1fr] lg:gap-x-16">
                  <div className="rise order-1 min-w-0 lg:justify-self-end" style={{ animationDelay: '120ms' }}>
                    {bothDone ? (
                      <Stat
                        label="Local · home"
                        value={state.results.bdix!.downloadMbps}
                        color={WORLDS.bdix.accent}
                        note={`↑ ${formatMbps(state.results.bdix!.uploadMbps)} · ${formatMs(state.results.bdix!.pingMs)} ms`}
                        side="left"
                      />
                    ) : (
                      <Stat
                        label="↓ Download"
                        value={download}
                        live={running && state.phase === 'download'}
                        side="left"
                      />
                    )}
                  </div>

                  <div className="pop order-3 col-span-2 justify-self-center lg:order-2 lg:col-span-1">
                    <Core
                      running={running}
                      phase={state.phase}
                      live={state.live}
                      progress={state.progress}
                      onGo={go}
                      onStop={stop}
                      disabled={selection === 'both' ? !BOTH_AVAILABLE : !AVAILABLE[selection]}
                      goLabel={`Start the ${selection === 'both' ? 'Local and Raw' : LEG[selection]} test`}
                    />
                  </div>

                  <div className="rise order-2 min-w-0 lg:order-3 lg:justify-self-start" style={{ animationDelay: '120ms' }}>
                    {bothDone ? (
                      <Stat
                        label={`Raw · ${server.city}`}
                        value={state.results.raw!.downloadMbps}
                        color={WORLDS.raw.accent}
                        note={`↑ ${formatMbps(state.results.raw!.uploadMbps)} · ${formatMs(state.results.raw!.pingMs)} ms`}
                        side="right"
                      />
                    ) : (
                      <Stat
                        label="↑ Upload"
                        value={upload}
                        live={running && state.phase === 'upload'}
                        side="right"
                      />
                    )}
                  </div>
                </div>

                {comparison ? (
                  <div key="verdict" className="rise flex max-w-lg flex-col items-center gap-2 text-center">
                    <span className="label">{comparison.heading}</span>
                    <span className="num ink text-[56px]">
                      <span className="mr-1 text-[var(--faint)]">×</span>
                      {comparison.ratio.toFixed(1)}
                    </span>
                    <p className="text-[14px] leading-relaxed text-[var(--muted)]">{comparison.verdict}</p>
                  </div>
                ) : running ? (
                  <div className="fade h-[40px] w-full max-w-[380px]">
                    <Trace mbps={state.live} accent={world.accent} glowRgb={world.glowRgb} active={running} height={40} />
                  </div>
                ) : showResult ? (
                  <div className="rise flex flex-wrap items-center justify-center gap-2.5">
                    <Metric label="Ping" value={formatMs(result!.pingMs)} unit="ms" />
                    <Metric label="Jitter" value={formatMs(result!.jitterMs, 1)} unit="ms" />
                  </div>
                ) : (
                  <p className="lift rise max-w-md text-center text-[14.5px] leading-relaxed text-[var(--muted)]" style={{ animationDelay: '240ms' }}>
                    {description}
                  </p>
                )}

                {!running && selection !== 'bdix' && (
                  <div className="flex flex-col items-center gap-4">
                    <ServerPicker selected={rawServerId} onSelect={setRawServerId} disabled={running} pings={rawPings} />
                    {/* M-Lab asks that a test start only with informed consent, so
                        the notice sits beside the control that starts one. */}
                    <p className="max-w-md text-center text-[12px] leading-relaxed text-[var(--faint)]">
                      Raw runs on Measurement Lab&apos;s open servers, which publish every result with
                      your IP address. Pressing GO with Raw or Both selected means you accept{' '}
                      <a href={MLAB.privacyUrl} target="_blank" rel="noreferrer" className="link underline-soft whitespace-nowrap">
                        M-Lab&apos;s privacy policy
                      </a>
                      .
                    </p>
                  </div>
                )}

                {finished && (
                  <ShareBar shortId={share.id} verified={share.verified} saving={share.saving} />
                )}

                {state.error && (
                  <p className="max-w-md text-center text-[13px] leading-relaxed text-[var(--bad)]" role="alert">
                    {state.error}
                  </p>
                )}
              </div>

              <div className="lift rise flex flex-col gap-4 pb-7 sm:flex-row sm:items-end sm:justify-between" style={{ animationDelay: '360ms' }}>
                <Whereabouts meta={meta} loading={metaLoading} mode={shownMode} rawServerId={rawServerId} />
                {shownMode === 'raw' ? (
                  <div className="text-left sm:text-right">
                    <span className="label">Out to sea</span>
                    <p className="mt-1 text-[18px] font-light tracking-tight text-[var(--text)]">
                      {server.city} · {server.km.toLocaleString('en-US')} km
                    </p>
                  </div>
                ) : (
                  lastRun && (
                    <div className="text-left sm:text-right">
                      <span className="label">Last {LEG[shownMode]} run</span>
                      <p className="mono mt-1.5 text-[12.5px] text-[var(--muted)]">
                        {formatMbps(lastRun.results[shownMode]!.downloadMbps)} down ·{' '}
                        {formatMbps(lastRun.results[shownMode]!.uploadMbps)} up ·{' '}
                        {formatMs(lastRun.results[shownMode]!.pingMs)} ms
                      </p>
                    </div>
                  )
                )}
              </div>
            </section>
          )}

          {route.name !== 'home' && (
            <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-5 py-14">
              {route.name === 'shared' && <SharedResultView id={route.id} />}
              {route.name === 'leaderboard' && <Leaderboard />}
              {route.name === 'privacy' && <PrivacyView />}
            </main>
          )}
        </div>

        {route.name === 'home' && !running && (
          <div className="mx-auto grid w-full max-w-6xl items-start gap-5 px-5 pt-6 pb-12 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:gap-6">
            <Reveal id="tools">
              <NetworkTools />
            </Reveal>
            <Reveal id="history" delay={120}>
              <HistoryPanel entries={history} onCleared={() => setHistory([])} />
            </Reveal>
          </div>
        )}

        <footer className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 pt-4 pb-10 sm:px-8">
          <div className="rule" />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-xl text-[12.5px] leading-relaxed text-[var(--faint)]">
              Local is measured against a Cloudflare edge inside Bangladesh, which reaches most local
              ISPs over BDIX peering. It approximates a BDIX server rather than being one. Raw is
              measured against Measurement Lab&apos;s servers abroad, physical machines on 10 Gbps
              transit with no CDN in front.
            </p>
            <nav className="flex shrink-0 gap-6 text-[13px]" aria-label="Footer">
              {SHARING_ENABLED && (
                <a
                  href="/leaderboard"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/leaderboard');
                    window.scrollTo({ top: 0 });
                  }}
                  className="link"
                >
                  ISP leaderboard
                </a>
              )}
              <a
                href="/privacy"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/privacy');
                  window.scrollTo({ top: 0 });
                }}
                className="link"
              >
                Privacy
              </a>
              <a href="https://github.com/erfanulfarhan/delta" target="_blank" rel="noreferrer" className="link">
                Source
              </a>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
