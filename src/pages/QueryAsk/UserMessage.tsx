interface UserMessageProps {
  content: string;
}

/**
 * UserMessage — user's question in the chat view.
 * Styled as a right-aligned bubble.
 */
export default function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="query-user-msg">
      {content}
    </div>
  );
}
