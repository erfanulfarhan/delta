import { AnimatedNumber } from './AnimatedNumber';

export type Direction = 'download' | 'upload';

interface ReadoutProps {
  direction: Direction;
  value: number;
  live: boolean;
  done: boolean;
  accent: string;
  glowRgb: string;
}

const ARROW: Record<Direction, string> = { download: '↓', upload: '↑' };

/**
 * Download and upload carry equal weight.
 *
 * The previous layout gave download a large numeral and left upload as small
 * grey supporting text, which read as though upload were not measured at all.
 * Both phases do the same amount of work and both matter to the user, so both
 * get the same treatment, and the one currently running is lit.
 */
function Readout({ direction, value, live, done, accent, glowRgb }: ReadoutProps) {
  const active = live || done;

  return (
    <div
      className="relative flex flex-1 flex-col items-center gap-2 px-4 py-6 transition-colors duration-500"
      style={{
        background: live
          ? `linear-gradient(180deg, rgba(${glowRgb}, 0.14), rgba(${glowRgb}, 0.02))`
          : 'transparent',
      }}
    >
      <div className="flex items-center gap-2">
        {live && (
          <span
            className="live-dot inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
            aria-hidden="true"
          />
        )}
        <span
          className="mono text-[10px] uppercase tracking-[0.28em] transition-colors duration-500"
          style={{ color: live ? accent : 'var(--muted)' }}
        >
          {ARROW[direction]} {direction}
        </span>
      </div>

      <AnimatedNumber
        value={value}
        className="display text-[46px] leading-none font-bold transition-colors duration-500 sm:text-[56px]"
        style={{
          color: active ? 'var(--text)' : 'var(--faint)',
          textShadow: live ? `0 0 52px rgba(${glowRgb}, 0.55)` : 'none',
        }}
      />

      <span className="mono text-[10px] tracking-[0.24em] text-[var(--muted)]">MBPS</span>
    </div>
  );
}

interface Props {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: string;
  jitterMs: string;
  phase: string;
  accent: string;
  glowRgb: string;
}

/**
 * One panel carries all four figures.
 *
 * Splitting throughput and latency into separate cards spread the page over
 * two screens for four numbers. They are read together, so they sit together.
 */
export function Readouts({
  downloadMbps,
  uploadMbps,
  pingMs,
  jitterMs,
  phase,
  accent,
  glowRgb,
}: Props) {
  const downloadDone = phase === 'upload' || phase === 'done';

  return (
    <div className="panel panel-lit w-full max-w-xl overflow-hidden rounded-2xl">
      <div className="flex">
        <Readout
          direction="download"
          value={downloadMbps}
          live={phase === 'download'}
          done={downloadDone}
          accent={accent}
          glowRgb={glowRgb}
        />
        <div className="w-px self-stretch bg-[var(--line)]" aria-hidden="true" />
        <Readout
          direction="upload"
          value={uploadMbps}
          live={phase === 'upload'}
          done={phase === 'done'}
          accent={accent}
          glowRgb={glowRgb}
        />
      </div>

      <div className="flex border-t border-[var(--line)]">
        {(
          [
            ['Ping', pingMs],
            ['Jitter', jitterMs],
          ] as const
        ).map(([label, value], i) => (
          <div
            key={label}
            className={`flex flex-1 items-center justify-center gap-2 py-3 ${
              i === 1 ? 'border-l border-[var(--line)]' : ''
            }`}
          >
            <span className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
              {label}
            </span>
            <span className="display text-[15px] font-medium">
              {value}
              <span className="mono ml-1 text-[9px] text-[var(--faint)]">ms</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
