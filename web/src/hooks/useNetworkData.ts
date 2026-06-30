import { useEffect, useState, useRef } from 'react';
import { NetworkSnapshot, HistorySample, AdapterStatus } from '../types';
import { reconnectDelay } from '../utils/backoff';

/** SSE connection state surfaced to the UI. */
export type ConnState = 'connecting' | 'live' | 'reconnecting';

// Treat the live data as stale if no snapshot has arrived in this long (the
// stream pushes one roughly every 5s).
const STALE_AFTER_MS = 15000;

export function useNetworkData() {
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [connState, setConnState] = useState<ConnState>('connecting');
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const lastSnapshotAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    // Connect to SSE stream
    const connectStream = () => {
      if (cancelled) return;
      // Close any prior connection before opening a new one.
      eventSourceRef.current?.close();
      const es = new EventSource('/api/stream');

      es.onopen = () => {
        attemptRef.current = 0; // reset backoff on a healthy connection
        setConnState('live');
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as NetworkSnapshot;
          lastSnapshotAtRef.current = Date.now();
          setStale(false);
          setSnapshot(data);
        } catch (err) {
          console.error('Failed to parse SSE data:', err);
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        setConnState('reconnecting');
        setError('Connection lost. Reconnecting…');
        es.close();

        // Reconnect with capped exponential backoff + jitter (tracked so
        // unmount can cancel it).
        const delay = reconnectDelay(attemptRef.current++);
        reconnectRef.current = setTimeout(connectStream, delay);
      };

      eventSourceRef.current = es;
    };

    connectStream();

    // Mark the feed stale if snapshots stop arriving while we think we're live.
    const staleInterval = setInterval(() => {
      if (lastSnapshotAtRef.current && Date.now() - lastSnapshotAtRef.current > STALE_AFTER_MS) {
        setStale(true);
      }
    }, 5000);

    // Fetch adapter status periodically. Tolerate transient blips (e.g. the dev
    // server restarting) without spamming errors: skip non-OK / empty bodies.
    const statusInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) return;
        const text = await response.text();
        if (!text) return;
        const data = JSON.parse(text);
        if (Array.isArray(data.adapters)) setAdapters(data.adapters);
      } catch {
        // Backend momentarily unavailable; next tick will recover.
      }
    }, 10000);

    return () => {
      cancelled = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      clearInterval(statusInterval);
      clearInterval(staleInterval);
    };
  }, []);

  const fetchHistory = async (minutes: number = 60) => {
    try {
      const response = await fetch(`/api/history?minutes=${minutes}`);
      if (!response.ok) return;
      const text = await response.text();
      if (!text) return;
      const data = JSON.parse(text);
      if (Array.isArray(data)) setHistory(data);
    } catch {
      // Transient; the user can retry from the UI.
    }
  };

  return {
    snapshot,
    history,
    adapters,
    connState,
    stale,
    isConnected: connState === 'live',
    error,
    fetchHistory,
  };
}
