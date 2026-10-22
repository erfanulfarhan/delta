import { AVAILABLE, BOTH_AVAILABLE } from '../config';

export type Selection = 'bdix' | 'raw' | 'both';

interface Props {
  value: Selection;
  onChange: (value: Selection) => void;
  disabled: boolean;
}

const OPTIONS: { id: Selection; label: string; hint: string }[] = [
  { id: 'bdix', label: 'Local', hint: 'Inside Bangladesh, over BDIX peering' },
  { id: 'raw', label: 'Raw', hint: 'Abroad, across the international link' },
  { id: 'both', label: 'Both', hint: 'Local, then Raw, and the gap between them' },
];

const available = (id: Selection) => (id === 'both' ? BOTH_AVAILABLE : AVAILABLE[id]);

/**
 * Which path GO measures.
 *
 * One pill slides between the three, coloured like the water it stands for:
 * green for Local, blue for Raw, and both at once for Both.
 */
export function ModeSwitch({ value, onChange, disabled }: Props) {
  const index = OPTIONS.findIndex((o) => o.id === value);
  const pill =
    value === 'both'
      ? 'linear-gradient(90deg, rgba(95, 255, 200, 0.2), rgba(89, 184, 255, 0.2))'
      : 'rgba(var(--glow), 0.16)';

  return (
    <div
      role="radiogroup"
      aria-label="What to measure"
      className="chip relative grid grid-cols-3 p-1"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const step = e.key === 'ArrowRight' ? 1 : -1;
        for (let k = 1; k <= OPTIONS.length; k += 1) {
          const next = OPTIONS[(index + step * k + OPTIONS.length * 2) % OPTIONS.length]!;
          if (available(next.id)) {
            onChange(next.id);
            break;
          }
        }
      }}
    >
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 rounded-full transition-[transform,background] duration-500"
        style={{
          width: 'calc((100% - 0.5rem) / 3)',
          transform: `translate3d(${index * 100}%, 0, 0)`,
          background: pill,
          boxShadow: 'inset 0 0 0 1px rgba(var(--glow), 0.35)',
          transitionTimingFunction: 'var(--ease-out)',
        }}
      />
      {OPTIONS.map((option) => {
        const selected = option.id === value;
        const can = available(option.id);
        return (
          <button
            key={option.id}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled || !can}
            title={can ? option.hint : 'Not deployed yet'}
            onClick={() => onChange(option.id)}
            className="relative z-10 min-w-[56px] cursor-pointer rounded-full px-3 py-2 text-[13px] font-medium transition-colors duration-300 disabled:cursor-not-allowed sm:min-w-[78px] sm:px-5"
            style={{ color: selected ? 'var(--text)' : 'var(--muted)', opacity: can ? 1 : 0.4 }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
