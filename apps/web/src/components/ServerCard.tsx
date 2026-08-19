import type { Meta } from '@speedtest/engine';
import { ENDPOINTS, type ModeId } from '../config';

interface Props {
  meta: Meta | null;
  loading: boolean;
  mode: ModeId;
  accent: string;
}

/** Cloudflare airport codes worth naming; anything else shows the raw code. */
const COLO_NAMES: Record<string, string> = {
  DAC: 'Dhaka',
  SIN: 'Singapore',
  BOM: 'Mumbai',
  CCU: 'Kolkata',
  HKG: 'Hong Kong',
  KUL: 'Kuala Lumpur',
  DEL: 'Delhi',
  MAA: 'Chennai',
  CGP: 'Chittagong',
};

function Row({ label, value, hint, accent }: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <span className="mono shrink-0 text-[9px] uppercase tracking-[0.24em] text-[var(--muted)]">
        {label}
      </span>
      <span className="mono truncate text-right text-[11px]" style={accent ? { color: accent } : undefined}>
        {value}
        {hint && <span className="ml-1.5 text-[var(--faint)]">{hint}</span>}
      </span>
    </div>
  );
}

export function ServerCard({ meta, loading, mode, accent }: Props) {
  const endpoint = ENDPOINTS[mode];

  const serverLine = (() => {
    if (!meta) return endpoint.label;
    const colo = (meta as Meta & { colo?: string }).colo;
    if (!colo) return meta.server;
    return COLO_NAMES[colo] ? `${COLO_NAMES[colo]} (${colo})` : colo;
  })();

  return (
    <div className="panel w-full max-w-xl divide-y divide-[var(--line)] overflow-hidden rounded-xl">
      <Row
        label="Server"
        value={loading ? 'checking…' : serverLine}
        hint={meta ? endpoint.shortLabel : undefined}
        accent={accent}
      />
      <Row label="Your IP" value={loading ? '…' : (meta?.ip || 'unknown')} />
      <Row
        label="ISP"
        value={loading ? '…' : (meta?.isp || 'unknown')}
        hint={meta?.asn || undefined}
      />
      {(meta?.city || meta?.country) && (
        <Row label="Location" value={[meta.city, meta.country].filter(Boolean).join(', ')} />
      )}
    </div>
  );
}
