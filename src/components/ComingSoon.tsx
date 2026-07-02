interface ComingSoonProps {
  title: string;
  description: string;
  featureHighlights?: string[];
}

/**
 * ComingSoon — placeholder state for locked/scaffolded tabs.
 * Present in nav for roadmap visibility but not functional yet.
 * Shows what's planned so users know it's intentional, not missing.
 */
export default function ComingSoon({ title, description, featureHighlights }: ComingSoonProps) {
  return (
    <div className="coming-soon">
      <div className="coming-soon__icon">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h2 className="coming-soon__title">{title}</h2>
      <p className="coming-soon__description">{description}</p>
      {featureHighlights && featureHighlights.length > 0 && (
        <div style={{ textAlign: 'left', maxWidth: 360 }}>
          <p className="text-subheading" style={{ marginBottom: 8 }}>Planned Features</p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {featureHighlights.map((feature, i) => (
              <li key={i} style={{ color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--accent-cool)' }}>◇</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      )}
      <span className="coming-soon__badge">Coming in v2</span>
    </div>
  );
}
