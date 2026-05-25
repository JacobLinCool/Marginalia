import { extractText, getDocumentProxy } from "unpdf";

import { USER_AGENT } from "./config";
import { fetchWithRetry } from "./httpRetry";

export function cleanPageText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/-\n(?=[a-z])/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripReferences(text: string): string {
  const re = /^[ \t]*(references|bibliography)[ \t]*$/gim;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m;
  if (!last) return text;
  if (last.index > text.length * 0.45) {
    return text.slice(0, last.index).trimEnd();
  }
  return text;
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + "\n\n[TRUNCATED DUE TO MAX_INPUT_CHARS]";
}

function startsWithPdfMagic(buf: Uint8Array): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x25 && // %
    buf[1] === 0x50 && // P
    buf[2] === 0x44 && // D
    buf[3] === 0x46    // F
  );
}

export async function downloadAndExtractText(
  pdfUrl: string,
): Promise<{ text: string; pageCount: number }> {
  const res = await fetchWithRetry(
    pdfUrl,
    { headers: { "User-Agent": USER_AGENT } },
    { label: "pdf download", maxAttempts: 10 },
  );
  if (!res.ok) throw new Error(`PDF download ${res.status} from ${pdfUrl}`);
  const ct = res.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!ct.toLowerCase().includes("pdf") && !startsWithPdfMagic(bytes)) {
    throw new Error(`Not a PDF: content-type=${ct}`);
  }

  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages: string[] = [];
  const arr = Array.isArray(text) ? text : [text];
  for (let i = 0; i < arr.length; i++) {
    const cleaned = cleanPageText(arr[i] ?? "");
    if (cleaned) pages.push(`[PAGE ${i + 1}]\n${cleaned}`);
  }
  return { text: pages.join("\n\n"), pageCount: totalPages };
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
