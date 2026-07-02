import MonoText from '../../components/MonoText';

interface IngestionSummaryProps {
  entityCount: number;
  relationshipCount: number;
}

/**
 * IngestionSummary — persistent bottom bar showing extraction stats.
 * Numbers in monospace for the instrumentation feel.
 * Updates live during ingestion (uses demo static values for now).
 */
export default function IngestionSummary({ entityCount, relationshipCount }: IngestionSummaryProps) {
  return (
    <div className="ingestion-summary">
      <span>
        <MonoText className="ingestion-summary__value">{entityCount.toLocaleString()}</MonoText>
        {' entities'}
      </span>
      <span style={{ color: 'var(--border-hairline)' }}>·</span>
      <span>
        <MonoText className="ingestion-summary__value">{relationshipCount.toLocaleString()}</MonoText>
        {' relationships extracted'}
      </span>
    </div>
  );
}
