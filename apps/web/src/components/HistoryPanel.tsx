import { clearHistory, loadHistory, type HistoryEntry } from '../lib/history';
import { formatMbps, formatMs } from '../lib/format';
import { WORLDS } from '../worlds';

interface Props {
  entries: HistoryEntry[];
  onCleared: () => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** Your own recent results. They live in this browser and nowhere else. */
export function HistoryPanel({ entries, onCleared }: Props) {
  return (
    <section className="panel flex h-full flex-col gap-5 rounded-3xl p-6 sm:p-7">
      <header className="flex items-end justify-between gap-4">
        <div>
          <span className="label">Kept in this browser</span>
          <h2 className="mt-2 text-[28px] font-light tracking-[-0.03em]">History</h2>
        </div>
        {entries.length > 0 && (
          <button
            onClick={() => {
              clearHistory();
              onCleared();
            }}
            className="link cursor-pointer pb-1.5 text-[12.5px]"
          >
            Clear
          </button>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--line-strong)] px-6 py-10 text-center">
          <p className="text-[15px] text-[var(--text)]">No tests yet</p>
          <p className="max-w-xs text-[13px] leading-relaxed text-[var(--muted)]">
            Your results will collect here, so you can see how your line holds up over the day.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col">
          {entries.slice(0, 8).map((entry) => (
            <li
              key={entry.at}
              className="flex items-center gap-4 border-b border-[var(--line)] py-3 last:border-b-0"
            >
              <span className="w-[74px] shrink-0 text-[12px] text-[var(--faint)]">{when(entry.at)}</span>
              <div className="flex flex-1 flex-wrap gap-x-6 gap-y-1.5">
                {(['bdix', 'raw'] as const).map((mode) => {
                  const r = entry.results[mode];
                  if (!r) return null;
                  return (
                    <span key={mode} className="flex items-baseline gap-2 text-[13px]">
                      <span className="h-1.5 w-1.5 translate-y-[-1px] rounded-full" style={{ background: WORLDS[mode].accent }} />
                      <span className="text-[var(--muted)]">{mode === 'bdix' ? 'Local' : 'Raw'}</span>
                      <span className="mono text-[var(--text)]">{formatMbps(r.downloadMbps)}</span>
                      <span className="mono text-[var(--faint)]">
                        / {formatMbps(r.uploadMbps)} · {formatMs(r.pingMs)} ms
                      </span>
                    </span>
                  );
                })}
              </div>
              {entry.shortId && (
                <a href={`/r/${entry.shortId}`} className="link shrink-0 text-[12px]">
                  Link
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export { loadHistory };
