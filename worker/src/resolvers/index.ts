import { fetchArxivMetadata } from "../arxiv";
import type { PaperMetadata, PaperRef } from "../paper";
import { fetchDoiMetadata } from "./doi";

export async function resolvePaperMetadata(
  ref: PaperRef,
): Promise<PaperMetadata> {
  if (ref.source === "arxiv") return await fetchArxivMetadata(ref);
  if (ref.source === "doi") return await fetchDoiMetadata(ref);
  const exhaustive: never = ref.source;
  throw new Error(`Unsupported paper source: ${exhaustive}`);
}
