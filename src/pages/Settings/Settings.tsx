import { useState, useEffect } from 'react';
import LlmProviderSection from './LlmProviderSection';
import StorageSection from './StorageSection';
import ResetSection from './ResetSection';
import type { LlmProvider, AppSettings } from '../../types';
import { getSettings, saveSettings, getSystemInfo } from '../../lib/tauri';

export default function Settings() {
  const [provider, setProvider] = useState<LlmProvider>('local');
  const [model, setModel] = useState('gemma4');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('http://localhost:11434/v1');
  const [storagePath, setStoragePath] = useState('~/sovereign-engine/data');
  const [systemArch, setSystemArch] = useState('unknown');

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Load settings and system info on mount
  useEffect(() => {
    async function loadData() {
      try {
        const current = await getSettings();
        setProvider(current.llm.provider);
        setModel(current.llm.model);
        setApiKey(current.llm.api_key);
        setEndpoint(current.llm.endpoint);
        setStoragePath(current.storage_path);
      } catch (err) {
        console.error('Failed to load settings from Tauri', err);
      }

      try {
        const sys = await getSystemInfo();
        setSystemArch(sys.arch);
      } catch (err) {
        console.error('Failed to load system info', err);
      }
    }
    loadData();
  }, []);

  const handleSave = async () => {
    setSaveStatus('saving');
    setErrorMsg('');

    const newSettings: AppSettings = {
      llm: {
        provider,
        model,
        api_key: apiKey,
        endpoint,
      },
      storage_path: storagePath,
    };

    try {
      await saveSettings(newSettings);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      setSaveStatus('error');
      setErrorMsg(String(err));
    }
  };

  return (
    <div className="settings-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
        <h2 className="font-display text-heading" style={{ margin: 0 }}>
          Settings
        </h2>

        {/* Save button & status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saveStatus === 'saved' && (
            <span style={{ fontSize: 12, color: 'var(--signal-green)', background: 'rgba(46,204,113,0.1)', padding: '6px 12px', borderRadius: 'var(--radius-sm)' }}>
              ✓ Settings saved and hot-swapped!
            </span>
          )}
          {saveStatus === 'error' && (
            <span style={{ fontSize: 12, color: 'var(--signal-red)', background: 'rgba(231,76,60,0.1)', padding: '6px 12px', borderRadius: 'var(--radius-sm)' }} title={errorMsg}>
              ⚠ Save failed: {errorMsg.substring(0, 40)}...
            </span>
          )}
          <button
            className={`btn btn--primary ${saveStatus === 'saving' ? 'loading' : ''}`}
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      <LlmProviderSection
        provider={provider}
        model={model}
        apiKey={apiKey}
        endpoint={endpoint}
        systemArch={systemArch}
        onProviderChange={(p) => {
          setProvider(p);
          // Set default model on provider change
          if (p === 'openai') setModel('gpt-4o-mini');
          else if (p === 'gemini') setModel('gemini-1.5-flash');
          else if (p === 'groq') setModel('llama-3.1-70b-versatile');
          else if (p === 'anthropic') setModel('claude-3-5-sonnet-latest');
          else if (p === 'local') setModel(systemArch === 'aarch64' ? 'llama3.1:8b' : 'llama3.2:3b');
        }}
        onModelChange={setModel}
        onApiKeyChange={setApiKey}
        onEndpointChange={setEndpoint}
      />

      <StorageSection
        storagePath={storagePath}
        onPathChange={setStoragePath}
      />

      <ResetSection />
    </div>
  );
}
