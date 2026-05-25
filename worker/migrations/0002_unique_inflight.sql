-- Prevent two concurrent submissions for the same (arxiv_id, model, prompt,
-- schema) from each creating a `queued`/`running` row and starting a workflow.
-- success/failed rows are unconstrained: re-submitting after a failure should
-- be allowed, and successes are looked up via the existing query path.

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_inflight
    ON extraction_runs(arxiv_id, model, prompt_version, schema_version)
    WHERE status IN ('queued', 'running');
