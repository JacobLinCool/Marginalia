# Marginalia Spec

## 0. TL;DR

Marginalia accepts a user-submitted arXiv id and reconstructs the paper's research agenda: the questions the paper is trying to answer, the claims the authors make, the evidence the paper provides for those claims, and the risk that a claim exceeds its own support.

The MVP runs as a Cloudflare Worker backed by D1 and Workflows. It uses a text-only extraction path: fetch arXiv metadata, extract text from the PDF, ask the OpenAI Responses API for strict-schema JSON, and persist the resulting analysis.

For deployment values (URL, D1 id, secrets) and setup commands, see the [README](./README.md).

---

## 1. Product goal

### 1.1 Core idea

Marginalia performs research-agenda reconstruction.

> Given a paper's full text, infer what the paper is trying to answer, what it claims, and how well those claims are supported by the paper's own methods and evidence.

Author framing is treated as evidence to interpret. The output should surface the concrete research question and claim-evidence relationship, even when the abstract, introduction, or conclusion uses broad promotional language.

### 1.2 MVP scope

For a single arXiv id submitted by a user, produce structured JSON containing:

1. Real problem framing
2. Inferred research questions, including questions implicit in the methods and evidence
3. Author claims
4. Claim support level: `unsupported` / `partially_supported` / `supported`
5. Overclaim risk: `low` / `medium` / `high`
6. Overall assessment

### 1.3 MVP boundary

The MVP excludes:

* Daily arXiv discovery / batch processing
* PDF vision / OCR / scanned PDFs / figure understanding
* Citation graph / external paper validation
* Leaderboard fact-checking
* Multi-model ensemble
* Human annotation UI
* Per-paper OG image

---

## 2. Current system

### 2.1 User flow

1. The user opens `/` and enters an arXiv id or URL
2. Cache hit: the Worker redirects to `/papers/:id/view`
3. Cache miss: the Worker starts a Workflow; the home page polls every 5 seconds and redirects when analysis completes
4. Permalink: `/papers/:id/view` works as a direct link at any time
5. List view: `/papers` shows analyzed papers

### 2.2 HTTP surface

| Method | Path               | Use                                                 |
| ------ | ------------------ | --------------------------------------------------- |
| GET    | `/`                | Submit form (HTML)                                  |
| GET    | `/papers`          | List page (HTML)                                    |
| GET    | `/api/papers`      | List JSON (`?limit=`, capped at 100)                |
| GET    | `/papers/:id/view` | Per-paper HTML with SSR OG / Twitter meta           |
| POST   | `/papers/:id`      | Submit (cache hit / claim slot / start workflow)    |
| GET    | `/papers/:id`      | Poll status / fetch result                          |

### 2.3 SEO

* All three pages emit `<title>`, `description`, `<link rel="canonical">`, `og:type`, `og:title`, `og:description`, `og:url`, `og:site_name`, `twitter:card=summary`, `twitter:title`, and `twitter:description`
* On `/papers/:id/view`, title and description are SSR'd from D1: title is `paper.title`, and description is the LLM's `one_sentence_summary`; pending papers use a generic blurb
* `og:url` and canonical derive from `new URL(req.url).origin`, so custom domains work with the same code

---

## 3. Architecture

The system has one HTTP Worker and one per-paper Workflow. The Worker serves HTML and JSON, claims work atomically in D1, and creates a Workflow only for the caller that wins the claim.

```text
Browser
  ├─ GET /, /papers, /papers/:id/view ──► Worker (HTML, SSR SEO meta)
  ├─ GET /api/papers ───────────────────► Worker ──► D1
  ├─ POST /papers/:id ──────────────────► Worker ──► D1 (cache hit check)
  │                                           ├─ hit  → return result
  │                                           └─ miss → atomic claim
  │                                                      └─ Workflow.create(id=runId)
  └─ GET /papers/:id (poll) ────────────► Worker ──► D1

ExtractPaperWorkflow per paper (5 steps, independently retried)
  1. mark-running     ──► D1
  2. fetch-metadata   ──► arXiv API ──► D1 upsert papers
  3. extract-text     ──► arXiv PDF ──► unpdf ──► sha256 ──► D1
  4. call-llm         ──► OpenAI Responses (json_schema strict)
  5. save-result      ──► D1 extraction_runs.result
```

### 3.1 Module layout

