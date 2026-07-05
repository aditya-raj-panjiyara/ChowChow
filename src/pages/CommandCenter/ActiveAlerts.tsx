import type { Alert } from '../../types';
import AlertRow from './AlertRow';

interface ActiveAlertsProps {
  alerts: Alert[];
  /** True once alerts come from the backend (Drift Sentinel) rather than demo data */
  isLive?: boolean;
  /** Dismiss an alert without applying its correction */
  onDismiss?: (alertId: string) => void;
}

/**
 * ActiveAlerts — scrollable alert list, severity-sorted.
 * Each alert expands inline to show downstream entities.
 */
export default function ActiveAlerts({ alerts, isLive, onDismiss }: ActiveAlertsProps) {
  const severityOrder = { critical: 0, elevated: 1, normal: 2 };
  const sorted = [...alerts].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel__header">
        <span className="panel__title">Active Alerts</span>
        <span className="text-mono-sm text-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLive && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--signal-green)', fontSize: 10 }}>
              <span className="status-pill__dot" style={{ background: 'var(--signal-green)', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
              SENTINEL LIVE
            </span>
          )}
          {alerts.length}
        </span>
      </div>
      <div className="panel__body--flush" style={{ flex: 1, overflow: 'auto' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No active alerts — resolved and dismissed alerts move to Recent Activity.
          </div>
        ) : (
          sorted.map(alert => (
            <AlertRow key={alert.id} alert={alert} onDismiss={onDismiss} />
          ))
        )}
      </div>
    </div>
  );
}
