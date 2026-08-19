import { useEffect, useRef } from 'react';
interface Props {
  mbps: number;
  accent: string;
  glowRgb: string;
  active: boolean;
  height?: number;
}

const MAX_POINTS = 240;

/**
 * Live throughput trace.
 *
 * Samples on a timer rather than on every engine event: the engine emits a
 * sample per chunk, which on a fast link is hundreds a second, and drawing all
 * of them would spend more time in the canvas than the shape justifies.
 */
export function Trace({ mbps, accent, glowRgb, active, height = 52 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<number[]>([]);
  // Colours live in the ref alongside the live values so the render loop is
  // never torn down. They change while the world transitions between modes,
  // which happens mid-test during a run-both, and restarting the loop there
  // would drop the sampler and interrupt the trace.
  const liveRef = useRef({ mbps, active, accent, glowRgb });
  liveRef.current = { mbps, active, accent, glowRgb };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;

    const resize = () => {
      width = canvas.clientWidth;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const sampler = setInterval(() => {
      const { mbps: v, active: on } = liveRef.current;
      if (!on && pointsRef.current.length === 0) return;
      pointsRef.current.push(on ? v : 0);
      if (pointsRef.current.length > MAX_POINTS) pointsRef.current.shift();
    }, 60);

    let raf = 0;
    const draw = () => {
      const points = pointsRef.current;
      ctx.clearRect(0, 0, width, height);

      if (points.length > 1) {
        const peak = Math.max(...points, 1);
        const step = width / (MAX_POINTS - 1);
        const yOf = (v: number) => height - (v / peak) * (height - 6) - 3;

        ctx.beginPath();
        points.forEach((v, i) => {
          const x = i * step;
          const y = yOf(v);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });

        const fill = ctx.createLinearGradient(0, 0, 0, height);
        fill.addColorStop(0, `rgba(${liveRef.current.glowRgb}, 0.22)`);
        fill.addColorStop(1, `rgba(${liveRef.current.glowRgb}, 0)`);
        ctx.lineTo((points.length - 1) * step, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.beginPath();
        points.forEach((v, i) => {
          const x = i * step;
          const y = yOf(v);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = liveRef.current.accent;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(sampler);
      window.removeEventListener('resize', resize);
    };
  }, [height]);

  return <canvas ref={canvasRef} style={{ height }} className="w-full" aria-hidden="true" />;
}
