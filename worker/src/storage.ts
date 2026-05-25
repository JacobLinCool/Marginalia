import type { ArxivMetadata } from "./arxiv";
import type { RunStatus } from "./config";

export interface RunRow {
  id: string;
  arxiv_id: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  text_sha256: string | null;
  status: RunStatus;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  error_type: string | null;
  error_message: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

export async function upsertPaper(
  db: D1Database,
  m: ArxivMetadata,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO papers (
         arxiv_id, arxiv_version, title, abstract, authors, categories,
         primary_category, published_at, updated_at, pdf_url, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(arxiv_id) DO UPDATE SET
         arxiv_version = excluded.arxiv_version,
         title = excluded.title,
         abstract = excluded.abstract,
         authors = excluded.authors,
         categories = excluded.categories,
         primary_category = excluded.primary_category,
         published_at = excluded.published_at,
         updated_at = excluded.updated_at,
         pdf_url = excluded.pdf_url,
         fetched_at = datetime('now')`,
    )
    .bind(
      m.arxivId,
      m.arxivVersion,
      m.title,
      m.abstract,
      JSON.stringify(m.authors),
      JSON.stringify(m.categories),
      m.primaryCategory,
      m.published,
      m.updated,
      m.pdfUrl,
    )
    .run();
}

export async function findLatestSuccess(
  db: D1Database,
  arxivId: string,
  model: string,
  promptVersion: string,
  schemaVersion: string,
): Promise<RunRow | null> {
  return await db
    .prepare(
      `SELECT * FROM extraction_runs
       WHERE arxiv_id = ? AND model = ? AND prompt_version = ?
         AND schema_version = ? AND status = 'success'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(arxivId, model, promptVersion, schemaVersion)
    .first<RunRow>();
}

export async function findLatestRun(
  db: D1Database,
  arxivId: string,
  model: string,
  promptVersion: string,
  schemaVersion: string,
): Promise<RunRow | null> {
  return await db
    .prepare(
      `SELECT * FROM extraction_runs
       WHERE arxiv_id = ? AND model = ? AND prompt_version = ?
         AND schema_version = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(arxivId, model, promptVersion, schemaVersion)
    .first<RunRow>();
}

/**
 * Atomically claim the in-flight slot for (arxiv_id, model, prompt, schema).
 * Returns true if this caller inserted the row; false if another concurrent
 * submission already owns the slot. Backed by the partial unique index
 * `idx_runs_one_inflight`.
 */
export interface PaperSummary {
  arxiv_id: string;
  title: string | null;
  primary_category: string | null;
  one_sentence_summary: string | null;
}

/** Lightweight lookup used for SSR-ing SEO/OG metadata on the view page. */
export async function getPaperSummary(
  db: D1Database,
  arxivId: string,
  model: string,
  promptVersion: string,
  schemaVersion: string,
): Promise<PaperSummary | null> {
  return await db
    .prepare(
      `SELECT p.arxiv_id, p.title, p.primary_category,
              json_extract(r.result, '$.paper.one_sentence_summary')
                AS one_sentence_summary
       FROM papers p
       LEFT JOIN extraction_runs r ON r.arxiv_id = p.arxiv_id
         AND r.model = ? AND r.prompt_version = ?
         AND r.schema_version = ? AND r.status = 'success'
       WHERE p.arxiv_id = ?
       ORDER BY r.updated_at DESC
       LIMIT 1`,
    )
    .bind(model, promptVersion, schemaVersion, arxivId)
    .first<PaperSummary>();
}

export interface PaperListItem {
  arxiv_id: string;
  title: string | null;
  primary_category: string | null;
  run_id: string;
  latency_ms: number | null;
  finished_at: string;
  one_sentence_summary: string | null;
}

/**
 * Most-recently-finished successful run per paper, newest first. Joins
 * `papers` with the latest `success` row in `extraction_runs` for the
 * currently-pinned (model, prompt, schema) tuple.
 */
export async function listPapersWithLatestSuccess(
  db: D1Database,
  model: string,
  promptVersion: string,
  schemaVersion: string,
  limit: number,
): Promise<PaperListItem[]> {
  const res = await db
    .prepare(
      `WITH latest AS (
         SELECT r.arxiv_id, r.id AS run_id, r.latency_ms, r.updated_at,
                r.result,
                ROW_NUMBER() OVER (
                  PARTITION BY r.arxiv_id
                  ORDER BY r.updated_at DESC
                ) AS rn
         FROM extraction_runs r
         WHERE r.model = ? AND r.prompt_version = ?
           AND r.schema_version = ? AND r.status = 'success'
       )
       SELECT p.arxiv_id, p.title, p.primary_category,
              l.run_id, l.latency_ms, l.updated_at AS finished_at,
              json_extract(l.result, '$.paper.one_sentence_summary')
                AS one_sentence_summary
       FROM latest l
       JOIN papers p ON p.arxiv_id = l.arxiv_id
       WHERE l.rn = 1
       ORDER BY l.updated_at DESC
       LIMIT ?`,
    )
    .bind(model, promptVersion, schemaVersion, limit)
    .all<PaperListItem>();
  return res.results ?? [];
}

export async function createRun(
  db: D1Database,
  run: {
    id: string;
    arxivId: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO extraction_runs (
         id, arxiv_id, model, prompt_version, schema_version, status
       ) VALUES (?, ?, ?, ?, ?, 'queued')
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      run.id,
      run.arxivId,
      run.model,
      run.promptVersion,
      run.schemaVersion,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

type RunPatch = Partial<{
  status: RunStatus;
  text_sha256: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
  error_type: string;
  error_message: string;
  result: string;
}>;

export async function updateRun(
  db: D1Database,
  runId: string,
  patch: RunPatch,
): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof RunPatch>;
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  await db
    .prepare(
      `UPDATE extraction_runs SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(...values, runId)
    .run();
}
