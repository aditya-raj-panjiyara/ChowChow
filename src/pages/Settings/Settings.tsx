import { useState } from 'react';
import LlmProviderSection from './LlmProviderSection';
import StorageSection from './StorageSection';
import ResetSection from './ResetSection';
import type { LlmProvider } from '../../types';

/**
 * Settings page — model config, storage paths, sovereignty settings.
 * Minimal for MVP: model + storage path + reset.
 */
export default function Settings() {
  const [provider, setProvider] = useState<LlmProvider>('local');
  const [ollamaModel, setOllamaModel] = useState('gemma4');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [storagePath, setStoragePath] = useState('~/sovereign-engine/data');

  return (
    <div className="settings-page">
      <h2 className="font-display text-heading" style={{ marginBottom: 'var(--space-xl)' }}>
        Settings
      </h2>

      <LlmProviderSection
        provider={provider}
        ollamaModel={ollamaModel}
        cloudApiKey={cloudApiKey}
        onProviderChange={setProvider}
        onModelChange={setOllamaModel}
        onApiKeyChange={setCloudApiKey}
      />

      <StorageSection
        storagePath={storagePath}
        onPathChange={setStoragePath}
      />

      <ResetSection />
    </div>
  );
}
