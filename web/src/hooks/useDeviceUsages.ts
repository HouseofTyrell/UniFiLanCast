import { useEffect, useState } from 'react';

export type UsageMap = Record<string, { down: number; up: number }>;

/** Per-device data usage (bytes) over a window, refreshed periodically. */
export function useDeviceUsages(minutes: number): UsageMap {
  const [map, setMap] = useState<UsageMap>({});

  useEffect(() => {
    let cancelled = false;
    const fetchUsage = async () => {
      try {
        const res = await fetch(`/api/usage/devices?minutes=${minutes}`);
        if (!res.ok) return;
        const m = await res.json();
        if (!cancelled) setMap(m);
      } catch {
        /* transient */
      }
    };
    fetchUsage();
    const id = setInterval(fetchUsage, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [minutes]);

  return map;
}
