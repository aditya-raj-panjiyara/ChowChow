import { describe, it, expect } from 'vitest';
import { analyzeGraph, topCritical } from './graphAnalytics';
import type { Entity, Relationship } from '../../types';

/* Run with: `npm test` (or `bun run test`) */

const e = (id: string, name: string): Entity => ({
  id,
  name,
  type: 'supplier',
  connectionCount: 0,
});

const r = (id: string, sourceId: string, targetId: string, deprecated = false): Relationship => ({
  id,
  sourceId,
  targetId,
  label: 'ships_to',
  deprecated,
});

describe('analyzeGraph — dependency criticality', () => {
  it('scores the chokepoint of a chain highest', () => {
    // A → HUB → C, A → HUB → D : HUB carries everything downstream.
    const entities = [e('A', 'Origin'), e('HUB', 'Chokepoint'), e('C', 'Customer C'), e('D', 'Customer D')];
    const rels = [r('1', 'A', 'HUB'), r('2', 'HUB', 'C'), r('3', 'HUB', 'D')];

    const analytics = analyzeGraph(entities, rels);
    const hub = analytics.get('HUB')!;
    const leafC = analytics.get('C')!;

    expect(hub.criticality).toBeGreaterThan(leafC.criticality);
    expect(hub.degree).toBe(3);
    expect(hub.downstreamReach).toBe(2); // C and D
    expect(leafC.downstreamReach).toBe(0);
  });

  it('flags articulation points as single points of failure', () => {
    // A - B - C in a line: B is a SPOF. Add A-C to close the triangle and it stops being one.
    const entities = [e('A', 'A'), e('B', 'B'), e('C', 'C')];

    const line = analyzeGraph(entities, [r('1', 'A', 'B'), r('2', 'B', 'C')]);
    expect(line.get('B')!.isSpof).toBe(true);
    expect(line.get('A')!.isSpof).toBe(false);

    const triangle = analyzeGraph(entities, [r('1', 'A', 'B'), r('2', 'B', 'C'), r('3', 'A', 'C')]);
    expect(triangle.get('B')!.isSpof).toBe(false);
  });

  it('ignores deprecated edges — corrected routes stop counting', () => {
    const entities = [e('A', 'A'), e('B', 'B'), e('C', 'C')];
    const analytics = analyzeGraph(entities, [
      r('1', 'A', 'B'),
      r('2', 'B', 'C', true), // deprecated by a correction
    ]);

    expect(analytics.get('B')!.downstreamReach).toBe(0);
    expect(analytics.get('B')!.isSpof).toBe(false);
    expect(analytics.get('C')!.degree).toBe(0);
  });

  it('handles empty and disconnected graphs without exploding', () => {
    expect(analyzeGraph([], []).size).toBe(0);

    const disconnected = analyzeGraph([e('A', 'A'), e('B', 'B')], []);
    expect(disconnected.get('A')!.criticality).toBe(0);
    expect(disconnected.get('A')!.isSpof).toBe(false);
  });
});

describe('topCritical — ranked dependency panel', () => {
  it('returns the requested count ordered by criticality', () => {
    const entities = [e('A', 'Origin'), e('HUB', 'Chokepoint'), e('C', 'C'), e('D', 'D')];
    const rels = [r('1', 'A', 'HUB'), r('2', 'HUB', 'C'), r('3', 'HUB', 'D')];
    const analytics = analyzeGraph(entities, rels);

    const top = topCritical(entities, analytics, 2);
    expect(top).toHaveLength(2);
    expect(top[0].id).toBe('HUB');
    expect(top[0].criticality).toBeGreaterThanOrEqual(top[1].criticality);
  });
});
