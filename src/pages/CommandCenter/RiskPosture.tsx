import type { RiskStatus } from '../../types';

interface RiskPostureProps {
  status: RiskStatus;
}

const statusStyles: Record<RiskStatus, string> = {
  Stable: 'risk-posture__status--stable',
  Elevated: 'risk-posture__status--elevated',
  Critical: 'risk-posture__status--critical',
};

/**
 * RiskPosture — large status word panel.
 * Single large state word color-coded via signal tokens.
 * Below it, a static mini render of the graph topology.
 */
export default function RiskPosture({ status }: RiskPostureProps) {
  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel__header">
        <span className="panel__title">Risk Posture</span>
      </div>
      <div className="risk-posture" style={{ flex: 1 }}>
        <span className="risk-posture__label">Current Status</span>
        <span className={`risk-posture__status ${statusStyles[status]}`}>
          {status}
        </span>
        {/* Mini topology silhouette */}
        <svg width="200" height="60" viewBox="0 0 200 60" style={{ opacity: 0.4 }}>
          {/* Simplified graph for the mini view */}
          <line x1="30" y1="20" x2="70" y2="35" stroke="var(--border-hairline)" strokeWidth="1" />
          <line x1="70" y1="35" x2="100" y2="15" stroke="var(--border-hairline)" strokeWidth="1" />
          <line x1="100" y1="15" x2="140" y2="40" stroke="var(--signal-amber)" strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1="140" y1="40" x2="170" y2="25" stroke="var(--border-hairline)" strokeWidth="1" />
          <line x1="70" y1="35" x2="130" y2="50" stroke="var(--border-hairline)" strokeWidth="1" />
          <circle cx="30" cy="20" r="4" fill="var(--entity-supplier)" />
          <circle cx="70" cy="35" r="5" fill="var(--entity-port)" />
          <circle cx="100" cy="15" r="4" fill="var(--entity-factory)" />
          <circle cx="140" cy="40" r="6" fill="var(--signal-amber)" style={{ animation: 'pulse-amber 2s ease-in-out infinite' }} />
          <circle cx="170" cy="25" r="4" fill="var(--entity-customer)" />
          <circle cx="130" cy="50" r="3" fill="var(--entity-material)" />
        </svg>
        <span className="text-caption" style={{ cursor: 'pointer', color: 'var(--accent-cool)' }}>
          View full graph →
        </span>
      </div>
    </div>
  );
}
