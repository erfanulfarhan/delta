import { useEffect, useState } from 'react';
import { checkPort, fetchIpInfo, type IpInfo, type PortResult } from '../lib/network';

interface Props {
  accent: string;
  glowRgb: string;
}

const VERDICT_COPY: Record<IpInfo['verdict'], { label: string; detail: string; good: boolean }> = {
  shared: {
    label: 'Shared (carrier NAT)',
    detail:
      'Your address is inside 100.64.0.0/10, the range reserved for carrier-grade NAT. You share it with other subscribers and cannot forward ports through it.',
    good: false,
  },
  'likely-shared': {
    label: 'Likely shared',
    detail:
      'Reverse DNS for your address names it as carrier NAT or shared. Port forwarding will almost certainly not work.',
    good: false,
  },
  dynamic: {
    label: 'Public but dynamic',
    detail:
      'Your address looks publicly routable but is drawn from a rotating pool, so it changes. Forwarding works while it lasts, but anything pinned to the address will break when it moves.',
    good: true,
  },
  'likely-public': {
    label: 'Likely public',
    detail:
      'Nothing indicates a shared address. The port test below is the only way to confirm it.',
    good: true,
  },
};

const OUTCOME_STYLE: Record<PortResult['outcome'], { label: string; tone: string }> = {
  open: { label: 'Open', tone: '#22d3a5' },
  closed: { label: 'Closed', tone: '#ffb259' },
  filtered: { label: 'No response', tone: '#ff6b6b' },
  error: { label: 'Failed', tone: '#7c8aa5' },
};

export function NetworkTools({ accent, glowRgb }: Props) {
  const [info, setInfo] = useState<IpInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [port, setPort] = useState('6881');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<PortResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchIpInfo().then((i) => {
      if (!alive) return;
      setInfo(i);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const run = async () => {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setError('Enter a port between 1 and 65535.');
      setResult(null);
      return;
    }
    setChecking(true);
    setError(null);
    setResult(null);
    const r = await checkPort(n);
    setChecking(false);
    if ('error' in r) setError(r.error);
    else setResult(r);
  };

  const verdict = info ? VERDICT_COPY[info.verdict] : null;

  return (
    <section className="flex w-full max-w-xl flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="mono text-[9px] uppercase tracking-[0.26em] text-[var(--muted)]">
          Your connection
        </h2>
        <span className="mono text-[9px] tracking-[0.14em] text-[var(--faint)]">
          tested from Singapore
        </span>
      </div>

      <div className="panel divide-y divide-[var(--line)] overflow-hidden rounded-xl">
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
            <span className="mono truncate text-right text-[10px] text-[var(--text)]">
              {info.reverseDns}
            </span>
          </div>
        )}

        {verdict && (
          <p className="px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
            {verdict.detail}
          </p>
        )}
      </div>

      <div className="panel flex flex-col gap-3 rounded-xl p-4">
        <div>
          <h3 className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
            Port reachability
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
            For seeding torrents or hosting a game, the internet has to be able to reach you.
            Start the application first so something is listening, then test its port. 6881 is
            BitTorrent's default.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            onKeyDown={(e) => e.key === 'Enter' && !checking && run()}
            inputMode="numeric"
            aria-label="Port to test"
            className="mono w-28 rounded-lg border border-[var(--line)] bg-black/30 px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[color:var(--accent)]"
          />
          <button
            onClick={run}
            disabled={checking}
            className="cursor-pointer rounded-lg px-5 py-2 text-[11px] font-semibold tracking-[0.14em] uppercase transition-transform duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: '#06040f', background: accent, boxShadow: `0 6px 22px -8px rgba(${glowRgb},0.7)` }}
          >
            {checking ? 'Testing' : 'Test port'}
          </button>
        </div>

        {error && <p className="mono text-[11px] text-red-300/80">{error}</p>}

        {result && (
          <div className="rise flex flex-col gap-1.5 rounded-lg border border-[var(--line)] bg-black/20 p-3">
            <div className="flex items-baseline gap-2">
              <span
                className="display text-[15px] font-semibold"
                style={{ color: OUTCOME_STYLE[result.outcome].tone }}
              >
                {OUTCOME_STYLE[result.outcome].label}
              </span>
              <span className="mono text-[10px] text-[var(--faint)]">
                port {result.port} · {result.detail}
              </span>
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--muted)]">{result.meaning}</p>
          </div>
        )}
      </div>
    </section>
  );
}
