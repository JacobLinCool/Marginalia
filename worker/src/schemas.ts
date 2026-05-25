export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    paper: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        one_sentence_summary: { type: "string" },
        primary_area: { type: "string" },
      },
      required: ["title", "one_sentence_summary", "primary_area"],
    },
    problem_framing: {
      type: "object",
      additionalProperties: false,
      properties: {
        field_context: { type: "string" },
        gap_or_limitation: { type: "string" },
        why_it_matters: { type: "string" },
      },
      required: ["field_context", "gap_or_limitation", "why_it_matters"],
    },
    research_questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rq: { type: "string" },
          source: {
            type: "string",
            enum: ["explicit", "inferred", "mixed"],
          },
          question_type: {
            type: "string",
            enum: [
              "comparative",
              "causal",
              "design",
              "measurement",
              "theoretical",
              "empirical",
              "systems",
              "other",
            ],
          },
          why_this_is_the_real_rq: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                page: { type: "string" },
                section_hint: { type: "string" },
                quote: { type: "string" },
                interpretation: { type: "string" },
              },
              required: ["page", "section_hint", "quote", "interpretation"],
            },
          },
          confidence: { type: "number" },
        },
        required: [
          "rq",
          "source",
          "question_type",
          "why_this_is_the_real_rq",
          "evidence",
          "confidence",
        ],
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          claim_type: {
            type: "string",
            enum: [
              "method",
              "empirical",
              "theoretical",
              "dataset",
              "system",
              "benchmark",
              "analysis",
              "other",
            ],
          },
          made_by_authors: { type: "boolean" },
          support_in_paper: {
            type: "string",
            enum: ["unsupported", "partially_supported", "supported"],
          },
          strength: {
            type: "string",
            enum: ["weak", "moderate", "strong"],
          },
          overclaim_risk: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                page: { type: "string" },
                section_hint: { type: "string" },
                quote: { type: "string" },
                interpretation: { type: "string" },
              },
              required: ["page", "section_hint", "quote", "interpretation"],
            },
          },
          notes: { type: "string" },
        },
        required: [
          "claim",
          "claim_type",
          "made_by_authors",
          "support_in_paper",
          "strength",
          "overclaim_risk",
          "evidence",
          "notes",
        ],
      },
    },
    overall_assessment: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        main_contribution: { type: "string" },
        main_weakness: { type: "string" },
        author_overclaim_summary: { type: "string" },
      },
      required: [
        "summary",
        "main_contribution",
        "main_weakness",
        "author_overclaim_summary",
      ],
    },
  },
  required: [
    "paper",
    "problem_framing",
    "research_questions",
    "claims",
    "overall_assessment",
  ],
} as const;

// JSON-only types so values flow through Workflow step.do (which constrains
// outputs to `Serializable<T>`).
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ExtractionResult = {
  paper: {
    title: string;
    one_sentence_summary: string;
    primary_area: string;
  };
  problem_framing: {
    field_context: string;
    gap_or_limitation: string;
    why_it_matters: string;
  };
  research_questions: JsonObject[];
  claims: JsonObject[];
  overall_assessment: {
    summary: string;
    main_contribution: string;
    main_weakness: string;
    author_overclaim_summary: string;
  };
};
