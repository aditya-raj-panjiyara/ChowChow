import { useState } from 'react';
import MessageList from './MessageList';
import QueryInput from './QueryInput';
import SuggestedChips from './SuggestedChips';
import QueryHistory from './QueryHistory';
import { demoQueries } from '../../data/demoData';
import type { QueryMessage, ConfidenceLevel } from '../../types';

const USE_MOCK = true;

const MOCK_RESPONSES: Array<{ keywords: string[]; response: QueryMessage }> = [
  {
    keywords: ['santos', 'port', 'shutdown', 'shuts', 'shut'],
    response: {
      id: '',
      role: 'ai',
      content: 'A shutdown at Port of Santos would disrupt Vale Mineração\'s lithium carbonate shipments. This cascades through Port of Rotterdam to Wolfsburg Assembly Plant, putting Stellantis NV\'s Q3 orders at risk by day 8. Tennessee Components LLC has ~9 days of buffer stock before Tesla Inc. orders enter risk territory.',
      confidence: 'high',
      hopCount: 3,
      reasoningPath: [
        { entityId: 'PRT-001', entityName: 'Port of Santos', entityType: 'port' },
        { entityId: 'MAT-001', entityName: 'Lithium Carbonate', entityType: 'material' },
        { entityId: 'FAC-001', entityName: 'Wolfsburg Assembly', entityType: 'factory' },
        { entityId: 'CUS-001', entityName: 'Stellantis NV', entityType: 'customer' },
      ],
    },
  },
  {
    keywords: ['single', 'source', 'depend', 'single-source'],
    response: {
      id: '',
      role: 'ai',
      content: 'Two critical single-source dependencies identified:\n\n1. **Rare Earth Oxides** — Nippon Chemical Supply is the sole supplier. No secondary source exists in the current graph.\n\n2. **Lithium Carbonate** — Vale Mineração S.A. is the only supplier, routed exclusively through Port of Santos.',
      confidence: 'high',
      hopCount: 2,
      reasoningPath: [
        { entityId: 'SUP-002', entityName: 'Nippon Chemical', entityType: 'supplier' },
        { entityId: 'MAT-002', entityName: 'Rare Earth Oxides', entityType: 'material' },
        { entityId: 'SUP-003', entityName: 'Vale Mineração', entityType: 'supplier' },
        { entityId: 'MAT-001', entityName: 'Lithium Carbonate', entityType: 'material' },
      ],
    },
  },
  {
    keywords: ['customer', 'exposure', 'risk', 'highest'],
    response: {
      id: '',
      role: 'ai',
      content: 'Tesla Inc. and Samsung SDI carry the highest combined exposure. Tesla relies on lithium carbonate via the Santos→Rotterdam route with thin buffer stock. Samsung SDI is downstream of the sole rare earth supplier with no alternate routing. Stellantis NV is currently impacted by the active Santos disruption alert.',
      confidence: 'partial',
      hopCount: 4,
      reasoningPath: [
        { entityId: 'CUS-002', entityName: 'Tesla Inc.', entityType: 'customer' },
        { entityId: 'CUS-003', entityName: 'Samsung SDI', entityType: 'customer' },
        { entityId: 'CUS-001', entityName: 'Stellantis NV', entityType: 'customer' },
      ],
    },
  },
  {
    keywords: ['rare', 'earth', 'china', 'chinese'],
    response: {
      id: '',
      role: 'ai',
      content: 'Your rare earth supply is entirely routed through Nippon Chemical Supply, which sources from Chinese extraction operations. These flow through Port of Shanghai → Guangzhou Electronics Hub → Samsung SDI. There is no secondary supplier, representing a zero-buffer concentration risk on Chinese export policy.',
      confidence: 'partial',
      hopCount: 4,
      reasoningPath: [
        { entityId: 'SUP-002', entityName: 'Nippon Chemical', entityType: 'supplier' },
        { entityId: 'MAT-002', entityName: 'Rare Earth Oxides', entityType: 'material' },
        { entityId: 'FAC-002', entityName: 'Guangzhou Hub', entityType: 'factory' },
        { entityId: 'CUS-003', entityName: 'Samsung SDI', entityType: 'customer' },
      ],
    },
  },
];

