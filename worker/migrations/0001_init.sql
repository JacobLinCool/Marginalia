-- Initial schema for the arxiv-rq-claims Worker MVP.
-- Simplified vs spec.md §4: no paper_texts (no text blob storage), and
-- paper_extractions merged into extraction_runs.result (one-to-one anyway).

CREATE TABLE IF NOT EXISTS papers (
    arxiv_id         TEXT PRIMARY KEY,
    arxiv_version    TEXT,
    title            TEXT,
    abstract         TEXT,
    authors          TEXT,            -- JSON array as text
    categories       TEXT,            -- JSON array as text
    primary_category TEXT,
    published_at     TEXT,
    updated_at       TEXT,
    pdf_url          TEXT,
    fetched_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS extraction_runs (
    id              TEXT PRIMARY KEY,    -- workflow instance id
    arxiv_id        TEXT NOT NULL,
    model           TEXT NOT NULL,
    prompt_version  TEXT NOT NULL,
    schema_version  TEXT NOT NULL,
    text_sha256     TEXT,                -- set by extract-text step
    status          TEXT NOT NULL,       -- queued | running | success | failed
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    total_tokens    INTEGER,
    latency_ms      INTEGER,
    error_type      TEXT,
    error_message   TEXT,
    result          TEXT,                -- JSON string, populated on success
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_runs_arxiv_status
    ON extraction_runs(arxiv_id, status);

CREATE INDEX IF NOT EXISTS idx_runs_lookup
    ON extraction_runs(arxiv_id, model, prompt_version, schema_version, status);
