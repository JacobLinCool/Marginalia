export type PaperSource = "arxiv" | "doi";

export interface PaperRef {
  source: PaperSource;
  /** Stable internal key, e.g. `arxiv:2605.06136` or `doi:10.1145/...`. */
  canonicalId: string;
  /** Source-native identifier without the source prefix. */
  sourceId: string;
  input: string;
}

export interface PaperMetadata {
  canonicalId: string;
  source: PaperSource;
  sourceId: string;
  doi: string | null;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  primaryCategory: string | null;
  venue: string | null;
  published: string | null;
  updated: string | null;
  landingUrl: string;
  pdfUrl: string | null;
  license: string | null;
  rawMetadata: Record<string, unknown>;
}
