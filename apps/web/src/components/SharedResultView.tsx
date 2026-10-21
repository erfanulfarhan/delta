import { useEffect, useState } from 'react';
import { fetchResult, type SharedResult } from '../lib/results';
import { compare } from '../lib/compare';
import { formatMbps } from '../lib/format';
import { WORLDS } from '../worlds';
import { navigate } from '../lib/route';

const fmtMbps = (v: number | null) => (v === null ? '··' : formatMbps(v));
const fmtMs = (v: number | null, digits = 0) => (v === null ? '··' : v.toFixed(digits));

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
    <div className="panel flex flex-col gap-6 rounded-3xl p-7">
      <span className="label" style={{ color: accent }}>
        {label}
      </span>
      <div className="flex gap-8">
        {(
          [
            ['↓ Down', down],
            ['↑ Up', up],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="flex flex-1 flex-col gap-2">
            <span className="label">{l}</span>
            <span className="num ink text-[52px]">{fmtMbps(v)}</span>
            <span className="text-[12px] text-[var(--muted)]">Mbps</span>
          </div>
        ))}
      </div>
      <div className="rule" />
      <div className="mono flex gap-6 text-[12px] text-[var(--muted)]">
        <span>{fmtMs(ping)} ms ping</span>
        <span>{fmtMs(jitter, 1)} ms jitter</span>
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
    return <p className="text-[13px] text-[var(--muted)]">Loading result…</p>;
  }

  if (state === 'missing' || !result) {
    return (
      <div className="rise flex flex-col items-center gap-4 text-center">
        <h1 className="text-[34px] font-light tracking-[-0.03em]">No result here</h1>
        <p className="max-w-sm text-[14px] leading-relaxed text-[var(--muted)]">
          This link is wrong, or the result was never saved. Run your own test instead.
        </p>
        <button onClick={() => navigate('/')} className="chip link cursor-pointer px-6 py-2.5 text-[13px] font-medium">
          Run a test
        </button>
      </div>
    );
  }

  const showLocal = result.bdix_down !== null;
  const showRaw = result.raw_down !== null;
  const comparison =
    showLocal && showRaw && result.raw_down! > 0 && result.bdix_down! > 0
      ? compare(result.bdix_down!, result.raw_down!)
      : null;

  return (
    <div className="rise flex w-full flex-col items-center gap-9">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="label">Shared result</span>
        <span className="text-[14px] text-[var(--muted)]">
          {new Date(result.created_at).toLocaleString()}
          {result.isp ? ` · ${result.isp}` : ''}
          {result.city ? ` · ${result.city}` : ''}
        </span>
      </div>

      <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2">
        {showLocal && (
          <Side
            label="Local · home"
            accent={WORLDS.bdix.accent}
            down={result.bdix_down}
            up={result.bdix_up}
            ping={result.bdix_ping}
            jitter={result.bdix_jitter}
          />
        )}
        {showRaw && (
          <Side
            label="Raw · abroad"
            accent={WORLDS.raw.accent}
            down={result.raw_down}
            up={result.raw_up}
            ping={result.raw_ping}
            jitter={result.raw_jitter}
          />
        )}
      </div>

      {comparison && (
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="label">{comparison.heading}</span>
          <span className="num ink text-[64px]">
            <span className="mr-1 text-[var(--faint)]">×</span>
            {comparison.ratio.toFixed(1)}
          </span>
          <p className="max-w-md text-[14px] leading-relaxed text-[var(--muted)]">{comparison.verdict}</p>
        </div>
      )}

      <button onClick={() => navigate('/')} className="chip link cursor-pointer px-6 py-2.5 text-[13px] font-medium">
        Test your own
      </button>
    </div>
  );
}
