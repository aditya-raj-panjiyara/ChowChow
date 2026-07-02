import type { QueryMessage } from '../../types';
import ConfidenceBadge from '../../components/ConfidenceBadge';
import ReasoningPath from './ReasoningPath';

interface AiAnswerProps {
  message: QueryMessage;
}

/**
 * AiAnswer — AI response with confidence badge and reasoning path.
 * Answer text reads like a briefing, not a wiki page.
 * Confidence uses words, not percentages, to avoid false precision.
 */
export default function AiAnswer({ message }: AiAnswerProps) {
  return (
    <div className="query-ai-msg">
      <div className="query-ai-msg__header">
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-cool)' }}>
          RISK ENGINE
        </span>
        {message.confidence && (
          <ConfidenceBadge level={message.confidence} />
        )}
      </div>
      <div className="query-ai-msg__text">
        {message.content.split('\n\n').map((paragraph, i) => (
          <p key={i} style={{ marginBottom: i < message.content.split('\n\n').length - 1 ? 12 : 0 }}>
            {paragraph}
          </p>
        ))}
      </div>
      {message.reasoningPath && message.hopCount && (
        <ReasoningPath hops={message.reasoningPath} hopCount={message.hopCount} />
      )}
    </div>
  );
}
