import { useEffect, useState } from 'react';
import { fetchResult, type SharedResult } from '../lib/results';
import { WORLDS } from '../worlds';
import { navigate } from '../lib/route';

const fmt = (v: number | null, digits = 2) => (v === null ? '—' : v.toFixed(digits));

function Side({
  label,
  accent,
  down,
  up,
  ping,
  jitter,
}: {
  label: string;
  accent: string;
  down: number | null;
  up: number | null;
  ping: number | null;
  jitter: number | null;
}) {
  return (
    <div className="panel flex flex-col gap-5 rounded-2xl p-6">
      <span className="mono text-[11px] font-medium tracking-[0.26em]" style={{ color: accent }}>
        {label}
      </span>
      <div className="flex gap-6">
        {(
          [
            ['↓ Down', down],
            ['↑ Up', up],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="flex flex-1 flex-col gap-1">
            <span className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">{l}</span>
            <span className="display text-[32px] leading-none font-medium">{fmt(v)}</span>
          </div>
        ))}
      </div>
      <div className="rule" />
      <div className="mono flex gap-5 text-[10px] text-[var(--muted)]">
        <span>{fmt(ping, 0)} ms ping</span>
        <span>{fmt(jitter, 1)} ms jitter</span>
      </div>
    </div>
  );
}

export function SharedResultView({ id }: { id: string }) {
  const [state, setState] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [result, setResult] = useState<SharedResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetchResult(id).then((r) => {
      if (!alive) return;
      setResult(r);
      setState(r ? 'ready' : 'missing');
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (state === 'loading') {
    return <p className="mono text-[11px] text-[var(--muted)]">Loading result…</p>;
  }

  if (state === 'missing' || !result) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="display text-[22px]">No result here</p>
        <p className="max-w-sm text-[13px] leading-relaxed text-[var(--muted)]">
          This link is wrong, or the result was never saved. Run your own test instead.
        </p>
        <button
          onClick={() => navigate('/')}
          className="panel cursor-pointer rounded-full px-6 py-2.5 text-[11px] tracking-[0.18em] text-[var(--muted)] uppercase transition-colors hover:text-[var(--text)]"
        >
          Run a test
        </button>
      </div>
    );
  }

  const showLocal = result.bdix_down !== null;
  const showRaw = result.raw_down !== null;
  const ratio =
    showLocal && showRaw && result.raw_down! > 0 && result.bdix_down! > 0
      ? Math.max(result.bdix_down!, result.raw_down!) /
        Math.min(result.bdix_down!, result.raw_down!)
      : null;
  const rawFaster = showLocal && showRaw && result.raw_down! > result.bdix_down!;

  return (
    <div className="rise flex w-full max-w-3xl flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="mono text-[10px] uppercase tracking-[0.3em] text-[var(--muted)]">
          Shared result
        </span>
        <span className="mono text-[11px] text-[var(--faint)]">
          {new Date(result.created_at).toLocaleString()}
          {result.isp ? ` · ${result.isp}` : ''}
          {result.city ? ` · ${result.city}` : ''}
        </span>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {showLocal && (
          <Side
            label="LOCAL"
            accent={WORLDS.bdix.accent}
            down={result.bdix_down}
            up={result.bdix_up}
            ping={result.bdix_ping}
            jitter={result.bdix_jitter}
          />
        )}
        {showRaw && (
          <Side
            label="RAW"
            accent={WORLDS.raw.accent}
            down={result.raw_down}
            up={result.raw_up}
            ping={result.raw_ping}
            jitter={result.raw_jitter}
          />
        )}
      </div>

      {ratio !== null && (
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="mono text-[10px] uppercase tracking-[0.3em] text-[var(--muted)]">
            {rawFaster ? 'Raw is faster by' : 'Local is faster by'}
          </span>
          <span className="display text-[64px] leading-none font-semibold">
            <span className="text-[var(--faint)]">×</span> {ratio.toFixed(1)}
          </span>
        </div>
      )}

      <button
        onClick={() => navigate('/')}
        className="panel cursor-pointer rounded-full px-7 py-3 text-[11px] tracking-[0.18em] text-[var(--muted)] uppercase transition-colors hover:text-[var(--text)]"
      >
        Test your own
      </button>
    </div>
  );
}
