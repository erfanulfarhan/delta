import { useEffect, useRef } from 'react';

export type Flow = 'idle' | 'testing' | 'done';

interface Props {
  /** The current accent as "r, g, b". */
  glowRgb: string;
  /** Raw's light carries on past the coast and out to sea; Local's stops at it. */
  toSea: boolean;
  flow: Flow;
  /** Live throughput while testing. Sets how hard the river runs. */
  mbps: number;
  reducedMotion: boolean;
  /** Pages for reading, rather than testing, keep the river further back. */
  dim?: boolean;
}

/** One cubic Bezier: start, two controls, end, in design units. */
type Seg = readonly [number, number, number, number, number, number, number, number];

interface RouteDef {
  segs: readonly Seg[];
  /** How many of the segments are inland; the rest is open water. */
  inland: number;
}

interface Network {
  w: number;
  h: number;
  routes: readonly RouteDef[];
}

/**
 * The delta, drawn twice: once for wide screens and once for tall ones.
 *
 * Every route starts upstream, off the top or left edge, and branches toward
 * the sea in the bottom right. The coast is where each route's inland
 * segments end. Coordinates are in a design space stretched to the viewport,
 * which a river network survives far better than a typeface would.
 */
const MAIN_A: Seg = [-20, 60, 200, 110, 300, 200, 420, 260];
const MAIN_B: Seg = [420, 260, 520, 310, 560, 420, 700, 470];
const NORTH: Seg = [140, -20, 170, 80, 260, 150, 420, 260];
const WEST_A: Seg = [-20, 220, 120, 230, 240, 300, 300, 380];
const WEST_B: Seg = [300, 380, 380, 400, 450, 470, 520, 520];
const MIDDLE: Seg = [420, 260, 470, 330, 440, 430, 520, 520];
const SOUTH_OUT: Seg = [520, 520, 580, 590, 700, 640, 860, 760];

const LANDSCAPE: Network = {
  w: 1200,
  h: 720,
  routes: [
    { segs: [MAIN_A, MAIN_B, [700, 470, 820, 515, 960, 560, 1220, 700]], inland: 2 },
    { segs: [MAIN_A, MAIN_B, [700, 470, 760, 420, 860, 400, 980, 430], [980, 430, 1080, 455, 1150, 520, 1240, 560]], inland: 2 },
    { segs: [NORTH, MIDDLE, SOUTH_OUT], inland: 2 },
    { segs: [WEST_A, WEST_B, SOUTH_OUT], inland: 2 },
    { segs: [WEST_A, [300, 380, 360, 460, 330, 560, 380, 760]], inland: 1 },
    { segs: [NORTH, MAIN_B, [700, 470, 820, 515, 960, 560, 1220, 700]], inland: 2 },
  ],
};

const P_MAIN_A: Seg = [40, -10, 60, 120, 140, 200, 180, 300];
const P_MAIN_B: Seg = [180, 300, 220, 400, 160, 520, 210, 640];
const P_OUT: Seg = [210, 640, 240, 720, 300, 780, 330, 870];

const PORTRAIT: Network = {
  w: 390,
  h: 844,
  routes: [
    { segs: [P_MAIN_A, P_MAIN_B, P_OUT], inland: 2 },
    { segs: [P_MAIN_A, [180, 300, 240, 330, 330, 360, 410, 350]], inland: 1 },
    { segs: [[-10, 420, 60, 440, 150, 470, 210, 640], P_OUT], inland: 1 },
    { segs: [[410, 120, 330, 220, 300, 330, 260, 420], [260, 420, 220, 500, 230, 580, 210, 640], [210, 640, 200, 720, 150, 790, 110, 870]], inland: 2 },
    { segs: [P_MAIN_A, P_MAIN_B, [210, 640, 200, 720, 150, 790, 110, 870]], inland: 2 },
  ],
};

interface Route {
  xs: Float32Array;
  ys: Float32Array;
  /** Cumulative length at each sample, in screen pixels. */
  cum: Float32Array;
  length: number;
  coast: number;
}

const STEPS_PER_SEG = 28;

function sampleRoute(def: RouteDef, sx: number, sy: number): Route {
  const n = def.segs.length * STEPS_PER_SEG + 1;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const cum = new Float32Array(n);
  let i = 0;
  let coast = 0;

  def.segs.forEach((seg, k) => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = seg;
    for (let s = k === 0 ? 0 : 1; s <= STEPS_PER_SEG; s += 1) {
      const t = s / STEPS_PER_SEG;
      const u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      xs[i] = x * sx;
      ys[i] = y * sy;
      cum[i] = i === 0 ? 0 : cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
      i += 1;
    }
    if (k === def.inland - 1) coast = cum[i - 1]!;
  });

  return { xs, ys, cum, length: cum[n - 1]!, coast };
}

