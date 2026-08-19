import { useEffect, useRef } from 'react';
import type { World } from '../worlds';

interface Props {
  world: World;
  /** Live throughput in Mbps, drives packet density and velocity. */
  mbps: number;
  /** Which way packets travel. Upload reverses the flow. */
  direction: 'down' | 'up' | 'idle';
  reducedMotion: boolean;
}

interface Packet {
  /** 0..1 along the path between the two nodes. */
  t: number;
  speed: number;
  offset: number;
  size: number;
}

const MAX_PACKETS = 220;

/**
 * The link, drawn.
 *
 * Two nodes: the viewer on the left, the server placed by `world.distance`.
 * BDIX puts the server close with a dense field of short quick packets; RAW
 * pushes it to the far edge with sparse, long, slow ones. The same throughput
 * therefore looks different in the two worlds, which is the point: distance is
 * a thing you should be able to see.
 *
 * Canvas rather than DOM nodes because a few hundred animated elements in the
 * document would thrash layout, and this runs while a measurement is live.
 */
export function ParticleField({ world, mbps, direction, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Held in a ref so changing throughput never restarts the animation loop.
  const propsRef = useRef({ world, mbps, direction });
  propsRef.current = { world, mbps, direction };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const packets: Packet[] = Array.from({ length: MAX_PACKETS }, () => ({
      t: Math.random(),
      speed: 0.15 + Math.random() * 0.35,
      offset: (Math.random() - 0.5) * 2,
      size: 0.6 + Math.random() * 1.8,
    }));

    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { world: w, mbps: live, direction: dir } = propsRef.current;

      ctx.clearRect(0, 0, width, height);

      // The link sits as its own band below the gauge rather than floating
      // beside it. Anchored left at the viewer, with the server pushed right
      // by world.distance, so BDIX is a short hop and RAW spans the screen.
      const ax = width * 0.13;
      const ay = height * 0.74;
      const bx = width * (0.13 + w.distance * 0.74);
      const by = height * 0.74;

      // Throughput drives how much of the field is lit and how fast it moves.
      // Log scale, because the range spans two orders of magnitude and a linear
      // map leaves everything below 50 Mbps looking identically dead.
      const intensity = live > 0 ? Math.min(Math.log10(live + 1) / 3, 1) : 0;
      const activeCount = Math.round(MAX_PACKETS * w.density * (0.12 + intensity * 0.88));

      // The connecting path.
      const gradient = ctx.createLinearGradient(ax, ay, bx, by);
      gradient.addColorStop(0, `rgba(${w.glowRgb}, ${0.05 + intensity * 0.16})`);
      gradient.addColorStop(0.5, `rgba(${w.glowRgb}, ${0.02 + intensity * 0.08})`);
      gradient.addColorStop(1, `rgba(${w.glowRgb}, ${0.05 + intensity * 0.16})`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      const trailLength = 0.018 * w.trail * (0.5 + intensity);

      for (let i = 0; i < activeCount; i += 1) {
        const p = packets[i]!;
        if (!reducedMotion && dir !== 'idle') {
          p.t += dt * p.speed * w.speed * (0.35 + intensity * 1.3);
          if (p.t > 1) p.t -= 1;
        }

        // Upload reverses the flow, so the direction of travel matches what
        // is actually happening on the wire.
        const travel = dir === 'up' ? 1 - p.t : p.t;
        const tail = Math.max(travel - trailLength, 0);

        const spread = 1 + w.distance * 2.2;
        const wobble = Math.sin((travel + p.offset) * Math.PI) * p.offset * 26 * spread;

        const x1 = ax + (bx - ax) * travel;
        const y1 = ay + (by - ay) * travel + wobble;
        const x2 = ax + (bx - ax) * tail;
        const y2 = ay + (by - ay) * tail + wobble;

        // Fade in and out at the endpoints so packets do not pop.
        const edge = Math.sin(travel * Math.PI);
        const alpha = (0.12 + intensity * 0.72) * edge;

        ctx.strokeStyle = `rgba(${w.glowRgb}, ${alpha})`;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      // The two nodes.
      for (const [nx, ny, scale] of [
        [ax, ay, 1],
        [bx, by, 0.82],
      ] as const) {
        const halo = ctx.createRadialGradient(nx, ny, 0, nx, ny, 46 * scale);
        halo.addColorStop(0, `rgba(${w.glowRgb}, ${0.3 + intensity * 0.4})`);
        halo.addColorStop(1, `rgba(${w.glowRgb}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(nx, ny, 46 * scale, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${w.glowRgb}, 0.95)`;
        ctx.beginPath();
        ctx.arc(nx, ny, 3.2 * scale, 0, Math.PI * 2);
        ctx.fill();
      }

      // Label the ends. Without this the diagram is two dots and a line, and
      // the distance between them means nothing to anyone looking at it.
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
      ctx.fillText('YOU', ax, ay + 30);
      ctx.fillText(w.distance > 0.6 ? 'SINGAPORE' : 'DHAKA', bx, by + 30);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
