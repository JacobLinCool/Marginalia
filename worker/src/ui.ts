// Three self-contained HTML pages plus a shared render-result script. We keep
// them as plain strings so the Worker serves them with no static-assets
// binding. The shared JS lives in `renderResultScript` and is included by
// both the home page and the per-paper view.

const SHARED_CSS = `
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
         max-width: 960px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5;
         color: #18181b; }
  h1, h2, h3 { line-height: 1.3; }
  h1 { margin-top: 0; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  nav { margin-bottom: 1.5rem; font-size: .9rem; color: #71717a; }
  nav a { margin-right: 1rem; }
  input[type=text] { width: 100%; padding: .55rem .75rem; font-size: 1rem;
                     box-sizing: border-box; border: 1px solid #d4d4d8;
                     border-radius: 6px; }
  button { padding: .5rem 1rem; font-size: 1rem; cursor: pointer; border: 0;
           border-radius: 6px; background: #2563eb; color: white; }
  button:disabled { background: #94a3b8; cursor: progress; }
  pre { background: #f4f4f5; padding: 1rem; border-radius: 6px; overflow: auto;
        font-size: .85rem; }
  .status { padding: .6rem 1rem; border-radius: 6px; margin: 1rem 0;
            font-size: .95rem; }
  .queued, .running { background: #fef3c7; color: #92400e; }
  .done { background: #d1fae5; color: #065f46; }
  .failed { background: #fee2e2; color: #991b1b; }
  .not_found { background: #f4f4f5; color: #52525b; }
  details { margin: .5rem 0; }
  details > summary { cursor: pointer; padding: .4rem 0; font-weight: 600; }
  .meta { color: #71717a; font-size: .85rem; }
  .item { border-left: 3px solid #e4e4e7; padding: .25rem 0 .25rem .75rem;
          margin: .5rem 0; }
  .badge { display: inline-block; padding: .1rem .5rem; border-radius: 4px;
           background: #e4e4e7; font-size: .75rem; margin-right: .25rem;
           margin-bottom: .25rem; }
  .row { padding: .75rem 0; border-bottom: 1px solid #f4f4f5; }
  .row:last-child { border-bottom: 0; }
  .row a.title { font-weight: 600; }
`;

const RENDER_RESULT_SCRIPT = `
function escape(s) {
  return String(s ?? '').replace(/[&<>"]/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
  });
}

function item(title, content) {
  const d = document.createElement('div');
  d.className = 'item';
  d.innerHTML = '<p><strong>' + escape(title) + '</strong></p><p>' +
    escape(content || '') + '</p>';
  return d;
}

function renderResult(target, result) {
  if (!result) return;
  target.innerHTML = '';
  const root = document.createElement('div');
  const p = result.paper || {};
  const head = document.createElement('div');
  // Paper title is rendered server-side as the <h1> on the view page; only
  // emit summary + area here to avoid a duplicate heading.
  head.innerHTML =
    '<p><em>' + escape(p.one_sentence_summary || '') + '</em></p>' +
    '<p class="meta"><span class="badge">' + escape(p.primary_area || '?') +
    '</span></p>';
  root.appendChild(head);

  if (result.problem_framing) {
    const pf = result.problem_framing;
    const sec = document.createElement('section');
    sec.innerHTML = '<h3>Problem framing</h3>';
    sec.appendChild(item('Field context', pf.field_context));
    sec.appendChild(item('Gap / limitation', pf.gap_or_limitation));
    sec.appendChild(item('Why it matters', pf.why_it_matters));
    root.appendChild(sec);
  }

  if (Array.isArray(result.research_questions)) {
    const sec = document.createElement('section');
    sec.innerHTML = '<h3>Research questions (' +
      result.research_questions.length + ')</h3>';
    for (const rq of result.research_questions) {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML =
        '<p><span class="badge">' + escape(rq.source || '') + '</span>' +
        '<span class="badge">' + escape(rq.question_type || '') + '</span>' +
        '<span class="badge">conf=' + (rq.confidence ?? '?') + '</span></p>' +
        '<p><strong>' + escape(rq.rq || '') + '</strong></p>' +
        '<p class="meta">' + escape(rq.why_this_is_the_real_rq || '') + '</p>';
      sec.appendChild(div);
    }
    root.appendChild(sec);
  }

  if (Array.isArray(result.claims)) {
    const sec = document.createElement('section');
    sec.innerHTML = '<h3>Claims (' + result.claims.length + ')</h3>';
    for (const c of result.claims) {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML =
        '<p><span class="badge">' + escape(c.claim_type || '') + '</span>' +
        '<span class="badge">support=' + escape(c.support_in_paper || '') + '</span>' +
        '<span class="badge">overclaim=' + escape(c.overclaim_risk || '') + '</span>' +
        '<span class="badge">' + escape(c.strength || '') + '</span></p>' +
        '<p>' + escape(c.claim || '') + '</p>' +
        (c.notes ? '<p class="meta">' + escape(c.notes) + '</p>' : '');
      sec.appendChild(div);
    }
    root.appendChild(sec);
  }

  if (result.overall_assessment) {
    const oa = result.overall_assessment;
    const sec = document.createElement('section');
    sec.innerHTML = '<h3>Overall assessment</h3>';
    sec.appendChild(item('Summary', oa.summary));
    sec.appendChild(item('Main contribution', oa.main_contribution));
    sec.appendChild(item('Main weakness', oa.main_weakness));
    sec.appendChild(item('Author overclaim summary', oa.author_overclaim_summary));
    root.appendChild(sec);
  }

  const dump = document.createElement('details');
  dump.innerHTML = '<summary>Full JSON</summary><pre></pre>';
  dump.querySelector('pre').textContent = JSON.stringify(result, null, 2);
  root.appendChild(dump);

  target.appendChild(root);
}
`;

