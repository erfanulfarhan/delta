import { useEffect, useRef, useState } from 'react';
import { RAW_SERVERS, type RawServer } from '../config';

interface Props {
  selected: string;
  onSelect: (id: string) => void;
  disabled: boolean;
  accent: string;
  glowRgb: string;
}

/**
 * Choose which international server Raw measures against.
 *
 * Latency is probed for each one on load, because that is the number that tells
 * you whether a location is worth testing: it is the part of a connection you
 * cannot buy your way out of, and it separates a server 2000 km away from one
 * 6000 km away far more honestly than a label does.
 */
async function probe(server: RawServer): Promise<number | null> {
  const samples: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now();
    try {
      await fetch(`${server.baseUrl}/ping?salt=${Math.random().toString(36).slice(2)}`, {
        cache: 'no-store',
      });
    } catch {
      return null;
    }
    // The first request pays for DNS, TCP and TLS, which later ones reuse.
    if (i > 0) samples.push(performance.now() - started);
  }
  if (samples.length === 0) return null;
  return Math.min(...samples);
}

/**
 * Latency cache at module scope, not component state.
 *
 * This component now mounts and unmounts as the user toggles between Local and
 * Raw. Keeping the results in component state would re-probe every server on
 * every toggle, which is three round trips per flick of a switch for numbers
 * that have not meaningfully changed.
 */
const pingCache: Record<string, number | null> = {};

export function ServerPicker({ selected, onSelect, disabled, accent, glowRgb }: Props) {
  const [pings, setPings] = useState<Record<string, number | null>>({ ...pingCache });
  const probed = useRef(false);

  useEffect(() => {
    if (probed.current) return;
    probed.current = true;
    // Already measured this session: reuse rather than re-ping.
    if (RAW_SERVERS.every((s) => s.id in pingCache)) return;
    let alive = true;

    // Sequential, not parallel: concurrent probes queue against each other on a
    // narrow link and report the queueing delay as latency.
    (async () => {
      for (const server of RAW_SERVERS) {
        const ms = await probe(server);
        pingCache[server.id] = ms;
        if (!alive) return;
        setPings((p) => ({ ...p, [server.id]: ms }));
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="w-full max-w-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono text-[9px] uppercase tracking-[0.26em] text-[var(--muted)]">
          Raw server
        </span>
        <span className="mono text-[9px] tracking-[0.16em] text-[var(--faint)]">
          lowest latency wins
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {RAW_SERVERS.map((server) => {
          const isSelected = server.id === selected;
          const ping = pings[server.id];
          const unreachable = ping === null && server.id in pings;

          return (
            <button
              key={server.id}
              onClick={() => onSelect(server.id)}
              disabled={disabled || unreachable}
              aria-pressed={isSelected}
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
                {ping === undefined
                  ? '···'
                  : ping === null
                    ? 'unreachable'
                    : `${ping.toFixed(0)} ms`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
