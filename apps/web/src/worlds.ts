import type { ModeId } from './config';

/**
 * Two worlds, one layout.
 *
 * Only colour temperature and apparent distance change between them. BDIX is
 * warm, near and dense; RAW is cool, distant and sparse. The intent is that
 * the difference between the two paths registers before any number is read.
 */
export interface World {
  /** Primary accent, drives gauge arc and numerals. */
  accent: string;
  /** Secondary accent for highlights and the amber/violet counterpoint. */
  accentAlt: string;
  /** Page background gradient stops, darkest first. */
  bg: [string, string];
  /** Glow colour, expects an rgb triple for use inside rgba(). */
  glowRgb: string;
  /** 0..1 how far the server node sits from the viewer node. */
  distance: number;
  /** Particles on screen. Dense reads as near, sparse reads as far. */
  density: number;
  /** Multiplier on trail length. Long slow trails read as distance. */
  trail: number;
  /** Multiplier on particle velocity. */
  speed: number;
}

export const WORLDS: Record<ModeId, World> = {
  bdix: {
    accent: '#6DF5A5',
    accentAlt: '#FFC46B',
    bg: ['#03100A', '#0B2418'],
    glowRgb: '109, 245, 165',
    distance: 0.26,
    density: 1.0,
    trail: 0.45,
    speed: 1.45,
  },
  raw: {
    accent: '#5AC8FF',
    accentAlt: '#9B8CFF',
    bg: ['#040A13', '#0B1728'],
    glowRgb: '90, 200, 255',
    distance: 0.86,
    density: 0.42,
    trail: 1.9,
    speed: 0.62,
  },
};

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mixChannel = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Blend two worlds, so the toggle animates through the space between them. */
export function lerpWorld(from: World, to: World, t: number): World {
  const mixHex = (x: string, y: string): string => {
    const [r1, g1, b1] = hexToRgb(x);
    const [r2, g2, b2] = hexToRgb(y);
    return `rgb(${mixChannel(r1, r2, t)}, ${mixChannel(g1, g2, t)}, ${mixChannel(b1, b2, t)})`;
  };
  const mixNum = (x: number, y: number) => x + (y - x) * t;

  return {
    accent: mixHex(from.accent, to.accent),
    accentAlt: mixHex(from.accentAlt, to.accentAlt),
    bg: [mixHex(from.bg[0], to.bg[0]), mixHex(from.bg[1], to.bg[1])],
    glowRgb: t < 0.5 ? from.glowRgb : to.glowRgb,
    distance: mixNum(from.distance, to.distance),
    density: mixNum(from.density, to.density),
    trail: mixNum(from.trail, to.trail),
    speed: mixNum(from.speed, to.speed),
  };
}
