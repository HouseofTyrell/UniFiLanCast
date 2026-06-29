import { useEffect, useState, useRef } from 'react';
import { NetworkSnapshot, HistorySample, AdapterStatus } from '../types';

export function useNetworkData() {
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Connect to SSE stream
    const connectStream = () => {
      const es = new EventSource('/api/stream');

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as NetworkSnapshot;
          setSnapshot(data);
        } catch (err) {
          console.error('Failed to parse SSE data:', err);
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        setError('Connection lost. Reconnecting...');
        es.close();

        // Reconnect after 5 seconds
        setTimeout(connectStream, 5000);
      };

      eventSourceRef.current = es;
    };

    connectStream();

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
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      clearInterval(statusInterval);
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
    isConnected,
    error,
    fetchHistory,
  };
}
