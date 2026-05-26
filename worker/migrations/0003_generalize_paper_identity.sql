-- Move the runtime model from arXiv-specific IDs to source-qualified paper
-- identities so DOI-backed papers can use the same extraction pipeline.

DROP INDEX IF EXISTS idx_runs_one_inflight;
DROP INDEX IF EXISTS idx_runs_lookup;
DROP INDEX IF EXISTS idx_runs_arxiv_status;

ALTER TABLE papers RENAME TO papers_arxiv_legacy;
ALTER TABLE extraction_runs RENAME TO extraction_runs_arxiv_legacy;

CREATE TABLE papers (
    canonical_id     TEXT PRIMARY KEY,
    source           TEXT NOT NULL,
    source_id        TEXT NOT NULL,
    doi              TEXT,
    title            TEXT,
    abstract         TEXT,
    authors          TEXT,            -- JSON array as text
    categories       TEXT,            -- JSON array as text
    primary_category TEXT,
    venue            TEXT,
    published_at     TEXT,
    updated_at       TEXT,
    landing_url      TEXT,
    pdf_url          TEXT,
    license          TEXT,
    raw_metadata     TEXT,            -- JSON object as text
    fetched_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE extraction_runs (
    id              TEXT PRIMARY KEY,    -- workflow instance id
    canonical_id    TEXT NOT NULL,
    model           TEXT NOT NULL,
    prompt_version  TEXT NOT NULL,
    schema_version  TEXT NOT NULL,
    text_sha256     TEXT,
    status          TEXT NOT NULL,       -- queued | running | success | failed
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    total_tokens    INTEGER,
    latency_ms      INTEGER,
    error_type      TEXT,
    error_message   TEXT,
    result          TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

INSERT INTO papers (
    canonical_id, source, source_id, doi, title, abstract, authors,
    categories, primary_category, venue, published_at, updated_at,
    landing_url, pdf_url, license, raw_metadata, fetched_at
)
SELECT
    'arxiv:' || arxiv_id,
    'arxiv',
    arxiv_id,
    NULL,
    title,
    abstract,
    authors,
    categories,
    primary_category,
    'arXiv',
    published_at,
    updated_at,
    'https://arxiv.org/abs/' || arxiv_id,
    pdf_url,
    NULL,
    json_object(
        'provider', 'arxiv',
        'arxivId', arxiv_id,
        'arxivVersion', arxiv_version
    ),
    fetched_at
FROM papers_arxiv_legacy;

INSERT INTO extraction_runs (
    id, canonical_id, model, prompt_version, schema_version, text_sha256,
    status, input_tokens, output_tokens, total_tokens, latency_ms,
    error_type, error_message, result, created_at, updated_at
)
SELECT
    id,
    'arxiv:' || arxiv_id,
    model,
    prompt_version,
    schema_version,
    text_sha256,
    status,
    input_tokens,
    output_tokens,
    total_tokens,
    latency_ms,
    error_type,
    error_message,
    result,
    created_at,
    updated_at
FROM extraction_runs_arxiv_legacy;

DROP TABLE papers_arxiv_legacy;
DROP TABLE extraction_runs_arxiv_legacy;

CREATE INDEX idx_runs_paper_status
    ON extraction_runs(canonical_id, status);

CREATE INDEX idx_runs_lookup
    ON extraction_runs(canonical_id, model, prompt_version, schema_version, status);

CREATE UNIQUE INDEX idx_runs_one_inflight
    ON extraction_runs(canonical_id, model, prompt_version, schema_version)
    WHERE status IN ('queued', 'running');
