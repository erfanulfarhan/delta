import type { ModeId } from './config';

/**
 * One shell, two accents.
 *
 * `distance` is the only property here that is about the subject rather than
 * decoration: local traffic stops inside Bangladesh, raw traffic crosses to
 * Singapore, and the distance line draws that gap to scale.
 */
export interface World {
  accent: string;
  accent2: string;
  glowRgb: string;
  /** 0..1 along the baseline where the far endpoint sits. */
  distance: number;
  farLabel: string;
}

export const WORLDS: Record<ModeId, World> = {
  bdix: {
    accent: '#2FF0A8',
    accent2: '#7BF7B0',
    glowRgb: '47, 240, 168',
    distance: 0.22,
    farLabel: 'DHAKA',
  },
  raw: {
    accent: '#4BB8FF',
    accent2: '#A97BFF',
    glowRgb: '75, 184, 255',
    distance: 0.94,
    farLabel: 'SINGAPORE',
  },
};

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

const mixHex = (x: string, y: string, t: number): string => {
  const [r1, g1, b1] = hexToRgb(x);
  const [r2, g2, b2] = hexToRgb(y);
  return `rgb(${mix(r1, r2, t)}, ${mix(g1, g2, t)}, ${mix(b1, b2, t)})`;
};

export function lerpWorld(from: World, to: World, t: number): World {
  const [r1, g1, b1] = hexToRgb(from.accent);
  const [r2, g2, b2] = hexToRgb(to.accent);

  return {
    accent: mixHex(from.accent, to.accent, t),
    accent2: mixHex(from.accent2, to.accent2, t),
    glowRgb: `${mix(r1, r2, t)}, ${mix(g1, g2, t)}, ${mix(b1, b2, t)}`,
    distance: from.distance + (to.distance - from.distance) * t,
    farLabel: t < 0.5 ? from.farLabel : to.farLabel,
  };
}