/** Index of the last sample at or before distance d. */
function indexAt(route: Route, d: number): number {
  let lo = 0;
  let hi = route.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (route.cum[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function pointAt(route: Route, d: number): [number, number] {
  const i = Math.min(indexAt(route, d), route.cum.length - 2);
  const span = route.cum[i + 1]! - route.cum[i]!;
  const t = span > 0 ? (d - route.cum[i]!) / span : 0;
  return [route.xs[i]! + (route.xs[i + 1]! - route.xs[i]!) * t, route.ys[i]! + (route.ys[i + 1]! - route.ys[i]!) * t];
}

interface Particle {
  route: number;
  d: number;
  /** Personal speed multiplier, so the light does not move in lockstep. */
  pace: number;
  brightness: number;
}

/** How hard the river runs, 0 to 1, from live throughput on a log scale. */
const energyOf = (mbps: number) => Math.min(Math.max(Math.log10(1 + mbps) / 3, 0), 1);

/**
 * The page background: river channels with light flowing down them.
 *
 * It is also the progress indicator. Before a test the light drifts; while
 * bytes move it runs faster and denser with the live speed; afterwards it
 * settles. Local's light stops at the coast, Raw's runs out to sea.
 *
 * Drawn on a canvas rather than as animated SVG. A dash animation on SVG
 * paths, especially with a glow filter, repaints the whole layer each frame;
 * here the channels are painted once to an offscreen canvas and each frame
 * draws a few dozen short strokes and sprites on top. The loop reads its
 * inputs from a ref so it is never torn down mid-test, stops while the tab
 * is hidden, and does not run at all for visitors who ask for reduced motion.
 */
export function RiverField({ glowRgb, toSea, flow, mbps, reducedMotion, dim = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef({ glowRgb, toSea, flow, mbps });
  liveRef.current = { glowRgb, toSea, flow, mbps };
  // Only set while the river is still: with no loop running, a change of mode
  // has to repaint the channels itself.
  const repaintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    repaintRef.current?.();
  }, [glowRgb, toSea]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    let width = 0;
    let height = 0;
    let scale = 1;
    let routes: Route[] = [];
    let weights: number[] = [];
    const channels = document.createElement('canvas');
    let channelsFor = '';

    const sprite = document.createElement('canvas');
    let spriteFor = '';
    const SPRITE = 40;

    const layout = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const net = width >= height ? LANDSCAPE : PORTRAIT;
      const sx = width / net.w;
      const sy = height / net.h;
      scale = (sx + sy) / 2;
      routes = net.routes.map((r) => sampleRoute(r, sx, sy));
      const total = routes.reduce((sum, r) => sum + r.length, 0);
      weights = routes.map((r) => r.length / total);
      channelsFor = '';
    };

    const paintChannels = (sea: boolean) => {
      channels.width = canvas.width;
      channels.height = canvas.height;
      const c = channels.getContext('2d')!;
      c.scale(dpr, dpr);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      const stroke = (route: Route, from: number, to: number, style: string, w: number) => {
        c.beginPath();
        let started = false;
        for (let i = 0; i < route.cum.length; i += 1) {
          if (route.cum[i]! < from || route.cum[i]! > to) continue;
          if (started) c.lineTo(route.xs[i]!, route.ys[i]!);
          else c.moveTo(route.xs[i]!, route.ys[i]!);
          started = true;
        }
        c.strokeStyle = style;
        c.lineWidth = w;
        c.stroke();
      };
      for (const route of routes) {
        // A wide, faint body of water under each channel, then the channel.
        stroke(route, 0, route.coast, 'rgba(120, 255, 215, 0.018)', 9);
        stroke(route, 0, route.coast, 'rgba(170, 245, 225, 0.085)', 1.2);
        stroke(route, route.coast, route.length, `rgba(150, 205, 255, ${sea ? 0.075 : 0.035})`, 1.2);
      }
      channelsFor = `${width}x${height}:${sea}`;
    };

    const paintSprite = (rgb: string) => {
      sprite.width = SPRITE;
      sprite.height = SPRITE;
      const c = sprite.getContext('2d')!;
      const g = c.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
      g.addColorStop(0, 'rgba(255, 255, 255, 1)');
      g.addColorStop(0.12, `rgba(${rgb}, 1)`);
      g.addColorStop(0.4, `rgba(${rgb}, 0.28)`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, SPRITE, SPRITE);
      spriteFor = rgb;
    };

    const pickRoute = () => {
      let r = Math.random();
      for (let i = 0; i < weights.length; i += 1) {
        r -= weights[i]!;
        if (r <= 0) return i;
      }
      return weights.length - 1;
    };

    const spawn = (anywhere: boolean): Particle => {
      const route = pickRoute();
      const limit = liveRef.current.toSea ? routes[route]!.length : routes[route]!.coast;
      return {
        route,
        d: anywhere ? Math.random() * limit * 0.9 : 0,
        pace: 0.75 + Math.random() * 0.5,
        brightness: 0.55 + Math.random() * 0.45,
      };
    };

    layout();
    window.addEventListener('resize', layout);

    // Fade the river back once the reader scrolls past the test, so it stays
    // behind the history and tools rather than competing with them.
    const onScroll = () => {
      const past = Math.min(window.scrollY / (window.innerHeight * 0.85), 1);
      canvas.style.opacity = String(1 - past * 0.6);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const draw = (particles: Particle[], energy: number) => {
      const { glowRgb: rgb, toSea: sea } = liveRef.current;
      if (channelsFor !== `${width}x${height}:${sea}`) paintChannels(sea);
      if (spriteFor !== rgb) paintSprite(rgb);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(channels, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';

      const tail = (22 + 70 * energy) * scale;
      const head = (12 + 6 * energy) * Math.max(scale, 0.6);
      for (const p of particles) {
        const route = routes[p.route]!;
        const limit = sea ? route.length : route.coast;
        const fadeIn = Math.min(p.d / (40 * scale), 1);
        const fadeOut = Math.min(Math.max((limit - p.d) / (limit * 0.16), 0), 1);
        const alpha = fadeIn * fadeOut * p.brightness;
        if (alpha <= 0.01) continue;

        const from = Math.max(p.d - tail, 0);
        const start = indexAt(route, from) + 1;
        const end = indexAt(route, p.d);
        const [fx, fy] = pointAt(route, from);
        const [hx, hy] = pointAt(route, p.d);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        for (let i = start; i <= end; i += 1) ctx.lineTo(route.xs[i]!, route.ys[i]!);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = `rgba(${rgb}, ${0.34 * alpha})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, hx - head / 2, hy - head / 2, head, head);
        ctx.globalAlpha = 1;
      }
    };

    if (reducedMotion) {
      // A still estuary: the channels, and nothing moving down them.
      const repaint = () => draw([], 0);
      repaint();
      repaintRef.current = repaint;
      window.addEventListener('resize', repaint);
      return () => {
        repaintRef.current = null;
        window.removeEventListener('resize', layout);
        window.removeEventListener('resize', repaint);
        window.removeEventListener('scroll', onScroll);
      };
    }

    const particles: Particle[] = Array.from({ length: 16 }, () => spawn(true));
    let energy = 0;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { flow: state, mbps: live, toSea: sea } = liveRef.current;

      // Ease toward the target rather than jumping: the live figure is itself
      // noisy, and a river that lurches reads as a broken animation.
      const target = state === 'testing' ? Math.max(energyOf(live), 0.18) : state === 'done' ? 0.12 : 0;
      energy += (target - energy) * (1 - Math.exp(-dt / 0.7));

      const wanted = Math.round(16 + 70 * energy);
      const speed = (30 + 230 * energy) * scale;

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]!;
        p.d += speed * p.pace * dt;
        const route = routes[p.route]!;
        const limit = sea ? route.length : route.coast;
        if (p.d >= limit) {
          if (particles.length > wanted) particles.splice(i, 1);
          else particles[i] = spawn(false);
        }
      }
      // New light enters from upstream, a few a frame at most, so a rise in
      // speed thickens the river over a second rather than all at once.
      for (let k = 0; k < 2 && particles.length < wanted; k += 1) particles.push(spawn(false));

      draw(particles, energy);
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', layout);
      window.removeEventListener('scroll', onScroll);
    };
  }, [reducedMotion]);

  // Dimmed on a wrapper, so it composes with the fade the canvas does itself
  // on scroll instead of fighting it for the same style property.
  return (
    <div className="river-wrap" style={{ opacity: dim ? 0.4 : 1 }} aria-hidden="true">
      <canvas ref={canvasRef} className="river" />
    </div>
  );
}
