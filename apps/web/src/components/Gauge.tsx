import { useEffect, useRef } from 'react';
import { AnimatedNumber } from './AnimatedNumber';

interface Props {
  mbps: number;
  accent: string;
  accent2: string;
  glowRgb: string;
  label: string;
  size?: number;
}

const START_ANGLE = 225;
const SWEEP = 270;
const MAX_MBPS = 1000;
const TICKS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];

/**
 * Logarithmic. The range spans two orders of magnitude, and on a linear axis a
 * 5 Mbps result and a 40 Mbps result both sit in the first tenth of the arc.
 */
function speedToFraction(mbps: number): number {
  if (mbps <= 0) return 0;
  return Math.min(Math.log10(1 + mbps) / Math.log10(1 + MAX_MBPS), 1);
}

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const start = polar(cx, cy, r, fromDeg);
  const end = polar(cx, cy, r, toDeg);
  const largeArc = toDeg - fromDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function Gauge({ mbps, accent, accent2, glowRgb, label, size = 320 }: Props) {
  const arcRef = useRef<SVGPathElement>(null);
  const capRef = useRef<SVGCircleElement>(null);

  // Both the target and the eased position live in refs.
  //
  // They must survive across renders, and the animation effect must NOT depend
  // on `mbps`. With `mbps` in the dependency array the effect tore down and
  // re-ran on every reading (20 a second), reinitialising the eased position to
  // zero each time. The arc restarted from empty continuously, creeping up a
  // few percent before being reset, so a 250 Mbps result sat visibly stuck near
  // the bottom of the scale and juddered. It only looked correct once a run
  // finished and the readings stopped changing.
  const targetRef = useRef(mbps);
  const currentRef = useRef(0);
  targetRef.current = mbps;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 30;
  const circumference = (SWEEP / 360) * 2 * Math.PI * r;
  const track = arcPath(cx, cy, r, START_ANGLE, START_ANGLE + SWEEP);

  // Driven imperatively: this updates every frame during a measurement, and
  // re-rendering the tree at 60fps would compete with the work being measured.
  // Note the dependencies are geometry only, so the loop runs uninterrupted for
  // the whole test.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const target = speedToFraction(targetRef.current);
      currentRef.current += (target - currentRef.current) * 0.07;
      const current = currentRef.current;

      if (arcRef.current) {
        arcRef.current.style.strokeDashoffset = String(circumference * (1 - current));
      }
      if (capRef.current) {
        const { x, y } = polar(cx, cy, r, START_ANGLE + current * SWEEP);
        capRef.current.setAttribute('cx', String(x));
        capRef.current.setAttribute('cy', String(y));
        capRef.current.style.opacity = current > 0.01 ? '1' : '0';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [circumference, cx, cy, r]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id="gaugeArc" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} />
            <stop offset="100%" stopColor={accent2} />
          </linearGradient>
          <filter id="gaugeGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path d={track} fill="none" stroke="var(--ink-700)" strokeWidth={6} strokeLinecap="round" />

        {TICKS.map((tick) => {
          const angle = START_ANGLE + speedToFraction(tick) * SWEEP;
          const outer = polar(cx, cy, r + 13, angle);
          const inner = polar(cx, cy, r + 7, angle);
          const labelPos = polar(cx, cy, r + 24, angle);
          return (
            <g key={tick}>
              <line
                x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                stroke="var(--line)" strokeWidth={1}
              />
              <text
                x={labelPos.x} y={labelPos.y}
                fill="var(--faint)" fontSize={8.5}
                textAnchor="middle" dominantBaseline="middle"
                fontFamily="var(--font-mono)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        <path
          ref={arcRef}
          d={track}
          fill="none"
          stroke="url(#gaugeArc)"
          strokeWidth={7}
          strokeLinecap="round"
          filter="url(#gaugeGlow)"
          style={{ strokeDasharray: circumference, strokeDashoffset: circumference }}
        />

        {/* Leading cap, so the arc has a head you can track rather than an edge. */}
        <circle ref={capRef} r={5.5} fill={accent2} style={{ opacity: 0, filter: 'url(#gaugeGlow)' }} />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
        <span
          className="mono text-[9px] uppercase tracking-[0.3em]"
          style={{ color: `rgba(${glowRgb}, 0.8)` }}
        >
          {label}
        </span>
        <AnimatedNumber
          value={mbps}
          className="display text-[56px] leading-none font-bold"
          style={{ textShadow: `0 0 50px rgba(${glowRgb}, 0.4)` }}
        />
        <span className="mono text-[10px] tracking-[0.26em] text-[var(--muted)]">MBPS</span>
      </div>
    </div>
  );
}
