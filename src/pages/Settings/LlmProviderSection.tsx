import { useState, useEffect } from 'react';
import type { LlmProvider } from '../../types';
import { getOllamaModels } from '../../lib/tauri';
import type { OllamaModel } from '../../lib/tauri';

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

  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [isLoadingOllama, setIsLoadingOllama] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  // Recommendations based on CPU architecture
  const localModels = isAppleSilicon
    ? [
      { value: 'llama3.1:8b', label: 'llama3.1:8b (Recommended - Apple Silicon Optimal)' },
      { value: 'qwen2.5:7b', label: 'qwen2.5:7b (Excellent balance)' },
      { value: 'mistral:7b', label: 'mistral:7b (Good generalist)' },
      { value: 'llama3.2:3b', label: 'llama3.2:3b (Ultra-fast, lightweight)' },
      { value: 'gemma2:2b', label: 'gemma2:2b (Very lightweight)' },
      { value: 'llama3.1:70b', label: 'llama3.1:70b (Heavyweight - requires 32GB+ RAM)' },
      { value: 'gemma4', label: 'gemma4 (Recommended - Instant replies)' },
    ]
    : [
      { value: 'llama3.2:3b', label: 'llama3.2:3b (Recommended - Intel/PC Fast)' },
      { value: 'gemma2:2b', label: 'gemma2:2b (Recommended - Very lightweight)' },
      { value: 'phi3:3.8b', label: 'phi3:3.8b (Good fast alternative)' },
      { value: 'qwen2.5:3b', label: 'qwen2.5:3b (Excellent small model)' },
      { value: 'llama3.1:8b', label: 'llama3.1:8b (Medium - slower on Intel without GPU)' },
      { value: 'mixtral:8x7b', label: 'mixtral:8x7b (Heavyweight - requires 32GB+ RAM)' },
      { value: 'gemma4', label: 'gemma4 (Recommended - Instant replies)' },
    ];

  const openaiModels = [
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini (Recommended - Fast & cost-effective)' },
    { value: 'gpt-4o', label: 'gpt-4o (High reasoning)' },
    { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
  ];

  const geminiModels = [
    { value: 'gemini-3.5-flash', label: 'gemini-3.5-flash (Recommended — latest stable, agentic)' },
    { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (Fast & low-cost bulk)' },
    { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Gemini 3 Flash preview)' },
    { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Highest intelligence)' },
    { value: 'gemini-flash-latest', label: 'gemini-flash-latest (Always points at latest Flash)' },
    { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro (Deep reasoning)' },
  ];

  const groqModels = [
    { value: 'llama-3.1-70b-versatile', label: 'llama-3.1-70b-versatile (Recommended)' },
    { value: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant (Sub-second response)' },
    { value: 'mixtral-8x7b-32768', label: 'mixtral-8x7b-32768' },
  ];

  const anthropicModels = [
    { value: 'claude-sonnet-5', label: 'claude-sonnet-5 (Recommended)' },
    { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5 (Fast — best for bulk ingestion)' },
    { value: 'claude-opus-4-8', label: 'claude-opus-4-8 (Most capable)' },
  ];

  // Fetch local Ollama models
  useEffect(() => {
    if (provider !== 'local') return;

    let active = true;
    async function fetchModels() {
      setIsLoadingOllama(true);
      setOllamaError(null);
      try {
        const models = await getOllamaModels(endpoint);
        if (active) {
          setOllamaModels(models);
        }
      } catch (err) {
        if (active) {
          setOllamaError(String(err));
          setOllamaModels([]);
        }
      } finally {
        if (active) {
          setIsLoadingOllama(false);
        }
      }
    }

    fetchModels();
    return () => {
      active = false;
    };
  }, [provider, endpoint]);

  const getCompatibilityInfo = (mName: string, paramSize?: string, capabilities?: string[]) => {
    const name = mName.toLowerCase();
    const isEmbedding =
      name.includes('embed') ||
      name.includes('mxbai') ||
      name.includes('nomic') ||
      name.includes('bge') ||
      name.includes('colbert');

    if (isEmbedding) {
      return {
        status: 'Incompatible',
        reason: 'Embedding-only model (not suitable for text generation/reasoning)',
        badgeStyle: { background: 'rgba(231,76,60,0.12)', color: 'var(--signal-red)' },
        isOk: false,
      };
    }

    let params = 0;
    if (paramSize) {
      params = parseFloat(paramSize);
    } else {
      const matches = name.match(/(\d+(?:\.\d+)?)(b|m)/);
      if (matches) {
        params = parseFloat(matches[1]);
      }
    }

    const hasTools = capabilities?.includes('tools') || false;

    if (params >= 7) {
      if (hasTools) {
        return {
          status: 'Highly Compatible',
          reason: `Excellent parameter size (${paramSize || params + 'B'}) with native tool support. Perfect for structured extraction.`,
          badgeStyle: { background: 'rgba(95,168,138,0.15)', color: 'var(--signal-green)' },
          isOk: true,
        };
      }
      return {
        status: 'Compatible',
        reason: `Good parameter size (${paramSize || params + 'B'}). May have occasional extraction errors without native tool support.`,
        badgeStyle: { background: 'rgba(52,152,219,0.15)', color: 'var(--accent-cool)' },
        isOk: true,
      };
    } else if (params >= 2) {
      return {
        status: 'Compatible (Lightweight)',
        reason: `Lightweight size (${paramSize || params + 'B'}). Fast responses, but structured extraction might be less precise.`,
        badgeStyle: { background: 'rgba(230,126,34,0.15)', color: 'var(--signal-amber)' },
        isOk: true,
      };
    } else {
      return {
        status: 'Low Compatibility',
        reason: `Model is very small (${paramSize || 'unknown'}). Structured JSON generation is highly likely to fail.`,
        badgeStyle: { background: 'rgba(231,76,60,0.12)', color: 'var(--signal-red)' },
        isOk: false,
      };
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Find matching model to bind to select element
  const getSelectValue = () => {
    if (provider !== 'local' || ollamaModels.length === 0) return model;
    const match = ollamaModels.find(
      m => m.model === model || m.name === model || (model.indexOf(':') === -1 && m.model === `${model}:latest`)
    );
    return match ? match.model : model;
  };

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
            value={getSelectValue()}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {provider === 'local' && (
              <>
                {ollamaModels.length > 0 ? (
                  <>
                    {!ollamaModels.some(m => m.model === model || m.name === model || (model.indexOf(':') === -1 && m.model === `${model}:latest`)) && (
                      <option value={model}>
                        {model} (Installed model not found - Default)
                      </option>
                    )}
                    {ollamaModels.map((m) => {
                      const compat = getCompatibilityInfo(m.name, m.details?.parameter_size, m.capabilities);
                      return (
                        <option key={m.model} value={m.model}>
                          {m.name} ({compat.status})
                        </option>
                      );
                    })}
                  </>
                ) : (
                  localModels.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))
                )}
              </>
            )}
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

      {/* Ollama Inventory and Compatibility Panel */}
      {provider === 'local' && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          {isLoadingOllama && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              ⚡ Querying Ollama endpoint for downloaded models...
            </div>
          )}

          {ollamaError && (
            <div style={{
              background: 'rgba(231,76,60,0.04)',
              border: '1px solid rgba(231,76,60,0.15)',
              borderRadius: 'var(--radius-md)',
              padding: '12px var(--space-md)',
              fontSize: 12,
              color: 'var(--text-primary)',
              marginBottom: 'var(--space-md)'
            }}>
              <div style={{ fontWeight: 600, color: 'var(--signal-red)', marginBottom: 4 }}>
                ⚠️ Could not connect to local Ollama
              </div>
              <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Make sure Ollama is running at <code style={{ color: 'var(--accent-cool)' }}>{endpoint}</code> or check your Ollama endpoint URL.
              </p>
            </div>
          )}

          {ollamaModels.length > 0 ? (
            <div style={{
              background: 'rgba(255,255,255,0.01)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-md)',
              fontSize: 13
            }}>
              <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                Local Model Inventory ({ollamaModels.length} installed)
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                {ollamaModels.map((m) => {
                  const compat = getCompatibilityInfo(m.name, m.details?.parameter_size, m.capabilities);
                  const isSelected = m.model === model || m.name === model || 
                    (model.indexOf(':') === -1 && m.model === `${model}:latest`) || 
                    (m.model.indexOf(':') === -1 && model === `${m.model}:latest`);
                  return (
                    <div
                      key={m.digest}
                      onClick={() => onModelChange(m.model)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        background: isSelected ? 'rgba(52, 152, 219, 0.05)' : 'transparent',
                        border: `1px solid ${isSelected ? 'var(--accent-cool)' : 'var(--border-hairline)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: isSelected ? 600 : 500, color: isSelected ? 'var(--accent-cool)' : 'var(--text-primary)' }}>
                          {m.name} {isSelected && '✓'}
                        </span>
                        <span style={{
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                          fontWeight: 600,
                          ...compat.badgeStyle
                        }}>
                          {compat.status}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                        <span>Size: {formatBytes(m.size)}</span>
                        {m.details?.parameter_size && <span>Params: {m.details.parameter_size}</span>}
                        {m.details?.quantization_level && <span>Quant: {m.details.quantization_level}</span>}
                        {m.capabilities && m.capabilities.length > 0 && (
                          <span style={{ display: 'flex', gap: 4 }}>
                            Capabilities: {m.capabilities.map(c => (
                              <code key={c} style={{ fontSize: 9, background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: 3 }}>
                                {c}
                              </code>
                            ))}
                          </span>
                        )}
                      </div>
                      
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 4 }}>
                        {compat.reason}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            !isLoadingOllama && !ollamaError && (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed var(--border-hairline)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-md)',
                fontSize: 12,
                color: 'var(--text-muted)',
                textAlign: 'center'
              }}>
                No models found installed in Ollama. Run <code style={{ color: 'var(--accent-cool)' }}>ollama run gemma4</code> in your terminal to install one.
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

