import { useEffect, useRef, useState } from 'react';
import { NetworkSnapshot, NetworkEvent } from '../types';

export interface WanPoint {
  t: number;
  down: number; // bits/sec
  up: number; // bits/sec
}

const MAX_WAN = 120; // ~10 min at 5s cadence
const MAX_EVENTS = 40;

/** Accumulate live WAN throughput history and a rolling event feed from snapshots. */
export function useRollingData(snapshot: NetworkSnapshot | null) {
  const [wanHistory, setWanHistory] = useState<WanPoint[]>([]);
  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const lastTs = useRef(0);
  const seen = useRef<Set<string>>(new Set());

  // Seed the feed from persisted events so it survives a page refresh; prime the
  // dedupe set so live SSE events don't re-add what we just loaded.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events?limit=${MAX_EVENTS}`)
      .then(r => (r.ok ? r.json() : []))
      .then((data: NetworkEvent[]) => {
        if (cancelled || !Array.isArray(data)) return;
        data.forEach(e => seen.current.add(`${e.ts}:${e.message}`));
        setEvents(prev => (prev.length ? prev : data.slice(0, MAX_EVENTS)));
      })
      .catch(() => {
        /* persisted events are best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!snapshot || snapshot.timestamp === lastTs.current) return;
    lastTs.current = snapshot.timestamp;

    const gw = snapshot.devices.find(d => d.type === 'gateway');
    setWanHistory(prev => {
      const next = [...prev, { t: snapshot.timestamp, down: gw?.rxBytes || 0, up: gw?.txBytes || 0 }];
      return next.length > MAX_WAN ? next.slice(next.length - MAX_WAN) : next;
    });

    const fresh = snapshot.events.filter(e => {
      const key = `${e.ts}:${e.message}`;
      if (seen.current.has(key)) return false;
      seen.current.add(key);
      return true;
    });
    // Bound the dedupe set — events older than the feed window can't reappear.
    if (seen.current.size > MAX_EVENTS * 8) {
      seen.current = new Set(Array.from(seen.current).slice(-MAX_EVENTS * 4));
    }
    if (fresh.length) {
      setEvents(prev => {
        const next = [...fresh.reverse(), ...prev];
        return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
      });
    }
  }, [snapshot]);

  return { wanHistory, events };
}
