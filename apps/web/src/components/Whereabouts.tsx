import type { Meta } from '@speedtest/engine';
import { ENDPOINTS, rawServer, type ModeId } from '../config';

/** Cloudflare airport codes worth naming; anything else shows the raw code. */
const COLO_NAMES: Record<string, string> = {
  DAC: 'Dhaka',
  CGP: 'Chittagong',
  CCU: 'Kolkata',
  DEL: 'Delhi',
  BOM: 'Mumbai',
  MAA: 'Chennai',
  SIN: 'Singapore',
  KUL: 'Kuala Lumpur',
  HKG: 'Hong Kong',
  // Where one Bangladeshi ISP routed half of Cloudflare's addresses.
  MRS: 'Marseille',
};

interface Props {
  meta: Meta | null;
  loading: boolean;
  mode: ModeId;
  rawServerId: string;
}

/**
 * Which server, and what it sees of you, shown before anything is pressed.
 *
 * Every speedtest shows this up front: the one moment it helps you decide
 * whether to trust the test is before you run it.
 */
export function Whereabouts({ meta, loading, mode, rawServerId }: Props) {
  const server = (() => {
    if (mode === 'raw') {
      const s = rawServer(rawServerId);
      return `M-Lab ${s.city} (${s.id})`;
    }
    if (!meta) return ENDPOINTS.bdix.label;
    const colo = meta.colo;
    if (!colo) return meta.server;
    return COLO_NAMES[colo] ? `${COLO_NAMES[colo]} (${colo})` : colo;
  })();

  const you = loading && !meta ? 'Finding your connection…' : [meta?.isp, meta?.asn, meta?.ip].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[13.5px]">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 10px rgba(var(--glow), 0.9)' }} />
        <span className="font-medium text-[var(--text)]">{server}</span>
        <span className="text-[var(--faint)]">· {ENDPOINTS[mode].shortLabel}</span>
      </div>
      {you && <span className="mono truncate text-[11.5px] text-[var(--faint)]">{you}</span>}
    </div>
  );
}
