import type { ConfidenceLevel } from '../types';

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
}

const labels: Record<ConfidenceLevel, string> = {
  high: 'High confidence',
  partial: 'Partial data',
  low: 'Low confidence — verify',
};

const icons: Record<ConfidenceLevel, string> = {
  high: '●',
  partial: '◐',
  low: '○',
};

/**
 * ConfidenceBadge — word-based confidence indicator.
 * Uses words instead of percentages since raw percentages
 * invite false precision in a risk context.
 */
export default function ConfidenceBadge({ level }: ConfidenceBadgeProps) {
  return (
    <span className={`confidence-badge confidence-badge--${level}`}>
      <span>{icons[level]}</span>
      {labels[level]}
    </span>
  );
}
