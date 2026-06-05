# Marginalia

Analyze what a paper is actually trying to answer, what it claims, and where those claims exceed its own evidence.

**Live**: https://marginalia.jacob.workers.dev

## What it does

Submit an arXiv id, DOI, or supported paper URL → Marginalia resolves paper metadata, downloads the PDF, extracts the text, and asks an LLM to:

- Infer the paper's real research questions, not just copy what the abstract says
- List each author claim with `claim_type`, `made_by_authors`, supporting evidence quotes
- Score how well the paper itself supports each claim: `supported` / `partially_supported` / `unsupported`
- Flag `overclaim_risk` per claim and summarise where the authors are likely overclaiming overall

Results have stable, shareable permalinks at `/papers/:id/view` with Open Graph metadata for link previews.

## Architecture

Single Cloudflare Worker:

- **D1** stores `papers` and `extraction_runs`. No separate D1 text blob is kept; `extraction_runs.text_sha256` fingerprints the extracted text. The Workflow step state may retain the extracted text for the lifetime/retention window of the Workflow instance.
- **Workflows** run the 5-step per-paper extraction (`mark-running → fetch-metadata → extract-text → call-llm → save-result`) with step-level retries
- **OpenAI Responses API** with strict JSON schema produces the structured output
- **Web UI** is three inline HTML pages (no static-assets binding) served by the same Worker; Takumi renders per-paper Open Graph PNGs on demand
- **Idempotency**: a partial unique index `(canonical_id, model, prompt, schema) WHERE status IN ('queued','running')` + `INSERT ... ON CONFLICT DO NOTHING` guarantees one in-flight run per paper even under concurrent submits

## HTTP surface

| Method | Path                | Use                                              |
| ------ | ------------------- | ------------------------------------------------ |
| GET    | `/`                 | Submit form                                      |
| GET    | `/papers`           | List page                                        |
| GET    | `/api/papers`       | List JSON (`?limit=`, capped at 100)             |
| GET    | `/papers/:id/og.png` | Per-paper Open Graph image                      |
| GET    | `/papers/:id/view`  | Per-paper page (server-rendered SEO meta)        |
| POST   | `/papers/:id`       | Submit (cache hit, claim slot, or start workflow) |
| GET    | `/papers/:id`       | Poll status / fetch result                       |

## Setup

```bash
cd worker
pnpm install
pnpm migrate:local
pnpm dev    # http://localhost:8787
```

`worker/.dev.vars` needs:

```
OPENAI_API_KEY=sk-...
```

Requires `wrangler` 4.x — 3.x doesn't simulate Workflows locally.

## Deploy

```bash
cd worker
pnpm wrangler login
pnpm wrangler d1 create arxiv_rq_claims      # first time, paste id into wrangler.toml
pnpm migrate:remote
pnpm wrangler secret put OPENAI_API_KEY
pnpm deploy
```

Workflows requires a **Workers Paid** plan.

### Ingesting paywalled papers (e.g. Nature)

The Workflow downloads the PDF from inside the Worker. For paywalled publishers
like Nature (`nature.com`, DOI prefix `10.1038`), the **deployed** Worker fails:
from Cloudflare datacenter egress the `.../articles/<slug>.pdf` URL returns the
HTML paywall page (`Not a PDF: content-type=text/html`), while the same URL
serves a real PDF from a residential IP.

Workaround — run the Worker **locally** (fetch egresses from your machine) but
point the D1 binding at **production**, then submit the paper to localhost:

```bash
cd worker
# In wrangler.toml, temporarily add `remote = true` to the [[d1_databases]] block.
# The key is `remote`, NOT `experimental_remote`. Needs wrangler >= 4.98
# (the pinned 4.94 doesn't support graduated remote bindings):
pnpm dlx wrangler@latest dev          # NOT --remote: that runs the Worker on the edge and re-breaks the fetch
# .dev.vars must hold OPENAI_API_KEY for the local LLM step.

# In another shell — DB binding will report `remote`, so the result lands in prod D1:
curl -X POST "http://localhost:8787/papers/https%3A%2F%2Fwww.nature.com%2Farticles%2Fs41586-025-09196-4"
# poll until status: success, then confirm via the live worker:
curl "https://marginalia.jacob.workers.dev/papers/https%3A%2F%2Fwww.nature.com%2Farticles%2Fs41586-025-09196-4"
```

Revert `remote = true` afterward, or every `pnpm dev` will write to prod D1.

## Roadmap

Roughly in priority order. Engineering notes for each in [`SPEC.md` §7](./SPEC.md#7-future-work).

- **Daily arXiv discovery** — Cron-triggered Worker that queues every new `cs.*` submission through the same idempotent submit path
- **Evaluation set** — ~100-paper hand-graded benchmark across `cs.AI` / `CL` / `CV` / `LG` / `RO` / `SE` / `DB` / `CR` / `HC` / `NE`, scoring `rq_specificity`, `claim_recall`, `claim_precision`, `support_judgment_quality`, `overclaim_detection`, `evidence_usefulness`
- **Re-extraction backfill** — when `PROMPT_VERSION` / `SCHEMA_VERSION` / `DEFAULT_MODEL` bumps, batch re-run the corpus instead of waiting for users to re-submit
- **PDF figure / table understanding** — separate Workflow that runs a vision-capable model on pages referenced in evidence quotes (escapes the current text-only scope)
- **Citation graph** — pull OpenAlex / Semantic Scholar to flag where a claim contradicts cited prior work
- **Human annotation UI** — overlay on the view page where reviewers can mark each `rq` / `claim` as correct / wrong / partial; results land in a `human_reviews` table for future fine-tuning
- **Multi-version comparison** — when a paper is re-analyzed under a new prompt or model, expose a diff view of the structured output
- **Public read-only API + rate limits** — if usage grows, add API keys and per-key quotas so the worker isn't accidentally a free LLM proxy

## Repo layout

```
.
├── README.md                # this file
├── SPEC.md                  # design doc
└── worker/                  # the entire deployable app
    ├── src/                 # TypeScript source
    ├── migrations/          # D1 SQL migrations
    └── wrangler.toml
```
