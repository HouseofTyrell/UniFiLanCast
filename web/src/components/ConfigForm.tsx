import { useState, useEffect } from 'react';
import './ConfigForm.css';

interface ConfigData {
  adapters: {
    mock: {
      enabled: boolean;
      deviceCount: number;
    };
    siteManager: {
      enabled: boolean;
      apiKey: string;
      pollingInterval: number;
    };
    localNetwork: {
      enabled: boolean;
      baseUrl: string;
      username: string;
      password: string;
      pollingInterval: number;
      useProxyPrefix: boolean;
      verifySsl: boolean;
    };
  };
  server: {
    port: number;
    historyRetentionMinutes: number;
    logLevel: string;
  };
}

const DEFAULT_CONFIG: ConfigData = {
  adapters: {
    mock: {
      enabled: true,
      deviceCount: 30,
    },
    siteManager: {
      enabled: false,
      apiKey: '',
      pollingInterval: 15000,
    },
    localNetwork: {
      enabled: false,
      baseUrl: 'https://192.168.1.1',
      username: '',
      password: '',
      pollingInterval: 5000,
      useProxyPrefix: true,
      verifySsl: false,
    },
  },
  server: {
    port: 3001,
    historyRetentionMinutes: 60,
    logLevel: 'info',
  },
};

interface ConfigFormProps {
  onClose: () => void;
}

