//! Blast Radius Service — disruption cascade simulation.
//!
//! Implements the predictive risk analysis engine: given a disrupted entity,
//! performs a hop-ordered breadth-first traversal of the knowledge graph,
//! scoring downstream impact with per-hop decay weighted by edge strength.
//! Produces severity per affected entity, an estimated financial exposure,
//! and a prioritized mitigation roadmap.
//!
//! Storage-agnostic: reads the graph exclusively through
//! `MemoryEngine::get_graph_snapshot()`, so it works identically against the
//! SQLite stub and cognee-rs.

use memory_engine::{GraphSnapshot, MemoryEngine};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

/// Per-hop impact decay — each hop away from the disruption origin
/// attenuates the impact score by this factor (before edge weighting).
const HOP_DECAY: f32 = 0.75;

/// Traversal cutoff — impacts below this score are considered absorbed
/// by normal supply buffers and excluded from the blast radius.
const IMPACT_FLOOR: f32 = 0.05;

/// Hard hop limit — keeps the simulation bounded on dense graphs.
const MAX_HOPS: u32 = 6;

/// One entity affected by the simulated disruption.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AffectedEntity {
    pub id: String,
    pub name: String,
    pub entity_type: String,
    /// Hop distance from the disruption origin (1 = directly connected).
    pub hop: u32,
    /// 0.0–1.0 impact score after decay and edge weighting.
    pub impact_score: f32,
    /// "critical" | "elevated" | "watch"
    pub severity: String,
    /// Entity-ID chain from the origin to this entity (inclusive of both ends).
    pub path_ids: Vec<String>,
    /// Entity-name chain matching `path_ids`.
    pub path_names: Vec<String>,
    /// Estimated financial exposure over the scenario duration, USD.
    pub estimated_exposure_usd: f64,
    /// Days of buffer stock before this entity feels the disruption.
    pub buffer_days: u32,
}

/// One step in the generated mitigation roadmap.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MitigationStep {
    /// 1 = most urgent.
    pub priority: u32,
    pub action: String,
    pub target_entity_id: String,
    pub target_entity_name: String,
}

/// Full result of a blast radius simulation.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlastRadiusResult {
    pub origin_id: String,
    pub origin_name: String,
    pub origin_type: String,
    pub duration_days: u32,
    /// Affected entities, hop-ordered (nearest first), then by impact.
    pub affected: Vec<AffectedEntity>,
    pub total_exposure_usd: f64,
    pub max_hop: u32,
    pub mitigations: Vec<MitigationStep>,
}

/// Simulates disruption cascades over the knowledge graph.
pub struct BlastRadiusService {
    engine: Arc<dyn MemoryEngine>,
}

impl BlastRadiusService {
    pub fn new(engine: Arc<dyn MemoryEngine>) -> Self {
        Self { engine }
    }

    /// Run a blast radius simulation from `entity_id` over `duration_days`.
    pub async fn simulate(
        &self,
        entity_id: &str,
        duration_days: u32,
    ) -> Result<BlastRadiusResult, String> {
        let snapshot = self
            .engine
            .get_graph_snapshot()
            .await
            .map_err(|e| e.to_string())?;

        simulate_over_snapshot(&snapshot, entity_id, duration_days)
    }
}

