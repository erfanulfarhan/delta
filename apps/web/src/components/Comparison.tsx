import type { RunResult } from '@speedtest/engine';
import { AnimatedNumber } from './AnimatedNumber';
import { WORLDS } from '../worlds';
import { ENDPOINTS } from '../config';

interface Props {
  bdix: RunResult;
  raw: RunResult;
}

/**
 * The comparison is the product. Neither speedtest.net nor speedtest.sg can
 * show this, because each only ever measures one path.
 */
export function Comparison({ bdix, raw }: Props) {
  const rawFirst = raw.downloadMbps > bdix.downloadMbps;

  // Always "the faster one is N times the slower one", never a fraction.
  // "Local is faster by 0.8x" is not a sentence that means anything, and a
  // business line with generous IIG capacity really can be quicker abroad.
  const faster = rawFirst ? raw.downloadMbps : bdix.downloadMbps;
  const slower = rawFirst ? bdix.downloadMbps : raw.downloadMbps;
  const ratio = slower > 0 ? faster / slower : 0;
  const heading = rawFirst ? 'Raw is faster by' : 'Local is faster by';

  const verdict =
    ratio <= 0
      ? 'Not enough data to compare.'
      : ratio < 1.25
        ? 'Both paths are close. Your connection performs the same abroad as it does at home.'
        : rawFirst
          ? 'Your raw international path is the quicker one, which is unusual here and typical of a business line with generous IIG capacity.'
          : ratio >= 5
            ? 'Almost all of your speed is local. International traffic gets a fraction of it.'
            : 'Your local speed is meaningfully faster than your raw international speed.';

  return (
    <div className="rise flex w-full max-w-3xl flex-col items-center gap-9">
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {([['bdix', bdix], ['raw', raw]] as const).map(([id, result]) => (
          <div key={id} className="panel flex flex-col gap-5 rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <span
                className="mono text-[11px] font-medium tracking-[0.26em]"
                style={{ color: WORLDS[id].accent }}
              >
                {ENDPOINTS[id].label}
              </span>
              <span className="mono text-[10px] text-[var(--faint)]">
                {ENDPOINTS[id].shortLabel}
              </span>
            </div>

            {/* Download and upload side by side, equal weight, as in the live view. */}
            <div className="flex gap-6">
              {(
                [
                  ['↓', 'Down', result.downloadMbps],
                  ['↑', 'Up', result.uploadMbps],
                ] as const
              ).map(([arrow, label, value]) => (
                <div key={label} className="flex flex-1 flex-col gap-1">
                  <span className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
                    {arrow} {label}
                  </span>
                  <span className="display text-[34px] leading-none font-medium">
                    {value.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            <div className="rule" />

            <div className="mono flex gap-5 text-[10px] text-[var(--muted)]">
              <span>{result.pingMs.toFixed(0)} ms ping</span>
              <span>{result.jitterMs.toFixed(1)} ms jitter</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3 text-center">
        <span className="mono text-[10px] uppercase tracking-[0.3em] text-[var(--muted)]">
          {heading}
        </span>
        <div className="flex items-baseline justify-center gap-2">
          <span className="display text-[40px] leading-none text-[var(--faint)]">×</span>
          <AnimatedNumber
            value={ratio}
            decimals={1}
            stiffness={0.045}
            className="display text-[78px] leading-none font-semibold"
          />
        </div>
        <p className="max-w-md text-[13px] leading-relaxed text-[var(--muted)]">{verdict}</p>
      </div>
    </div>
  );
}
