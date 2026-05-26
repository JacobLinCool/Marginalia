import { ImageResponse } from "takumi-js/response";
import { container, text, type Node } from "takumi-js/helpers";

const WIDTH = 1200;
const HEIGHT = 630;

export interface OgImageInput {
  canonicalId: string;
  title: string | null;
  summary: string | null;
  primaryCategory: string | null;
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function renderNode(input: OgImageInput): Node {
  const rawTitle = clamp(input.title ?? input.canonicalId, 120);
  const rawSummary = clamp(
    input.summary ??
      "Research questions, claims, evidence support, and overclaim risk from the paper's full text.",
    180,
  );
  const category = clamp(input.primaryCategory ?? "research paper", 42);
  const canonicalId = clamp(input.canonicalId, 84);
  const titleFontSize =
    rawTitle.length > 100 ? 52 : rawTitle.length > 72 ? 58 : 64;
  const summaryFontSize = rawSummary.length > 145 ? 30 : 33;

  return container({
    style: {
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      overflow: "hidden",
      padding: "56px 64px 50px",
      backgroundColor: "#f8fafc",
      color: "#111827",
      fontFamily: "Arial, Helvetica, sans-serif",
    },
    children: [
      container({
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#334155",
          fontSize: "26px",
        },
        children: [
          text("Marginalia", { fontWeight: 800 }),
          container({
            style: {
              boxSizing: "border-box",
              maxWidth: "480px",
              overflow: "hidden",
              padding: "10px 18px",
              borderRadius: "8px",
              backgroundColor: "#dbeafe",
            },
            children: [
              text(category, {
                color: "#1e3a8a",
                fontSize: "24px",
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }),
            ],
          }),
        ],
      }),
      container({
        style: {
          display: "flex",
          flexDirection: "column",
          width: "1010px",
        },
        children: [
          text(rawTitle, {
            marginBottom: "26px",
            color: "#111827",
            fontSize: `${titleFontSize}px`,
            lineHeight: 1.08,
            fontWeight: 800,
          }),
          text(rawSummary, {
            width: "990px",
            color: "#475569",
            fontSize: `${summaryFontSize}px`,
            lineHeight: 1.32,
          }),
        ],
      }),
      container({
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#64748b",
          fontSize: "24px",
        },
        children: [
          text(canonicalId, {
            maxWidth: "760px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }),
          container({
            style: {
              display: "flex",
              alignItems: "center",
            },
            children: [
              container({
                style: {
                  width: "88px",
                  height: "8px",
                  borderRadius: "8px",
                  backgroundColor: "#2563eb",
                },
              }),
              container({
                style: {
                  width: "88px",
                  height: "8px",
                  marginLeft: "8px",
                  borderRadius: "8px",
                  backgroundColor: "#14b8a6",
                },
              }),
              container({
                style: {
                  width: "88px",
                  height: "8px",
                  marginLeft: "8px",
                  borderRadius: "8px",
                  backgroundColor: "#f97316",
                },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export function ogImageResponse(input: OgImageInput): Response {
  const cacheControl =
    input.title || input.summary ? "public, max-age=3600" : "no-store";

  return new ImageResponse(renderNode(input), {
    width: WIDTH,
    height: HEIGHT,
    headers: {
      "cache-control": cacheControl,
    },
  });
}
