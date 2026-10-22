import { navigate } from '../lib/route';
import { ModeSwitch, type Selection } from './ModeSwitch';

/** A delta: the estuary's triangle, with the land inside it. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" style={{ color: 'var(--accent-2)' }}>
      <path d="M14 3.2 L25.6 23.8 H2.4 Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M14 11.5 L19.2 20.8 H8.8 Z" fill="currentColor" opacity="0.38" />
    </svg>
  );
}

interface Props {
  /** The switch belongs to the test; other pages show a way back instead. */
  home: boolean;
  selection: Selection;
  onSelect: (value: Selection) => void;
  disabled: boolean;
}

// Smooth only for those who have not asked for less motion. A behaviour set
// here overrides the stylesheet's scroll-behaviour, reduced-motion rule and all.
const glide = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

const scrollTo = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: glide(), block: 'start' });
};

export function TopBar({ home, selection, onSelect, disabled }: Props) {
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 pt-5 sm:px-8 lg:pt-7">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
          window.scrollTo({ top: 0, behavior: glide() });
        }}
        className="flex items-center gap-2.5"
        aria-label="Delta, home"
      >
        <Logo />
        <span className="text-[19px] font-semibold tracking-[-0.02em]">delta</span>
      </a>

      {home ? (
        <div className="lg:absolute lg:left-1/2 lg:-translate-x-1/2">
          <ModeSwitch value={selection} onChange={onSelect} disabled={disabled} />
        </div>
      ) : (
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="chip link px-4 py-2 text-[13px] font-medium"
        >
          Run a test
        </a>
      )}

      <nav className="hidden items-center gap-7 text-[13.5px] lg:flex" aria-label="Sections">
        {home && (
          <>
            <a href="#tools" onClick={scrollTo('tools')} className="link">
              IP &amp; ports
            </a>
            <a href="#history" onClick={scrollTo('history')} className="link">
              History
            </a>
          </>
        )}
        <a
          href="/privacy"
          onClick={(e) => {
            e.preventDefault();
            navigate('/privacy');
            window.scrollTo({ top: 0 });
          }}
          className="link"
        >
          Privacy
        </a>
      </nav>
    </header>
  );
}
