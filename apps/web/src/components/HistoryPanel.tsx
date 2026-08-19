import { clearHistory, loadHistory, type HistoryEntry } from '../lib/history';
import { WORLDS } from '../worlds';

interface Props {
  entries: HistoryEntry[];
  onCleared: () => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
};

export function HistoryPanel({ entries, onCleared }: Props) {
  if (entries.length === 0) return null;

  return (
    <div className="w-full max-w-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono text-[9px] uppercase tracking-[0.26em] text-[var(--muted)]">
          Your recent tests
        </span>
        <button
          onClick={() => {
            clearHistory();
            onCleared();
          }}
          className="mono cursor-pointer text-[9px] uppercase tracking-[0.2em] text-[var(--faint)] transition-colors hover:text-[var(--text)]"
        >
          Clear
        </button>
      </div>

      <div className="panel divide-y divide-[var(--line)] overflow-hidden rounded-xl">
        {entries.slice(0, 6).map((entry) => (
          <div key={entry.at} className="flex items-center gap-4 px-4 py-2.5">
            <span className="mono w-16 shrink-0 text-[9px] text-[var(--faint)]">
              {when(entry.at)}
            </span>
            <div className="flex flex-1 flex-wrap gap-x-5 gap-y-1">
              {(['bdix', 'raw'] as const).map((mode) => {
                const r = entry.results[mode];
                if (!r) return null;
                return (
                  <span key={mode} className="mono flex items-baseline gap-1.5 text-[10px]">
                    <span style={{ color: WORLDS[mode].accent }}>
                      {mode === 'bdix' ? 'LOCAL' : 'RAW'}
                    </span>
                    <span className="text-[var(--text)]">{r.downloadMbps.toFixed(1)}</span>
                    <span className="text-[var(--faint)]">/ {r.uploadMbps.toFixed(1)}</span>
                  </span>
                );
              })}
            </div>
            {entry.shortId && (
              <a
                href={`/r/${entry.shortId}`}
                className="mono shrink-0 text-[9px] uppercase tracking-[0.16em] text-[var(--faint)] transition-colors hover:text-[var(--text)]"
              >
                Link
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export { loadHistory };