/// Pure simulation over an in-memory snapshot — unit-testable without an engine.
pub fn simulate_over_snapshot(
    snapshot: &GraphSnapshot,
    entity_id: &str,
    duration_days: u32,
) -> Result<BlastRadiusResult, String> {
    let entities: HashMap<&str, &memory_engine::MemoryEntity> = snapshot
        .entities
        .iter()
        .map(|e| (e.id.as_str(), e))
        .collect();

    let origin = entities
        .get(entity_id)
        .ok_or_else(|| format!("entity not found in graph: {entity_id}"))?;

    // Undirected adjacency over active edges only — disruption ripples both
    // up- and downstream, but deprecated edges never carry impact.
    // Downstream (from → to) edges carry full weight; upstream propagation
    // is dampened since disruption flows with the supply direction.
    let mut adjacency: HashMap<&str, Vec<(&str, f32)>> = HashMap::new();
    for rel in &snapshot.relationships {
        if !rel.active {
            continue;
        }
        let w = rel.weight.clamp(0.0, 1.0);
        adjacency
            .entry(rel.from_id.as_str())
            .or_default()
            .push((rel.to_id.as_str(), w));
        adjacency
            .entry(rel.to_id.as_str())
            .or_default()
            .push((rel.from_id.as_str(), w * 0.5));
    }

    // BFS with impact scores — keep the strongest impact per entity.
    let mut best: HashMap<&str, (u32, f32, Vec<&str>)> = HashMap::new();
    let mut visited: HashSet<&str> = HashSet::new();
    let mut queue: VecDeque<(&str, u32, f32, Vec<&str>)> = VecDeque::new();
    queue.push_back((entity_id, 0, 1.0, vec![entity_id]));
    visited.insert(entity_id);

    while let Some((current, hop, impact, path)) = queue.pop_front() {
        if hop >= MAX_HOPS {
            continue;
        }
        if let Some(neighbors) = adjacency.get(current) {
            for (next, edge_weight) in neighbors {
                if visited.contains(next) {
                    continue;
                }
                let next_impact = impact * HOP_DECAY * edge_weight;
                if next_impact < IMPACT_FLOOR {
                    continue;
                }
                visited.insert(next);
                let mut next_path = path.clone();
                next_path.push(next);
                best.insert(next, (hop + 1, next_impact, next_path.clone()));
                queue.push_back((next, hop + 1, next_impact, next_path));
            }
        }
    }

    let mut affected: Vec<AffectedEntity> = best
        .into_iter()
        .filter_map(|(id, (hop, impact, path))| {
            let entity = entities.get(id)?;
            let severity = severity_for(impact);
            let exposure = daily_exposure_usd(&entity.entity_type) * impact as f64
                * duration_days as f64;
            let path_names = path
                .iter()
                .map(|pid| {
                    entities
                        .get(pid)
                        .map(|e| e.name.clone())
                        .unwrap_or_else(|| (*pid).to_string())
                })
                .collect();
            Some(AffectedEntity {
                id: entity.id.clone(),
                name: entity.name.clone(),
                entity_type: entity.entity_type.clone(),
                hop,
                impact_score: impact,
                severity: severity.to_string(),
                path_ids: path.iter().map(|s| s.to_string()).collect(),
                path_names,
                estimated_exposure_usd: exposure,
                buffer_days: buffer_days_for(&entity.entity_type, hop),
            })
        })
        .collect();

    // Hop-ordered, strongest impact first within each hop.
    affected.sort_by(|a, b| {
        a.hop
            .cmp(&b.hop)
            .then(b.impact_score.total_cmp(&a.impact_score))
    });

    let total_exposure_usd = affected.iter().map(|a| a.estimated_exposure_usd).sum();
    let max_hop = affected.iter().map(|a| a.hop).max().unwrap_or(0);
    let mitigations = build_mitigations(&affected);

    Ok(BlastRadiusResult {
        origin_id: origin.id.clone(),
        origin_name: origin.name.clone(),
        origin_type: origin.entity_type.clone(),
        duration_days,
        affected,
        total_exposure_usd,
        max_hop,
        mitigations,
    })
}

fn severity_for(impact: f32) -> &'static str {
    if impact >= 0.5 {
        "critical"
    } else if impact >= 0.2 {
        "elevated"
    } else {
        "watch"
    }
}

/// Heuristic daily exposure by entity type, USD. Deliberately coarse — the
/// point is relative ranking across the radius, not accounting-grade numbers.
fn daily_exposure_usd(entity_type: &str) -> f64 {
    let t = entity_type.to_lowercase();
    if t.contains("customer") {
        250_000.0
    } else if t.contains("factory") || t.contains("plant") || t.contains("assembly") {
        180_000.0
    } else if t.contains("port") || t.contains("hub") || t.contains("route") {
        120_000.0
    } else if t.contains("supplier") || t.contains("vendor") {
        90_000.0
    } else if t.contains("material") || t.contains("component") {
        60_000.0
    } else {
        40_000.0
    }
}

/// Heuristic buffer stock before an entity feels the disruption:
/// further hops have more pipeline inventory between them and the origin.
fn buffer_days_for(entity_type: &str, hop: u32) -> u32 {
    let t = entity_type.to_lowercase();
    let type_buffer = if t.contains("customer") {
        4
    } else if t.contains("factory") || t.contains("plant") {
        3
    } else {
        1
    };
    hop * 2 + type_buffer
}

