import { AnimatedNumber } from './AnimatedNumber';
import { formatMbps } from '../lib/format';

interface Props {
  label: string;
  /** Null until the phase has produced a figure. */
  value: number | null;
  /** The phase is running now: the figure moves and the label lights up. */
  live?: boolean;
  /** Under the figure, after the unit. */
  note?: string;
  /** Overrides the accent, for side-by-side Local and Raw. */
  color?: string;
  /** Which side of GO it sits on, on wide screens. Phones centre both. */
  side?: 'left' | 'right';
}

const SIDE = {
  left: 'items-center text-center lg:items-end lg:text-right',
  right: 'items-center text-center lg:items-start lg:text-left',
} as const;

/** A thin bar where a figure will be, instead of a dash character. */
function Pending() {
  return (
    <span className="num flex h-[1em] items-center text-[var(--ghost)]" aria-label="not measured yet">
      <span className="block h-[3px] w-[0.55em] rounded-full bg-current" />
    </span>
  );
}

/**
 * One throughput figure beside the core.
 *
 * Download and upload get identical treatment and sit either side of GO, so
 * neither reads as secondary. The figure rolls up from zero when it first
 * appears, which is the moment the result arrives.
 */
export function Stat({ label, value, live = false, note, color, side = 'left' }: Props) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${SIDE[side]}`}>
      <span
        className="label flex items-center gap-2 transition-colors duration-500"
        style={live || color ? { color: color ?? 'var(--accent)' } : undefined}
      >
        {live && (
          <span
            className="live-dot inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: color ?? 'var(--accent)' }}
            aria-hidden="true"
          />
        )}
        {label}
      </span>
      <span className="text-[52px] sm:text-[68px] lg:text-[clamp(76px,7.4vw,124px)]">
        {value === null ? (
          <Pending />
        ) : (
          <AnimatedNumber value={value} from={0} format={formatMbps} stiffness={0.07} className="num ink block" />
        )}
      </span>
      <span className="text-[13px] text-[var(--muted)]">
        Mbps{note ? <span className="text-[var(--faint)]"> · {note}</span> : null}
      </span>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string | null;
  unit: string;
}

/** Ping and jitter: smaller, together, under the core. */
export function Metric({ label, value, unit }: MetricProps) {
  return (
    <div className="chip flex items-baseline gap-2.5 px-4 py-2.5">
      <span className="label">{label}</span>
      <span className="display text-[20px] font-light tracking-tight text-[var(--text)]">
        {value ?? <span className="text-[var(--ghost)]">··</span>}
      </span>
      {value !== null && <span className="text-[12px] text-[var(--muted)]">{unit}</span>}
    </div>
  );
}
