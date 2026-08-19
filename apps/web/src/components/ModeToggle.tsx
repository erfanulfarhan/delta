import type { ModeId } from '../config';
import { ENDPOINTS } from '../config';

interface Props {
  mode: ModeId;
  onChange: (mode: ModeId) => void;
  disabled: boolean;
  accent: string;
}

const ORDER: ModeId[] = ['bdix', 'raw'];

export function ModeToggle({ mode, onChange, disabled, accent }: Props) {
  const index = ORDER.indexOf(mode);

  return (
    <div
      role="radiogroup"
      aria-label="Which connection path to measure"
      className="panel relative flex rounded-xl p-1"
    >
      <div
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 rounded-lg transition-transform duration-500"
        style={{
          width: 'calc(50% - 0.25rem)',
          transform: `translate3d(${index * 100}%, 0, 0)`,
          background: 'var(--ink-700)',
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
      {ORDER.map((id) => {
        const selected = id === mode;
        return (
          <button
            key={id}
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(id)}
            className="relative z-10 min-w-[128px] cursor-pointer rounded-lg px-6 py-2 text-center transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className="mono block text-[11px] font-medium tracking-[0.2em] transition-colors duration-500"
              style={{ color: selected ? accent : 'var(--muted)' }}
            >
              {ENDPOINTS[id].label}
            </span>
            <span className="mt-0.5 block text-[10px] text-[var(--faint)]">
              {ENDPOINTS[id].shortLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
