import { useState } from 'react';
import type { Alert } from '../../types';
import SeverityDot from '../../components/SeverityDot';
import MonoText from '../../components/MonoText';

interface AlertRowProps {
  alert: Alert;
}

/**
 * AlertRow — single alert with severity dot, entity name, description, timestamp.
 * Click expands inline to show affected downstream entities without leaving the page.
 */
export default function AlertRow({ alert }: AlertRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="alert-row" onClick={() => setIsExpanded(!isExpanded)}>
      <SeverityDot severity={alert.severity} />
      <div className="alert-row__content">
        <div className="alert-row__entity">{alert.entityName}</div>
        <div className="alert-row__description">{alert.description}</div>
        {isExpanded && alert.downstreamEntities && alert.downstreamEntities.length > 0 && (
          <div className="alert-row__expand">
            <div style={{ marginBottom: 6, fontWeight: 500, color: 'var(--text-primary)' }}>
              Affected downstream:
            </div>
            {alert.downstreamEntities.map((entity, i) => (
              <div key={i} style={{ padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--signal-amber)' }}>→</span>
                <MonoText>{entity}</MonoText>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="alert-row__timestamp">
        {formatTimestamp(alert.timestamp)}
      </span>
    </div>
  );
}
