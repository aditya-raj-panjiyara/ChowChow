//! Schema-guided repair of LLM structured output.
//!
//! Local models routinely return JSON that is *almost* right: `label`
//! instead of `name`, a wrapper key around the payload, numbers as strings,
//! a single object where an array was expected. cognee-lib deserializes
//! strictly (`missing field 'name'` fails the whole cognify pipeline), so
//! [`repair`] walks the model output against the JSON schema cognee supplied
//! and fixes what it can *before* deserialization:
//!
//! 1. `$ref` / `anyOf` / `allOf` resolution against the schema root
//! 2. wrapper-key unwrapping (`{"knowledge_graph": {...}}` → `{...}`)
//! 3. required fields filled from alias keys (`label`→`name`, `from`→`source_node_id`…)
//! 4. scalar coercion (number↔string, string bools, JSON embedded in strings)
//! 5. last-resort defaults so the pipeline degrades instead of dying
//!
//! Every fix is recorded so the Cognition Trace can show what was repaired.

use serde_json::{Map, Value};

const MAX_REF_DEPTH: usize = 8;

/// Repair `value` in place against `schema`. Returns the repaired value and
/// a human-readable list of the fixes applied (empty = output was clean).
pub fn repair(value: Value, schema: &Value) -> (Value, Vec<String>) {
    let mut fixes = Vec::new();
    let out = repair_node(value, schema, schema, &mut fixes, "$".to_string());
    (out, fixes)
}

fn norm(k: &str) -> String {
    k.to_lowercase().replace(['_', '-', ' '], "")
}

/// Follow `$ref` chains (bounded) against the schema root.
fn resolve<'a>(mut s: &'a Value, root: &'a Value) -> &'a Value {
    for _ in 0..MAX_REF_DEPTH {
        let Some(r) = s.get("$ref").and_then(Value::as_str) else {
            return s;
        };
        let Some(path) = r.strip_prefix("#/") else {
            return s;
        };
        let mut cur = root;
        for seg in path.split('/') {
            match cur.get(seg) {
                Some(n) => cur = n,
                None => return s,
            }
        }
        s = cur;
    }
    s
}

/// First declared non-null type of a schema node.
fn type_of(s: &Value) -> Option<&str> {
    match s.get("type") {
        Some(Value::String(t)) => Some(t.as_str()),
        Some(Value::Array(ts)) => ts
            .iter()
            .filter_map(Value::as_str)
            .find(|t| *t != "null"),
        _ => None,
    }
}

fn allows_null(s: &Value) -> bool {
    match s.get("type") {
        Some(Value::String(t)) => t == "null",
        Some(Value::Array(ts)) => ts.iter().any(|t| t.as_str() == Some("null")),
        _ => false,
    }
}

fn variants(s: &Value) -> Option<&Vec<Value>> {
    s.get("anyOf")
        .or_else(|| s.get("oneOf"))
        .and_then(Value::as_array)
}

fn loosely_matches(v: &Value, s: &Value) -> bool {
    match type_of(s) {
        Some("object") => v.is_object(),
        Some("array") => v.is_array(),
        Some("string") => v.is_string(),
        Some("integer") | Some("number") => v.is_number(),
        Some("boolean") => v.is_boolean(),
        _ => s.get("type").is_none() && v.is_null(),
    }
}

fn repair_node(
    value: Value,
    schema: &Value,
    root: &Value,
    fixes: &mut Vec<String>,
    path: String,
) -> Value {
    let s = resolve(schema, root);

    if let Some(vars) = variants(s) {
        if value.is_null() && vars.iter().any(|v| allows_null(resolve(v, root))) {
            return Value::Null;
        }
        let resolved: Vec<&Value> = vars.iter().map(|v| resolve(v, root)).collect();
        let pick = resolved
            .iter()
            .find(|v| loosely_matches(&value, v))
            .or_else(|| resolved.iter().find(|v| !allows_null(v)));
        if let Some(sub) = pick {
            return repair_node(value, sub, root, fixes, path);
        }
        return value;
    }
    if let Some(all) = s.get("allOf").and_then(Value::as_array) {
        if let Some(first) = all.first() {
            return repair_node(value, first, root, fixes, path);
        }
    }

    match type_of(s) {
        Some("object") => repair_object(value, s, root, fixes, path),
        Some("array") => repair_array(value, s, root, fixes, path),
        Some("string") => coerce_string(value, fixes, &path),
        Some("integer") | Some("number") => coerce_number(value, fixes, &path),
        Some("boolean") => coerce_bool(value, fixes, &path),
        _ => value,
    }
}

