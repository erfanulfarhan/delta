import { RAW_SERVERS } from '../config';

interface Props {
  selected: string;
  onSelect: (id: string) => void;
  disabled: boolean;
  accent: string;
  glowRgb: string;
  /** Ping measured by a Raw test this session, by site id. */
  pings: Record<string, number>;
}

/**
 * Choose which international server Raw measures against.
 *
 * Each location shows its distance until it has been tested, then the ping that
 * test measured. Distance is the honest stand-in: latency is the part of a
 * connection you cannot buy your way out of, and it follows distance closely.
 *
 * There is no live ping here any more, deliberately. M-Lab's servers have no
 * ping endpoint, and opening a test connection just to time it would be
 * recorded by M-Lab as a test and spend one of the visitor's 40 a day.
 */
export function ServerPicker({ selected, onSelect, disabled, accent, glowRgb, pings }: Props) {
  return (
    <div className="w-full max-w-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono text-[9px] uppercase tracking-[0.26em] text-[var(--muted)]">
          Raw server
        </span>
        <span className="mono text-[9px] tracking-[0.16em] text-[var(--faint)]">
          M-Lab · 10 Gbps
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {RAW_SERVERS.map((server) => {
          const isSelected = server.id === selected;
          const ping = pings[server.id];

          return (
            <button
              key={server.id}
              onClick={() => onSelect(server.id)}
              disabled={disabled}
              aria-pressed={isSelected}
              title={`M-Lab ${server.id}, on ${server.transit}`}
              className="panel flex cursor-pointer flex-col items-center gap-1.5 rounded-xl px-3 py-3.5 transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
              style={
                isSelected
                  ? {
                      borderColor: `rgba(${glowRgb}, 0.55)`,
                      background: `linear-gradient(180deg, rgba(${glowRgb}, 0.16), rgba(${glowRgb}, 0.03))`,
                      boxShadow: `0 0 28px -8px rgba(${glowRgb}, 0.6)`,
                    }
                  : undefined
              }
            >
              <span className="text-[17px] leading-none">{server.flag}</span>
              <span
                className="mono text-[10px] tracking-[0.12em]"
                style={{ color: isSelected ? accent : 'var(--text)' }}
              >
                {server.city}
              </span>
              <span className="mono text-[9px] text-[var(--faint)]">
                {ping !== undefined ? `${ping.toFixed(0)} ms` : `${server.km.toLocaleString('en-US')} km`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
