# Page Date Detection — Design & Build Plan

Status: **draft, pre-Phase-0.** Nothing is built yet. Phase 0 (§8) is a decision gate that can still redirect this document.

---

## 1. Context

Most articles and web pages don't show when they were written. Worse, pages that *do* show a date often show the **original** publication date while the content has been silently rewritten years later. There is no reliable way to judge whether technical content ("is this Astro SSR post pre- or post-v5?") or regulatory material (a NIS2 / IEC 62443 summary from 2021 vs 2025 is a materially different document) is current.

**Prior art, and why it isn't enough:**

| Thing | What it does | Why it falls short |
|---|---|---|
| [Published Date](https://addons.mozilla.org/en-US/firefox/addon/published-date/) ([src](https://github.com/ndsvw/Published-Date)) | ~40 detection methods, Firefox + Chrome | Single date, no provenance; Firefox build is still MV2 |
| [Show Published Date](https://chromewebstore.google.com/detail/show-published-date/megeibiipjngcjncbipfemihhicimmam) | meta tags, JSON-LD, itemprop | Narrower detection, no confidence signal |
| `unfluff`, `node-article-extractor` | Full article extraction incl. date | Unmaintained (~8y), Node/Cheerio-shaped |
| [`@extractus/article-extractor`](https://www.npmjs.com/package/@extractus/article-extractor) | Maintained article extractor | Date is a side effect of content extraction; Node-shaped |
| `@settingdust/article-extractor` | Accepts `Document`, separate published/modified extractors | Right API shape, but 22 deps, zero dependents |
| [htmldate](https://github.com/adbar/htmldate) | The reference implementation. Fast + extensive modes, multilingual, production-proven | Python. **Apache-2.0 since v1.8.0** (GPLv3+ before) — porting its logic is license-clean |

**The gap:** nothing is browser-first with zero deps, exposes published and modified as distinct outputs, *and* carries a confidence/provenance field. That last one is what the whole idea needs and nobody exposes it.

**Outcome:** an npm library that returns date *candidates with provenance and confidence*, plus a WXT extension that renders them — including **disagreement between sources**, which is the actual complaint being solved.

---

## 2. Scope & non-goals

**In scope:** library + extension + Wayback timeline. Open-source, published to npm. Generic core plus a small per-domain adapter layer.

**Non-goals:**

- Full article/content extraction. Dates only. Not competing with `@extractus`.
- Server-side rendering as a design driver. Node must work (for tests), but the browser is the target — a live `Document` is the primary input, and no HTML parser ships in the bundle.
- Text diffing of archive snapshots. Too expensive; see §7.
- Fixing the web. This surfaces what sites declare, and flags when they contradict themselves.

**Two design commitments that differ from conventional approaches:**

1. **Feeds are a first-class, top-tier signal.** Hugo, Astro, Jekyll and Eleventy all emit RSS/Atom by default, discoverable from one `<link rel="alternate">` in `<head>`. Atom entries carry `<published>` *and* `<updated>` as separate elements. This is a site-**declared** signal sitting right there on exactly the undated personal blogs where inline metadata is absent — the case usually written off as unsolvable.
2. **The API returns candidates, never "a date."** A single-date return value structurally cannot express *"declared 2019, but the archive shows edits through 2024."* That expression is the product.

---

## 3. Repository layout

pnpm workspaces monorepo:

```
website-date/
├─ package.json                  # workspace root, pnpm
├─ pnpm-workspace.yaml
├─ docs/
│  └─ DESIGN.md                  # this document
├─ packages/
│  └─ pagedate/                  # the library — zero runtime deps
│     ├─ src/
│     │  ├─ index.ts             # public API surface
│     │  ├─ types.ts             # Candidate, DateResult, Env, Adapter
│     │  ├─ extract/
│     │  │  ├─ jsonld.ts         # schema.org, @graph traversal
│     │  │  ├─ opengraph.ts      # article:published_time / modified_time
│     │  │  ├─ meta.ts           # Dublin Core, citation_*, itemprop, name=date
│     │  │  ├─ timeTags.ts       # <time datetime> w/ context scoring
│     │  │  ├─ urlSlug.ts        # /YYYY/MM/DD/
│     │  │  ├─ visibleText.ts    # multilingual "Updated on…" patterns
│     │  │  ├─ feed.ts           # RSS/Atom discovery + entry match
│     │  │  ├─ sitemap.ts        # sitemap.xml <lastmod>, index-aware
│     │  │  └─ httpHeaders.ts    # conditional Last-Modified
│     │  ├─ adapters/
│     │  │  ├─ index.ts          # registry + dispatch
│     │  │  ├─ stackexchange.ts
│     │  │  ├─ github.ts
│     │  │  └─ docgen.ts         # Docusaurus/VitePress/Starlight/MkDocs
│     │  ├─ parse/
│     │  │  ├─ normalize.ts      # → ISO + precision
│     │  │  ├─ locale.ts         # DD/MM vs MM/DD disambiguation
│     │  │  └─ plausibility.ts   # range + "is this just now?" checks
│     │  ├─ resolve.ts           # candidate → DateResult + conflict detection
│     │  └─ archive/
│     │     └─ cdx.ts            # Wayback CDX client + edit-event derivation
│     ├─ test/
│     └─ package.json
├─ apps/
│  └─ extension/                 # WXT — MV3 Chrome + Firefox from one codebase
│     ├─ entrypoints/
│     │  ├─ background.ts        # service worker: all network + resolution
│     │  ├─ content.ts           # DOM-only extraction, no network
│     │  └─ popup/
│     └─ wxt.config.ts
├─ fixtures/                     # captured pages + annotations
│  └─ <slug>/
│     ├─ page.html
│     ├─ headers.json
│     ├─ feed.xml                # optional
│     ├─ sitemap.xml             # optional
│     └─ expected.json
└─ scripts/
   └─ fixture.ts                 # capture harness
```

---

## 4. Library design

### 4.1 Public API

```ts
// The two halves exist separately because they split across the MV3 boundary:
// extraction is sync + DOM-only (content script), resolution is async +
// network-backed (service worker). This is not incidental — see §6.2.

export function extractFromDocument(doc: Document, url: string): Candidate[]

export function resolve(
  candidates: Candidate[],
  url: string,
  env?: Env,
): Promise<DateResult>

// Convenience wrapper for Node/tests/simple use. This is the only entry point
// that fetches: feed (§4.4), sitemap (§4.5) and, on request, response headers
// (§4.10). Each network signal is a decision, so each is an option.
export function findDates(
  doc: Document,
  url: string,
  env?: Env,
  options?: ResolveOptions & ExtractOptions & NetworkOptions,
): Promise<DateResult>

export type NetworkOptions = {
  sitemap?: boolean      // default true, skipped when the page declares `modified`
  httpHeaders?: boolean  // default false — see §4.10
}
```

### 4.2 Types

```ts
type Confidence =
  | 'declared'   // the site explicitly stated this in structured metadata
  | 'derived'    // structured but weaker, or from an adjacent site-owned document
  | 'inferred'   // guessed from URL shape, prose, or transport headers

type Field = 'published' | 'modified' | 'unknown'

type Candidate = {
  value: string                              // ISO 8601, truncated to precision
  precision: 'year' | 'month' | 'day' | 'minute'
  field: Field
  source: string                             // 'jsonld' | 'atom-feed' | 'url-slug' | …
  confidence: Confidence
  note?: string                              // human-readable, shown in UI on hover
}

type DateResult = {
  published?: Candidate
  modified?: Candidate
  candidates: Candidate[]                    // everything found, unresolved
  conflict?: {
    kind: 'declared-disagreement' | 'stale-declaration'
    gapDays: number
    detail: string                           // rendered verbatim in the UI
  }
  archive?: ArchiveTimeline                  // only when explicitly requested
}

type Env = {
  // The library NEVER calls network directly. Node tests inject a fixture
  // replayer; the extension injects a shim that routes through the SW.
  fetchText?(url: string): Promise<string | null>
  fetchHeaders?(url: string): Promise<Record<string, string> | null>
}

type Adapter = {
  name: string
  matches(url: URL, doc: Document): boolean
  extract(doc: Document, url: URL): Candidate[]
}
```

The `Env` injection point is load-bearing. It keeps the library pure with respect to network, which means the whole thing is testable in Node against fixtures — and therefore **Phases 0–2 are fine on WSL2**.

### 4.3 Signal ladder

**`declared` — the site said so**

- **JSON-LD** `datePublished` / `dateModified`. Must traverse `@graph`, handle arrays, nested `@type`, and multiple `<script type="application/ld+json">` blocks. Prefer nodes whose `@type` is `Article`/`BlogPosting`/`NewsArticle`/`TechArticle` over `WebPage`.
- **OpenGraph** `article:published_time` / `article:modified_time` (`<meta property=…>`).
- **RSS/Atom feed** entry matching this URL — Atom `<published>` and `<updated>`, RSS `<pubDate>` (plus `<atom:updated>` when present). See §4.4.
- **Per-domain adapters** (§4.6).

**`derived` — structured but weaker**

- `<time datetime>` — scored by context. Inside `<article>` header/footer, or adjacent to author markup, scores high; in a sidebar "recent posts" list, low. Reject `<time>` elements inside `<nav>`, `<aside>`, or elements matching common "related/recent/popular" class patterns.
- Dublin Core `DC.date.issued` / `DC.date.modified`, `citation_publication_date`, `itemprop="datePublished"`, `<meta name="date">`.
- **`sitemap.xml` `<lastmod>`** for the exact URL. Cheap, surprisingly reliable, almost nobody uses it. See §4.5.

**`inferred` — guessed**

- **URL slug** patterns: `/2024/03/12/`, `/2024-03-12-`, `/2024/03/`. Precision follows what's present.
- **Image upload path** — the `/2016/05/04/` in the `og:image` a page declares. Day-partitioned paths only; monthly buckets were measured and are wrong more often than right. See §4.9.
- **HTTP `Last-Modified`** via HEAD — **opt-in**, ranked last, and off by default on measured evidence. See §4.10. **Never use `document.lastModified`**: it silently falls back to *now* when the header is absent, which makes it worse than useless.
- **Visible-text patterns** — multilingual from day one, Italian included: `Updated on`, `Last updated`, `Posted`, `Published`, `Pubblicato il`, `Ultimo aggiornamento`, `Aggiornato il`, `Veröffentlicht`, `Publié le`, `Actualizado`. Scoped to article context, same exclusions as `<time>`.

**External provenance (separate field, never merged into `published`/`modified`)**

- Wayback CDX: first capture is an *upper bound* on publication; digest changes are edit events (§7).

### 4.4 Feed discovery & matching

1. Read `<link rel="alternate" type="application/rss+xml">` and `application/atom+xml` from `<head>`; resolve relative hrefs against the page URL.
2. If absent, probe well-known paths in order: `/index.xml` (Hugo default), `/feed.xml`, `/rss.xml`, `/atom.xml`, `/feed/`. Probe at most 2 before giving up — these are extra requests.
3. Parse with `DOMParser` (browser) / `linkedom` (tests). No XML dependency ships.
4. Match the entry to the page by, in order: exact URL → `<link rel=canonical>` URL → path-only match ignoring query/hash → path suffix match.
5. Atom yields both `<published>` and `<updated>` — map to `field` directly. RSS `<pubDate>` maps to `published` only.

Feeds usually list only recent entries, so this succeeds most often on recent posts. That is fine — it's a high-value signal when it hits and costs one request when it doesn't.

### 4.5 Sitemap handling

*Built. `src/extract/sitemap.ts`.*

`<link rel="sitemap">` if the page declares one, otherwise `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml`. Sitemap **index** files are followed, with the whole lookup sharing a budget of three fetched documents; children are tried in order of how much path they share with the page, since a post at `/guide/install/` is far likelier to be listed in `/guide/sitemap.xml` than in the first child alphabetically. Gzipped children are skipped — we have no unzip, and fetching one buys a parse failure at the price of a request. Find `<url>` whose `<loc>` matches the page (exact → canonical → path-only), read `<lastmod>`.

The signal says **`modified`, not `published`**. `<lastmod>` is defined as when the file changed; on a page never edited the two coincide, but laundering one into the other would be exactly the invention this library refuses elsewhere. A page whose only date comes from the sitemap therefore reports a modification date and an explicitly undeclared publication date.

`<lastmod>` reflects the *sitemap generator's* notion of change, which for most SSGs is the source file mtime — good — but for some CMSes is the build time, in which case it collapses to one instant for every URL. Detect that: if **every** entry carries an identical `<lastmod>` and there are at least ten of them, drop the signal. The plan originally said "sample the first three"; that was tightened during implementation because a small site published in one sitting legitimately has three identical values, and dropping a real signal is the more expensive error here.

The lookup is skipped entirely when the page already declares a modification date — the only field a sitemap can speak to — so the request is spent only where it can change the answer.

Measured: on the local corpus it answers `danluu.com/everything-is-broken/`, a hand-written page with no date anywhere in its markup, with `2014-11-18` — corroborated by the page's own links to articles published in November 2014. That fixture's expectation was changed when this landed, and the reasoning is recorded in `fixtures/danluu-no-date/expected.json`.

### 4.6 Per-domain adapters

A small pluggable registry matched on hostname or DOM fingerprint. This targets the content that actually motivates the project — generic heuristics optimize for news, which is the case where help isn't needed.

- **Stack Overflow / Stack Exchange** — page-level JSON-LD exists, but the useful thing is **per-answer** timestamps. The question being from 2011 doesn't matter if the top answer was edited last year.
- **GitHub** — commit date for blob/README/wiki views; `relative-time` elements carry a `datetime` attribute.
- **Doc generators** (`docgen.ts`) — Docusaurus, VitePress, Starlight and MkDocs Material all render a git-derived "Last updated" footer. Fingerprint by `<meta name="generator">` or characteristic DOM classes. **One adapter covers thousands of sites**, which is the whole reason this layer earns its complexity.

Adapter output is `declared` confidence and short-circuits nothing — generic extractors still run, so conflicts remain visible.

### 4.7 Parsing & plausibility

- **Normalize** every candidate to ISO 8601 truncated to its actual precision. Never invent precision — `2024` stays `2024`, not `2024-01-01`.
- **Locale disambiguation** for `DD/MM` vs `MM/DD`: use `<html lang>`, then TLD, then site-wide consistency (if other dates on the page disambiguate, apply that reading). Relevant for Italian sites, which are explicitly in the target corpus. When genuinely ambiguous, drop precision to month rather than guessing.
- **Timezone**: preserve as given. Do not normalize to UTC — it shifts the displayed day for no benefit.
- **Plausibility filter**: reject before 1995, reject beyond now + 48h, reject anything within 60s of "now" (that's a render timestamp, not a publication date).

### 4.8 Resolution & conflict detection

```
1. Filter candidates through plausibility.
2. Bucket by field.
3. Within each bucket, rank by: confidence tier → source priority → precision.
   Take the top as the resolved value for that field.
4. Reassign 'unknown' candidates: if no published exists and the candidate is
   earlier than the resolved modified, promote it to published.
5. Conflict detection — two distinct kinds, both surfaced:
   a. 'declared-disagreement' — two `declared` candidates for the SAME field
      disagree by > 30 days. The site contradicts itself.
   b. 'stale-declaration' — a declared published date predates a strong
      modification signal (declared/derived modified, or an archive edit event)
      by > 365 days, AND no modified date is displayed by the site itself.
      This is the "claims 2019 but the text is from last year" case.
```

`published` and `modified` simply *differing* is normal and is **not** a conflict. Encoding that distinction correctly is what keeps the conflict flag meaningful rather than permanently lit.

### 4.9 Image upload paths

*Built. `src/extract/imagePath.ts`.*

WordPress files uploads under `/wp-content/uploads/2016/05/`, Drupal under `/files/2016/05/04/`, and the image a post declares as its `og:image` or `twitter:image` is usually the one uploaded with it. On CMS-shaped sites emitting no other date, it can be the only machine-readable signal on the page.

Only paths carrying a **day** are accepted. This is measured, not squeamishness. Six of the 55 pages in the external corpus declare a dated image path:

| shape | pages | agree with the page's real date |
|---|---|---|
| `/2016/05/04/` (day) | 2 | 2 |
| `/2016/05/` (month) | 4 | 1 |

A monthly bucket holds every image a site used that month, including the stock banner it has reused since — `verfassungsblog.de` previews a 2014 photo on a 2019 article, `wara-enforcement.org` a resized elephant thumbnail. Accepting months scored +1 exact and +1 false positive; accepting only days scored +1 exact and nothing else. On the external corpus this signal takes strict accuracy from 61.8% to 63.6%, and does the same against the corrected answer key (67.3% → 69.1%).

It is `inferred` and ranks *below* `url-slug`: a post's URL is minted with the post, but its preview image is reusable.

### 4.10 Transport signals — HTTP `Last-Modified`

*Built, `src/extract/headers.ts`, and off by default.*

On a static host this is a file's mtime and is real information. Behind a CDN or any dynamic renderer it is the moment the response was assembled. Three filters try to tell those apart:

1. Discard when `Last-Modified` is within five minutes of the response's own `Date` header — that is a page built for this request.
2. Discard when `Cache-Control` says `no-store`, `no-cache` or `max-age=0`.
3. Discard when the response sets a cookie while serving itself.

What is left is still poor. Measured over the five local fixtures whose capture recorded a `Last-Modified`: one filtered correctly, one was right by coincidence (a news page published the same day), one was outranked by a date the page declared, and **two were false** — a GitHub Pages rebuild reported as an edit to a year-old release announcement, and a static-site deploy reported as an edit to a page that has none.

So it exists, because it is real information on the hosts where it is real; it is `inferred`; it ranks below every other source; and the caller has to ask for it (`httpHeaders: true`, or `--headers`). Enabling it by default would have cost accuracy on the corpus, which is the whole argument.

### 4.11 What the library will fetch, and what it refuses

*Built, `src/extract/urlGuard.ts`.*

Feed and sitemap discovery reads URLs the **analysed page wrote** — `<link rel="alternate">`, `<link rel="sitemap">`, and `<loc>` inside a sitemap index. That is the correct design, and it means a page chooses what the analysing host connects to. Unguarded, a document only has to say

```html
<link rel="sitemap" href="http://169.254.169.254/latest/meta-data/">
```

to have a server fetch its own cloud credentials endpoint. Response bodies never reach the caller, but reachability, timing, and any `<lastmod>`-shaped bytes in the reply do.

`isSafeFetchTarget` is the filter, and the rule is **public hosts only, not same-origin**. Feeds legitimately live off-origin — FeedBurner, Substack — so refusing those would cost real accuracy to solve a problem that address filtering already solves. What is refused:

- anything that is not `http:` or `https:` — `file:`, `data:`, `gopher:`
- URLs carrying credentials, which would be handed to whatever host the page named
- loopback, RFC 1918, carrier-grade NAT, link-local (including `169.254.169.254`), multicast and reserved IPv4; the IPv6 equivalents; and the IPv4-mapped and NAT64 spellings of all of them
- `localhost`, `.local`, `.internal`, `.home.arpa`, and single-label hostnames, which resolve through the resolver's search domain

Alternative encodings — `http://2130706433/`, `http://0177.0.0.1/` — need no special handling because `URL` normalises them to dotted decimal before the guard sees them. `test/urlGuard.test.ts` asserts that, since it is someone else's behaviour being relied on.

`nodeEnv` applies the same filter to every request including its own, follows redirects **by hand** so each hop is re-checked (`redirect: 'follow'` would let a public URL bounce to a private one), and caps response bodies at 5 MB — a timeout does not bound memory, because a server drip-feeding inside the deadline stays inside it the whole time it fills the heap.

Analysing your own dev server is an ordinary thing to want, so `blockPrivateNetwork: 'off'` drops the address check — keeping the scheme test, because "fetch this page" never meant "read the local disk". The opt-out exists so that wanting `http://localhost:3000/` does not push anyone off the guarded path and into hand-rolling an `Env`.

Two limits are worth stating plainly. The guard never resolves DNS, so a public hostname pointing at a private address passes; `blockPrivateNetwork: 'strict'` adds a resolution preflight, which closes that but not DNS rebinding — the socket is not pinned to the address that was checked. And this is the *Node* path. The extension is stricter and always was: `apps/extension/lib/analyze.ts` refuses anything cross-origin outright and fetches with `credentials: 'omit'`.

---

## 5. Fixture harness & testing

Build the harness **before** the heuristics. Capturing 50 pages by hand is tedious enough to kill the project outright; this is the difference between the corpus existing and not.

`scripts/fixture.ts <url> [--slug name]` snapshots:

```jsonc
// fixtures/<slug>/expected.json
{
  "url": "https://example.com/posts/thing",
  "capturedAt": "2026-07-28",
  "notes": "Hugo blog, no inline date, has /index.xml",
  "expect": {
    "published": { "value": "2023-04-11", "source": "atom-feed", "confidence": "declared" },
    "modified":  null,
    "conflict":  null
  }
}
```

alongside `page.html`, `headers.json`, and any discovered `feed.xml` / `sitemap.xml`.

Tests use **Vitest + `linkedom`** to turn fixture HTML into a `Document`, with an `Env` that replays `headers.json` / `feed.xml` / `sitemap.xml` and **throws on any un-stubbed network access** — that assertion is what keeps the library honestly network-pure.

Assertions cover not just the resolved date but `source` and `confidence` per candidate. Track overall pass rate as a printed number so a heuristic change that raises the aggregate while breaking a previously-passing fixture is visible rather than silent.

**Conflict cases get their own dedicated fixtures.** It's the differentiating behaviour; it needs deliberate coverage, not incidental.

---

## 6. Extension

### 6.1 Privacy posture drives the permission model

**On-demand popup is the default; the always-on banner is opt-in.** An extension that reads every page and queries archive.org for every URL you visit is a browsing-history side channel.

This isn't only hygiene — it changes the install prompt. On-demand needs `activeTab`, which asks for nothing scary. An always-on banner needs `<all_urls>`, which is the difference between an extension people install and one they don't. Ship the popup; make the banner a settings toggle that triggers an optional-permission request at the moment it's enabled.

```jsonc
// permissions
["activeTab", "storage", "scripting"]
// optional_host_permissions
["*://web.archive.org/*", "<all_urls>"]
```

### 6.2 Split across the MV3 boundary

```
content script  →  extractFromDocument(document, url)  →  Candidate[]   (sync, no network)
        │
        │  { type: 'RESOLVE', url, candidates }
        ▼
service worker  →  resolve(candidates, url, env)  →  DateResult
                   env does: HEAD, feed fetch, sitemap fetch, CDX
        │
        │  { type: 'RESOLVED', result }
        ▼
popup / banner renders
```

All network lives in the service worker — CORS plus `host_permissions` make this mandatory, and it's also where caching belongs.

### 6.3 Rendering

- Banner injects into a **closed shadow DOM**, or site CSS will eat it.
- **Confidence tiers must render visibly distinctly.** "Declared by the site" and "guessed from body text" showing identically is the exact failure mode of every existing extension. Solid vs dashed border, plus an explicit source label.
- Conflicts get the loudest treatment available — that's the state worth interrupting for.
- SPAs hydrate dates after load: `MutationObserver` on `<head>` plus Navigation API hooks to re-run on soft navigation.

### 6.4 Caching

`chrome.storage.local`, keyed `d:<sha256(url)>` → `{ result, fetchedAt, libVersion }`.

- Page-signal results: 7-day TTL.
- CDX results: 30-day TTL (archive history barely changes, and IA *will* rate-limit).
- Invalidate the whole cache when `libVersion` changes, so heuristic improvements don't get masked by stale entries.

### 6.5 Distribution

**Do not pay the $5 Chrome Web Store fee yet.** Load unpacked in Chrome and as a temporary add-on in Firefox until it's proven itself over a month of real use. WXT wraps `web-ext` for Firefox linting/signing when that time comes.

---

## 7. Wayback timeline (sequenced last, cuttable)

```
https://web.archive.org/cdx/search/cdx
  ?url=<encoded>
  &output=json
  &fl=timestamp,digest,statuscode
  &filter=statuscode:200
  &collapse=digest
  &limit=200
```

Rows where the digest differs from the previous row are edit events. Render as a sparkline under the banner, **lazily on click only**.

**Limitations to encode in the UI rather than paper over:**

- `collapse=digest` dedupes **adjacent** rows only — confirmed against the [CDX server docs](https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/README.md). A page alternating between two states still yields many rows. Post-filter client-side.
- The digest covers the whole HTML, so rotating ads, CSRF nonces and embedded render timestamps all produce false-positive "changes." The real fix — fetching snapshots and diffing readability-extracted main text — is too expensive to do eagerly, and is out of scope.
- **Archive coverage is inversely correlated with need.** Big news sites are captured hourly *and* already emit clean `datePublished`. The undated Hugo post is captured twice, or never.

Therefore, present this as **"roughly when this changed,"** never as a diff, and never as the headline feature. Cache aggressively per §6.4.

> **Stated risk:** this is the feature most likely to disappoint, for the structural reasons above. It is deliberately last so that if it underdelivers, Phases 0–3 still stand as a finished, useful, publishable thing.

---

## 8. Build phases

### Phase 0 — Bake-off *(half a day — do this before writing anything)*

Run `@extractus/article-extractor` and `@settingdust/article-extractor` against ~20 pages that genuinely annoy you: undated Hugo blogs, Italian regional sites, old Stack Overflow answers, framework docs pages. Record hit/miss in a table.

- **≥80%** → wrap one, skip most of Phase 2, ship the extension over it.
- **~40%** → justification confirmed.

Either way the 20 pages become the seed fixture corpus, so the time is not spent speculatively. **This phase is a decision gate, not a formality.**

### Phase 1 — Fixture harness *(half a day)*

`scripts/fixture.ts`, the `expected.json` format, Vitest + `linkedom` wiring, the network-purity assertion.

### Phase 2 — Library core *(the bulk of the work)*

Signal ladder bottom-up: generic extractors → parse/normalize → resolve → adapters. Port htmldate's extensive-mode disambiguation and locale handling rather than reinventing the regexes; the [Go port](https://github.com/markusmobius/go-htmldate) is easier reading for a JS reimplementation than the Python.

**Gate: decent pass rate on ~50 fixtures before any extension code is written.** The library is the durable, independently valuable artifact — if interest fades here, something real still shipped.

`tsup` for the build, GitHub Actions for CI, npm trusted publishing.

### Phase 3 — Extension shell *(a weekend, on top of a working library)*

WXT project, `pnpm add` the workspace library, popup-first per §6.1, banner as opt-in toggle.

### Phase 4 — Wayback timeline *(cuttable)*

Per §7.

**Effort reality check:** the toolchain is a day at most and much of it is boilerplate familiar from Astro work. The heuristics and the fixture corpus are open-ended and will absorb ~80% of the total effort. Plan accordingly.

---

## 9. Environment

- **Node 24 LTS + pnpm.**
- **Phases 0–2 are pure Node — WSL2 is fine.** This is a direct consequence of the `Env` injection design in §4.2.
- **Phase 3 onward should move to the Mac mini**, or native Windows Node with the repo on the Windows side. Loading an unpacked extension from a watched dev server across the WSL↔Windows filesystem boundary makes file watching flaky and the "load unpacked" path awkward.
- Firefox Developer Edition + Chrome/Chromium for dual-target testing.

**Accounts:** GitHub (free), npm with 2FA (free), addons.mozilla.org (free), Chrome Web Store $5 — deferred per §6.5.

---

## 10. Verification

| Phase | How it's verified |
|---|---|
| 0 | Written table: 20 URLs × 2 extractors × hit/miss. Decision gate before proceeding. |
| 1 | Harness captures a live URL end-to-end; the network-purity assertion demonstrably fails when an extractor tries to fetch un-stubbed. |
| 2 | `pnpm test` — Vitest over the corpus, asserting resolved date **plus** `source` and `confidence` per candidate. Aggregate pass rate printed and tracked run-over-run. |
| 2 | Conflict fixtures specifically assert `conflict` is populated with the right `kind` — and that ordinary published≠modified pages do **not** trip it. |
| 3 | Load unpacked in Chrome + temporary add-on in Firefox. Live checklist: a JSON-LD news site, an undated Hugo blog with a feed, an SPA that hydrates late, a page with aggressive CSS that would eat a non-shadow-DOM banner, and a page behind `activeTab` only. |
| 4 | Compare the derived timeline against 3 pages with known edit history; confirm the false-positive rate is tolerable **before** shipping the sparkline. |

---

## 11. Decision log

| Decision | Rationale |
|---|---|
| Candidates + conflict, not a single date | A single-date API cannot express "claims 2019, edited 2024" — the core complaint |
| Feeds as a top-tier signal | Site-declared, present on exactly the SSG blogs where inline metadata is missing |
| `Last-Modified` kept, but opt-in | Measured: two false positives and no gains on the local corpus. Real on static hosts, so it stays — behind a flag, ranked last (§4.10) |
| Sitemap `<lastmod>` says `modified` | It is defined as when the file changed. Reading it as a publication date would invent the one thing the site did not say (§4.5) |
| Image paths: days only, never months | A monthly upload bucket is where stock banners live. Days are per-upload directories; measured 2/2 against 1/4 (§4.9) |
| `Env` network injection | Keeps the library pure → testable in Node → WSL2 viable for Phases 0–2 → clean MV3 split |
| Popup-first, banner opt-in | Privacy, and it's the difference between `activeTab` and `<all_urls>` at install time |
| Per-domain adapters | Generic heuristics optimize for news — the case where help isn't needed |
| Port htmldate, don't reinvent | Apache-2.0 since v1.8.0, multilingual, production-proven on millions of documents |
| Wayback last | Coverage is inversely correlated with need; keeps the risky feature cuttable |

---

## 12. Open questions

- **Package name.** `pagedate` is a placeholder; npm availability unchecked.
- **Phase 0 corpus.** The ~20 annoying URLs need to be actually collected. This is the input to every later phase and nothing should start before it exists.
- **htmldate port depth.** Full extensive-mode parity is a large job. Likely start with its locale patterns and candidate-scoring approach, not a line-by-line port — revisit after Phase 2 pass rates are known.
