import { useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/* ============================================================
   Cognition Trace — live view of the cognee ↔ LLM pipeline.
   Every entry is a real backend event: pipeline stages, actual
   LLM prompts/responses, embedding batches. Nothing simulated.
   ============================================================ */

interface TraceEvent {
  seq: number;
  op_id: string;
  op_label: string;
  kind: 'op_start' | 'op_end' | 'stage' | 'llm' | 'embed';
  label: string;
  detail: string;
  duration_ms: number | null;
  ts_ms: number;
}

interface TraceRun {
  id: string;
  label: string;
  startTs: number;
  events: TraceEvent[];
  active: boolean;
  failed: boolean;
  durationMs: number | null;
  summary: string;
}

const MAX_RUNS = 12;

const kindStyle: Record<string, { label: string; color: string }> = {
  stage: { label: 'STAGE', color: 'var(--text-muted)' },
  llm: { label: 'LLM', color: 'var(--accent-cool)' },
  embed: { label: 'EMBED', color: 'var(--signal-green)' },
};

function applyEvent(runs: TraceRun[], ev: TraceEvent): TraceRun[] {
  const next = [...runs];
  let run = next.find(r => r.id === ev.op_id);

  if (!run) {
    run = {
      id: ev.op_id,
      label: ev.op_label,
      startTs: ev.ts_ms,
      events: [],
      active: true,
      failed: false,
      durationMs: null,
      summary: '',
    };
    next.unshift(run);
  } else {
    const idx = next.indexOf(run);
    run = { ...run };
    next[idx] = run;
  }

  if (ev.kind === 'op_start') {
    run.label = ev.op_label;
    run.startTs = ev.ts_ms;
    run.active = true;
  } else if (ev.kind === 'op_end') {
    run.active = false;
    run.durationMs = ev.duration_ms;
    run.summary = ev.detail;
    run.failed = ev.label === 'ended with error';
  } else {
    run.events = [...run.events, ev];
  }

  return next.slice(0, MAX_RUNS);
}

function EventRow({ ev, startTs }: { ev: TraceEvent; startTs: number }) {
  const [expanded, setExpanded] = useState(false);
  const style = kindStyle[ev.kind] ?? kindStyle.stage;
  const offset = Math.max(0, ev.ts_ms - startTs) / 1000;

  return (
    <div
      onClick={() => setExpanded(v => !v)}
      style={{
        padding: '5px 10px 5px 14px',
        borderLeft: `2px solid ${style.color}`,
        marginLeft: 10,
        cursor: 'pointer',
        background: expanded ? 'var(--bg-raised)' : 'transparent',
        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="text-mono-sm" style={{ color: 'var(--text-muted)', fontSize: 9.5, width: 44, flexShrink: 0 }}>
          +{offset.toFixed(1)}s
        </span>
        <span
          className="text-mono-sm"
          style={{
            fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em',
            color: style.color, width: 42, flexShrink: 0,
          }}
        >
          {style.label}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
          {ev.label}
          {ev.duration_ms != null && (
            <span className="text-mono-sm" style={{ color: 'var(--text-muted)', fontSize: 9.5, marginLeft: 6 }}>
              {(ev.duration_ms / 1000).toFixed(1)}s
            </span>
          )}
        </span>
      </div>
      <div
        className="text-mono-sm"
        style={{
          fontSize: 10.5,
          color: 'var(--text-muted)',
          marginTop: 2,
          paddingLeft: 52,
          whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          wordBreak: 'break-word',
          lineHeight: 1.55,
        }}
      >
        {ev.detail}
      </div>
    </div>
  );
}

function RunSection({ run, defaultOpen }: { run: TraceRun; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (run.active) setOpen(true);
  }, [run.active]);

  const llmCalls = run.events.filter(e => e.kind === 'llm').length;
  const embedCalls = run.events.filter(e => e.kind === 'embed').length;

  return (
    <div style={{ borderBottom: '1px solid var(--border-hairline)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span
          className="status-pill__dot"
          style={{
            width: 7, height: 7, flexShrink: 0,
            background: run.active
              ? 'var(--accent-cool)'
              : run.failed
                ? 'var(--signal-red)'
                : 'var(--signal-green)',
            animation: run.active ? 'pulse-dot 1.2s ease-in-out infinite' : undefined,
          }}
        />
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.label}
        </span>
        <span className="text-mono-sm" style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}>
          {llmCalls > 0 && `${llmCalls} llm · `}
          {embedCalls > 0 && `${embedCalls} embed · `}
          {run.active ? 'running' : run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : ''}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 9, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ paddingBottom: 8 }}>
          {run.events.map(ev => (
            <EventRow key={ev.seq} ev={ev} startTs={run.startTs} />
          ))}
          {!run.active && run.summary && (
            <div
              className="text-mono-sm"
              style={{
                margin: '6px 12px 4px 24px', fontSize: 10.5,
                color: run.failed ? 'var(--signal-red)' : 'var(--signal-green)',
              }}
            >
              ✓ {run.summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * CognitionTrace — header toggle + slide-in panel streaming the live
 * cognee ↔ LLM pipeline. Mounted once in AppShell.
 */
export default function CognitionTrace() {
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    listen<TraceEvent>('cognition-trace', ({ payload }) => {
      setRuns(prev => applyEvent(prev, payload));
    }).then(fn => {
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(() => {
      // Not running inside Tauri — panel stays empty
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const anyActive = useMemo(() => runs.some(r => r.active), [runs]);

  return (
    <>
      {/* Header toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Cognition Trace — watch cognee reason with the LLM in real time"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '4px 12px', borderRadius: 'var(--radius-pill)',
          background: open ? 'var(--bg-raised)' : 'transparent',
          border: '1px solid var(--border-hairline)',
          color: anyActive ? 'var(--accent-cool)' : 'var(--text-muted)',
          cursor: 'pointer', fontSize: 11.5, fontWeight: 500,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <span
          style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: anyActive ? 'var(--accent-cool)' : 'var(--text-muted)',
            animation: anyActive ? 'pulse-dot 1.2s ease-in-out infinite' : undefined,
            opacity: anyActive ? 1 : 0.4,
          }}
        />
        Cognition Trace
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: 'fixed', top: 48, right: 0, bottom: 0, width: 430,
            background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-hairline)',
            boxShadow: 'var(--shadow-raised)', zIndex: 'var(--z-overlay)' as unknown as number,
            display: 'flex', flexDirection: 'column',
            animation: 'slide-in-right 0.2s ease',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid var(--border-hairline)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Cognition Trace
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {runs.length > 0 && (
                <button
                  onClick={() => setRuns([])}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 10.5, cursor: 'pointer' }}
                >
                  clear
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer' }}
              >
                ✕
              </button>
            </span>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
            {runs.length === 0 ? (
              <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.7 }}>
                Ingest a document or ask a question —<br />
                every cognee stage, LLM prompt/response, and<br />
                embedding batch will stream here in real time.
              </div>
            ) : (
              runs.map((run, i) => <RunSection key={run.id} run={run} defaultOpen={i === 0} />)
            )}
          </div>

          <div style={{
            padding: '7px 14px', borderTop: '1px solid var(--border-hairline)',
            fontSize: 10, color: 'var(--text-muted)',
          }}>
            Live instrumentation of cognee's pipelines — real model calls, nothing simulated.
          </div>
        </div>
      )}
    </>
  );
}
