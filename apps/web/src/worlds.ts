import type { ModeId } from './config';

/**
 * One estuary, two waters.
 *
 * Local is the green of the delta's channels, Raw the blue of the sea beyond
 * the coast. The river, the ring, the numbers and the page background all take
 * their colour from here, so switching mode changes the whole place at once.
 */
export interface World {
  accent: string;
  /** A paler tint of the accent, for gradients on large type. */
  accent2: string;
  /** The accent as "r, g, b", for rgba() in styles and on canvas. */
  glowRgb: string;
}

export const WORLDS: Record<ModeId, World> = {
  bdix: {
    accent: '#5FFFC8',
    accent2: '#B4FFE6',
    glowRgb: '95, 255, 200',
  },
  raw: {
    accent: '#59B8FF',
    accent2: '#B9DEFF',
    glowRgb: '89, 184, 255',
  },
};

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

const mixRgb = (x: string, y: string, t: number): [number, number, number] => {
  const [r1, g1, b1] = hexToRgb(x);
  const [r2, g2, b2] = hexToRgb(y);
  return [mix(r1, r2, t), mix(g1, g2, t), mix(b1, b2, t)];
};

const toHex = (rgb: [number, number, number]) =>
  `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

export function lerpWorld(from: World, to: World, t: number): World {
  const accent = mixRgb(from.accent, to.accent, t);
  return {
    accent: toHex(accent),
    accent2: toHex(mixRgb(from.accent2, to.accent2, t)),
    glowRgb: accent.join(', '),
  };
}
