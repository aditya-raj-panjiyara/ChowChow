import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
}

/**
 * EmptyState — reusable empty/zero-data state.
 * Never shows fake/zero charts — always provides clear messaging
 * and an optional action to resolve the empty state.
 */
export default function EmptyState({ icon, message, ctaLabel, onCtaClick }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <p className="empty-state__message">{message}</p>
      {ctaLabel && onCtaClick && (
        <button className="empty-state__cta" onClick={onCtaClick}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