#[cfg(test)]
mod tests {
    use super::*;
    use memory_engine::{MemoryEntity, MemoryRelationship};

    fn entity(id: &str, name: &str, entity_type: &str) -> MemoryEntity {
        MemoryEntity {
            id: id.to_string(),
            entity_type: entity_type.to_string(),
            name: name.to_string(),
            attributes: serde_json::Value::Null,
        }
    }

    fn edge(from: &str, to: &str, weight: f32, active: bool) -> MemoryRelationship {
        MemoryRelationship {
            from_id: from.to_string(),
            to_id: to.to_string(),
            relationship_type: "supplies".to_string(),
            weight,
            active,
        }
    }

    /// Port → Factory → Customer chain: hop ordering, decay, and the
    /// inactive-edge cutoff all in one graph.
    #[test]
    fn cascade_is_hop_ordered_and_skips_deprecated_edges() {
        let snapshot = GraphSnapshot {
            entities: vec![
                entity("P1", "Port of Santos", "Port"),
                entity("F1", "Wolfsburg Assembly", "Factory"),
                entity("C1", "Stellantis NV", "Customer"),
                entity("X1", "Unreachable Co", "Supplier"),
            ],
            relationships: vec![
                edge("P1", "F1", 1.0, true),
                edge("F1", "C1", 1.0, true),
                edge("P1", "X1", 1.0, false), // deprecated — must not propagate
            ],
        };

        let result = simulate_over_snapshot(&snapshot, "P1", 14).unwrap();

        assert_eq!(result.origin_name, "Port of Santos");
        assert_eq!(result.affected.len(), 2);
        assert_eq!(result.affected[0].id, "F1");
        assert_eq!(result.affected[0].hop, 1);
        assert_eq!(result.affected[1].id, "C1");
        assert_eq!(result.affected[1].hop, 2);
        // Impact decays with distance
        assert!(result.affected[0].impact_score > result.affected[1].impact_score);
        assert!(result.total_exposure_usd > 0.0);
        assert!(!result.mitigations.is_empty());
    }

    #[test]
    fn unknown_origin_is_an_error() {
        let snapshot = GraphSnapshot {
            entities: vec![],
            relationships: vec![],
        };
        assert!(simulate_over_snapshot(&snapshot, "nope", 7).is_err());
    }
}

/// Generate a prioritized mitigation roadmap from the most impacted entities.
fn build_mitigations(affected: &[AffectedEntity]) -> Vec<MitigationStep> {
    let mut steps: Vec<MitigationStep> = Vec::new();
    let mut ranked: Vec<&AffectedEntity> = affected
        .iter()
        .filter(|a| a.severity != "watch")
        .collect();
    ranked.sort_by(|a, b| b.impact_score.total_cmp(&a.impact_score));

    for entity in ranked.into_iter().take(6) {
        let t = entity.entity_type.to_lowercase();
        let action = if t.contains("supplier") || t.contains("vendor") {
            format!(
                "Qualify an alternate supplier for {} — sole-source exposure amplifies this disruption",
                entity.name
            )
        } else if t.contains("port") || t.contains("hub") || t.contains("route") {
            format!(
                "Re-route shipments away from {} via secondary logistics corridors",
                entity.name
            )
        } else if t.contains("factory") || t.contains("plant") || t.contains("assembly") {
            format!(
                "Pre-build inventory or shift production loads away from {} (~{} days of buffer remain)",
                entity.name, entity.buffer_days
            )
        } else if t.contains("customer") {
            format!(
                "Notify {} and negotiate revised delivery schedules before buffer stock runs out (~{} days)",
                entity.name, entity.buffer_days
            )
        } else if t.contains("material") || t.contains("component") {
            format!(
                "Secure spot-market inventory of {} to bridge the disruption window",
                entity.name
            )
        } else {
            format!("Review dependency on {} and identify substitution options", entity.name)
        };

        steps.push(MitigationStep {
            priority: steps.len() as u32 + 1,
            action,
            target_entity_id: entity.id.clone(),
            target_entity_name: entity.name.clone(),
        });
    }

    steps
}
