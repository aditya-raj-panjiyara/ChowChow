import { demoSources } from '../../data/demoData';
import SourceItem from './SourceItem';

interface SourceListProps {
  activeSourceId: string;
  onSelectSource: (id: string) => void;
}

/**
 * SourceList — left panel of the Ingestion tab.
 * Lists source type categories with active/locked states.
 */
export default function SourceList({ activeSourceId, onSelectSource }: SourceListProps) {
  return (
    <div style={{
      borderRight: '1px solid var(--border-hairline)',
      padding: 'var(--space-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-xs)',
      background: 'var(--bg-surface)',
    }}>
      <h3 className="text-subheading" style={{ padding: '0 var(--space-md)', marginBottom: 'var(--space-sm)' }}>
        Sources
      </h3>
      {demoSources.map(source => (
        <SourceItem
          key={source.id}
          source={source}
          isActive={activeSourceId === source.id}
          onClick={() => onSelectSource(source.id)}
        />
      ))}
    </div>
  );
}
