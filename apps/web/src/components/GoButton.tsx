interface Props {
  onClick: () => void;
  disabled: boolean;
  accent: string;
  glowRgb: string;
  label?: string;
}

/**
 * The circular Go control that sits inside the dial.
 *
 * Deliberately an outlined ring rather than a filled disc: filled, it reads as a
 * solid plug in the middle of the instrument, and the dial around it stops
 * looking like a dial. Outlined, the centre stays open and the control reads as
 * part of the same face it is printed on.
 */
export function GoButton({ onClick, disabled, accent, glowRgb, label = 'GO' }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group relative grid h-[132px] w-[132px] place-items-center rounded-full transition-transform duration-300 hover:scale-[1.04] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: 'transparent' }}
    >
      <span
        className="go-halo absolute inset-0 rounded-full"
        aria-hidden="true"
        style={{ boxShadow: `0 0 54px -6px rgba(${glowRgb}, 0.55)` }}
      />
      <span
        className="absolute inset-0 rounded-full transition-colors duration-300"
        aria-hidden="true"
        style={{
          border: `1.5px solid rgba(${glowRgb}, 0.55)`,
          background: `radial-gradient(circle at 50% 30%, rgba(${glowRgb}, 0.14), transparent 70%)`,
        }}
      />
      {/* Solid accent, not a clipped gradient.
          Inline background-clip:text did not apply here and the gradient filled
          the whole box instead of the glyphs, rendering the control as a plain
          coloured square. The stylesheet's .accent-text does work, but a single
          flat accent is legible at this size and has nothing to go wrong. */}
      <span
        className="display relative text-[27px] font-bold tracking-[0.12em]"
        style={{ color: accent, textShadow: `0 0 26px rgba(${glowRgb}, 0.6)` }}
      >
        {label}
      </span>
    </button>
  );
}
