import { useEffect, useRef } from 'react';
import type { QueryMessage } from '../../types';
import UserMessage from './UserMessage';
import AiAnswer from './AiAnswer';

interface MessageListProps {
  messages: QueryMessage[];
}

/**
 * MessageList — scrollable message history.
 * Auto-scrolls to bottom on new messages.
 */
export default function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="query-messages">
      {messages.map(msg => (
        msg.role === 'user'
          ? <UserMessage key={msg.id} content={msg.content} />
          : <AiAnswer key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
