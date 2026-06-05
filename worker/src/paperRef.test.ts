import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePaperRef } from "./paperRef.ts";

test("nature.com article URL maps to its 10.1038 DOI", () => {
  const ref = parsePaperRef("https://www.nature.com/articles/s41586-025-09196-4");
  assert.deepEqual(ref, {
    source: "doi",
    canonicalId: "doi:10.1038/s41586-025-09196-4",
    sourceId: "10.1038/s41586-025-09196-4",
    input: "https://www.nature.com/articles/s41586-025-09196-4",
  });
});

test("nature.com .pdf URL strips the extension before mapping", () => {
  const ref = parsePaperRef("https://www.nature.com/articles/s41586-025-09196-4.pdf");
  assert.equal(ref?.sourceId, "10.1038/s41586-025-09196-4");
});

test("bare nature.com host (no www) is also supported", () => {
  const ref = parsePaperRef("https://nature.com/articles/s41467-024-12345-6");
  assert.equal(ref?.canonicalId, "doi:10.1038/s41467-024-12345-6");
});

test("arxiv abs URL still resolves to an arxiv ref", () => {
  const ref = parsePaperRef("https://arxiv.org/abs/2605.06136");
  assert.equal(ref?.source, "arxiv");
  assert.equal(ref?.sourceId, "2605.06136");
});

test("doi.org URL still resolves to a doi ref", () => {
  const ref = parsePaperRef("https://doi.org/10.1145/3589334.3645501");
  assert.equal(ref?.canonicalId, "doi:10.1145/3589334.3645501");
});
