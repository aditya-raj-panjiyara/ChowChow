import { useEffect, useMemo, useState } from 'react';
import {
  getGraphSnapshot,
  simulateBlastRadius,
  type MemoryEntity,
  type BlastRadiusResult,
  type BlastAffectedEntity,
} from '../../lib/tauri';
import EmptyState from '../../components/EmptyState';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'var(--signal-red)';
    case 'elevated': return 'var(--signal-amber)';
    default: return 'var(--signal-green)';
  }
}

/** One affected entity card inside a hop column. */
function AffectedCard({ entity }: { entity: BlastAffectedEntity }) {
  return (
    <div
      className="card"
      title={`Path: ${entity.path_names.join(' → ')}`}
      style={{ padding: 'var(--space-md)', borderLeft: `2px solid ${severityColor(entity.severity)}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 4 }}>
        <span
          className={`severity-dot severity-dot--${entity.severity === 'watch' ? 'normal' : entity.severity}`}
        />
        <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entity.name}
        </span>
      </div>
      <div className="text-mono-sm text-muted" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{entity.entity_type}</span>
        <span>
          impact <span style={{ color: severityColor(entity.severity) }}>{Math.round(entity.impact_score * 100)}%</span>
          {' · '}exposure <span className="text-primary">{usd.format(entity.estimated_exposure_usd)}</span>
        </span>
        <span>buffer ~{entity.buffer_days}d</span>
      </div>
    </div>
  );
}

/**
 * BlastRadius — disruption cascade simulation.
 *
 * Pick a node, pick a scenario duration, and the engine traces the
 * hop-ordered ripple through the knowledge graph: severity per entity,
 * estimated financial exposure, and a prioritized mitigation roadmap.
 */
export default function BlastRadius() {
  const [entities, setEntities] = useState<MemoryEntity[]>([]);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [durationDays, setDurationDays] = useState(14);
  const [result, setResult] = useState<BlastRadiusResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const snapshot = await getGraphSnapshot();
        const sorted = [...snapshot.entities].sort((a, b) => a.name.localeCompare(b.name));
        setEntities(sorted);
        setGraphError(null);
        if (sorted.length > 0) setSelectedId(prev => prev || sorted[0].id);
      } catch (err) {
        setGraphError(
          `Could not load the knowledge graph: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }, []);

  const handleRun = async () => {
    if (!selectedId || isRunning) return;
    setIsRunning(true);
    setRunError(null);
    try {
      setResult(await simulateBlastRadius(selectedId, durationDays));
    } catch (err) {
      setRunError(`Simulation failed: ${err instanceof Error ? err.message : String(err)}`);
      setResult(null);
    } finally {
      setIsRunning(false);
    }
  };

  // Group affected entities by hop for the hop-ordered layout.
  const hops = useMemo(() => {
    if (!result) return [];
    const byHop = new Map<number, BlastAffectedEntity[]>();
    for (const a of result.affected) {
      const list = byHop.get(a.hop) ?? [];
      list.push(a);
      byHop.set(a.hop, list);
    }
    return [...byHop.entries()].sort(([a], [b]) => a - b);
  }, [result]);

  const criticalCount = result?.affected.filter(a => a.severity === 'critical').length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', height: '100%' }}>
      {/* Scenario controls */}
      <div className="panel">
        <div className="panel__header">
          <span className="panel__title">Disruption Scenario</span>
          <span className="text-mono-sm text-muted">{entities.length} nodes in graph</span>
        </div>
        <div className="panel__body" style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px' }}>
            <label className="settings-field__label">Disrupted entity</label>
            <select
              className="settings-field__select"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
            >
              {entities.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.entity_type})
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '0 1 260px' }}>
            <label className="settings-field__label">
              Scenario duration — <span className="text-mono-sm">{durationDays} days</span>
            </label>
            <input
              type="range"
              min={1}
              max={60}
              value={durationDays}
              onChange={e => setDurationDays(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-cool)' }}
            />
          </div>
          <button
            className="btn btn--primary"
            onClick={handleRun}
            disabled={!selectedId || isRunning}
            style={{ opacity: !selectedId || isRunning ? 0.5 : 1 }}
          >
            {isRunning ? 'Tracing cascade…' : 'Trace Blast Radius'}
          </button>
        </div>
      </div>

      {(graphError || runError) && (
        <div className="panel" style={{ borderColor: 'var(--signal-red)', padding: 'var(--space-md) var(--space-lg)' }}>
          <span className="text-red" style={{ fontSize: 13 }}>{graphError || runError}</span>
        </div>
      )}

      {!result && !graphError && !runError && (
        <div className="panel" style={{ flex: 1 }}>
          <EmptyState
            message={
              entities.length === 0
                ? 'The knowledge graph is empty — ingest documents first, then simulate disruptions here.'
                : 'Select a node and trace its blast radius. The cascade is computed hop-by-hop from live graph structure, not cached assumptions.'
            }
          />
        </div>
      )}

      {result && (
        <>
          {/* Impact summary */}
          <div className="panel">
            <div className="panel__body" style={{ display: 'flex', gap: 'var(--space-2xl)', flexWrap: 'wrap' }}>
              {[
                { label: 'Origin', value: result.origin_name, mono: false },
                { label: 'Affected entities', value: String(result.affected.length), mono: true },
                { label: 'Critical', value: String(criticalCount), mono: true, color: criticalCount > 0 ? 'var(--signal-red)' : undefined },
                { label: 'Cascade depth', value: `${result.max_hop} hops`, mono: true },
                { label: `Est. exposure / ${result.duration_days}d`, value: usd.format(result.total_exposure_usd), mono: true, color: 'var(--signal-amber)' },
              ].map(({ label, value, mono, color }) => (
                <div key={label}>
                  <div className="text-caption text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    {label}
                  </div>
                  <div
                    className={mono ? 'text-mono' : undefined}
                    style={{ fontSize: 18, fontWeight: 600, color: color ?? 'var(--text-primary)' }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-lg)', flex: 1, minHeight: 0 }}>
            {/* Hop-ordered cascade */}
            <div className="panel" style={{ flex: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div className="panel__header">
                <span className="panel__title">Cascade — hop-ordered</span>
                <span className="text-mono-sm text-muted">impact decays with distance</span>
              </div>
              <div className="panel__body" style={{ flex: 1, overflow: 'auto' }}>
                {result.affected.length === 0 ? (
                  <EmptyState message="No connected entities carry meaningful impact — this node is isolated or well-buffered." />
                ) : (
                  <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-start' }}>
                    {hops.map(([hop, list]) => (
                      <div key={hop} style={{ flex: '1 0 200px', minWidth: 200 }}>
                        <div
                          className="text-mono-sm text-muted"
                          style={{ marginBottom: 'var(--space-sm)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
                        >
                          Hop {hop} · {list.length}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                          {list.map(a => <AffectedCard key={a.id} entity={a} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Mitigation roadmap */}
            <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 300 }}>
              <div className="panel__header">
                <span className="panel__title">Mitigation Roadmap</span>
                <span className="text-mono-sm text-muted">{result.mitigations.length} actions</span>
              </div>
              <div className="panel__body" style={{ flex: 1, overflow: 'auto' }}>
                {result.mitigations.length === 0 ? (
                  <EmptyState message="No mitigation needed — nothing in the radius rises above watch level." />
                ) : (
                  <ol style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', listStyle: 'none' }}>
                    {result.mitigations.map(step => (
                      <li key={step.priority} style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-start' }}>
                        <span
                          className="text-mono-sm"
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: 'var(--bg-raised)',
                            border: '1px solid var(--border-hairline)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            color: 'var(--accent-cool)',
                          }}
                        >
                          {step.priority}
                        </span>
                        <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                          {step.action}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
