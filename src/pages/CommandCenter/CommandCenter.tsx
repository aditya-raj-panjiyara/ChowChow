import { useCallback, useEffect, useState } from 'react';
import RiskPosture from './RiskPosture';
import ActiveAlerts from './ActiveAlerts';
import RecentActivity from './RecentActivity';
import { listAlerts, getIngestionStatus, listCorrections, resolveAlert } from '../../lib/tauri';
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
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [isLive, setIsLive] = useState(false);

  const load = useCallback(async (isCancelled?: () => boolean) => {
      try {
        const backendAlerts = await listAlerts();
        const jobs = await getIngestionStatus().catch(() => []);
        const corrections = await listCorrections().catch(() => []);
        if (isCancelled?.()) return;

        const severityMap: Record<string, AlertSeverity> = {
          critical: 'critical',
          elevated: 'elevated',
          stable: 'normal',
        };
        // Only open alerts belong in the Active feed — acting on an alert
        // (confirming its correction) or dismissing it retires it.
        setAlerts(
          backendAlerts
            .filter(a => (a.status ?? 'active') === 'active')
            .map(a => ({
              id: a.id,
              severity: severityMap[a.severity] ?? 'elevated',
              entityName: a.entity_id ?? 'Drift Sentinel',
              entityId: a.entity_id ?? '',
              description: a.description,
              timestamp: a.created_at,
              suggestedCorrection: a.suggested_correction ?? undefined,
            })),
        );

        let activityList: any[] = [];
        // Closed alerts become activity history instead of vanishing.
        for (const a of backendAlerts) {
          if ((a.status ?? 'active') === 'active') continue;
          activityList.push({
            id: `alert-${a.id}`,
            type: 'correction',
            description: a.status === 'resolved'
              ? `Alert resolved via correction — ${a.description.length > 70 ? a.description.substring(0, 67) + '...' : a.description}`
              : `Alert dismissed — ${a.description.length > 80 ? a.description.substring(0, 77) + '...' : a.description}`,
            timestamp: a.resolved_at ?? a.created_at,
          });
        }
        for (const job of jobs) {
          activityList.push({
            id: job.id,
            type: 'upload',
            description: (job.status === 'complete' || job.status === 'success')
              ? `Successfully ingested ${job.file_path.split('/').pop()}`
              : `Failed to ingest ${job.file_path.split('/').pop()}: ${job.error_message ?? 'Unknown error'}`,
            timestamp: job.completed_at || job.created_at,
          });
        }
        for (const c of corrections) {
          activityList.push({
            id: c.id,
            type: 'correction',
            description: `Correction submitted by ${c.author}: "${c.raw_text.length > 50 ? c.raw_text.substring(0, 47) + '...' : c.raw_text}" (Status: ${c.status})`,
            timestamp: c.created_at,
          });
        }

        activityList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setActivity(activityList.slice(0, 10));
        setIsLive(true);
      } catch {
        // Keep empty
      }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    load(isCancelled);
    const interval = setInterval(() => load(isCancelled), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [load]);

  // Manual dismissal — the alert leaves the feed immediately, no waiting
  // for the next poll tick.
  const handleDismiss = useCallback(async (alertId: string) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
    try {
      await resolveAlert(alertId, 'dismissed');
    } catch {
      // Backend unavailable — the poll will restore it if it's still active.
    }
    load();
  }, [load]);

  const riskStatus: RiskStatus = alerts.some(a => a.severity === 'critical')
    ? 'Critical'
    : alerts.some(a => a.severity === 'elevated')
      ? 'Elevated'
      : 'Stable';

  return (
    <div className="grid-3-col">
      <RiskPosture status={riskStatus} />
      <ActiveAlerts alerts={alerts} isLive={isLive} onDismiss={handleDismiss} />
      <RecentActivity items={activity} />
    </div>
  );
}