function getMockResponse(question: string): QueryMessage {
  const lower = question.toLowerCase();
  for (const { keywords, response } of MOCK_RESPONSES) {
    if (keywords.some(k => lower.includes(k))) {
      return { ...response, id: `A-${Date.now()}` };
    }
  }
  return {
    id: `A-${Date.now()}`,
    role: 'ai',
    content: `Analyzing "${question}" across the knowledge graph. Based on current ingested data: no direct match found, but 3 related supply chain nodes identified. Recommend reviewing the Graph Explorer for manual traversal.`,
    confidence: 'low',
    hopCount: 1,
    reasoningPath: [
      { entityId: 'PRT-002', entityName: 'Port of Rotterdam', entityType: 'port' },
    ],
  };
}

const SUGGESTED_QUESTIONS = [
  'What happens if Santos port shuts down?',
  'Show all single-source dependencies',
  'Which customers have the highest exposure?',
];

/**
 * QueryAsk page — natural-language multi-hop questioning, chat-style.
 * The single most important screen for trust: every answer shows its reasoning path.
 * Max 760px centered — reading-width discipline for text-heavy content.
 */
export default function QueryAsk() {
  const [messages, setMessages] = useState<QueryMessage[]>(demoQueries);
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    const question = inputValue.trim();
    if (!question || isLoading) return;

    const userMsg: QueryMessage = {
      id: `Q-${Date.now()}`,
      role: 'user',
      content: question,
    };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setShowSuggestions(false);
    setIsLoading(true);

    if (USE_MOCK) {
      await new Promise(r => setTimeout(r, 800));
      setMessages(prev => [...prev, getMockResponse(question)]);
      setIsLoading(false);
      return;
    }

    try {
      const { askQuestion } = await import('../../lib/tauri');
      const result = await askQuestion(question);
      const confidenceMap: Record<string, ConfidenceLevel> = {
        High: 'high',
        Partial: 'partial',
        Low: 'low',
      };
      const aiResponse: QueryMessage = {
        id: `A-${Date.now()}`,
        role: 'ai',
        content: result.answer,
        confidence: confidenceMap[result.confidence] ?? 'low',
        hopCount: result.reasoning_path.length,
        reasoningPath: result.reasoning_path.map(e => ({
          entityId: e.id,
          entityName: e.name,
          entityType: (e.entity_type.toLowerCase() as any) ?? 'supplier',
        })),
      };
      setMessages(prev => [...prev, aiResponse]);
    } catch (err) {
      const errorMsg: QueryMessage = {
        id: `E-${Date.now()}`,
        role: 'ai',
        content: `Query failed: ${err instanceof Error ? err.message : String(err)}. Make sure the backend is running.`,
        confidence: 'low',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setInputValue(suggestion);
    setShowSuggestions(false);
  };

  const pastQueries = messages
    .filter(m => m.role === 'user')
    .map(m => m.content);

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {/* History toggle */}
      <button
        onClick={() => setShowHistory(!showHistory)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          background: 'transparent',
          border: 'none',
          zIndex: 5,
        }}
        title="Query history"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </button>

      {/* History drawer */}
      {showHistory && (
        <QueryHistory
          queries={pastQueries}
          onSelect={(query) => {
            setInputValue(query);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Main chat area */}
      <div className="query-container">
        <MessageList messages={messages} />

        {showSuggestions && (
          <SuggestedChips
            suggestions={SUGGESTED_QUESTIONS}
            onSelect={handleSuggestionSelect}
            onDismiss={() => setShowSuggestions(false)}
          />
        )}

        <QueryInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
