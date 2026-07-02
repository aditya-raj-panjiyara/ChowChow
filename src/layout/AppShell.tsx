import { Outlet } from 'react-router';
import NavRail from './NavRail';
import TopologyStrip from './TopologyStrip';
import { useNavigation } from '../hooks/useNavigation';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';

/**
 * AppShell — the root layout wrapper.
 * Composes NavRail + TopologyStrip + routed content area.
 * Rendered once, persists across all tab navigations.
 */
export default function AppShell() {
  const { isCollapsed, toggleCollapse } = useNavigation();

  // Global shortcut: Cmd/Ctrl + K → navigate to query page
  useKeyboardShortcut('k', () => {
    // Focus the query input if on query page, otherwise navigate there
    const queryInput = document.querySelector('.query-input-bar__input') as HTMLInputElement;
    if (queryInput) {
      queryInput.focus();
    } else {
      window.location.hash = '#/query';
    }
  }, { meta: true });

  return (
    <div className={`app-shell ${isCollapsed ? 'app-shell--collapsed' : ''}`}>
      {/* Top header bar */}
      <header className="app-header">
        <span className="app-header__title">SOVEREIGN SUPPLY CHAIN RISK ENGINE</span>
        <div className="app-header__actions">
          <span className="text-mono-sm text-muted">
            ⌘K to search
          </span>
        </div>
      </header>

      {/* Left navigation rail */}
      <NavRail isCollapsed={isCollapsed} onToggleCollapse={toggleCollapse} />

      {/* Topology strip — persistent across all tabs */}
      <TopologyStrip />

      {/* Main content — swapped by router */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
