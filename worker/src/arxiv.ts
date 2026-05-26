import { XMLParser } from "fast-xml-parser";

import { USER_AGENT } from "./config";
import { fetchWithRetry } from "./httpRetry";
import type { PaperMetadata, PaperRef } from "./paper";
import { PaperResolveError } from "./resolvers/errors";

const ARXIV_API_URL = "https://export.arxiv.org/api/query";

export function splitArxivIdVersion(id: string): [string, string | null] {
  const m = id.match(/^(.*?)(v\d+)$/);
  if (m) return [m[1], m[2]];
  return [id, null];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function squashWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

interface AtomLink {
  "@_href"?: string;
  "@_title"?: string;
  "@_type"?: string;
}

interface AtomAuthor {
  name?: string;
}

interface AtomCategory {
  "@_term"?: string;
}

interface AtomEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: AtomAuthor | AtomAuthor[];
  category?: AtomCategory | AtomCategory[];
  link?: AtomLink | AtomLink[];
  "arxiv:primary_category"?: { "@_term"?: string };
}

function entryToMetadata(
  entry: AtomEntry,
  ref: PaperRef,
): PaperMetadata {
  const rawId = entry.id ?? "";
  const idWithVersion = rawId.includes("/abs/")
    ? rawId.split("/abs/").pop()!
    : ref.sourceId;
  const [baseId, version] = splitArxivIdVersion(idWithVersion);

  const links = asArray(entry.link);
  let pdfUrl = "";
  for (const link of links) {
    if (link["@_title"] === "pdf" || link["@_type"] === "application/pdf") {
      pdfUrl = link["@_href"] ?? "";
      break;
    }
  }
  if (!pdfUrl) pdfUrl = `https://arxiv.org/pdf/${baseId}`;
  const categories = asArray(entry.category)
    .map((c) => c["@_term"] ?? "")
    .filter(Boolean);

  return {
    canonicalId: ref.canonicalId,
    source: "arxiv",
    sourceId: ref.sourceId,
    doi: null,
    title: squashWhitespace(entry.title ?? ""),
    abstract: squashWhitespace(entry.summary ?? ""),
    authors: asArray(entry.author)
      .map((a) => squashWhitespace(a.name ?? ""))
      .filter(Boolean),
    categories,
    primaryCategory: entry["arxiv:primary_category"]?.["@_term"] ?? null,
    venue: "arXiv",
    published: entry.published ?? null,
    updated: entry.updated ?? null,
    landingUrl: `https://arxiv.org/abs/${baseId}`,
    pdfUrl,
    license: null,
    rawMetadata: {
      provider: "arxiv",
      arxivId: baseId,
      arxivVersion: version,
      idWithVersion,
      categories,
    },
  };
}

export async function fetchArxivMetadata(ref: PaperRef): Promise<PaperMetadata> {
  const url = new URL(ARXIV_API_URL);
  url.searchParams.set("id_list", ref.sourceId);

  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": USER_AGENT } },
    { label: "arxiv metadata", maxAttempts: 10 },
  );
  if (!res.ok) {
    throw new PaperResolveError(
      `arXiv API ${res.status}: ${await res.text()}`,
      502,
    );
  }
  const xml = await res.text();
  const parsed = xmlParser.parse(xml);
  const feed = parsed?.feed;
  if (!feed) {
    throw new PaperResolveError("arXiv API response missing <feed>", 502);
  }

  const entries = asArray<AtomEntry>(feed.entry);
  if (entries.length === 0) {
    throw new PaperResolveError(
      `No arXiv entry found for id=${ref.sourceId}`,
      404,
    );
  }
  return entryToMetadata(entries[0], ref);
}
