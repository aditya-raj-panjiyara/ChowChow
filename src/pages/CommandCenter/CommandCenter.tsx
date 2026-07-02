import RiskPosture from './RiskPosture';
import ActiveAlerts from './ActiveAlerts';
import RecentActivity from './RecentActivity';
import { demoAlerts, demoActivity, currentRiskStatus } from '../../data/demoData';

/**
 * CommandCenter page — at-a-glance risk posture, live alerts, recent activity.
 * 3-column grid, asymmetric (40/30/30).
 */
export default function CommandCenter() {
  return (
    <div className="grid-3-col">
      <RiskPosture status={currentRiskStatus} />
      <ActiveAlerts alerts={demoAlerts} />
      <RecentActivity items={demoActivity} />
    </div>
  );
}
