import { useEffect, useRef } from 'react';
import { demoTopologyNodes } from '../data/demoData';

/**
 * TopologyStrip — persistent horizontal SVG band showing a simplified
 * graph silhouette. Pulses amber at disrupted node locations.
 * 
 * This is the signature element: always visible, functional motion only.
 * It answers "is something happening right now" without navigation.
 */
export default function TopologyStrip() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Force re-render on resize to keep strip responsive
    const handleResize = () => {
      if (svgRef.current) {
        svgRef.current.setAttribute('width', String(svgRef.current.parentElement?.clientWidth || 800));
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const nodes = demoTopologyNodes;
  const height = 36;

  return (
    <div className="topology-strip">
      <svg
        ref={svgRef}
        className="topology-strip__canvas"
        height={height}
        preserveAspectRatio="none"
      >
        {/* Edge lines connecting nodes */}
        {nodes.slice(0, -1).map((node, i) => {
          const next = nodes[i + 1];
          const isDisruptedEdge = node.disrupted || next.disrupted;
          return (
            <line
              key={`edge-${i}`}
              x1={`${node.x * 100}%`}
              y1={height / 2}
              x2={`${next.x * 100}%`}
              y2={height / 2}
              stroke={isDisruptedEdge ? 'var(--signal-amber)' : 'var(--border-hairline)'}
              strokeWidth={isDisruptedEdge ? 1.5 : 1}
              opacity={isDisruptedEdge ? 0.6 : 0.4}
            />
          );
        })}

        {/* Additional cross-connections for visual complexity */}
        {nodes.filter((_, i) => i % 3 === 0).slice(0, -1).map((node, i, arr) => {
          if (i >= arr.length - 1) return null;
          const target = arr[i + 1];
          return (
            <line
              key={`cross-${i}`}
              x1={`${node.x * 100}%`}
              y1={height / 2 - 6}
              x2={`${target.x * 100}%`}
              y2={height / 2 + 6}
              stroke="var(--border-hairline)"
              strokeWidth={0.5}
              opacity={0.3}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node, i) => (
          <g key={`node-${i}`}>
            {/* Pulse glow for disrupted nodes */}
            {node.disrupted && (
              <circle
                cx={`${node.x * 100}%`}
                cy={height / 2}
                r={8}
                fill="var(--signal-amber)"
                opacity={0.15}
                style={{ animation: 'pulse-amber 2s ease-in-out infinite' }}
              />
            )}
            <circle
              cx={`${node.x * 100}%`}
              cy={height / 2}
              r={node.disrupted ? 3.5 : 2.5}
              fill={node.disrupted ? 'var(--signal-amber)' : 'var(--text-muted)'}
              opacity={node.disrupted ? 1 : 0.5}
              style={node.disrupted ? { animation: 'pulse-amber 2s ease-in-out infinite' } : undefined}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
