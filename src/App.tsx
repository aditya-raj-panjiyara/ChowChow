import { Routes, Route } from 'react-router';
import AppShell from './layout/AppShell';
import CommandCenter from './pages/CommandCenter/CommandCenter';
import Ingestion from './pages/Ingestion/Ingestion';
import GraphExplorer from './pages/GraphExplorer/GraphExplorer';
import QueryAsk from './pages/QueryAsk/QueryAsk';
import BlastRadius from './pages/BlastRadius/BlastRadius';
import CorrectionsLog from './pages/CorrectionsLog/CorrectionsLog';
import Settings from './pages/Settings/Settings';
import './App.css';

/**
 * App — route definitions only.
 * All layout (nav rail, topology strip) is handled by AppShell.
 * Each route maps to a page component.
 */
function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/ingestion" element={<Ingestion />} />
        <Route path="/graph" element={<GraphExplorer />} />
        <Route path="/query" element={<QueryAsk />} />
        <Route path="/blast-radius" element={<BlastRadius />} />
        <Route path="/corrections" element={<CorrectionsLog />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
