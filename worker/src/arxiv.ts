import { XMLParser } from "fast-xml-parser";

import { USER_AGENT } from "./config";
import { fetchWithRetry } from "./httpRetry";

export interface ArxivMetadata {
  arxivId: string;
  arxivVersion: string | null;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  primaryCategory: string | null;
  published: string | null;
  updated: string | null;
  pdfUrl: string;
}

const ARXIV_API_URL = "https://export.arxiv.org/api/query";

export function normalizeArxivId(value: string): string {
  let v = value.trim();
  v = v.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, "");
  v = v.replace(/\.pdf$/, "");
  return v;
}

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

function entryToMetadata(entry: AtomEntry, fallbackId: string): ArxivMetadata {
  const rawId = entry.id ?? "";
  const idWithVersion = rawId.includes("/abs/")
    ? rawId.split("/abs/").pop()!
    : fallbackId;
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

  return {
    arxivId: baseId,
    arxivVersion: version,
    title: squashWhitespace(entry.title ?? ""),
    abstract: squashWhitespace(entry.summary ?? ""),
    authors: asArray(entry.author)
      .map((a) => squashWhitespace(a.name ?? ""))
      .filter(Boolean),
    categories: asArray(entry.category)
      .map((c) => c["@_term"] ?? "")
      .filter(Boolean),
    primaryCategory: entry["arxiv:primary_category"]?.["@_term"] ?? null,
    published: entry.published ?? null,
    updated: entry.updated ?? null,
    pdfUrl,
  };
}

export async function fetchArxivMetadata(arxivId: string): Promise<ArxivMetadata> {
  const [baseId] = splitArxivIdVersion(arxivId);
  const url = new URL(ARXIV_API_URL);
  url.searchParams.set("id_list", arxivId);

  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": USER_AGENT } },
    { label: "arxiv metadata", maxAttempts: 10 },
  );
  if (!res.ok) {
    throw new Error(`arXiv API ${res.status}: ${await res.text()}`);
  }
  const xml = await res.text();
  const parsed = xmlParser.parse(xml);
  const feed = parsed?.feed;
  if (!feed) throw new Error("arXiv API response missing <feed>");

  const entries = asArray<AtomEntry>(feed.entry);
  if (entries.length === 0) {
    throw new Error(`No arXiv entry found for id=${arxivId}`);
  }
  return entryToMetadata(entries[0], baseId);
}
