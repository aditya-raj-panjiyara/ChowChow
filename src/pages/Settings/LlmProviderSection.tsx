interface LlmProviderSectionProps {
  provider: 'local' | 'cloud';
  ollamaModel: string;
  cloudApiKey: string;
  onProviderChange: (provider: 'local' | 'cloud') => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (key: string) => void;
}

const OLLAMA_MODELS = [
  'gemma4',
  'llama3.1:8b',
  'llama3.1:70b',
  'mistral:7b',
  'mixtral:8x7b',
  'qwen2:7b',
  'phi3:14b',
];

/**
 * LlmProviderSection — model selector with sovereignty indicator.
 * Clear visual distinction between local and cloud deployment.
 * This should never be ambiguous given the product's core promise.
 */
export default function LlmProviderSection({
  provider, ollamaModel, cloudApiKey,
  onProviderChange, onModelChange, onApiKeyChange,
}: LlmProviderSectionProps) {
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">LLM Provider</h3>

      {/* Sovereignty badge */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        {provider === 'local' ? (
          <span className="sovereignty-badge sovereignty-badge--local">
            <span>●</span> Running fully local
          </span>
        ) : (
          <span className="sovereignty-badge sovereignty-badge--external">
            <span>●</span> Using external API
          </span>
        )}
      </div>

      {/* Provider toggle */}
      <div className="settings-field">
        <label className="settings-field__label">Provider</label>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button
            className={`btn ${provider === 'local' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => onProviderChange('local')}
          >
            Local (Ollama)
          </button>
          <button
            className={`btn ${provider === 'cloud' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => onProviderChange('cloud')}
          >
            Cloud API
          </button>
        </div>
      </div>

      {provider === 'local' ? (
        <div className="settings-field">
          <label className="settings-field__label">Ollama Model</label>
          <select
            className="settings-field__select"
            value={ollamaModel}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {OLLAMA_MODELS.map(model => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="settings-field">
          <label className="settings-field__label">API Key</label>
          <input
            className="settings-field__input"
            type="password"
            value={cloudApiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="Enter your API key..."
          />
        </div>
      )}
    </div>
  );
}
