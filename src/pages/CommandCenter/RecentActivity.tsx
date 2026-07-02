import type { ActivityItem } from '../../types';
import type { ReactNode } from 'react';
import MonoText from '../../components/MonoText';

interface RecentActivityProps {
  items: ActivityItem[];
}

const typeIcons: Record<string, ReactNode> = {
  upload: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cool)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  ),
  query: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--signal-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  correction: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--signal-amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
};

/**
 * RecentActivity — chronological feed, icon-coded by type.
 * Last 20 items, scrollable. No pagination in MVP.
 */
export default function RecentActivity({ items }: RecentActivityProps) {
  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel__header">
        <span className="panel__title">Recent Activity</span>
      </div>
      <div className="panel__body" style={{ flex: 1, overflow: 'auto', padding: 'var(--space-md)' }}>
        {items.map(item => (
          <div key={item.id} className="activity-item">
            <div className="activity-item__icon">
              {typeIcons[item.type]}
            </div>
            <span className="activity-item__text">{item.description}</span>
            <MonoText muted className="activity-item__time">
              {formatTime(item.timestamp)}
            </MonoText>
          </div>
        ))}
      </div>
    </div>
  );
}
