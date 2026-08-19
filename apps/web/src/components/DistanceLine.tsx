import { useEffect, useRef } from 'react';
import type { World } from '../worlds';

interface Props {
  world: World;
  mbps: number;
  direction: 'down' | 'up' | 'idle';
  reducedMotion: boolean;
}

interface Packet {
  t: number;
  speed: number;
  lane: number;
}

const PACKETS = 90;

/**
 * The distance line: this page's one distinctive element.
 *
 * Every speedtest shows a gauge. None of them show the thing that actually
 * separates BDIX from international, which is distance. Traffic to Dhaka stops
 * a short way along this baseline; traffic to Singapore runs its full length.
 * Drawn as a measured instrument scale rather than an ambient particle field,
 * because the distance is a fact being reported, not decoration.
 */
export function DistanceLine({ world, mbps, direction, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ world, mbps, direction });
  propsRef.current = { world, mbps, direction };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const packets: Packet[] = Array.from({ length: PACKETS }, () => ({
      t: Math.random(),
      speed: 0.22 + Math.random() * 0.3,
      lane: Math.round((Math.random() - 0.5) * 4),
    }));

    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { world: w, mbps: live, direction: dir } = propsRef.current;

      ctx.clearRect(0, 0, width, height);

      const padding = Math.min(72, width * 0.09);
      const x0 = padding;
      const x1 = width - padding;
      const y = height * 0.5;
      const far = x0 + (x1 - x0) * w.distance;

      // Baseline, full span, drawn faint. The line is the possible distance;
      // the lit portion is the distance actually travelled.
      ctx.strokeStyle = 'rgba(255,255,255,0.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      // Scale ticks along the baseline.
      for (let i = 0; i <= 10; i += 1) {
        const tx = x0 + ((x1 - x0) * i) / 10;
        const major = i % 5 === 0;
        ctx.strokeStyle = `rgba(255,255,255,${major ? 0.14 : 0.07})`;
        ctx.beginPath();
        ctx.moveTo(tx, y - (major ? 7 : 4));
        ctx.lineTo(tx, y + (major ? 7 : 4));
        ctx.stroke();
      }

      const intensity = live > 0 ? Math.min(Math.log10(live + 1) / 3, 1) : 0;

      // The travelled span.
      ctx.strokeStyle = `rgba(${w.glowRgb}, ${0.28 + intensity * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(far, y);
      ctx.stroke();

      // Packets, as short precise dashes rather than glowing dots.
      const activeCount = Math.round(PACKETS * (0.1 + intensity * 0.9));
      for (let i = 0; i < activeCount; i += 1) {
        const p = packets[i]!;
        if (!reducedMotion && dir !== 'idle') {
          p.t += dt * p.speed * (0.4 + intensity * 1.1);
          if (p.t > 1) p.t -= 1;
        }
        const travel = dir === 'up' ? 1 - p.t : p.t;
        const px = x0 + (far - x0) * travel;
        const len = 5 + intensity * 13;
        const fade = Math.sin(travel * Math.PI);

        ctx.strokeStyle = `rgba(${w.glowRgb}, ${fade * (0.16 + intensity * 0.6)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px - len / 2, y + p.lane * 3);
        ctx.lineTo(px + len / 2, y + p.lane * 3);
        ctx.stroke();
      }

      // Endpoints.
      const endpoint = (ex: number, label: string, primary: boolean) => {
        if (primary) {
          const halo = ctx.createRadialGradient(ex, y, 0, ex, y, 26);
          halo.addColorStop(0, `rgba(${w.glowRgb}, ${0.22 + intensity * 0.3})`);
          halo.addColorStop(1, `rgba(${w.glowRgb}, 0)`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(ex, y, 26, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${w.glowRgb}, 0.9)`;
        ctx.beginPath();
        ctx.arc(ex, y, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(232,237,247,0.42)';
        ctx.fillText(label, ex, y + 26);
      };

      endpoint(x0, 'YOU', false);
      endpoint(far, w.farLabel, true);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
