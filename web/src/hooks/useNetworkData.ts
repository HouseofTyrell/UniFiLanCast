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

    // Fetch adapter status periodically
    const statusInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/status');
        const data = await response.json();
        setAdapters(data.adapters);
      } catch (err) {
        console.error('Failed to fetch adapter status:', err);
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
      const data = await response.json();
      setHistory(data);
    } catch (err) {
      console.error('Failed to fetch history:', err);
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
