interface SuggestedChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  onDismiss: () => void;
}

/**
 * SuggestedChips — dismissible suggested question chips.
 * Shown on first use only to help users understand what to ask.
 */
export default function SuggestedChips({ suggestions, onSelect, onDismiss }: SuggestedChipsProps) {
  return (
    <div className="suggested-chips">
      {suggestions.map((suggestion, i) => (
        <button
          key={i}
          className="suggested-chip"
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </button>
      ))}
      <button
        className="suggested-chip"
        onClick={onDismiss}
        style={{ borderStyle: 'dashed', opacity: 0.6 }}
      >
        ✕ Dismiss
      </button>
    </div>
  );
}
