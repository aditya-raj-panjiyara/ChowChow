import { useEffect, useRef } from 'react';
import type { QueryMessage } from '../../types';
import UserMessage from './UserMessage';
import AiAnswer from './AiAnswer';

interface MessageListProps {
  messages: QueryMessage[];
  isLoading: boolean;
}

export default function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages OR when loading state changes (to show thinking bubble)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  return (
    <div className="query-messages">
      {messages.map(msg => (
        msg.role === 'user'
          ? <UserMessage key={msg.id} content={msg.content} />
          : <AiAnswer key={msg.id} message={msg} />
      ))}

      {/* Thinking state bubble */}
      {isLoading && (
        <div className="query-ai-msg thinking">
          <div className="query-ai-msg__header" style={{ marginBottom: 8 }}>
            <span className="pulsing-text" style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent-cool)', letterSpacing: 0.5 }}>
              RISK ENGINE IS REASONING
            </span>
          </div>
          <div className="query-ai-msg__text" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, height: 16 }}>
            <span className="dot" style={{ animationDelay: '0s' }} />
            <span className="dot" style={{ animationDelay: '0.2s' }} />
            <span className="dot" style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
