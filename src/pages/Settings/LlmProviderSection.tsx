import type { LlmProvider } from '../../types';

interface LlmProviderSectionProps {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  endpoint: string;
  systemArch: string;
  onProviderChange: (provider: LlmProvider) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (key: string) => void;
  onEndpointChange: (endpoint: string) => void;
}

export default function LlmProviderSection({
  provider,
  model,
  apiKey,
  endpoint,
  systemArch,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onEndpointChange,
}: LlmProviderSectionProps) {
  const isAppleSilicon = systemArch === 'aarch64' || systemArch === 'arm64';

  // Recommendations based on CPU architecture
  const localModels = isAppleSilicon
    ? [
        { value: 'llama3.1:8b', label: 'llama3.1:8b (Recommended - Apple Silicon Optimal)' },
        { value: 'qwen2.5:7b', label: 'qwen2.5:7b (Excellent balance)' },
        { value: 'mistral:7b', label: 'mistral:7b (Good generalist)' },
        { value: 'llama3.2:3b', label: 'llama3.2:3b (Ultra-fast, lightweight)' },
        { value: 'gemma2:2b', label: 'gemma2:2b (Very lightweight)' },
        { value: 'llama3.1:70b', label: 'llama3.1:70b (Heavyweight - requires 32GB+ RAM)' },
      ]
    : [
        { value: 'llama3.2:3b', label: 'llama3.2:3b (Recommended - Intel/PC Fast)' },
        { value: 'gemma2:2b', label: 'gemma2:2b (Recommended - Very lightweight)' },
        { value: 'phi3:3.8b', label: 'phi3:3.8b (Good fast alternative)' },
        { value: 'qwen2.5:3b', label: 'qwen2.5:3b (Excellent small model)' },
        { value: 'llama3.1:8b', label: 'llama3.1:8b (Medium - slower on Intel without GPU)' },
        { value: 'mixtral:8x7b', label: 'mixtral:8x7b (Heavyweight - requires 32GB+ RAM)' },
      ];

  const openaiModels = [
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini (Recommended - Fast & cost-effective)' },
    { value: 'gpt-4o', label: 'gpt-4o (High reasoning)' },
    { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
  ];

  const geminiModels = [
    { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash (Recommended - Instant replies)' },
    { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro (High intelligence)' },
    { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash (Next-gen)' },
  ];

  const groqModels = [
    { value: 'llama-3.1-70b-versatile', label: 'llama-3.1-70b-versatile (Recommended)' },
    { value: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant (Sub-second response)' },
    { value: 'mixtral-8x7b-32768', label: 'mixtral-8x7b-32768' },
  ];

  const anthropicModels = [
    { value: 'claude-3-5-sonnet-latest', label: 'claude-3-5-sonnet-latest (Recommended)' },
    { value: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest (Fast)' },
    { value: 'claude-3-opus-latest', label: 'claude-3-opus-latest (High intelligence)' },
  ];

  const showApiKey = provider !== 'local';
  const showEndpoint = provider === 'custom' || provider === 'local';

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">LLM Provider</h3>

      {/* Sovereignty / Environment badge */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        {provider === 'local' ? (
          <span className="sovereignty-badge sovereignty-badge--local">
            <span>●</span> Running fully local (Sovereign)
          </span>
        ) : (
          <span className="sovereignty-badge sovereignty-badge--external">
            <span>●</span> Using external API ({provider.toUpperCase()})
          </span>
        )}
        <span style={{ marginLeft: 12, fontSize: 11, color: 'var(--text-muted)' }}>
          System Architecture: <span style={{ fontFamily: 'monospace', color: 'var(--accent-cool)' }}>{systemArch}</span> {isAppleSilicon ? '(Apple Silicon)' : ''}
        </span>
      </div>

      {/* Provider Selector Buttons */}
      <div className="settings-field">
        <label className="settings-field__label">Select Provider</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
          {(['local', 'gemini', 'openai', 'anthropic', 'groq', 'custom'] as LlmProvider[]).map((p) => {
            const labels: Record<LlmProvider, string> = {
              local: 'Local (Ollama)',
              gemini: 'Google Gemini',
              openai: 'OpenAI',
              anthropic: 'Anthropic Claude',
              groq: 'Groq',
              custom: 'Custom OpenAI-Compatible',
            };
            return (
              <button
                key={p}
                className={`btn ${provider === p ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => onProviderChange(p)}
                style={{ fontSize: 12, padding: '8px 14px' }}
              >
                {labels[p]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom endpoint input */}
      {showEndpoint && (
        <div className="settings-field">
          <label className="settings-field__label">
            {provider === 'local' ? 'Ollama Endpoint URL' : 'Base Endpoint URL'}
          </label>
          <input
            className="settings-field__input"
            type="text"
            value={endpoint}
            onChange={(e) => onEndpointChange(e.target.value)}
            placeholder={provider === 'local' ? 'http://localhost:11434/v1' : 'https://api.example.com/v1'}
          />
        </div>
      )}

      {/* API Key input */}
      {showApiKey && (
        <div className="settings-field">
          <label className="settings-field__label">API Key</label>
          <input
            className="settings-field__input"
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={`Enter your ${provider.toUpperCase()} API key...`}
          />
        </div>
      )}

      {/* Model Selector */}
      <div className="settings-field">
        <label className="settings-field__label">Model Selection</label>
        {provider === 'custom' ? (
          <input
            className="settings-field__input"
            type="text"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="Type custom model name (e.g. mistral-large)..."
          />
        ) : (
          <select
            className="settings-field__select"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {provider === 'local' &&
              localModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            {provider === 'openai' &&
              openaiModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            {provider === 'gemini' &&
              geminiModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            {provider === 'groq' &&
              groqModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            {provider === 'anthropic' &&
              anthropicModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
          </select>
        )}
      </div>
    </div>
  );
}
