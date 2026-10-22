import { RAW_SERVERS } from '../config';

interface Props {
  selected: string;
  onSelect: (id: string) => void;
  disabled: boolean;
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
 * There is no live ping here, deliberately. M-Lab's servers have no ping
 * endpoint, and opening a test connection just to time it would be recorded by
 * M-Lab as a test and spend one of the visitor's 40 a day.
 *
 * No flags: Windows renders flag emoji as two bare letters. Toggle buttons
 * rather than a radio group: three plain tab stops need no arrow-key handling
 * to be usable.
 */
export function ServerPicker({ selected, onSelect, disabled, pings }: Props) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <span className="label">Raw server · M-Lab, 10 Gbps</span>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Raw server">
        {RAW_SERVERS.map((server) => {
          const isSelected = server.id === selected;
          const ping = pings[server.id];
          return (
            <button
              key={server.id}
              aria-pressed={isSelected}
              onClick={() => onSelect(server.id)}
              disabled={disabled}
              title={`M-Lab ${server.id}, on ${server.transit}`}
              className="chip flex cursor-pointer items-baseline gap-2 px-4 py-2 transition-all duration-300 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
              style={
                isSelected
                  ? { background: 'rgba(var(--glow), 0.14)', borderColor: 'rgba(var(--glow), 0.45)' }
                  : undefined
              }
            >
              <span className="text-[13.5px] font-medium" style={{ color: isSelected ? 'var(--text)' : 'var(--muted)' }}>
                {server.city}
              </span>
              <span className="mono text-[11px] text-[var(--faint)]">
                {ping !== undefined ? `${ping.toFixed(0)} ms` : `${server.km.toLocaleString('en-US')} km`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
