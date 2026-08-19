import type { ModeId } from '../config';
import { ENDPOINTS } from '../config';
import type { World } from '../worlds';

interface Props {
  mode: ModeId;
  onChange: (mode: ModeId) => void;
  disabled: boolean;
  world: World;
}

const ORDER: ModeId[] = ['bdix', 'raw'];

export function ModeToggle({ mode, onChange, disabled, world }: Props) {
  const index = ORDER.indexOf(mode);

  return (
    <div
      role="radiogroup"
      aria-label="Which connection path to measure"
      className="panel relative flex rounded-full p-1"
    >
      {/* The travelling pill. Transform only, so it stays on the compositor. */}
      <div
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 rounded-full transition-transform duration-[600ms]"
        style={{
          width: 'calc(50% - 0.25rem)',
          transform: `translate3d(${index * 100}%, 0, 0)`,
          background: `linear-gradient(135deg, ${world.accent}22, ${world.accentAlt}18)`,
          border: `1px solid ${world.accent}44`,
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
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
            className="relative z-10 min-w-[132px] cursor-pointer rounded-full px-6 py-2.5 text-center disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span
              className="mono block text-[12px] font-medium tracking-[0.2em]"
              style={{ color: selected ? world.accent : 'rgba(255,255,255,0.5)' }}
            >
              {ENDPOINTS[id].label}
            </span>
            <span className="mt-0.5 block text-[10px] tracking-wide text-white/30">
              {ENDPOINTS[id].shortLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
