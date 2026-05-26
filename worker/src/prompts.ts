import type { PaperMetadata } from "./paper";

export const SYSTEM_PROMPT = `You are a rigorous research-paper analyst.

Your task is not to merely extract sentences. Your task is to reconstruct the paper's
actual research agenda from the full text.

Rules:
- Infer the paper's actual research questions even when the authors state them vaguely.
- Do not be captured by promotional or overbroad author framing.
- A good inferred RQ is specific, testable, and aligned with the paper's methods and evidence.
- Separate what the authors claim from what the paper actually supports.
- Flag overclaim risk when conclusions exceed experiments, assumptions, or scope.
- Use only the provided paper text. Do not use outside knowledge.
- Evidence quotes should be short and should include page markers when available.
`;

export function buildUserPrompt(
  metadata: PaperMetadata,
  paperText: string,
): string {
  const metadataJson = JSON.stringify(metadata, null, 2);
  return `Analyze this research paper.

Metadata:
${metadataJson}

Paper text with page markers:
${paperText}
`;
}
