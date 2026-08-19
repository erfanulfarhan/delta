import { useEffect, useState } from 'react';
import { fetchMeta, type Meta } from '@speedtest/engine';
import { AVAILABLE, ENDPOINTS, type ModeId } from '../config';

/**
 * Connection details, fetched on load rather than after a test.
 *
 * Every speedtest shows you which server you are about to hit and what it
 * thinks your connection is before you press anything. Waiting until a result
 * exists means the one moment the information is useful for deciding whether to
 * trust the test is the one moment it is missing.
 */
export function useMeta(mode: ModeId): { meta: Meta | null; loading: boolean } {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!AVAILABLE[mode]) {
      setMeta(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchMeta(ENDPOINTS[mode].baseUrl.replace(/\/$/, '')).then((m) => {
      if (!alive) return;
      setMeta(m);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [mode]);

  return { meta, loading };
}
