import { useEffect, useRef, useState } from 'react';

interface Props {
  children: React.ReactNode;
  id?: string;
  className?: string;
  /** Milliseconds, for staggering neighbours. */
  delay?: number;
}

/**
 * Slides its content up the first time it scrolls into view, once.
 *
 * Without IntersectionObserver the content simply shows: an entrance is a
 * nicety, and hiding the content behind it would make it a requirement.
 */
export function Reveal({ children, id, className = '', delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div
      ref={ref}
      id={id}
      className={`reveal ${shown ? 'in' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
