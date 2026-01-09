import { useState, useCallback } from 'react';
import { NetworkCanvas } from './components/NetworkCanvas';
import { Controls } from './components/Controls';
import { TimePlayback } from './components/TimePlayback';
import { useNetworkData } from './hooks/useNetworkData';
import { Filter, NetworkSnapshot } from './types';
import './App.css';

function App() {
  const { snapshot, history, adapters, isConnected, error, fetchHistory } = useNetworkData();

  const [filter, setFilter] = useState<Filter>({
    wiredOnly: false,
    wifiOnly: false,
    issuesOnly: false,
    search: '',
  });

  const [playbackSnapshot, setPlaybackSnapshot] = useState<NetworkSnapshot | null>(null);

  const handleSnapshotChange = useCallback((historySample: any) => {
    setPlaybackSnapshot(historySample);
  }, []);

  // Use playback snapshot if available, otherwise use live snapshot
  const displaySnapshot = playbackSnapshot || snapshot;

  return (
    <div className="app">
      <NetworkCanvas snapshot={displaySnapshot} filter={filter} />

      <Controls
        filter={filter}
        onFilterChange={setFilter}
        adapters={adapters}
        isConnected={isConnected}
        error={error}
      />

      <TimePlayback
        history={history}
        onFetchHistory={fetchHistory}
        onSnapshotChange={handleSnapshotChange}
      />
    </div>
  );
}

export default App;