fn repair_object(
    value: Value,
    s: &Value,
    root: &Value,
    fixes: &mut Vec<String>,
    path: String,
) -> Value {
    let mut map = match value {
        Value::Object(m) => m,
        Value::Array(mut items) if items.first().is_some_and(Value::is_object) => {
            fixes.push(format!("{path}: took first element of unexpected array"));
            match items.remove(0) {
                Value::Object(m) => m,
                _ => Map::new(),
            }
        }
        Value::String(text) => match extract_json_object(&text) {
            Some(m) => {
                fixes.push(format!("{path}: parsed JSON embedded in a string"));
                m
            }
            None => {
                fixes.push(format!("{path}: replaced non-object with empty object"));
                Map::new()
            }
        },
        other => {
            fixes.push(format!(
                "{path}: replaced {} with empty object",
                json_kind(&other)
            ));
            Map::new()
        }
    };

    let required: Vec<String> = s
        .get("required")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_default();

    // Unwrap a lone wrapper key hiding the real payload:
    // {"knowledge_graph": {"nodes": [...], "edges": [...]}}
    if map.len() == 1 && !required.is_empty() && !required.iter().any(|r| map.contains_key(r)) {
        let only_key = map.keys().next().cloned().unwrap_or_default();
        let inner_has_required = matches!(
            map.get(&only_key),
            Some(Value::Object(inner))
                if required.iter().any(|r| inner.keys().any(|k| norm(k) == norm(r)))
        );
        if inner_has_required {
            if let Some(Value::Object(inner)) = map.remove(&only_key) {
                fixes.push(format!("{path}: unwrapped wrapper key \"{only_key}\""));
                map = inner;
            }
        }
    }

    if let Some(props) = s.get("properties").and_then(Value::as_object) {
        // Recurse into properties that are present.
        for (key, sub) in props {
            if let Some(v) = map.remove(key) {
                let repaired = repair_node(v, sub, root, fixes, format!("{path}.{key}"));
                map.insert(key.clone(), repaired);
            }
        }

        for req in &required {
            let sub = props.get(req.as_str());
            if let Some(existing) = map.get(req.as_str()) {
                // Required but null and schema doesn't allow null → default.
                if existing.is_null() {
                    let sr = sub.map(|x| resolve(x, root));
                    if let Some(sr) = sr {
                        if !allows_null(sr) && variants(sr).is_none() {
                            fixes.push(format!("{path}.{req}: replaced null with default"));
                            map.insert(req.clone(), default_for(sr, req, root));
                        }
                    }
                }
                continue;
            }
            // Missing: try an alias key first, then fall back to a default.
            if let Some(alias_key) = find_alias(&map, req) {
                let v = map.get(&alias_key).cloned().unwrap_or(Value::Null);
                fixes.push(format!("{path}.{req}: filled from \"{alias_key}\""));
                let repaired = match sub {
                    Some(sc) => repair_node(v, sc, root, fixes, format!("{path}.{req}")),
                    None => v,
                };
                map.insert(req.clone(), repaired);
            } else {
                let dv = sub
                    .map(|sc| default_for(resolve(sc, root), req, root))
                    .unwrap_or(Value::Null);
                fixes.push(format!("{path}.{req}: missing — filled with default"));
                map.insert(req.clone(), dv);
            }
        }
    }

    Value::Object(map)
}

fn repair_array(
    value: Value,
    s: &Value,
    root: &Value,
    fixes: &mut Vec<String>,
    path: String,
) -> Value {
    let items = match value {
        Value::Array(a) => a,
        Value::Null => {
            fixes.push(format!("{path}: null replaced with empty array"));
            Vec::new()
        }
        Value::String(text) => match extract_json_array(&text) {
            Some(a) => {
                fixes.push(format!("{path}: parsed JSON array embedded in a string"));
                a
            }
            None => {
                fixes.push(format!("{path}: replaced string with empty array"));
                Vec::new()
            }
        },
        other => {
            fixes.push(format!("{path}: wrapped single {} in array", json_kind(&other)));
            vec![other]
        }
    };

    let item_schema = s.get("items");
    Value::Array(
        items
            .into_iter()
            .enumerate()
            .map(|(i, v)| match item_schema {
                Some(is) => repair_node(v, is, root, fixes, format!("{path}[{i}]")),
                None => v,
            })
            .collect(),
    )
}

