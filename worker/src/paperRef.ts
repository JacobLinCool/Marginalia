import type { PaperRef } from "./paper";

const MODERN_ARXIV_ID_RE = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;
const LEGACY_ARXIV_ID_RE = /^[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i;
const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const DOI_EXACT_RE = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;

function canonicalDoi(doi: string): string {
  return doi.trim().replace(/^doi:/i, "").toLowerCase();
}

function trimDoiPunctuation(doi: string): string {
  return doi.replace(/[.,;:]+$/g, "");
}

function isArxivId(id: string): boolean {
  return MODERN_ARXIV_ID_RE.test(id) || LEGACY_ARXIV_ID_RE.test(id);
}

function arxivRef(id: string, input: string): PaperRef | null {
  const sourceId = id.trim();
  if (!isArxivId(sourceId)) return null;
  return {
    source: "arxiv",
    canonicalId: `arxiv:${sourceId}`,
    sourceId,
    input,
  };
}

function doiRef(doi: string, input: string): PaperRef | null {
  const sourceId = trimDoiPunctuation(canonicalDoi(doi));
  if (!DOI_EXACT_RE.test(sourceId)) return null;
  return {
    source: "doi",
    canonicalId: `doi:${sourceId}`,
    sourceId,
    input,
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function parseUrlRef(url: URL, input: string): PaperRef | null {
  const host = url.hostname.toLowerCase();
  const path = decodeURIComponent(url.pathname);

  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) {
    const m = path.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i);
    if (m) return arxivRef(m[1], input);
  }

  if (host === "doi.org" || host === "dx.doi.org") {
    const doi = path.replace(/^\/+/, "");
    return doiRef(doi, input);
  }

  if (host === "dl.acm.org") {
    const m = path.match(/^\/doi\/(?:abs\/|pdf\/|fullHtml\/)?(10\..+)$/i);
    if (m) return doiRef(m[1], input);
  }

  const doi = path.match(DOI_RE)?.[0];
  return doi ? doiRef(doi, input) : null;
}

export function parsePaperRef(input: string): PaperRef | null {
  const value = input.trim();
  if (!value) return null;

  if (value.toLowerCase().startsWith("arxiv:")) {
    return arxivRef(value.slice("arxiv:".length), value);
  }
  if (value.toLowerCase().startsWith("doi:")) {
    return doiRef(value.slice("doi:".length), value);
  }

  const url = parseUrl(value);
  if (url) return parseUrlRef(url, value);

  const doi = value.match(DOI_RE)?.[0];
  if (doi) return doiRef(doi, value);

  return arxivRef(value, value);
}
