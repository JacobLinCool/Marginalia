import OpenAI from "openai";

import type { ArxivMetadata } from "./arxiv";
import type { ReasoningEffort } from "./config";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import {
  EXTRACTION_SCHEMA,
  type ExtractionResult,
  type JsonValue,
} from "./schemas";

export type LLMUsage = { [key: string]: JsonValue };

export interface LLMCallResult {
  result: ExtractionResult;
  usage: LLMUsage | null;
}

export async function callOpenAI(opts: {
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  metadata: ArxivMetadata;
  paperText: string;
}): Promise<LLMCallResult> {
  const client = new OpenAI({ apiKey: opts.apiKey });

  // The SDK's ReasoningEffort enum trails actual API surface (e.g. "none",
  // "xhigh"). The Responses API accepts the string as-is, so we forward it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    model: opts.model,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(opts.metadata, opts.paperText) },
    ],
    reasoning: { effort: opts.reasoningEffort },
    text: {
      format: {
        type: "json_schema",
        name: "paper_rq_claims_extraction",
        schema: EXTRACTION_SCHEMA,
        strict: true,
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await client.responses.create(body);

  const outputText = response.output_text as string;
  const result = JSON.parse(outputText) as ExtractionResult;

  const usage: LLMUsage | null = response.usage
    ? (JSON.parse(JSON.stringify(response.usage)) as LLMUsage)
    : null;

  return { result, usage };
}
