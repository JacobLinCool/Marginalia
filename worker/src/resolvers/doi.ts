import { USER_AGENT } from "../config";
import { fetchWithRetry } from "../httpRetry";
import type { PaperMetadata, PaperRef } from "../paper";
import { PaperResolveError } from "./errors";

interface CrossrefDate {
  "date-parts"?: number[][];
  "date-time"?: string;
}

interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
}

interface CrossrefLink {
  URL?: string;
  "content-type"?: string;
  "content-version"?: string;
}

interface CrossrefLicense {
  URL?: string;
}

interface CrossrefWork {
  DOI?: string;
  URL?: string;
  type?: string;
  title?: string[];
  abstract?: string;
  author?: CrossrefAuthor[];
  subject?: string[];
  "container-title"?: string[];
  event?: { name?: string; acronym?: string; location?: string };
  license?: CrossrefLicense[];
  link?: CrossrefLink[];
  resource?: { primary?: { URL?: string } };
  published?: CrossrefDate;
  "published-online"?: CrossrefDate;
  "published-print"?: CrossrefDate;
  indexed?: CrossrefDate;
}

interface CrossrefResponse {
  status?: string;
  message?: CrossrefWork;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateToIso(date: CrossrefDate | undefined): string | null {
  if (!date) return null;
  if (date["date-time"]) return date["date-time"];
  const parts = date["date-parts"]?.[0];
  if (!parts || parts.length === 0) return null;
  const [year, month = 1, day = 1] = parts;
  if (!year) return null;
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function authorName(author: CrossrefAuthor): string {
  if (author.name) return author.name.trim();
  return [author.given, author.family].filter(Boolean).join(" ").trim();
}

function choosePdfUrl(links: CrossrefLink[] | undefined): string | null {
  for (const link of links ?? []) {
    const url = link.URL ?? "";
    const contentType = link["content-type"]?.toLowerCase() ?? "";
    if (url.includes("/doi/pdf/") || contentType.includes("pdf")) return url;
  }
  return null;
}

export async function fetchDoiMetadata(ref: PaperRef): Promise<PaperMetadata> {
  const url = `https://api.crossref.org/works/${encodeURIComponent(ref.sourceId)}`;
  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": USER_AGENT } },
    { label: "crossref metadata", maxAttempts: 5 },
  );

  if (res.status === 404) {
    throw new PaperResolveError(
      `No Crossref metadata found for DOI ${ref.sourceId}`,
      404,
    );
  }
  if (!res.ok) {
    throw new PaperResolveError(
      `Crossref metadata ${res.status} for DOI ${ref.sourceId}`,
      502,
    );
  }

  const body = (await res.json()) as CrossrefResponse;
  const work = body.message;
  if (!work?.DOI) {
    throw new PaperResolveError(
      `Crossref response missing DOI metadata for ${ref.sourceId}`,
      502,
    );
  }

  const title = work.title?.[0]?.trim();
  if (!title) {
    throw new PaperResolveError(
      `Crossref metadata missing title for DOI ${ref.sourceId}`,
      502,
    );
  }

  const venue = work["container-title"]?.[0] ?? work.event?.name ?? null;
  const categories = work.subject ?? [];
  const pdfUrl = choosePdfUrl(work.link);
  const landingUrl =
    work.resource?.primary?.URL ??
    work.URL ??
    `https://doi.org/${ref.sourceId}`;

  return {
    canonicalId: ref.canonicalId,
    source: "doi",
    sourceId: ref.sourceId,
    doi: work.DOI.toLowerCase(),
    title,
    abstract: work.abstract ? stripHtml(work.abstract) : "",
    authors: (work.author ?? []).map(authorName).filter(Boolean),
    categories,
    primaryCategory: categories[0] ?? work.event?.acronym ?? null,
    venue,
    published:
      dateToIso(work.published) ??
      dateToIso(work["published-online"]) ??
      dateToIso(work["published-print"]),
    updated: dateToIso(work.indexed),
    landingUrl,
    pdfUrl,
    license: work.license?.[0]?.URL ?? null,
    rawMetadata: {
      provider: "crossref",
      doi: work.DOI,
      type: work.type,
      event: work.event ?? null,
      link: work.link ?? [],
      license: work.license ?? [],
      resource: work.resource ?? null,
    },
  };
}
