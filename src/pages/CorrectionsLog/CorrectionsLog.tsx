import ComingSoon from '../../components/ComingSoon';

/**
 * CorrectionsLog — placeholder/locked tab for v2.
 * Present in nav for roadmap visibility but not functional yet.
 */
export default function CorrectionsLog() {
  return (
    <ComingSoon
      title="Corrections Log"
      description="Dynamic learning loop — review AI-extracted relationships, approve or reject corrections, and maintain a full audit trail of all graph modifications."
      featureHighlights={[
        'Dense data table with correction history',
        'Timestamp, manager, and correction summary',
        'Affected entities with inline confirm/reject',
        'Full audit trail (pending → committed → reversed)',
        'Direct link to LLM intent-extraction confirmation',
      ]}
    />
  );
}
