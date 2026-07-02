-- ============================================================================
-- App-level tables (permanent — these stay even after cognee-rs replaces stub)
-- ============================================================================

-- Tracks every ingestion job: status pills in the Ingestion tab read from here.
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id              TEXT PRIMARY KEY,
    file_path       TEXT NOT NULL,
    source_type     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',  -- queued | processing | complete | failed
    entities_extracted    INTEGER,
    relationships_extracted INTEGER,
    error_message   TEXT,
    created_at      TEXT NOT NULL,
    completed_at    TEXT
);

-- Command Center alerts — stability/risk signals surfaced to the user.
CREATE TABLE IF NOT EXISTS alerts (
    id          TEXT PRIMARY KEY,
    severity    TEXT NOT NULL,   -- stable | elevated | critical
    entity_id   TEXT,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- Correction audit log (UI-facing) — timestamps, author, approval status.
-- Separate from the graph audit *node* which lives in the memory engine.
CREATE TABLE IF NOT EXISTS correction_log (
    id              TEXT PRIMARY KEY,
    raw_text        TEXT NOT NULL,
    author          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | committed | rejected
    audit_node_id   TEXT,           -- FK reference into memory engine's audit trail
    created_at      TEXT NOT NULL
);

-- ============================================================================
-- Stub memory backend tables (temporary — replaced when cognee-rs is wired in)
-- ============================================================================

-- STUB: Graph nodes. Replace with cognee-rs graph storage.
CREATE TABLE IF NOT EXISTS stub_entities (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    name        TEXT NOT NULL,
    attributes  TEXT NOT NULL DEFAULT '{}'  -- JSON blob
);

-- STUB: Graph edges. Replace with cognee-rs graph storage.
CREATE TABLE IF NOT EXISTS stub_relationships (
    from_id             TEXT NOT NULL,
    to_id               TEXT NOT NULL,
    relationship_type   TEXT NOT NULL,
    weight              REAL NOT NULL DEFAULT 1.0,
    active              INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (from_id, to_id, relationship_type),
    FOREIGN KEY (from_id) REFERENCES stub_entities(id),
    FOREIGN KEY (to_id) REFERENCES stub_entities(id)
);

-- ============================================================================
-- Custom manual overrides (delta tables applied on top of active memory engine)
-- ============================================================================

CREATE TABLE IF NOT EXISTS custom_entities (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    name        TEXT NOT NULL,
    attributes  TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS custom_relationships (
    from_id             TEXT NOT NULL,
    to_id               TEXT NOT NULL,
    relationship_type   TEXT NOT NULL,
    weight              REAL NOT NULL DEFAULT 1.0,
    active              INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (from_id, to_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS deleted_entities (
    id          TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS deleted_relationships (
    from_id             TEXT NOT NULL,
    to_id               TEXT NOT NULL,
    relationship_type   TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id, relationship_type)
);
