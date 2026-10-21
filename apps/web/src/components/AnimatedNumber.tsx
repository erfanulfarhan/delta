import { useEffect, useRef } from 'react';

interface Props {
  value: number;
  decimals?: number;
  /** Overrides `decimals`, for figures whose precision depends on their size. */
  format?: (n: number) => string;
  /** Where the count starts on first render, for figures that should roll up. */
  from?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Higher is snappier. Fraction of remaining distance closed per frame at 60fps. */
  stiffness?: number;
}

/**
 * Eases toward a target and writes straight to the DOM node.
 *
 * Deliberately does not hold the displayed figure in React state. During a
 * measurement this updates every frame, and re-rendering the tree sixty times
 * a second competes with the very work whose speed we are trying to report.
 * The loop also stops once it has arrived, so a settled result costs nothing.
 */
export function AnimatedNumber({
  value,
  decimals = 2,
  format,
  from,
  className,
  style,
  stiffness = 0.075,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const targetRef = useRef(value);
  const currentRef = useRef(from ?? value);
  const formatRef = useRef(format ?? ((n: number) => n.toFixed(decimals)));
  targetRef.current = value;
  formatRef.current = format ?? ((n: number) => n.toFixed(decimals));
  // Rendered once and never changed, so React leaves the text alone and the
  // loop below is the only thing that writes it. Rendering the live target
  // instead would flash the final figure for a frame on every update.
  const initial = useRef(formatRef.current(from ?? value)).current;

  useEffect(() => {
    // Asked for less motion: the figure lands where it is going, no roll.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      currentRef.current = targetRef.current;
      if (ref.current) ref.current.textContent = formatRef.current(targetRef.current);
      return;
    }
    let raf = 0;
    const tick = () => {
      const target = targetRef.current;
      const current = currentRef.current;
      const settled = Math.abs(target - current) < Math.max(Math.abs(target) * 0.0005, 0.005);
      const next = settled ? target : current + (target - current) * stiffness;
      currentRef.current = next;
      if (ref.current) ref.current.textContent = formatRef.current(next);
      if (!settled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, stiffness]);

  return (
    <span ref={ref} className={className} style={style}>
      {initial}
    </span>
  );
}
