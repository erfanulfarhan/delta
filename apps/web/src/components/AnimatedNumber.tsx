import { useEffect, useRef } from 'react';

interface Props {
  value: number;
  decimals?: number;
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
 */
export function AnimatedNumber({ value, decimals = 2, className, style, stiffness = 0.075 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const targetRef = useRef(value);
  const currentRef = useRef(value);
  targetRef.current = value;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const target = targetRef.current;
      const current = currentRef.current;
      const next = Math.abs(target - current) < 0.005 ? target : current + (target - current) * stiffness;
      currentRef.current = next;
      if (ref.current) ref.current.textContent = next.toFixed(decimals);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [decimals, stiffness]);

  return (
    <span ref={ref} className={className} style={style}>
      {value.toFixed(decimals)}
    </span>
  );
}
