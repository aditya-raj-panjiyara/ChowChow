import { useEffect, useState } from 'react';
import RiskPosture from './RiskPosture';
import ActiveAlerts from './ActiveAlerts';
import RecentActivity from './RecentActivity';
import { demoAlerts, demoActivity } from '../../data/demoData';
import { listAlerts } from '../../lib/tauri';
import type { Alert, AlertSeverity, RiskStatus } from '../../types';

/**
 * CommandCenter page — at-a-glance risk posture, live alerts, recent activity.
 * 3-column grid, asymmetric (40/30/30).
 *
 * Alerts are live: the Drift Sentinel writes findings here after every
 * ingestion (polled so they appear without a refresh). Demo data only
 * shows when the backend has no alerts yet.
 */
export default function CommandCenter() {
  const [alerts, setAlerts] = useState<Alert[]>(demoAlerts);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const backendAlerts = await listAlerts();
        if (cancelled || backendAlerts.length === 0) return;
        const severityMap: Record<string, AlertSeverity> = {
          critical: 'critical',
          elevated: 'elevated',
          stable: 'normal',
        };
        setAlerts(
          backendAlerts.map(a => ({
            id: a.id,
            severity: severityMap[a.severity] ?? 'elevated',
            entityName: a.entity_id ?? 'Drift Sentinel',
            entityId: a.entity_id ?? '',
            description: a.description,
            timestamp: a.created_at,
            suggestedCorrection: a.suggested_correction ?? undefined,
          })),
        );
        setIsLive(true);
      } catch {
        // Backend not running — keep demo data
      }
    };

    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const riskStatus: RiskStatus = alerts.some(a => a.severity === 'critical')
    ? 'Critical'
    : alerts.some(a => a.severity === 'elevated')
      ? 'Elevated'
      : 'Stable';

  return (
    <div className="grid-3-col">
      <RiskPosture status={riskStatus} />
      <ActiveAlerts alerts={alerts} isLive={isLive} />
      <RecentActivity items={demoActivity} />
    </div>
  );
}
