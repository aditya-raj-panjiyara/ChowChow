import { useRef, useCallback } from 'react';
import type { Entity, Relationship } from '../../types';

interface SimulationNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  entity: Entity;
  /** Pinned nodes are not affected by forces (user has manually placed them) */
  pinned: boolean;
  /** Width/height of the rendered card */
  width: number;
  height: number;
}

/**
 * Force simulation for ComfyUI-style rectangular nodes.
 * Nodes that have been manually dragged become "pinned" and resist forces.
 * Runs for a fixed number of ticks then settles.
 */
export function useForceSimulation() {
  const frameRef = useRef<number>(0);
  const isRunningRef = useRef(false);
  const tickRef = useRef(0);
  const nodesRef = useRef<SimulationNode[]>([]);

  const initializeNodes = useCallback((
    entities: Entity[],
    width: number,
    height: number,
    existingNodes?: SimulationNode[]
  ): SimulationNode[] => {
    const existingMap = new Map(
      (existingNodes || []).map(n => [n.id, n])
    );

    return entities.map((entity, i) => {
      const existing = existingMap.get(entity.id);
      if (existing) {
        return { ...existing, entity };
      }

      // Distribute in a grid-like pattern for ComfyUI look
      const cols = Math.ceil(Math.sqrt(entities.length));
      const rows = Math.ceil(entities.length / cols);
      const row = Math.floor(i / cols);
      const col = i % cols;
      const spacingX = 280;
      const spacingY = 200;
      const startX = Math.max(100, (width - cols * spacingX) / 2);
      const startY = Math.max(80, (height - rows * spacingY) / 2);

      return {
        id: entity.id,
        x: startX + col * spacingX + (Math.random() - 0.5) * 40,
        y: startY + row * spacingY + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        entity,
        pinned: false,
        width: 220,
        height: 140,
      };
    });
  }, []);

  const simulate = useCallback((
    nodes: SimulationNode[],
    relationships: Relationship[],
    onTick: (nodes: SimulationNode[]) => void,
    options?: { gentle?: boolean; layoutMode?: 'free' | 'board' }
  ) => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }

    nodesRef.current = nodes;
    // Gentle mode (live incremental updates): start with decayed alpha so the
    // settled layout is nudged, not jolted, on every restart.
    tickRef.current = options?.gentle ? 45 : 0;
    isRunningRef.current = true;

    const tick = () => {
      const currentNodes = nodesRef.current;
      if (!isRunningRef.current || currentNodes.length === 0) return;

      const alpha = Math.max(0.001, 0.15 * Math.pow(0.97, tickRef.current));

      // Reset forces
      for (const n of currentNodes) {
        if (n.pinned) continue;
        n.vx = 0;
        n.vy = 0;
      }

      // Column centering force (Board View)
      if (options?.layoutMode === 'board') {
        for (const n of currentNodes) {
          if (n.pinned) continue;
          n.vy += (400 - n.y) * 0.05 * alpha;
        }
      }

      // Node repulsion (account for card size)
      for (let i = 0; i < currentNodes.length; i++) {
        for (let j = i + 1; j < currentNodes.length; j++) {
          const a = currentNodes[i];
          const b = currentNodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(10, Math.sqrt(dx * dx + dy * dy));
          const minDist = (a.width + b.width) / 2 + 40;

          if (dist < minDist * 2) {
            const force = -200 * alpha / (dist * dist) * minDist;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
            if (!b.pinned) { b.vx += fx; b.vy += fy; }
          }
        }
      }

      // Edge attraction
      for (const rel of relationships) {
        const source = currentNodes.find(n => n.id === rel.sourceId);
        const target = currentNodes.find(n => n.id === rel.targetId);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const targetDist = 280;
        const force = (dist - targetDist) * 0.003 * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!source.pinned) { source.vx += fx; source.vy += fy; }
        if (!target.pinned) { target.vx -= fx; target.vy -= fy; }
      }

      // Apply velocities
      for (const node of currentNodes) {
        if (node.pinned) continue;
        if (options?.layoutMode === 'board') {
          const columnMap: Record<string, number> = {
            material: 0,
            supplier: 1,
            transit: 2,
            port: 3,
            factory: 4,
            customer: 5,
          };
          const colIdx = columnMap[node.entity.type] ?? 1;
          const targetX = colIdx * 450 + 200;
          node.x += (targetX - node.x) * 0.25;
          node.vx = 0;
        } else {
          node.x += node.vx * 0.8;
        }
        node.y += node.vy * 0.8;
      }

      tickRef.current++;
      onTick(currentNodes.map(n => ({ ...n })));

      if (tickRef.current < 150 && isRunningRef.current) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      isRunningRef.current = false;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, []);

  const stop = useCallback(() => {
    isRunningRef.current = false;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
  }, []);

  return { initializeNodes, simulate, stop };
}

export type { SimulationNode };
