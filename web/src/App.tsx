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
import { useDeviceUsages } from './hooks/useDeviceUsages';
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
  // Global usage window — drives the panels AND the node sizing.
  const [windowMinutes, setWindowMinutes] = useState(60);
  const deviceUsage = useDeviceUsages(windowMinutes);

  const handleSnapshotChange = useCallback((historySample: any) => {
    setPlaybackSnapshot(historySample);
  }, []);

  // Use playback snapshot if available, otherwise use live snapshot
  const displaySnapshot = playbackSnapshot || snapshot;
  const selectedDevice =
    (selectedId && displaySnapshot?.devices.find(d => d.id === selectedId)) || null;

  // Rolling history accumulated from the live stream (not playback).
  const { wanHistory, events } = useRollingData(snapshot);

  // Make simulated data unmistakable: the mock adapter is only ever active when
  // explicitly enabled, but if it is, say so loudly.
  const simulated = adapters.some(a => a.name === 'mock' && a.connected);

  return (
    <div className="app">
      {simulated && (
        <div className="sim-banner" role="status">
          ⚠ SIMULATED DATA — the mock adapter is active; this is not your real network.
        </div>
      )}
      <Header
        snapshot={displaySnapshot}
        isConnected={isConnected}
        site={adapters.find(a => a.site)?.site}
      />

      <div className="layout">
        <aside className="rail rail-left">
          {selectedDevice ? (
            <DeviceDetail
              device={selectedDevice}
              onClose={() => setSelectedId(null)}
              minutes={windowMinutes}
              onMinutesChange={setWindowMinutes}
            />
          ) : (
            <WanChart data={wanHistory} minutes={windowMinutes} onMinutesChange={setWindowMinutes} />
          )}
          <Events events={events} />
          <TopTalkers snapshot={displaySnapshot} onSelect={setSelectedId} />
        </aside>

        <main className="stage">
          <NetworkCanvas
            snapshot={displaySnapshot}
            filter={filter}
            selectedId={selectedId}
            onSelect={setSelectedId}
            colorMode={colorMode}
            usageMap={deviceUsage}
          />
          <TimePlayback
            history={history}
            onFetchHistory={fetchHistory}
            onSnapshotChange={handleSnapshotChange}
          />
        </main>

        <aside className="rail rail-right">
          <Controls
            filter={filter}
            onFilterChange={setFilter}
            adapters={adapters}
            isConnected={isConnected}
            error={error}
            onConfigClick={() => setShowConfig(true)}
          />
          <Segments snapshot={displaySnapshot} />
          <Legend
            snapshot={displaySnapshot}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
          />
        </aside>
      </div>

      {showConfig && <ConfigForm onClose={() => setShowConfig(false)} />}
    </div>
  );
}

export default App;
