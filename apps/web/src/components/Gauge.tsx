import { useEffect, useRef } from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import type { World } from '../worlds';

interface Props {
  mbps: number;
  world: World;
  label: string;
  sublabel?: string;
  size?: number;
}

// Degrees are measured clockwise from twelve o'clock, so 225 is bottom-left.
// Sweeping 270 from there runs up over the top and back down to bottom-right,
// which is the direction a gauge is read.
const START_ANGLE = 225;
const SWEEP = 270;
const MAX_MBPS = 1000;
const TICKS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];

/**
 * Logarithmic, because a linear axis is useless here.
 *
 * The range this has to cover spans two orders of magnitude: a rural DSL line
 * and a BDIX connection differ by 100x. Linear leaves everything below 100 Mbps
 * crushed into the first tenth of the arc, where a 5 Mbps result and a 40 Mbps
 * result look identical.
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
  // Drawn from the low end to the high end, not the reverse: the dash offset
  // that animates this path fills from its start point, so the path has to
  // begin at zero or the arc grows down from the maximum instead of up.
  const start = polar(cx, cy, r, fromDeg);
  const end = polar(cx, cy, r, toDeg);
  const largeArc = toDeg - fromDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function Gauge({ mbps, world, label, sublabel, size = 340 }: Props) {
  const arcRef = useRef<SVGPathElement>(null);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 34;
  const circumference = (SWEEP / 360) * 2 * Math.PI * r;

  // The arc is driven imperatively for the same reason as the numerals: this
  // updates every frame while a measurement is in flight.
  useEffect(() => {
    let raf = 0;
    let current = 0;
    const tick = () => {
      const target = speedToFraction(mbps);
      current += (target - current) * 0.12;
      if (arcRef.current) {
        arcRef.current.style.strokeDashoffset = String(circumference * (1 - current));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mbps, circumference]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id="gaugeStroke" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={world.accent} />
            <stop offset="100%" stopColor={world.accentAlt} />
          </linearGradient>
          <filter id="gaugeGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d={arcPath(cx, cy, r, START_ANGLE, START_ANGLE + SWEEP)}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={10}
          strokeLinecap="round"
        />

        {TICKS.map((tick) => {
          const angle = START_ANGLE + speedToFraction(tick) * SWEEP;
          const outer = polar(cx, cy, r + 15, angle);
          const inner = polar(cx, cy, r + 8, angle);
          const labelPos = polar(cx, cy, r + 26, angle);
          return (
            <g key={tick}>
              <line
                x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                stroke="rgba(255,255,255,0.22)" strokeWidth={1}
              />
              <text
                x={labelPos.x} y={labelPos.y}
                fill="rgba(255,255,255,0.32)" fontSize={9}
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
          d={arcPath(cx, cy, r, START_ANGLE, START_ANGLE + SWEEP)}
          fill="none"
          stroke="url(#gaugeStroke)"
          strokeWidth={10}
          strokeLinecap="round"
          filter="url(#gaugeGlow)"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: circumference,
          }}
        />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="mono text-[10px] uppercase tracking-[0.34em] text-white/40">{label}</div>
        <AnimatedNumber
          value={mbps}
          className="display glow-text mt-1 text-[68px] leading-none"
        />
        <div className="mono mt-1 text-[11px] tracking-[0.3em] text-white/45">MBPS</div>
        {sublabel && (
          <div className="mono mt-3 max-w-[190px] text-center text-[10px] leading-relaxed text-white/30">
            {sublabel}
          </div>
        )}
      </div>
    </div>
  );
}