/// Alias keys the model commonly emits for cognee's canonical field names.
fn find_alias(map: &Map<String, Value>, field: &str) -> Option<String> {
    let target = norm(field);
    if let Some(k) = map.keys().find(|k| norm(k) == target) {
        return Some(k.clone());
    }
    let aliases: &[&str] = match target.as_str() {
        "name" => &["label", "title", "entityname", "nodename", "entity", "value", "text", "id"],
        "id" => &["name", "label", "identifier", "uuid", "key"],
        "type" | "entitytype" | "nodetype" => &["entitytype", "nodetype", "type", "category", "kind", "label"],
        "relationshipname" => &[
            "relationship", "relationshiptype", "relation", "predicate",
            "label", "edgetype", "type", "name",
        ],
        "sourcenodeid" => &["source", "sourceid", "from", "fromid", "src", "start", "subject"],
        "targetnodeid" => &["target", "targetid", "to", "toid", "dst", "end", "object"],
        "description" => &["desc", "summary", "text", "details", "content"],
        "nodes" => &["entities", "vertices"],
        "edges" => &["relationships", "relations", "links", "connections"],
        "summary" => &["text", "description", "content"],
        _ => &[],
    };
    for a in aliases {
        if let Some(k) = map.keys().find(|k| norm(k) == *a) {
            return Some(k.clone());
        }
    }
    None
}

/// Last-resort value satisfying `schema` for a missing required field.
fn default_for(schema: &Value, field: &str, root: &Value) -> Value {
    let s = resolve(schema, root);
    if let Some(d) = s.get("default") {
        return d.clone();
    }
    if let Some(vars) = variants(s) {
        if let Some(first) = vars.iter().map(|v| resolve(v, root)).find(|v| !allows_null(v)) {
            return default_for(first, field, root);
        }
    }
    match type_of(s) {
        Some("string") => {
            let f = norm(field);
            if f.contains("id") {
                Value::String(uuid::Uuid::new_v4().to_string())
            } else if f == "name" {
                Value::String("Unnamed".to_string())
            } else {
                Value::String(String::new())
            }
        }
        Some("integer") | Some("number") => Value::from(0),
        Some("boolean") => Value::Bool(false),
        Some("array") => Value::Array(Vec::new()),
        Some("object") => {
            let mut m = Map::new();
            if let (Some(props), Some(req)) = (
                s.get("properties").and_then(Value::as_object),
                s.get("required").and_then(Value::as_array),
            ) {
                for r in req.iter().filter_map(Value::as_str) {
                    if let Some(ps) = props.get(r) {
                        m.insert(r.to_string(), default_for(ps, r, root));
                    }
                }
            }
            Value::Object(m)
        }
        _ => Value::Null,
    }
}

fn coerce_string(value: Value, fixes: &mut Vec<String>, path: &str) -> Value {
    match value {
        Value::String(_) | Value::Null => value,
        Value::Number(n) => {
            fixes.push(format!("{path}: number coerced to string"));
            Value::String(n.to_string())
        }
        Value::Bool(b) => {
            fixes.push(format!("{path}: boolean coerced to string"));
            Value::String(b.to_string())
        }
        other => {
            fixes.push(format!("{path}: {} coerced to string", json_kind(&other)));
            Value::String(other.to_string())
        }
    }
}

fn coerce_number(value: Value, fixes: &mut Vec<String>, path: &str) -> Value {
    match value {
        Value::Number(_) | Value::Null => value,
        Value::String(text) => {
            let t = text.trim();
            if let Ok(i) = t.parse::<i64>() {
                fixes.push(format!("{path}: string coerced to integer"));
                Value::from(i)
            } else if let Ok(f) = t.parse::<f64>() {
                if let Some(n) = serde_json::Number::from_f64(f) {
                    fixes.push(format!("{path}: string coerced to number"));
                    Value::Number(n)
                } else {
                    Value::String(text)
                }
            } else {
                Value::String(text)
            }
        }
        other => other,
    }
}

