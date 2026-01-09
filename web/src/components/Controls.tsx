import { useState } from 'react';
import { Filter, AdapterStatus } from '../types';
import './Controls.css';

interface ControlsProps {
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  adapters: AdapterStatus[];
  isConnected: boolean;
  error: string | null;
}

export function Controls({
  filter,
  onFilterChange,
  adapters,
  isConnected,
  error,
}: ControlsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="controls">
      <div className="controls-header">
        <h1>Network Weather Map</h1>
        <button
          className="controls-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? '▼' : '▲'}
        </button>
      </div>

      {isExpanded && (
        <div className="controls-content">
          {/* Connection Status */}
          <div className="status-section">
            <h3>Connection Status</h3>
            <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '● Connected' : '○ Disconnected'}
            </div>
            {error && <div className="error-message">{error}</div>}
          </div>

          {/* Adapter Status */}
          <div className="adapter-section">
            <h3>Data Sources</h3>
            {adapters.map(adapter => (
              <div key={adapter.name} className="adapter-status">
                <div className="adapter-name">
                  {adapter.name}
                  <span
                    className={`adapter-indicator ${adapter.connected ? 'active' : 'inactive'}`}
                  >
                    {adapter.connected ? '●' : '○'}
                  </span>
                </div>
                <div className="adapter-info">
                  Devices: {adapter.deviceCount}
                  {adapter.error && (
                    <div className="adapter-error">{adapter.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="search-section">
            <h3>Search</h3>
            <input
              type="text"
              className="search-input"
              placeholder="Search by name, IP, or MAC..."
              value={filter.search}
              onChange={e =>
                onFilterChange({ ...filter, search: e.target.value })
              }
            />
          </div>

          {/* Filters */}
          <div className="filter-section">
            <h3>Filters</h3>
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={filter.wiredOnly}
                onChange={e =>
                  onFilterChange({
                    ...filter,
                    wiredOnly: e.target.checked,
                    wifiOnly: false,
                  })
                }
              />
              <span>Wired Only</span>
            </label>
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={filter.wifiOnly}
                onChange={e =>
                  onFilterChange({
                    ...filter,
                    wifiOnly: e.target.checked,
                    wiredOnly: false,
                  })
                }
              />
              <span>WiFi Only</span>
            </label>
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={filter.issuesOnly}
                onChange={e =>
                  onFilterChange({ ...filter, issuesOnly: e.target.checked })
                }
              />
              <span>Issues Only</span>
            </label>
          </div>

          {/* Legend */}
          <div className="legend-section">
            <h3>Legend</h3>
            <div className="legend-items">
              <div className="legend-item">
                <span className="legend-icon gateway">⊙</span>
                <span>Gateway</span>
              </div>
              <div className="legend-item">
                <span className="legend-icon switch">⧉</span>
                <span>Switch</span>
              </div>
              <div className="legend-item">
                <span className="legend-icon ap">📡</span>
                <span>Access Point</span>
              </div>
              <div className="legend-item">
                <span className="legend-icon client">●</span>
                <span>Client</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