```text
worker/
  src/
    config.ts                  # PROMPT_VERSION / SCHEMA_VERSION / model defaults
    env.ts                     # Env interface (D1, Workflow, secret)
    arxiv.ts                   # ArxivMetadata, fetchArxivMetadata, normalize
    pdfText.ts                 # unpdf extract + clean + strip refs + truncate + sha256
    httpRetry.ts               # fetchWithRetry (backoff + Retry-After)
    prompts.ts                 # SYSTEM_PROMPT + buildUserPrompt
    schemas.ts                 # EXTRACTION_SCHEMA (for OpenAI strict mode)
    extractor.ts               # callOpenAI (Responses API)
    storage.ts                 # D1 repository (upsert, find, claim, update, list)
    ui.ts                      # inline HTML for /, /papers, /papers/:id/view
    worker.ts                  # fetch handler + routing
    workflows/extractPaper.ts  # WorkflowEntrypoint
  migrations/
    0001_init.sql
    0002_unique_inflight.sql
  wrangler.toml
```

### 3.2 Data model

D1 (SQLite):

```sql
CREATE TABLE papers (
    arxiv_id         TEXT PRIMARY KEY,
    arxiv_version    TEXT,
    title            TEXT,
    abstract         TEXT,
    authors          TEXT,            -- JSON
    categories       TEXT,            -- JSON
    primary_category TEXT,
    published_at     TEXT,
    updated_at       TEXT,
    pdf_url          TEXT,
    fetched_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE extraction_runs (
    id              TEXT PRIMARY KEY,    -- workflow instance id (== runId)
    arxiv_id        TEXT NOT NULL,
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
    result          TEXT,                -- JSON
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Single in-flight run per (arxiv_id, model, prompt, schema). success / failed
-- rows are unconstrained.
CREATE UNIQUE INDEX idx_runs_one_inflight
    ON extraction_runs(arxiv_id, model, prompt_version, schema_version)
    WHERE status IN ('queued', 'running');
```

Design decisions relative to the original §4 schema:

* Extracted paper text is discarded after hashing; `extraction_runs.text_sha256` stores the fingerprint used to identify the analyzed input
* Result JSON is stored inline on `extraction_runs.result`, matching the one-to-one relationship between a run and its extraction
* Idempotency uses the partial unique index plus `INSERT ... ON CONFLICT DO NOTHING`, making the claim atomic under concurrent submissions

### 3.3 Idempotency and race safety

POST `/papers/:id` handles concurrent submissions in this order:

1. Look up the latest `(arxiv_id, model, prompt, schema, status='success')`; when present, return it
2. Insert an `extraction_runs` row with `status='queued'` using `ON CONFLICT DO NOTHING`
3. When `meta.changes > 0`, this caller won the claim and creates `EXTRACT_WORKFLOW.create({ id: runId, ... })`
4. When no row is inserted, another caller already holds the in-flight claim; re-query the latest in-flight row and report that `runId`

`runId === workflow instance id`, so a polling client always sees the same id.

### 3.4 Workflow

Each step round-trips its payload through `JSON.stringify` / `JSON.parse` across step boundaries. This keeps Workflow payloads simple and sidesteps the TypeScript recursion blowup in Workflow's `Serializable<T>`.

| Step              | Failure handling                                         |
| ----------------- | -------------------------------------------------------- |
| `mark-running`    | default                                                  |
| `fetch-metadata`  | default (inner `fetchWithRetry` already handles 429)     |
| `extract-text`    | default (inner `fetchWithRetry` already handles 429)     |
| `call-llm`        | 10-minute timeout, 2 step-level retries, exp backoff 30s |
| `save-result`     | default                                                  |

The `run()` body is wrapped in `try` / `catch`. Any throwing step marks the row `failed` before rethrowing, allowing a polling GET to surface the error.

### 3.5 fetchWithRetry

`src/httpRetry.ts` provides the shared retry logic for both the arXiv API and PDF download calls:

* `maxAttempts` defaults to 10
* Base 1 s, exponential backoff to a 30 s cap, ±25% jitter
* 429 honors `Retry-After` (seconds or HTTP date), capped at 60 s
* 5xx and network errors are retried
* Other 4xx responses are returned to the caller as-is

### 3.6 Output JSON shape

Full schema lives in `worker/src/schemas.ts`. Top-level keys:

* `paper` — `title` / `one_sentence_summary` / `primary_area`
* `problem_framing` — `field_context` / `gap_or_limitation` / `why_it_matters`
* `research_questions[]` — `rq` / `source` (`explicit` | `inferred` | `mixed`) / `question_type` / `why_this_is_the_real_rq` / `evidence[]` / `confidence`
* `claims[]` — `claim` / `claim_type` / `made_by_authors` / `support_in_paper` / `strength` / `overclaim_risk` / `evidence[]` / `notes`
* `overall_assessment` — `summary` / `main_contribution` / `main_weakness` / `author_overclaim_summary`

