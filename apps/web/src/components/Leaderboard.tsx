import { useEffect, useState } from 'react';
import { fetchLeaderboard, type LeaderboardRow } from '../lib/results';
import { navigate } from '../lib/route';
import { WORLDS } from '../worlds';

const fmt = (v: number | null, digits = 1) => (v === null ? '··' : v.toFixed(digits));

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
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="label">Verified results only</span>
        <h1 className="text-[40px] font-light tracking-[-0.035em]">ISP leaderboard</h1>
        <p className="max-w-lg text-[14px] leading-relaxed text-[var(--muted)]">
          Median download over the last 30 days, ranked by raw international speed. Only verified
          results count, and a provider needs at least 20 of them before it appears.
        </p>
      </div>

      {rows === null && <p className="text-[13px] text-[var(--muted)]">Loading…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="panel flex flex-col items-center gap-2 rounded-3xl px-8 py-10 text-center">
          <p className="text-[16px] text-[var(--text)]">Nothing to rank yet.</p>
          <p className="max-w-sm text-[13px] leading-relaxed text-[var(--muted)]">
            A provider appears once 20 verified results have come in from it. Run a test to
            contribute one.
          </p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="panel w-full overflow-x-auto rounded-3xl">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--line)]">
                {['ISP', 'Local', 'Raw', 'Ping', 'Tests'].map((h, i) => (
                  <th
                    key={h}
                    className={`label px-5 py-4 ${i === 0 ? 'text-left' : 'text-right'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.isp} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-5 py-3.5 text-[14px]">{row.isp}</td>
                  <td
                    className="mono px-5 py-3.5 text-right text-[13px]"
                    style={{ color: WORLDS.bdix.accent }}
                  >
                    {fmt(row.median_local_down)}
                  </td>
                  <td
                    className="mono px-5 py-3.5 text-right text-[13px]"
                    style={{ color: WORLDS.raw.accent }}
                  >
                    {fmt(row.median_raw_down)}
                  </td>
                  <td className="mono px-5 py-3.5 text-right text-[13px] text-[var(--muted)]">
                    {fmt(row.median_raw_ping, 0)}
                  </td>
                  <td className="mono px-5 py-3.5 text-right text-[13px] text-[var(--faint)]">
                    {row.samples}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button onClick={() => navigate('/')} className="chip link cursor-pointer px-6 py-2.5 text-[13px] font-medium">
        Back to the test
      </button>
    </div>
  );
}
