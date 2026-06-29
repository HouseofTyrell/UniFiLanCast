import { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { NetworkCanvas } from './components/NetworkCanvas';
import { Controls } from './components/Controls';
import { TimePlayback } from './components/TimePlayback';
import { ConfigForm } from './components/ConfigForm';
import { TopTalkers } from './components/TopTalkers';
import { Legend } from './components/Legend';
import { DeviceDetail } from './components/DeviceDetail';
import { WanChart } from './components/WanChart';
import { Segments } from './components/Segments';
import { Events } from './components/Events';
import { useNetworkData } from './hooks/useNetworkData';
import { useRollingData } from './hooks/useRollingData';
import { Filter, NetworkSnapshot } from './types';
import { ColorMode } from './utils/vlan';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('type');

  const handleSnapshotChange = useCallback((historySample: any) => {
    setPlaybackSnapshot(historySample);
  }, []);

  // Use playback snapshot if available, otherwise use live snapshot
  const displaySnapshot = playbackSnapshot || snapshot;
  const selectedDevice =
    (selectedId && displaySnapshot?.devices.find(d => d.id === selectedId)) || null;

  // Rolling history accumulated from the live stream (not playback).
  const { wanHistory, events } = useRollingData(snapshot);

  return (
    <div className="app">
      <Header snapshot={displaySnapshot} isConnected={isConnected} />

      <NetworkCanvas
        snapshot={displaySnapshot}
        filter={filter}
        selectedId={selectedId}
        onSelect={setSelectedId}
        colorMode={colorMode}
      />

      {/* Left column */}
      {!selectedDevice && <WanChart data={wanHistory} />}
      <Events events={events} />
      <TopTalkers snapshot={displaySnapshot} onSelect={setSelectedId} />
      <DeviceDetail device={selectedDevice} onClose={() => setSelectedId(null)} />

      {/* Right column */}
      <Segments snapshot={displaySnapshot} />
      <Legend
        snapshot={displaySnapshot}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
      />

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
