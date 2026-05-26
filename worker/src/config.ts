export const PROMPT_VERSION = "v0.1.0";
export const SCHEMA_VERSION = "v0.1.0";

export const DEFAULT_MODEL = "gpt-5.4-mini";
export const DEFAULT_REASONING_EFFORT = "medium";
export const DEFAULT_MAX_INPUT_CHARS = 160_000;

export const USER_AGENT =
  "marginalia-worker/0.1 (mailto:jacoblincool@gmail.com)";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type RunStatus = "queued" | "running" | "success" | "failed";
