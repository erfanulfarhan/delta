import { useEffect, useState } from 'react';
import {
  checkReachability,
  fetchIpInfo,
  type IpInfo,
  type PortOutcome,
  type Reachability,
} from '../lib/network';

const VERDICT_COPY: Record<IpInfo['verdict'], { label: string; good: boolean }> = {
  shared: { label: 'Shared (carrier NAT)', good: false },
  'likely-shared': { label: 'Likely shared', good: false },
  dynamic: { label: 'Public but dynamic', good: true },
  'likely-public': { label: 'Likely public', good: true },
};

const OUTCOME: Record<PortOutcome, { label: string; tone: string; hint: string }> = {
  open: { label: 'open', tone: 'var(--accent)', hint: 'something is listening' },
  refused: { label: 'refused', tone: 'var(--accent)', hint: 'your router replied, so traffic arrives' },
  silent: { label: 'no reply', tone: 'var(--faint)', hint: 'dropped or not forwarded' },
  error: { label: 'error', tone: 'var(--bad)', hint: 'unreachable' },
};

function Status({ label, value, good }: { label: string; value: string; good: boolean | null }) {
  const tone = good === null ? 'var(--faint)' : good ? 'var(--accent)' : 'var(--bad)';
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-white/[0.02] p-4">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2.5 text-[17px] font-medium tracking-tight" style={{ color: good === null ? 'var(--muted)' : 'var(--text)' }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone, boxShadow: good === null ? 'none' : `0 0 12px ${tone}` }} />
        {value}
      </span>
    </div>
  );
}

/**
 * What kind of address the ISP gave you, and whether the internet can reach it.
 *
 * Probed from Singapore, because the check has to open connections back to the
 * visitor from outside, which a Worker cannot do.
 */
export function NetworkTools() {
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
    <section className="panel flex h-full flex-col gap-5 rounded-3xl p-6 sm:p-7">
      <header className="flex items-end justify-between gap-4">
        <div>
          <span className="label">Your connection</span>
          <h2 className="mt-2 text-[28px] font-light tracking-[-0.03em]">IP &amp; ports</h2>
        </div>
        <span className="mono pb-1.5 text-[11px] text-[var(--faint)]">probed from Singapore</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Status
          label="Inbound reachable"
          value={loading ? 'Probing…' : (reach?.headline ?? 'Unavailable')}
          good={reach ? reach.reachable : null}
        />
        <Status
          label="Address type"
          value={loading ? 'Checking…' : (verdict?.label ?? 'Unavailable')}
          good={verdict ? verdict.good : null}
        />
      </div>

      {info?.reverseDns && (
        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] pb-3">
          <span className="label">Reverse DNS</span>
          <span className="mono truncate text-right text-[12px] text-[var(--muted)]">{info.reverseDns}</span>
        </div>
      )}

      {reach && <p className="text-[13.5px] leading-relaxed text-[var(--muted)]">{reach.detail}</p>}

      {reach && reach.probes.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className="label">Ports probed</span>
          <div className="flex flex-wrap gap-2">
            {reach.probes.map((p) => (
              <span key={p.port} title={OUTCOME[p.outcome].hint} className="chip mono px-3 py-1.5 text-[11.5px]">
                <span className="text-[var(--text)]">{p.port}</span>
                <span className="mx-1.5 text-[var(--ghost)]">·</span>
                <span style={{ color: OUTCOME[p.outcome].tone }}>{OUTCOME[p.outcome].label}</span>
              </span>
            ))}
          </div>
          <p className="text-[12.5px] leading-relaxed text-[var(--faint)]">
            Nothing needs to be open for this to be useful. A refusal still proves traffic from the
            internet arrives at your address, which is the part carrier NAT takes away.
          </p>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-white/[0.02] p-4">
        <div>
          <h3 className="text-[15px] font-medium">Check a specific port</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
            Forwarded a port for seeding or hosting? Start the application first so something is
            listening, then test it here.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            onKeyDown={(e) => e.key === 'Enter' && !checking && runCustom()}
            placeholder="51413"
            inputMode="numeric"
            aria-label="Port to test"
            className="mono w-0 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-black/30 px-4 py-2.5 text-[13px] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--ghost)] focus:border-[rgba(var(--glow),0.6)] sm:w-36 sm:flex-none"
          />
          <button
            onClick={runCustom}
            disabled={checking || !port}
            className="cursor-pointer rounded-full px-6 py-2.5 text-[13px] font-semibold text-[#02100c] transition-transform duration-200 hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)', boxShadow: '0 8px 28px -10px rgba(var(--glow), 0.8)' }}
          >
            {checking ? 'Testing…' : 'Test'}
          </button>
        </div>
        {error && <p className="text-[12.5px] text-[var(--bad)]">{error}</p>}
      </div>
    </section>
  );
}
