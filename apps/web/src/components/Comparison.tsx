import type { RunResult } from '@speedtest/engine';
import { AnimatedNumber } from './AnimatedNumber';
import { WORLDS } from '../worlds';
import { ENDPOINTS } from '../config';

interface Props {
  bdix: RunResult;
  raw: RunResult;
}

/**
 * The comparison is the product.
 *
 * Neither speedtest.net nor speedtest.sg can show this, because each only ever
 * measures one path. The ratio is the number that actually explains why a
 * connection that benchmarks at 90 Mbps still buffers on YouTube.
 */
export function Comparison({ bdix, raw }: Props) {
  const rawFirst = raw.downloadMbps > bdix.downloadMbps;

  // Always expressed as "the faster one is N times the slower one", never as a
  // fraction. A connection whose international path is quicker is unusual in
  // Bangladesh but entirely real on business lines, and "local is faster by
  // 0.8x" is not a sentence that means anything.
  const faster = rawFirst ? raw.downloadMbps : bdix.downloadMbps;
  const slower = rawFirst ? bdix.downloadMbps : raw.downloadMbps;
  const ratio = slower > 0 ? faster / slower : 0;
  const heading = rawFirst ? 'International is faster by' : 'Local is faster by';

  const verdict =
    ratio <= 0
      ? 'Not enough data to compare.'
      : ratio < 1.25
        ? 'Both paths are close. Your connection performs the same abroad as it does locally.'
        : rawFirst
          ? 'Your international path is the quicker one, which is unusual here and typical of a business line with generous IIG capacity.'
          : ratio >= 5
            ? 'Almost all of your speed is local. International traffic gets a fraction of it.'
            : 'Your local speed is meaningfully faster than your international speed.';

  return (
    <div className="rise flex w-full max-w-3xl flex-col items-center gap-8">
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {([['bdix', bdix], ['raw', raw]] as const).map(([id, result]) => (
          <div
            key={id}
            className="panel flex flex-col gap-3 rounded-2xl p-6"
            style={{ borderColor: `${WORLDS[id].accent}33` }}
          >
            <div className="flex items-baseline justify-between">
              <span
                className="mono text-[11px] tracking-[0.28em]"
                style={{ color: WORLDS[id].accent }}
              >
                {ENDPOINTS[id].label}
              </span>
              <span className="mono text-[10px] text-white/30">{ENDPOINTS[id].shortLabel}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="display text-[46px] leading-none" style={{ color: WORLDS[id].accent }}>
                {result.downloadMbps.toFixed(2)}
              </span>
              <span className="mono text-[11px] text-white/40">Mbps down</span>
            </div>
            <div className="mono flex gap-4 text-[10px] text-white/40">
              <span>{result.uploadMbps.toFixed(1)} up</span>
              <span>{result.pingMs.toFixed(0)}ms ping</span>
              <span>{result.jitterMs.toFixed(1)}ms jitter</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3 text-center">
        <span className="mono text-[10px] uppercase tracking-[0.34em] text-white/35">
          {heading}
        </span>
        <div className="flex items-baseline justify-center gap-2">
          <span className="display text-[46px] leading-none text-white/35">×</span>
          <AnimatedNumber
            value={ratio}
            decimals={1}
            stiffness={0.06}
            className="display glow-text text-[84px] leading-none"
          />
        </div>
        <p className="max-w-md text-[13px] leading-relaxed text-white/45">{verdict}</p>
      </div>
    </div>
  );
}
