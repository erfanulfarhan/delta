import { useEffect, useState } from 'react';
import {
  checkReachability,
  fetchIpInfo,
  type IpInfo,
  type PortOutcome,
  type Reachability,
} from '../lib/network';

interface Props {
  accent: string;
  glowRgb: string;
}

const VERDICT_COPY: Record<IpInfo['verdict'], { label: string; good: boolean }> = {
  shared: { label: 'Shared (carrier NAT)', good: false },
  'likely-shared': { label: 'Likely shared', good: false },
  dynamic: { label: 'Public but dynamic', good: true },
  'likely-public': { label: 'Likely public', good: true },
};

const OUTCOME: Record<PortOutcome, { label: string; tone: string; hint: string }> = {
  open: { label: 'open', tone: '#22d3a5', hint: 'something is listening' },
  refused: { label: 'refused', tone: '#22d3a5', hint: 'your router replied, so traffic arrives' },
  silent: { label: 'no reply', tone: '#7c8aa5', hint: 'dropped or not forwarded' },
  error: { label: 'error', tone: '#ff6b6b', hint: 'unreachable' },
};

export function NetworkTools({ accent, glowRgb }: Props) {
  const [info, setInfo] = useState<IpInfo | null>(null);
  const [reach, setReach] = useState<Reachability | null>(null);
  const [loading, setLoading] = useState(true);
  const [port, setPort] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [i, r] = await Promise.all([fetchIpInfo(), checkReachability()]);
      if (!alive) return;
      setInfo(i);
      if (r && !('error' in r)) setReach(r);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const runCustom = async () => {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setError('Enter a port between 1 and 65535.');
      return;
    }
    setChecking(true);
    setError(null);
    const r = await checkReachability([n]);
    setChecking(false);
    if ('error' in r) setError(r.error);
    else setReach(r);
  };

  const verdict = info ? VERDICT_COPY[info.verdict] : null;

  return (
    <section className="flex w-full max-w-xl flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="mono text-[9px] uppercase tracking-[0.26em] text-[var(--muted)]">
          Your connection
        </h2>
        <span className="mono text-[9px] tracking-[0.14em] text-[var(--faint)]">
          probed from Singapore
        </span>
      </div>

      <div className="panel divide-y divide-[var(--line)] overflow-hidden rounded-xl">
        <div className="flex items-baseline justify-between gap-4 px-4 py-3">
          <span className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
            Inbound reachable
          </span>
          <span
            className="mono text-right text-[11px]"
            style={{ color: reach ? (reach.reachable ? accent : '#ff8f6b') : 'var(--faint)' }}
          >
            {loading ? 'probing…' : (reach?.headline ?? 'unavailable')}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-4 px-4 py-3">
          <span className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
            Address type
          </span>
          <span
            className="mono text-right text-[11px]"
            style={{ color: verdict ? (verdict.good ? accent : '#ff8f6b') : 'var(--faint)' }}
          >
            {loading ? 'checking…' : (verdict?.label ?? 'unavailable')}
          </span>
        </div>

        {info?.reverseDns && (
          <div className="flex items-baseline justify-between gap-4 px-4 py-3">
            <span className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
              Reverse DNS
            </span>
            <span className="mono truncate text-right text-[10px]">{info.reverseDns}</span>
          </div>
        )}

        {reach && (
          <p className="px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">{reach.detail}</p>
        )}
      </div>

      {reach && reach.probes.length > 0 && (
        <div className="panel flex flex-col gap-2 rounded-xl p-4">
          <span className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
            Ports probed
          </span>
          <div className="flex flex-wrap gap-2">
            {reach.probes.map((p) => (
              <span
                key={p.port}
                title={OUTCOME[p.outcome].hint}
                className="mono rounded-md border border-[var(--line)] bg-black/25 px-2.5 py-1 text-[10px]"
              >
                <span className="text-[var(--text)]">{p.port}</span>
                <span className="mx-1 text-[var(--faint)]">·</span>
                <span style={{ color: OUTCOME[p.outcome].tone }}>{OUTCOME[p.outcome].label}</span>
              </span>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--faint)]">
            Nothing needs to be open for this to be useful. A refusal still proves traffic from
            the internet arrives at your address, which is the part carrier NAT takes away.
          </p>
        </div>
      )}

      <div className="panel flex flex-col gap-3 rounded-xl p-4">
        <div>
          <h3 className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
            Check a specific port
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
            If you have forwarded a port for seeding or hosting, test it here. Start the
            application first so something is listening.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            onKeyDown={(e) => e.key === 'Enter' && !checking && runCustom()}
            placeholder="e.g. 51413"
            inputMode="numeric"
            aria-label="Port to test"
            className="mono w-32 rounded-lg border border-[var(--line)] bg-black/30 px-3 py-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:border-[color:var(--accent)]"
          />
          <button
            onClick={runCustom}
            disabled={checking || !port}
            className="cursor-pointer rounded-lg px-5 py-2 text-[11px] font-semibold tracking-[0.14em] uppercase transition-transform duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: '#06040f',
              background: accent,
              boxShadow: `0 6px 22px -8px rgba(${glowRgb},0.7)`,
            }}
          >
            {checking ? 'Testing' : 'Test'}
          </button>
        </div>

        {error && <p className="mono text-[11px] text-red-300/80">{error}</p>}
      </div>
    </section>
  );
}
