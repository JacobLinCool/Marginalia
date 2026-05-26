import {
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from "./config";
import type { Env } from "./env";
import { ogImageResponse } from "./ogImage";
import type { PaperRef } from "./paper";
import { parsePaperRef } from "./paperRef";
import { resolvePaperMetadata } from "./resolvers";
import { PaperResolveError } from "./resolvers/errors";
import {
  createRun,
  findLatestRun,
  findLatestSuccess,
  getPaperSummary,
  listPapersWithLatestSuccess,
  type RunRow,
  upsertPaper,
} from "./storage";
import { indexHtml, listHtml, viewHtml } from "./ui";

export { ExtractPaperWorkflow } from "./workflows/extractPaper";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const origin = url.origin;

    if (req.method === "GET" && path === "/") return html(indexHtml(origin));
    if (req.method === "GET" && path === "/papers")
      return html(listHtml(origin));

    if (req.method === "GET" && path === "/api/papers") {
      const limitParam = Number(url.searchParams.get("limit") ?? "100");
      const limit = Math.min(
        Math.max(Number.isFinite(limitParam) ? limitParam : 100, 1),
        100,
      );
      const papers = await listPapersWithLatestSuccess(
        env.DB,
        DEFAULT_MODEL,
        PROMPT_VERSION,
        SCHEMA_VERSION,
        limit,
      );
      return json({ papers });
    }

    const ogMatch = path.match(/^\/papers\/(.+)\/og\.png$/);
    if (ogMatch && req.method === "GET") {
      const ref = parsePaperRef(decodeURIComponent(ogMatch[1]));
      if (!ref) return new Response("invalid paper id", { status: 400 });
      const summary = await getPaperSummary(
        env.DB,
        ref.canonicalId,
        DEFAULT_MODEL,
        PROMPT_VERSION,
        SCHEMA_VERSION,
      );
      return ogImageResponse({
        canonicalId: ref.canonicalId,
        title: summary?.title ?? null,
        summary: summary?.one_sentence_summary ?? null,
        primaryCategory: summary?.primary_category ?? null,
      });
    }

    // /papers/:id/view — HTML detail page (skeleton; loads /papers/:id JSON).
    const viewMatch = path.match(/^\/papers\/(.+)\/view$/);
    if (viewMatch && req.method === "GET") {
      const ref = parsePaperRef(decodeURIComponent(viewMatch[1]));
      if (!ref) return new Response("invalid paper id", { status: 400 });
      // SSR the SEO/OG metadata so link previews show the real title +
      // summary. Falls back to a generic blurb when the paper hasn't been
      // analyzed yet.
      const summary = await getPaperSummary(
        env.DB,
        ref.canonicalId,
        DEFAULT_MODEL,
        PROMPT_VERSION,
        SCHEMA_VERSION,
      );
      return html(
        viewHtml(
          ref.canonicalId,
          {
            title: summary?.title ?? null,
            description: summary?.one_sentence_summary ?? null,
            landingUrl: summary?.landing_url ?? null,
          },
          origin,
        ),
      );
    }

    // /papers/:id — JSON API. POST submits, GET polls.
    const paperMatch = path.match(/^\/papers\/(.+)$/);
    if (paperMatch) {
      const ref = parsePaperRef(decodeURIComponent(paperMatch[1]));
      if (!ref) return json({ error: "invalid paper id" }, 400);
      if (req.method === "POST") return await handleSubmit(env, ref);
      if (req.method === "GET") return await handleGet(env, ref.canonicalId);
      return json({ error: "method not allowed" }, 405);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleSubmit(env: Env, ref: PaperRef): Promise<Response> {
  const model = DEFAULT_MODEL;

  const success = await findLatestSuccess(
    env.DB,
    ref.canonicalId,
    model,
    PROMPT_VERSION,
    SCHEMA_VERSION,
  );
  if (success) {
    return json(runToBody(success), 200);
  }

  let metadata;
  try {
    metadata = await resolvePaperMetadata(ref);
  } catch (err) {
    if (err instanceof PaperResolveError) {
      return json(
        { error: err.message, canonicalId: ref.canonicalId },
        err.status,
      );
    }
    const e = err as Error;
    return json(
      {
        error: e.message ?? "paper metadata resolution failed",
        canonicalId: ref.canonicalId,
      },
      502,
    );
  }
  await upsertPaper(env.DB, metadata);

  // Try to claim the in-flight slot. If two POSTs race, only the one that
  // wins the partial unique index insert proceeds to start a workflow; the
  // loser re-queries and reports the winner's run id.
  const runId = crypto.randomUUID();
  const inserted = await createRun(env.DB, {
    id: runId,
    canonicalId: ref.canonicalId,
    model,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
  });
  if (!inserted) {
    const existing = await findLatestRun(
      env.DB,
      ref.canonicalId,
      model,
      PROMPT_VERSION,
      SCHEMA_VERSION,
    );
    if (existing) return json(runToBody(existing), 202);
    // Extremely unlikely: a competing run finished and was overwritten
    // between our insert and re-query. Fall through to a fresh attempt.
    return json({ status: "queued", runId: null, error: "race retry" }, 503);
  }

  await env.EXTRACT_WORKFLOW.create({
    id: runId,
    params: {
      canonicalId: ref.canonicalId,
      model,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
    },
  });
  return json({ status: "queued", runId, canonicalId: ref.canonicalId }, 202);
}

async function handleGet(env: Env, canonicalId: string): Promise<Response> {
  const model = DEFAULT_MODEL;
  const success = await findLatestSuccess(
    env.DB,
    canonicalId,
    model,
    PROMPT_VERSION,
    SCHEMA_VERSION,
  );
  if (success) return json(runToBody(success), 200);

  const latest = await findLatestRun(
    env.DB,
    canonicalId,
    model,
    PROMPT_VERSION,
    SCHEMA_VERSION,
  );
  if (latest) return json(runToBody(latest), 200);

  return json({ status: "not_found", canonicalId }, 404);
}

function runToBody(run: RunRow): Record<string, unknown> {
  const body: Record<string, unknown> = {
    status: run.status,
    runId: run.id,
    canonicalId: run.canonical_id,
  };
  if (run.status === "success" && run.result) {
    body.result = JSON.parse(run.result);
  }
  if (run.status === "failed") {
    body.error = run.error_message ?? run.error_type ?? "unknown error";
  }
  return body;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
