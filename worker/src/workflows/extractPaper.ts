import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import { fetchArxivMetadata, type ArxivMetadata } from "../arxiv";
import {
  DEFAULT_MAX_INPUT_CHARS,
  type ReasoningEffort,
} from "../config";
import type { Env } from "../env";
import { callOpenAI, type LLMUsage } from "../extractor";
import {
  downloadAndExtractText,
  sha256Hex,
  stripReferences,
  truncateText,
} from "../pdfText";
import type { ExtractionResult } from "../schemas";
import { updateRun, upsertPaper } from "../storage";

export interface ExtractParams {
  arxivId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  maxInputChars?: number;
  keepReferences?: boolean;
}

interface ExtractedText {
  paperText: string;
  pageCount: number;
  sha256: string;
}

interface LlmStepOutput {
  result: ExtractionResult;
  usage: LLMUsage | null;
  latencyMs: number;
}

// Workflow step outputs must satisfy `Serializable<T>`. Our deeper types
// (JSON objects with recursive shapes) blow up the `Serializable<T>` type
// recursion in TS, so each step returns a plain JSON string and we parse it
// back on the consuming side. The serialization round-trip also enforces real
// serializability at runtime.
export class ExtractPaperWorkflow extends WorkflowEntrypoint<Env, ExtractParams> {
  async run(
    event: WorkflowEvent<ExtractParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const {
      arxivId,
      model,
      reasoningEffort,
      maxInputChars = DEFAULT_MAX_INPUT_CHARS,
      keepReferences = false,
    } = event.payload;
    const runId = event.instanceId;

    try {
      await step.do("mark-running", async () => {
        await updateRun(this.env.DB, runId, { status: "running" });
      });

      const metadataJson = await step.do("fetch-metadata", async () => {
        const m = await fetchArxivMetadata(arxivId);
        await upsertPaper(this.env.DB, m);
        return JSON.stringify(m);
      });
      const metadata = JSON.parse(metadataJson) as ArxivMetadata;

      const extractedJson = await step.do("extract-text", async () => {
        const raw = await downloadAndExtractText(metadata.pdfUrl);
        let text = raw.text;
        if (!keepReferences) text = stripReferences(text);
        text = truncateText(text, maxInputChars);
        const sha = await sha256Hex(text);
        await updateRun(this.env.DB, runId, { text_sha256: sha });
        const out: ExtractedText = {
          paperText: text,
          pageCount: raw.pageCount,
          sha256: sha,
        };
        return JSON.stringify(out);
      });
      const extracted = JSON.parse(extractedJson) as ExtractedText;

      const llmJson = await step.do(
        "call-llm",
        {
          timeout: "10 minutes",
          retries: { limit: 2, delay: "30 seconds", backoff: "exponential" },
        },
        async () => {
          const t0 = Date.now();
          const res = await callOpenAI({
            apiKey: this.env.OPENAI_API_KEY,
            model,
            reasoningEffort,
            metadata,
            paperText: extracted.paperText,
          });
          const out: LlmStepOutput = {
            result: res.result,
            usage: res.usage,
            latencyMs: Date.now() - t0,
          };
          return JSON.stringify(out);
        },
      );
      const llm = JSON.parse(llmJson) as LlmStepOutput;

      await step.do("save-result", async () => {
        const usage = llm.usage ?? {};
        const enriched = {
          ...llm.result,
          _metadata: metadata,
          _usage: usage,
          _runId: runId,
        };
        await updateRun(this.env.DB, runId, {
          status: "success",
          input_tokens:
            typeof usage.input_tokens === "number" ? usage.input_tokens : null,
          output_tokens:
            typeof usage.output_tokens === "number" ? usage.output_tokens : null,
          total_tokens:
            typeof usage.total_tokens === "number" ? usage.total_tokens : null,
          latency_ms: llm.latencyMs,
          result: JSON.stringify(enriched),
        });
      });
    } catch (err) {
      const e = err as Error;
      await updateRun(this.env.DB, runId, {
        status: "failed",
        error_type: e.name ?? "Error",
        error_message: (e.message ?? String(err)).slice(0, 2000),
      });
      throw err;
    }
  }
}
