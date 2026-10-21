import { MLAB } from '../config';
import { navigate } from '../lib/route';
import { SHARING_ENABLED } from '../lib/supabase';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="mono text-[10px] uppercase tracking-[0.26em] text-[var(--muted)]">{title}</h2>
      <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-[var(--text)]">{children}</div>
    </section>
  );
}

const linkClass = 'underline decoration-[var(--line)] underline-offset-2 hover:text-[var(--text)]';

/**
 * What each part of the site sends, and to whom.
 *
 * M-Lab requires every third-party client to publish one, and Raw's results
 * really are public, so this states that as plainly as the test itself does.
 */
export function PrivacyView() {
  return (
    <div className="rise flex w-full max-w-xl flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className="display text-[24px] font-semibold">Privacy</span>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Delta has no accounts and keeps no record of who ran a test. This is what each part of the
          site sends, and to whom.
        </p>
      </div>

      <Section title="Local test">
        <p>
          Runs against Delta&apos;s own endpoint on Cloudflare, served from Dhaka. It reads your IP
          address, ISP and city so the page can show them, and stores none of it. Cloudflare handles
          the requests as it does for any website, under{' '}
          <a className={linkClass} href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">
            its own privacy policy
          </a>
          .
        </p>
      </Section>

      <Section title="Raw test">
        <p>
          Runs on Measurement Lab (M-Lab), a non-profit open measurement platform. M-Lab publishes
          every test it runs as open data that anyone can download, and keeps it indefinitely. That
          includes your IP address, the time of the test and its results. Delta adds only its own
          name and version, which M-Lab asks of every client; your browser sends the same headers it
          sends to any site, which name the browser and its version.
        </p>
        <p>
          A Raw test only starts when you press Go in Raw mode or Run both. Doing so means you accept{' '}
          <a className={linkClass} href={MLAB.privacyUrl} target="_blank" rel="noreferrer">
            M-Lab&apos;s privacy policy
          </a>
          . If you would rather not appear in that data, use Local only.
        </p>
      </Section>

      <Section title="IP and port checks">
        <p>
          The address check and the reachability check run on Delta&apos;s function in Singapore,
          hosted on Vercel. It looks up your address&apos;s reverse DNS and tries to open connections
          back to it. It sees your IP address while it works and stores nothing.
        </p>
      </Section>

      <Section title="Your history">
        <p>
          Recent results are kept in this browser&apos;s local storage and nowhere else. Clearing the
          history, or this site&apos;s data in your browser, deletes them.
        </p>
      </Section>

      {SHARING_ENABLED && (
        <Section title="Shared results">
          <p>
            Sharing a result saves its figures with your ISP and city, so the link works. Your IP
            address is not saved, and a result can only be read by someone who has its link.
          </p>
        </Section>
      )}

      <button
        onClick={() => navigate('/')}
        className="panel cursor-pointer self-center rounded-full px-7 py-3 text-[11px] tracking-[0.18em] text-[var(--muted)] uppercase transition-colors hover:text-[var(--text)]"
      >
        Back to test
      </button>
    </div>
  );
}
