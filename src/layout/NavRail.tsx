import NavRailItem from './NavRailItem';
import { navTabs } from '../data/demoData';

interface NavRailProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * Left navigation rail — maps all tabs, handles collapse/expand.
 * Settings is visually separated at the bottom.
 */
export default function NavRail({ isCollapsed, onToggleCollapse }: NavRailProps) {
  const mainTabs = navTabs.filter(t => t.id !== 'settings');
  const settingsTab = navTabs.find(t => t.id === 'settings')!;

  return (
    <nav className={`nav-rail ${isCollapsed ? 'nav-rail--collapsed' : ''}`}>
      <div className="nav-rail__items">
        {mainTabs.map(tab => (
          <NavRailItem key={tab.id} tab={tab} isCollapsed={isCollapsed} />
        ))}
      </div>
      <div className="nav-rail__bottom">
        <NavRailItem tab={settingsTab} isCollapsed={isCollapsed} />
        <button
          className="nav-rail__toggle"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: isCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
          >
            <polyline points="11 17 6 12 11 7" />
            <polyline points="18 17 13 12 18 7" />
          </svg>
          {!isCollapsed && <span style={{ fontSize: 12 }}>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