export function ConfigForm({ onClose }: ConfigFormProps) {
  const [config, setConfig] = useState<ConfigData>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Load existing config
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(() => {
        // If no config exists, use defaults
        setConfig(DEFAULT_CONFIG);
      });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Failed to save configuration (${response.status})`);
      }

      setMessage({ text: 'Configuration saved successfully! Restart the server to apply changes.', type: 'success' });
    } catch (error) {
      setMessage({ text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (path: string[], value: any) => {
    setConfig(prev => {
      const newConfig = JSON.parse(JSON.stringify(prev));
      let current = newConfig;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;
      return newConfig;
    });
  };

  return (
    <div className="config-overlay">
      <div className="config-modal">
        <div className="config-header">
          <h2>Configuration</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="config-content">
          {/* Mock Adapter */}
          <section className="config-section">
            <h3>Mock Adapter</h3>
            <p className="section-description">
              Testing mode with simulated devices. Perfect for demos or when you don't have UniFi hardware.
            </p>

            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={config.adapters.mock.enabled}
                onChange={(e) => updateConfig(['adapters', 'mock', 'enabled'], e.target.checked)}
              />
              <span>Enable Mock Adapter</span>
            </label>

            {config.adapters.mock.enabled && (
              <div className="config-field">
                <label>
                  Device Count
                  <span className="field-hint">Number of simulated devices</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={config.adapters.mock.deviceCount}
                  onChange={(e) => updateConfig(['adapters', 'mock', 'deviceCount'], parseInt(e.target.value))}
                />
              </div>
            )}
          </section>

          {/* Site Manager Adapter */}
          <section className="config-section">
            <h3>Site Manager API Adapter</h3>
            <p className="section-description">
              Official UniFi cloud API (read-only). Get your API key from{' '}
              <a href="https://account.ui.com" target="_blank" rel="noopener noreferrer">account.ui.com</a>
            </p>

            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={config.adapters.siteManager.enabled}
                onChange={(e) => updateConfig(['adapters', 'siteManager', 'enabled'], e.target.checked)}
              />
              <span>Enable Site Manager Adapter</span>
            </label>

            {config.adapters.siteManager.enabled && (
              <>
                <div className="config-field">
                  <label>
                    API Key
                    <span className="field-hint">Your Site Manager API key</span>
                  </label>
                  <input
                    type="password"
                    value={config.adapters.siteManager.apiKey}
                    onChange={(e) => updateConfig(['adapters', 'siteManager', 'apiKey'], e.target.value)}
                    placeholder="Enter API key"
                  />
                </div>

                <div className="config-field">
                  <label>
                    Polling Interval (ms)
                    <span className="field-hint">How often to fetch data (recommended: 15000ms)</span>
                  </label>
                  <input
                    type="number"
                    min="5000"
                    step="1000"
                    value={config.adapters.siteManager.pollingInterval}
                    onChange={(e) => updateConfig(['adapters', 'siteManager', 'pollingInterval'], parseInt(e.target.value))}
                  />
                </div>
              </>
            )}
          </section>

          {/* Local Network Adapter */}
          <section className="config-section">
            <h3>Local Network API Adapter</h3>
            <p className="section-description">
              Direct connection to your UniFi Network Application. Provides the most detailed data.
            </p>

            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={config.adapters.localNetwork.enabled}
                onChange={(e) => updateConfig(['adapters', 'localNetwork', 'enabled'], e.target.checked)}
              />
              <span>Enable Local Network Adapter</span>
            </label>

            {config.adapters.localNetwork.enabled && (
              <>
                <div className="config-field">
                  <label>
                    Base URL
                    <span className="field-hint">Your controller URL (e.g., https://192.168.1.1)</span>
                  </label>
                  <input
                    type="text"
                    value={config.adapters.localNetwork.baseUrl}
                    onChange={(e) => updateConfig(['adapters', 'localNetwork', 'baseUrl'], e.target.value)}
                    placeholder="https://192.168.1.1"
                  />
                </div>

                <div className="config-field">
                  <label>
                    Username
                    <span className="field-hint">Local admin username</span>
                  </label>
                  <input
                    type="text"
                    value={config.adapters.localNetwork.username}
                    onChange={(e) => updateConfig(['adapters', 'localNetwork', 'username'], e.target.value)}
                    placeholder="admin"
                    autoComplete="username"
                  />
                </div>

                <div className="config-field">
                  <label>
                    Password
                    <span className="field-hint">Local admin password</span>
                  </label>
                  <div className="password-field">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={config.adapters.localNetwork.password}
                      onChange={(e) => updateConfig(['adapters', 'localNetwork', 'password'], e.target.value)}
                      placeholder="Enter password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="toggle-password"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>

                <div className="config-field">
                  <label>
                    Polling Interval (ms)
                    <span className="field-hint">How often to fetch data (recommended: 5000ms)</span>
                  </label>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={config.adapters.localNetwork.pollingInterval}
                    onChange={(e) => updateConfig(['adapters', 'localNetwork', 'pollingInterval'], parseInt(e.target.value))}
                  />
                </div>

                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.adapters.localNetwork.useProxyPrefix}
                    onChange={(e) => updateConfig(['adapters', 'localNetwork', 'useProxyPrefix'], e.target.checked)}
                  />
                  <span>
                    Use Proxy Prefix
                    <span className="field-hint">Enable for UniFi OS consoles (UDM/UCG)</span>
                  </span>
                </label>

                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.adapters.localNetwork.verifySsl}
                    onChange={(e) => updateConfig(['adapters', 'localNetwork', 'verifySsl'], e.target.checked)}
                  />
                  <span>
                    Verify SSL
                    <span className="field-hint">Disable for self-signed certificates</span>
                  </span>
                </label>
              </>
            )}
          </section>

          {/* Server Settings */}
          <section className="config-section">
            <h3>Server Settings</h3>
            <p className="section-description">
              General server configuration options.
            </p>

            <div className="config-field">
              <label>
                Port
                <span className="field-hint">Server port (default: 3001)</span>
              </label>
              <input
                type="number"
                min="1"
                max="65535"
                value={config.server.port}
                onChange={(e) => updateConfig(['server', 'port'], parseInt(e.target.value))}
              />
            </div>

            <div className="config-field">
              <label>
                History Retention (minutes)
                <span className="field-hint">How long to keep history data in memory</span>
              </label>
              <input
                type="number"
                min="1"
                max="1440"
                value={config.server.historyRetentionMinutes}
                onChange={(e) => updateConfig(['server', 'historyRetentionMinutes'], parseInt(e.target.value))}
              />
            </div>

            <div className="config-field">
              <label>
                Log Level
                <span className="field-hint">Logging verbosity</span>
              </label>
              <select
                value={config.server.logLevel}
                onChange={(e) => updateConfig(['server', 'logLevel'], e.target.value)}
              >
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>
          </section>

          {/* Message display */}
          {message && (
            <div className={`config-message ${message.type}`}>
              {message.text}
            </div>
          )}
        </div>

        <div className="config-footer">
          <button className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button-primary"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}
