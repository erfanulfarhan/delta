import type { ModeId } from './config';

/**
 * The shell stays constant; only the accent and the measured distance change.
 *
 * `distance` is the one property that is genuinely about the subject rather
 * than decoration: BDIX traffic stops inside Bangladesh, RAW traffic crosses to
 * Singapore, and the distance line draws that difference to scale.
 */
export interface World {
  accent: string;
  glowRgb: string;
  /** 0..1 along the baseline where the far endpoint sits. */
  distance: number;
  /** Place name for the far endpoint. */
  farLabel: string;
}

export const WORLDS: Record<ModeId, World> = {
  bdix: { accent: '#22D3A5', glowRgb: '34, 211, 165', distance: 0.22, farLabel: 'DHAKA' },
  raw: { accent: '#5B8CFF', glowRgb: '91, 140, 255', distance: 0.94, farLabel: 'SINGAPORE' },
};

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

export function lerpWorld(from: World, to: World, t: number): World {
  const [r1, g1, b1] = hexToRgb(from.accent);
  const [r2, g2, b2] = hexToRgb(to.accent);
  const r = mix(r1, r2, t);
  const g = mix(g1, g2, t);
  const b = mix(b1, b2, t);

  return {
    accent: `rgb(${r}, ${g}, ${b})`,
    glowRgb: `${r}, ${g}, ${b}`,
    distance: from.distance + (to.distance - from.distance) * t,
    farLabel: t < 0.5 ? from.farLabel : to.farLabel,
  };
}
