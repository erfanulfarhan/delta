import { useEffect, useState } from 'react';
import { nearestOrigins, type Meta } from '@speedtest/engine';
import { AVAILABLE, LOCAL_FALLBACK, LOCAL_ORIGINS } from '../config';

/**
 * Connection details, fetched on load rather than after a test.
 *
 * Every speedtest shows you which server you are about to hit and what it
 * thinks your connection is before you press anything. Waiting until a result
 * exists means the one moment the information is useful for deciding whether to
 * trust the test is the one moment it is missing.
 *
 * Always read from the Local endpoint, whichever mode is selected. Cloudflare
 * knows the visitor's ISP, ASN and city for free; M-Lab reports only an
 * address, and only once a test has run.
 *
 * Read the way a Local run chooses its hostnames, so the server shown is the
 * PoP the test goes on to measure, not wherever the first hostname landed.
 */
export function useMeta(): { meta: Meta | null; loading: boolean } {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!AVAILABLE.bdix) {
      setLoading(false);
      return;
    }
    let alive = true;
    nearestOrigins(LOCAL_ORIGINS, LOCAL_FALLBACK).then((choice) => {
      if (!alive) return;
      setMeta(choice.meta);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { meta, loading };
}
