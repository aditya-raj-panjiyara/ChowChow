import { useState } from 'react';
import type { QueryMessage } from '../../types';
import ConfidenceBadge from '../../components/ConfidenceBadge';
import ReasoningPath from './ReasoningPath';
import { improveAnswer } from '../../lib/tauri';

interface AiAnswerProps {
  message: QueryMessage;
}

type FeedbackState =
  | { phase: 'idle' }
  | { phase: 'sending'; helpful: boolean }
  | { phase: 'done'; helpful: boolean; detail: string }
  | { phase: 'error'; detail: string };

/**
 * AiAnswer — AI response with confidence badge, reasoning path, and the
 * feedback → improve() loop: rating an answer feeds cognee's improve()
 * bridge, which re-weights the graph elements behind it so retrieval
 * genuinely learns from the analyst's judgment.
 */
export default function AiAnswer({ message }: AiAnswerProps) {
  const [feedback, setFeedback] = useState<FeedbackState>({ phase: 'idle' });

  const rate = async (helpful: boolean) => {
    if (!message.qaId || feedback.phase === 'sending' || feedback.phase === 'done') return;
    setFeedback({ phase: 'sending', helpful });
    try {
      const result = await improveAnswer(message.qaId, helpful);
      setFeedback({
        phase: 'done',
        helpful,
        detail: result.feedback_applied > 0
          ? `memory re-weighted (${result.feedback_applied} update${result.feedback_applied === 1 ? '' : 's'} applied)`
          : 'feedback recorded',
      });
    } catch (err) {
      setFeedback({ phase: 'error', detail: err instanceof Error ? err.message : String(err) });
    }
  };

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

      {/* Feedback → improve(): rating re-weights the graph behind the answer */}
      {message.qaId && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
          paddingTop: 8, borderTop: '1px solid var(--border-hairline)',
        }}>
          {feedback.phase === 'done' ? (
            <span style={{ fontSize: 11, color: 'var(--signal-green)' }}>
              {feedback.helpful ? '👍' : '👎'} Thanks — {feedback.detail}
            </span>
          ) : feedback.phase === 'error' ? (
            <span style={{ fontSize: 11, color: 'var(--signal-red)' }} title={feedback.detail}>
              ⚠ Feedback failed: {feedback.detail.substring(0, 60)}
            </span>
          ) : (
            <>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                {feedback.phase === 'sending' ? 'Re-weighting memory…' : 'Was this useful? Rating teaches the memory:'}
              </span>
              {[true, false].map(helpful => (
                <button
                  key={String(helpful)}
                  onClick={() => rate(helpful)}
                  disabled={feedback.phase === 'sending'}
                  title={helpful ? 'Helpful — boost the evidence behind this answer' : 'Not helpful — demote the evidence behind this answer'}
                  style={{
                    background: 'transparent', border: '1px solid var(--border-hairline)',
                    borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer',
                    fontSize: 12, lineHeight: 1.4,
                    opacity: feedback.phase === 'sending' && feedback.helpful !== helpful ? 0.35 : 1,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-raised)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {helpful ? '👍' : '👎'}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
