import type { World } from '../worlds';

interface Stat {
  label: string;
  value: string;
  unit?: string;
}

export function StatRow({ stats, world }: { stats: Stat[]; world: World }) {
  return (
    <div className="grid w-full max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/8 bg-white/5 sm:grid-cols-4">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className="rise flex flex-col items-center gap-1.5 bg-[#05090799] px-4 py-5 backdrop-blur-md"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <span className="mono text-[9px] uppercase tracking-[0.26em] text-white/35">
            {stat.label}
          </span>
          <span className="mono text-[19px]" style={{ color: world.accent }}>
            {stat.value}
            {stat.unit && <span className="ml-1 text-[10px] text-white/40">{stat.unit}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
