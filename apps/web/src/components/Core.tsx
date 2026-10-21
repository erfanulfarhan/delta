import type { Phase } from '@speedtest/engine';
import { AnimatedNumber } from './AnimatedNumber';
import { formatMbps } from '../lib/format';

interface Props {
  running: boolean;
  phase: Phase;
  /** Live throughput of the phase in progress. */
  live: number;
  /** 0 to 1 through the phase in progress. */
  progress: number;
  onGo: () => void;
  onStop: () => void;
  disabled: boolean;
  /** What pressing GO will measure, for screen readers. */
  goLabel: string;
}

const R = 47;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * How much of the ring a moment in the test fills.
 *
 * The ping takes a second, the two transfers eight seconds each, so the ring
 * gives them that kind of share, in the order they run.
 */
function filled(phase: Phase, progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  if (phase === 'latency') return 0.05;
  if (phase === 'download') return 0.05 + 0.475 * p;
  if (phase === 'upload') return 0.525 + 0.475 * p;
  if (phase === 'done') return 1;
  return 0;
}

const PHASE_NAME: Partial<Record<Phase, string>> = {
  latency: 'Ping',
  download: '↓ Download',
  upload: '↑ Upload',
};

/**
 * The middle of the page, always.
 *
 * Before and after a test it is GO. Pressed, it gives way to a ring that
 * fills as the test runs, with the live speed at its centre, and it is GO
 * again in the same place once the figures have moved out to either side.
 * Both states stay mounted and crossfade, so the change is one motion rather
 * than a swap.
 */
export function Core({ running, phase, live, progress, onGo, onStop, disabled, goLabel }: Props) {
  const offset = CIRCUMFERENCE * (1 - filled(phase, progress));

  return (
    <div className="core" data-running={running}>
      <div className="meter" aria-hidden={!running}>
        <svg viewBox="0 0 100 100">
          <circle className="track" cx="50" cy="50" r={R} />
          <circle
            className="arc"
            cx="50"
            cy="50"
            r={R}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        </svg>

        <div className="relative flex flex-col items-center">
          <span className="label" style={{ color: 'var(--accent-2)' }}>
            {PHASE_NAME[phase] ?? ''}
          </span>
          {phase === 'latency' ? (
            <span className="dots mt-3 mb-2 flex gap-2" aria-label="Measuring ping">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--accent)' }} />
              ))}
            </span>
          ) : (
            <AnimatedNumber
              key={phase}
              value={live}
              from={0}
              format={formatMbps}
              stiffness={0.12}
              className="num ink mt-2 text-[58px] lg:text-[72px]"
            />
          )}
          <span className="mt-2 text-[13px] text-[var(--muted)]">Mbps</span>
        </div>

        <button
          onClick={onStop}
          tabIndex={running ? 0 : -1}
          className="label absolute bottom-[15%] cursor-pointer rounded-full px-3 py-1.5 transition-colors hover:text-[var(--text)]"
        >
          Stop
        </button>
      </div>

      <button className="go" onClick={onGo} disabled={disabled || running} aria-label={goLabel} tabIndex={running ? -1 : 0}>
        GO
      </button>
    </div>
  );
}
