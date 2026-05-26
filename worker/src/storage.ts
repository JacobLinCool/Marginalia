import type { RunStatus } from "./config";
import type { PaperMetadata, PaperSource } from "./paper";

export interface RunRow {
  id: string;
  canonical_id: string;
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

interface PaperRow {
  canonical_id: string;
  source: PaperSource;
  source_id: string;
  doi: string | null;
  title: string | null;
  abstract: string | null;
  authors: string | null;
  categories: string | null;
  primary_category: string | null;
  venue: string | null;
  published_at: string | null;
  updated_at: string | null;
  landing_url: string | null;
  pdf_url: string | null;
  license: string | null;
  raw_metadata: string | null;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((v) => typeof v === "string")
    : [];
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function rowToPaperMetadata(row: PaperRow): PaperMetadata {
  return {
    canonicalId: row.canonical_id,
    source: row.source,
    sourceId: row.source_id,
    doi: row.doi,
    title: row.title ?? "",
    abstract: row.abstract ?? "",
    authors: parseJsonArray(row.authors),
    categories: parseJsonArray(row.categories),
    primaryCategory: row.primary_category,
    venue: row.venue,
    published: row.published_at,
    updated: row.updated_at,
    landingUrl: row.landing_url ?? "",
    pdfUrl: row.pdf_url,
    license: row.license,
    rawMetadata: parseJsonObject(row.raw_metadata),
  };
}

export async function upsertPaper(
  db: D1Database,
  m: PaperMetadata,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO papers (
         canonical_id, source, source_id, doi, title, abstract, authors,
         categories, primary_category, venue, published_at, updated_at,
         landing_url, pdf_url, license, raw_metadata, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(canonical_id) DO UPDATE SET
         source = excluded.source,
         source_id = excluded.source_id,
         doi = excluded.doi,
         title = excluded.title,
         abstract = excluded.abstract,
         authors = excluded.authors,
         categories = excluded.categories,
         primary_category = excluded.primary_category,
         venue = excluded.venue,
         published_at = excluded.published_at,
         updated_at = excluded.updated_at,
         landing_url = excluded.landing_url,
         pdf_url = excluded.pdf_url,
         license = excluded.license,
         raw_metadata = excluded.raw_metadata,
         fetched_at = datetime('now')`,
    )
    .bind(
      m.canonicalId,
      m.source,
      m.sourceId,
      m.doi,
      m.title,
      m.abstract,
      JSON.stringify(m.authors),
      JSON.stringify(m.categories),
      m.primaryCategory,
      m.venue,
      m.published,
      m.updated,
      m.landingUrl,
      m.pdfUrl,
      m.license,
      JSON.stringify(m.rawMetadata),
    )
    .run();
}

export async function getPaperMetadata(
  db: D1Database,
  canonicalId: string,
): Promise<PaperMetadata | null> {
  const row = await db
    .prepare(`SELECT * FROM papers WHERE canonical_id = ?`)
    .bind(canonicalId)
    .first<PaperRow>();
  return row ? rowToPaperMetadata(row) : null;
}

export async function findLatestSuccess(
  db: D1Database,
  canonicalId: string,
  model: string,
  promptVersion: string,
  schemaVersion: string,
): Promise<RunRow | null> {
  return await db
    .prepare(
      `SELECT * FROM extraction_runs
       WHERE canonical_id = ? AND model = ? AND prompt_version = ?
         AND schema_version = ? AND status = 'success'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(canonicalId, model, promptVersion, schemaVersion)
    .first<RunRow>();
}

export async function findLatestRun(
  db: D1Database,
  canonicalId: string,
  model: string,
  promptVersion: string,
  schemaVersion: string,
): Promise<RunRow | null> {
  return await db
    .prepare(
      `SELECT * FROM extraction_runs
       WHERE canonical_id = ? AND model = ? AND prompt_version = ?
         AND schema_version = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(canonicalId, model, promptVersion, schemaVersion)
    .first<RunRow>();
}

export interface PaperSummary {
  canonical_id: string;
  source: PaperSource;
  source_id: string;
  title: string | null;
  primary_category: string | null;
  landing_url: string | null;
  one_sentence_summary: string | null;
}

/** Lightweight lookup used for SSR-ing SEO/OG metadata on the view page. */
export async function getPaperSummary(
  db: D1Database,
  canonicalId: string,
  model: string,
  promptVersion: string,
  schemaVersion: string,
): Promise<PaperSummary | null> {
  return await db
    .prepare(
      `SELECT p.canonical_id, p.source, p.source_id, p.title,
              p.primary_category, p.landing_url,
              json_extract(r.result, '$.paper.one_sentence_summary')
                AS one_sentence_summary
       FROM papers p
       LEFT JOIN extraction_runs r ON r.canonical_id = p.canonical_id
         AND r.model = ? AND r.prompt_version = ?
         AND r.schema_version = ? AND r.status = 'success'
       WHERE p.canonical_id = ?
       ORDER BY r.updated_at DESC
       LIMIT 1`,
    )
    .bind(model, promptVersion, schemaVersion, canonicalId)
    .first<PaperSummary>();
}

export interface PaperListItem {
  canonical_id: string;
  source: PaperSource;
  source_id: string;
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
         SELECT r.canonical_id, r.id AS run_id, r.latency_ms, r.updated_at,
                r.result,
                ROW_NUMBER() OVER (
                  PARTITION BY r.canonical_id
                  ORDER BY r.updated_at DESC
                ) AS rn
         FROM extraction_runs r
         WHERE r.model = ? AND r.prompt_version = ?
           AND r.schema_version = ? AND r.status = 'success'
       )
       SELECT p.canonical_id, p.source, p.source_id, p.title,
              p.primary_category, l.run_id, l.latency_ms,
              l.updated_at AS finished_at,
              json_extract(l.result, '$.paper.one_sentence_summary')
                AS one_sentence_summary
       FROM latest l
       JOIN papers p ON p.canonical_id = l.canonical_id
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
    canonicalId: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO extraction_runs (
         id, canonical_id, model, prompt_version, schema_version, status
       ) VALUES (?, ?, ?, ?, ?, 'queued')
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      run.id,
      run.canonicalId,
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