const SITE_NAME = "Marginalia";

interface PageMeta {
  /** Used in <title>, og:title, twitter:title. Should be plain text. */
  title: string;
  /** Plain text, used in meta description, og:description, twitter:description. */
  description: string;
  /** Absolute path on this origin (e.g. "/papers/arxiv%3A2605.06136/view"). */
  path: string;
  origin: string;
  /** Defaults to "website". Use "article" for per-paper pages. */
  ogType?: "website" | "article";
  /** Absolute path on this origin. When present, upgrades Twitter cards. */
  imagePath?: string;
  imageAlt?: string;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function clamp(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function page(meta: PageMeta, body: string, extraScript = ""): string {
  const title = escapeAttr(meta.title);
  const description = escapeAttr(clamp(meta.description, 300));
  const url = escapeAttr(meta.origin + meta.path);
  const site = escapeAttr(SITE_NAME);
  const ogType = meta.ogType ?? "website";
  const imageUrl = meta.imagePath ? escapeAttr(meta.origin + meta.imagePath) : null;
  const imageAlt = escapeAttr(meta.imageAlt ?? meta.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${site}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
${imageUrl ? `<meta property="og:image" content="${imageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${imageAlt}">` : ""}
<meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">
<meta name="twitter:image:alt" content="${imageAlt}">` : ""}
<style>${SHARED_CSS}</style>
</head>
<body>
<nav><a href="/">Submit</a><a href="/papers">Browse</a></nav>
${body}
<script>${RENDER_RESULT_SCRIPT}${extraScript}</script>
</body>
</html>`;
}

export function indexHtml(origin: string): string {
  return page(
    {
      title: "Marginalia",
      description:
        "Show a paper's actual research questions, claims, and overclaim risk from its full text.",
      path: "/",
      origin,
    },
    `<h1>Marginalia</h1>
<p class="meta">
  Enter an arXiv id, DOI, or paper URL to analyze the
  paper's research questions, claims, and overclaim risk.
</p>
<form id="f">
  <input type="text" id="paperInput" placeholder="2605.06136, 10.1145/3772318.3791958, or paper URL" required>
  <p><button id="submit" type="submit">Analyze</button></p>
</form>
<div id="status"></div>
<div id="result"></div>`,
    `
const f = document.getElementById('f');
const submitBtn = document.getElementById('submit');
const input = document.getElementById('paperInput');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
let pollTimer = null;
let currentId = null;

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = input.value.trim();
  if (!id) return;
  currentId = id;
  clear();
  setBusy(true);
  setStatus('queued', 'Submitting...');
  try {
    const r = await fetch('/papers/' + encodeURIComponent(id), { method: 'POST' });
    const body = await r.json();
    if (body.canonicalId) currentId = body.canonicalId;
    if (!r.ok && !body.status) body.status = 'failed';
    handle(currentId, body);
  } catch (err) {
    setStatus('failed', 'Error: ' + err.message);
    setBusy(false);
  }
});

function clear() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  resultEl.innerHTML = '';
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  submitBtn.textContent = busy ? 'Working...' : 'Analyze';
}

function setStatus(kind, msg) {
  statusEl.className = 'status ' + kind;
  statusEl.textContent = msg;
}

function handle(id, body) {
  if (id !== currentId) return;
  if (body.error && !body.status) {
    setStatus('failed', 'Failed: ' + body.error);
    setBusy(false);
    return;
  }
  if (body.status === 'success' || body.status === 'done') {
    window.location.href = '/papers/' + encodeURIComponent(id) + '/view';
    return;
  }
  if (body.status === 'failed') {
    setStatus('failed', 'Failed: ' + (body.error || 'unknown'));
    setBusy(false);
    return;
  }
  if (body.status === 'not_found') {
    setStatus('not_found', 'Not found.');
    setBusy(false);
    return;
  }
  setStatus(body.status, body.status + '...');
  pollTimer = setTimeout(() => poll(id), 5000);
}

async function poll(id) {
  if (id !== currentId) return;
  try {
    const r = await fetch('/papers/' + encodeURIComponent(id));
    const body = await r.json();
    handle(id, body);
  } catch (err) {
    setStatus('failed', 'Poll error: ' + err.message);
    setBusy(false);
  }
}
`,
  );
}

export function listHtml(origin: string): string {
  return page(
    {
      title: "Browse — Marginalia",
      description:
        "All papers analyzed on this site, newest first. Click a paper to view its analyzed research questions, claims, and overclaim assessment.",
      path: "/papers",
      origin,
    },
    `<h1>Browse papers</h1>
<p class="meta">All papers with a successful extraction, newest first.</p>
<div id="list">Loading...</div>`,
    `
const listEl = document.getElementById('list');
(async () => {
  try {
    const r = await fetch('/api/papers?limit=100');
    const body = await r.json();
    if (!body.papers || body.papers.length === 0) {
      listEl.innerHTML = '<p class="meta">No papers analyzed yet. <a href="/">Submit one</a>.</p>';
      return;
    }
    listEl.innerHTML = '';
    for (const p of body.papers) {
      const row = document.createElement('div');
      row.className = 'row';
      const href = '/papers/' + encodeURIComponent(p.canonical_id) + '/view';
      row.innerHTML =
        '<p><a class="title" href="' + href + '">' + escape(p.title || p.canonical_id) + '</a></p>' +
        (p.one_sentence_summary ? '<p>' + escape(p.one_sentence_summary) + '</p>' : '') +
        '<p class="meta">' +
          '<span class="badge">' + escape(p.canonical_id) + '</span>' +
          (p.primary_category ? '<span class="badge">' + escape(p.primary_category) + '</span>' : '') +
          '<span class="badge">latency ' + (p.latency_ms ?? '?') + 'ms</span>' +
          '<span class="badge">' + escape(p.finished_at || '') + '</span>' +
        '</p>';
      listEl.appendChild(row);
    }
  } catch (err) {
    listEl.innerHTML = '<p class="failed status">Error: ' + escape(err.message) + '</p>';
  }
})();
`,
  );
}

export interface ViewMeta {
  /** Paper title, if known. Falls back to the canonical id. */
  title: string | null;
  /** One-sentence summary, if a successful extraction exists. */
  description: string | null;
  /** Source landing page, if known. */
  landingUrl: string | null;
}

export function viewHtml(
  canonicalId: string,
  meta: ViewMeta,
  origin: string,
): string {
  const safeId = canonicalId.replace(/[<>"&]/g, "");
  const seoTitle = `${meta.title ?? safeId} — ${SITE_NAME}`;
  const seoDescription =
    meta.description ??
    `Analyzed research questions, claims, and overclaim risk for ${safeId}.`;
  const sourceLink = meta.landingUrl
    ? `<a href="${escapeAttr(meta.landingUrl)}" target="_blank" rel="noreferrer">Source page</a>`
    : "";
  return page(
    {
      title: seoTitle,
      description: seoDescription,
      path: `/papers/${encodeURIComponent(canonicalId)}/view`,
      origin,
      ogType: "article",
      imagePath: `/papers/${encodeURIComponent(canonicalId)}/og.png`,
      imageAlt: meta.title ?? safeId,
    },
    `<h1>${escapeAttr(meta.title ?? safeId)}</h1>
<p class="meta"><span class="badge">${escapeAttr(safeId)}</span> ${sourceLink}</p>
<div id="status"></div>
<div id="result"></div>`,
    `
const canonicalId = ${JSON.stringify(canonicalId)};
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
let pollTimer = null;

function setStatus(kind, msg) {
  statusEl.className = 'status ' + kind;
  statusEl.textContent = msg;
}

function clear() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function load() {
  try {
    const r = await fetch('/papers/' + encodeURIComponent(canonicalId));
    const body = await r.json();
    handle(body);
  } catch (err) {
    setStatus('failed', 'Error: ' + err.message);
  }
}

function handle(body) {
  if (body.status === 'success' || body.status === 'done') {
    statusEl.className = '';
    statusEl.textContent = '';
    renderResult(resultEl, body.result);
    return;
  }
  if (body.status === 'failed') {
    setStatus('failed', 'Failed: ' + (body.error || 'unknown'));
    return;
  }
  if (body.status === 'not_found') {
    setStatus('not_found',
      'Not yet analyzed. Go to /, submit ' + canonicalId + ', then come back.');
    return;
  }
  setStatus(body.status, body.status + '...');
  pollTimer = setTimeout(load, 5000);
}

load();
`,
  );
}
