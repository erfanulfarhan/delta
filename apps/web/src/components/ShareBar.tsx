import { useState } from 'react';

interface Props {
  shortId: string | null;
  verified: boolean;
  saving: boolean;
}

/**
 * Says plainly whether a result counts toward the leaderboard.
 *
 * An unverified result is still the user's own and still shareable; it just
 * cannot influence anyone else's view of their ISP. Saying so is better than
 * silently discarding it, and better than implying every result is equal.
 */
export function ShareBar({ shortId, verified, saving }: Props) {
  const [copied, setCopied] = useState(false);

  if (saving) {
    return <p className="text-[12.5px] text-[var(--faint)]">Saving result…</p>;
  }
  if (!shortId) return null;

  const url = `${window.location.origin}/r/${shortId}`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="chip flex items-center gap-3 py-1.5 pr-1.5 pl-5">
        <span className="mono max-w-[240px] truncate text-[12px] text-[var(--muted)]">{url}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              setCopied(false);
            }
          }}
          className="cursor-pointer rounded-full bg-white/10 px-4 py-1.5 text-[12px] font-medium text-[var(--text)] transition-colors hover:bg-white/15"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span className="text-[12px] text-[var(--faint)]">
        {verified
          ? 'Verified · counts toward the ISP leaderboard'
          : 'Unverified · shareable, but excluded from the leaderboard'}
      </span>
    </div>
  );
}