Before writing to D1, the result is enriched with `_metadata` (ArxivMetadata), `_usage` (OpenAI usage), and `_runId`.

---

## 4. Prompting

`SYSTEM_PROMPT` (`worker/src/prompts.ts`) asks the model to distinguish:

1. What the authors say explicitly
2. What the paper tests or proves
3. What the real research question appears to be
4. Where claims exceed the evidence

The OpenAI Responses API call uses `text.format.type = "json_schema"` with `strict: true`. The schema comes from `EXTRACTION_SCHEMA`, giving every successful run a stable output shape.

---

## 5. Versioning

`PROMPT_VERSION` and `SCHEMA_VERSION` (in `config.ts`) are part of the idempotency key:

* Prompt text change → bump `PROMPT_VERSION` → next submit cache-misses and re-runs
* Schema change → bump `SCHEMA_VERSION` → next submit cache-misses and re-runs
* `DEFAULT_MODEL` change → different models are tracked separately because the model is part of the key

Old rows remain available for history. The next submit under a new key writes a new row, and all `extraction_runs` for a given `arxiv_id` can be queried together.

---

## 6. Operational

### 6.1 Rate limits

* arXiv: `fetchWithRetry` honors 429 + `Retry-After`; with discovery outside MVP scope, traffic is user-paced
* OpenAI: per-paper Workflow concurrency bounds calls; the current system runs one instance per paper and performs no batching

### 6.2 Retry policy

| Failure                   | Handling                                  |
| ------------------------- | ----------------------------------------- |
| arXiv 429 / 5xx           | `fetchWithRetry` × 10                     |
| PDF download 429 / 5xx    | `fetchWithRetry` × 10                     |
| OpenAI call timeout / 5xx | Workflow step retry × 2 (exp backoff)     |
| Workflow step exception   | `run()` catch → mark row `failed`         |
| Unrecoverable             | Row `status=failed`; UI shows the error   |

### 6.3 Logging / observability

* `extraction_runs` records `input_tokens` / `output_tokens` / `total_tokens` / `latency_ms` / `error_type` / `error_message` / `status` per row
* Cloudflare `[observability] enabled = true` collects per-request logs
* Workflow instances are inspectable via `wrangler workflows instances list`

---

## 7. Future work

The user-facing roadmap lives in the [README](./README.md#roadmap). This section records engineering notes in rough priority order.

### 7.1 Daily arXiv discovery

A scheduled Worker (cron trigger) queries the arXiv search API for the previous day's `cs.*` submissions and submits each paper through `EXTRACT_WORKFLOW.create`. The idempotent submit path gives cron submissions the same concurrency semantics as user POSTs. Traffic estimate: ~500 papers/day → ~4–6M input tokens and 0.4–0.6M output tokens per day.

### 7.2 Evaluation set

Hand-score 100 papers across cs.AI / CL / CV / LG / RO / SE / DB / CR / HC / NE:

| Metric                    | Meaning                                                  |
| ------------------------- | -------------------------------------------------------- |
| rq_specificity            | RQ is specific enough to be testable                     |
| rq_alignment              | RQ matches the actual methods / evidence                 |
| claim_recall              | Important claims are captured                            |
| claim_precision           | Invented claims are absent                               |
| support_judgment_quality  | supported / partially / unsupported labels are sensible  |
| overclaim_detection       | Overstated author claims are flagged                     |
| evidence_usefulness       | Evidence quote / page helps a reviewer verify            |

1–5 rubric: bad → weak → acceptable → good (distinguishes claims from evidence) → excellent (reconstructs the real agenda and flags overclaim).

### 7.3 Per-paper OG image

Use `satori` to SSR a per-paper card (title + summary + badge), upgrading `twitter:card` from `summary` to `summary_large_image`.

### 7.4 Re-extraction backfill

Today, a version bump triggers re-extraction when a user re-submits. A backfill Workflow over `pending_arxiv_ids` could re-run the entire corpus after prompt, schema, or model changes.

### 7.5 PDF figure / table understanding

A separate Workflow could run a vision-capable model on pages referenced in evidence quotes and augment the result with figure / table content, expanding beyond the current text-only scope.

### 7.6 Citation graph

Integrate OpenAlex / Semantic Scholar to flag tensions or contradictions between a paper's claims and its cited prior work.

### 7.7 Human annotation UI

Add an overlay on the view page so reviewers can mark each `rq` / `claim` as correct / wrong / partial. Results land in a `human_reviews` table, producing a labeled set for fine-tuning.
