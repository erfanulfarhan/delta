import { useEffect, useRef, useState } from 'react';
import { lerpWorld, WORLDS, type World } from '../worlds';
import type { ModeId } from '../config';

const EASE_OUT_EXPO = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
const DURATION_MS = 700;

/**
 * Interpolate between the two worlds so switching mode travels through the
 * space between them rather than cutting. The whole conceit is that BDIX and
 * RAW are two places; a hard cut makes them two stylesheets.
 */
export function useWorld(mode: ModeId, reducedMotion: boolean): World {
  const [world, setWorld] = useState<World>(WORLDS[mode]);
  const fromRef = useRef<World>(WORLDS[mode]);

  useEffect(() => {
    const target = WORLDS[mode];

    if (reducedMotion) {
      fromRef.current = target;
      setWorld(target);
      return;
    }

    const from = fromRef.current;
    const started = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min((now - started) / DURATION_MS, 1);
      const next = lerpWorld(from, target, EASE_OUT_EXPO(t));
      setWorld(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, reducedMotion]);

  return world;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
