import { useEffect, useState } from 'react';
import RiskPosture from './RiskPosture';
import ActiveAlerts from './ActiveAlerts';
import RecentActivity from './RecentActivity';
import { listAlerts, getIngestionStatus, listCorrections } from '../../lib/tauri';
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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const backendAlerts = await listAlerts();
        const jobs = await getIngestionStatus().catch(() => []);
        const corrections = await listCorrections().catch(() => []);
        if (cancelled) return;

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

        let activityList: any[] = [];
        for (const job of jobs) {
          activityList.push({
            id: job.id,
            type: 'upload',
            description: job.status === 'success'
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
      <RecentActivity items={activity} />
    </div>
  );
}
