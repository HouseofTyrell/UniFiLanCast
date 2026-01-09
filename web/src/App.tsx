import { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { NetworkCanvas } from './components/NetworkCanvas';
import { Controls } from './components/Controls';
import { TimePlayback } from './components/TimePlayback';
import { ConfigForm } from './components/ConfigForm';
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
  const [showConfig, setShowConfig] = useState(false);

  const handleSnapshotChange = useCallback((historySample: any) => {
    setPlaybackSnapshot(historySample);
  }, []);

  // Use playback snapshot if available, otherwise use live snapshot
  const displaySnapshot = playbackSnapshot || snapshot;

  return (
    <div className="app">
      <Header />

      <NetworkCanvas snapshot={displaySnapshot} filter={filter} />

      <Controls
        filter={filter}
        onFilterChange={setFilter}
        adapters={adapters}
        isConnected={isConnected}
        error={error}
        onConfigClick={() => setShowConfig(true)}
      />

      <TimePlayback
        history={history}
        onFetchHistory={fetchHistory}
        onSnapshotChange={handleSnapshotChange}
      />

      {showConfig && <ConfigForm onClose={() => setShowConfig(false)} />}
    </div>
  );
}

export default App;