fn coerce_bool(value: Value, fixes: &mut Vec<String>, path: &str) -> Value {
    match value {
        Value::Bool(_) | Value::Null => value,
        Value::String(text) => match text.trim().to_lowercase().as_str() {
            "true" | "yes" => {
                fixes.push(format!("{path}: string coerced to boolean"));
                Value::Bool(true)
            }
            "false" | "no" => {
                fixes.push(format!("{path}: string coerced to boolean"));
                Value::Bool(false)
            }
            _ => Value::String(text),
        },
        other => other,
    }
}

fn extract_json_object(text: &str) -> Option<Map<String, Value>> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    match serde_json::from_str::<Value>(&text[start..=end]) {
        Ok(Value::Object(m)) => Some(m),
        _ => None,
    }
}

fn extract_json_array(text: &str) -> Option<Vec<Value>> {
    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end <= start {
        return None;
    }
    match serde_json::from_str::<Value>(&text[start..=end]) {
        Ok(Value::Array(a)) => Some(a),
        _ => None,
    }
}

fn json_kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn kg_schema() -> Value {
        json!({
            "title": "KnowledgeGraph",
            "type": "object",
            "required": ["nodes", "edges"],
            "properties": {
                "nodes": { "type": "array", "items": { "$ref": "#/$defs/Node" } },
                "edges": { "type": "array", "items": { "$ref": "#/$defs/Edge" } }
            },
            "$defs": {
                "Node": {
                    "type": "object",
                    "required": ["id", "name", "type"],
                    "properties": {
                        "id": { "type": "string" },
                        "name": { "type": "string" },
                        "type": { "type": "string" }
                    }
                },
                "Edge": {
                    "type": "object",
                    "required": ["source_node_id", "target_node_id", "relationship_name"],
                    "properties": {
                        "source_node_id": { "type": "string" },
                        "target_node_id": { "type": "string" },
                        "relationship_name": { "type": "string" }
                    }
                }
            }
        })
    }

    #[test]
    fn fills_missing_name_from_label() {
        let raw = json!({
            "nodes": [{ "id": "n1", "label": "Acme Corp", "type": "Organization" }],
            "edges": []
        });
        let (out, fixes) = repair(raw, &kg_schema());
        assert_eq!(out["nodes"][0]["name"], "Acme Corp");
        assert!(!fixes.is_empty());
    }

    #[test]
    fn unwraps_wrapper_key_and_maps_edge_aliases() {
        let raw = json!({
            "knowledge_graph": {
                "nodes": [],
                "edges": [{ "from": "a", "to": "b", "relation": "ships_to" }]
            }
        });
        let (out, _fixes) = repair(raw, &kg_schema());
        assert_eq!(out["edges"][0]["source_node_id"], "a");
        assert_eq!(out["edges"][0]["target_node_id"], "b");
        assert_eq!(out["edges"][0]["relationship_name"], "ships_to");
    }

    #[test]
    fn defaults_unrepairable_required_fields() {
        let raw = json!({ "nodes": [{ "type": "Organization" }], "edges": null });
        let (out, fixes) = repair(raw, &kg_schema());
        // name defaulted, id got a generated uuid, edges null → []
        assert!(out["nodes"][0]["name"].is_string());
        assert!(!out["nodes"][0]["id"].as_str().unwrap_or("").is_empty());
        assert!(out["edges"].as_array().unwrap().is_empty());
        assert!(fixes.len() >= 3);
    }

    #[test]
    fn coerces_scalars_and_number_strings() {
        let schema = json!({
            "type": "object",
            "required": ["name", "weight"],
            "properties": {
                "name": { "type": "string" },
                "weight": { "type": "number" }
            }
        });
        let raw = json!({ "name": 42, "weight": "3.5" });
        let (out, _) = repair(raw, &schema);
        assert_eq!(out["name"], "42");
        assert_eq!(out["weight"], 3.5);
    }

    #[test]
    fn clean_output_is_untouched() {
        let raw = json!({
            "nodes": [{ "id": "n1", "name": "Acme", "type": "Organization" }],
            "edges": [{ "source_node_id": "n1", "target_node_id": "n1", "relationship_name": "self" }]
        });
        let (out, fixes) = repair(raw.clone(), &kg_schema());
        assert_eq!(out, raw);
        assert!(fixes.is_empty());
    }
}
