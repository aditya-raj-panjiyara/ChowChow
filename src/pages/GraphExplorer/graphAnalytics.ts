import type { Entity, Relationship } from '../../types';

/* ============================================================
   Graph Analytics — dependency criticality & structural risk
   Pure functions over the in-memory graph; no backend calls.
   ============================================================ */

export interface NodeAnalytics {
  /** 0..1 — how much the business depends on this node. */
  criticality: number;
  /** Structural single point of failure (articulation point). */
  isSpof: boolean;
  /** Distinct nodes reachable downstream (supply direction). */
  downstreamReach: number;
  /** Active-edge degree. */
  degree: number;
}

/**
 * Compute per-node criticality and single-point-of-failure flags.
 *
 * Criticality blends normalized degree (how connected) with normalized
 * downstream reach (how much of the network sits behind this node).
 * SPOF = articulation point of the active undirected graph — removing
 * the node disconnects part of the supply network.
 */
export function analyzeGraph(
  entities: Entity[],
  relationships: Relationship[],
): Map<string, NodeAnalytics> {
  const ids = entities.map(e => e.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;

  const active = relationships.filter(
    r => !r.deprecated && index.has(r.sourceId) && index.has(r.targetId),
  );

  // Adjacency: undirected (for degree + articulation) and directed (for reach).
  const undirected: number[][] = Array.from({ length: n }, () => []);
  const directed: number[][] = Array.from({ length: n }, () => []);
  for (const r of active) {
    const a = index.get(r.sourceId)!;
    const b = index.get(r.targetId)!;
    undirected[a].push(b);
    undirected[b].push(a);
    directed[a].push(b);
  }

  // Downstream reach per node (BFS over directed edges).
  const reach = new Array<number>(n).fill(0);
  for (let s = 0; s < n; s++) {
    const seen = new Set<number>([s]);
    const queue = [s];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of directed[cur]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    reach[s] = seen.size - 1;
  }

  // Articulation points — iterative Tarjan over the undirected graph.
  const disc = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);
  const isArticulation = new Array<boolean>(n).fill(false);
  let timer = 0;

  for (let root = 0; root < n; root++) {
    if (disc[root] !== -1) continue;
    let rootChildren = 0;
    // Stack of [node, neighbor-cursor]
    const stack: Array<[number, number]> = [[root, 0]];
    disc[root] = low[root] = timer++;

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [u] = frame;
      if (frame[1] < undirected[u].length) {
        const v = undirected[u][frame[1]++];
        if (disc[v] === -1) {
          parent[v] = u;
          if (u === root) rootChildren++;
          disc[v] = low[v] = timer++;
          stack.push([v, 0]);
        } else if (v !== parent[u]) {
          low[u] = Math.min(low[u], disc[v]);
        }
      } else {
        stack.pop();
        const p = parent[u];
        if (p !== -1) {
          low[p] = Math.min(low[p], low[u]);
          if (p !== root && low[u] >= disc[p]) {
            isArticulation[p] = true;
          }
        }
      }
    }
    if (rootChildren > 1) isArticulation[root] = true;
  }

  const degree = undirected.map(adj => adj.length);
  const maxDegree = Math.max(1, ...degree);
  const maxReach = Math.max(1, ...reach);

  const result = new Map<string, NodeAnalytics>();
  ids.forEach((id, i) => {
    const score = 0.45 * (degree[i] / maxDegree) + 0.55 * (reach[i] / maxReach);
    result.set(id, {
      criticality: Math.round(score * 100) / 100,
      isSpof: isArticulation[i],
      downstreamReach: reach[i],
      degree: degree[i],
    });
  });
  return result;
}

/** Top N most critical nodes, SPOFs ranked first within equal scores. */
export function topCritical(
  entities: Entity[],
  analytics: Map<string, NodeAnalytics>,
  count: number,
): Array<Entity & NodeAnalytics> {
  return entities
    .map(e => ({ ...e, ...(analytics.get(e.id) ?? { criticality: 0, isSpof: false, downstreamReach: 0, degree: 0 }) }))
    .sort((a, b) => b.criticality - a.criticality || Number(b.isSpof) - Number(a.isSpof))
    .slice(0, count);
}
