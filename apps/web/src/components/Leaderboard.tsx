import { useEffect, useState } from 'react';
import { fetchLeaderboard, type LeaderboardRow } from '../lib/results';
import { navigate } from '../lib/route';
import { WORLDS } from '../worlds';

const fmt = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));

export function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard().then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rise flex w-full max-w-2xl flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="display text-[24px] font-semibold">ISP leaderboard</span>
        <p className="max-w-lg text-[12px] leading-relaxed text-[var(--muted)]">
          Median download over the last 30 days, ranked by raw international speed. Only verified
          results count, and a provider needs at least 20 of them before it appears.
        </p>
      </div>

      {rows === null && <p className="mono text-[11px] text-[var(--muted)]">Loading…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="panel flex flex-col items-center gap-2 rounded-xl px-6 py-8 text-center">
          <p className="text-[13px] text-[var(--text)]">Nothing to rank yet.</p>
          <p className="max-w-sm text-[12px] leading-relaxed text-[var(--muted)]">
            A provider appears once 20 verified results have come in from it. Run a test to
            contribute one.
          </p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="panel w-full overflow-x-auto rounded-xl">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--line)]">
                {['ISP', 'Local', 'Raw', 'Ping', 'Tests'].map((h, i) => (
                  <th
                    key={h}
                    className={`mono px-4 py-3 text-[9px] uppercase tracking-[0.2em] text-[var(--muted)] ${
                      i === 0 ? 'text-left' : 'text-right'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.isp} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-4 py-3 text-[12px]">{row.isp}</td>
                  <td
                    className="mono px-4 py-3 text-right text-[12px]"
                    style={{ color: WORLDS.bdix.accent }}
                  >
                    {fmt(row.median_local_down)}
                  </td>
                  <td
                    className="mono px-4 py-3 text-right text-[12px]"
                    style={{ color: WORLDS.raw.accent }}
                  >
                    {fmt(row.median_raw_down)}
                  </td>
                  <td className="mono px-4 py-3 text-right text-[12px] text-[var(--muted)]">
                    {fmt(row.median_raw_ping, 0)}
                  </td>
                  <td className="mono px-4 py-3 text-right text-[12px] text-[var(--faint)]">
                    {row.samples}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={() => navigate('/')}
        className="panel cursor-pointer rounded-full px-7 py-3 text-[11px] tracking-[0.18em] text-[var(--muted)] uppercase transition-colors hover:text-[var(--text)]"
      >
        Back to test
      </button>
    </div>
  );
}
