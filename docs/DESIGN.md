# Page date detection — design

The architecture of the `pagedate` library and the Page Date extension: what each signal is, how candidates are ranked, and how the pieces fit together. Rationale for the decisions described here is collected in [§10](#10-decision-log).

---

## 1. Context

Most articles and web pages do not state when they were written. Pages that do state a date often show the original publication date while the content has been edited since. This affects any judgement about whether technical content or regulatory material is current.

Existing tools:

| Tool | What it does | Limitation |
|---|---|---|
| [Published Date](https://addons.mozilla.org/en-US/firefox/addon/published-date/) ([src](https://github.com/ndsvw/Published-Date)) | ~40 detection methods, Firefox + Chrome | Single date, no provenance; the Firefox build is MV2 |
| [Show Published Date](https://chromewebstore.google.com/detail/show-published-date/megeibiipjngcjncbipfemihhicimmam) | meta tags, JSON-LD, itemprop | Narrower detection, no confidence signal |
| `unfluff`, `node-article-extractor` | Full article extraction including date | Unmaintained for around 8 years, Node/Cheerio-shaped |
| [`@extractus/article-extractor`](https://www.npmjs.com/package/@extractus/article-extractor) | Maintained article extractor | Date is a side effect of content extraction; Node-shaped |
| `@settingdust/article-extractor` | Accepts `Document`, separate published/modified extractors | 22 dependencies, zero dependents |
| [htmldate](https://github.com/adbar/htmldate) | The reference implementation. Fast and extensive modes, multilingual, production-proven | Python. Apache-2.0 since v1.8.0 (GPLv3+ before), so its logic can be ported |

No existing tool is browser-first with zero dependencies, exposes published and modified as distinct outputs, and carries a confidence and provenance field.

This project is a library returning date candidates with provenance and confidence, plus a WXT extension that renders them, including disagreement between sources.

---

## 2. Scope and non-goals

**In scope:** the library, the extension, and an archive lookup that detects a page rewritten since the date it claims. MIT licensed.

**Non-goals:**

- Full article or content extraction. Dates only.
- Server-side rendering as a design driver. Node is a supported entry point, but the browser is the target: a live `Document` is the primary input, and no HTML parser ships in the bundle.
- Text diffing of archive snapshots. See §7.
- Fixing the web. The library surfaces what sites declare and flags contradictions.

Two commitments distinguish it from conventional approaches:

1. **Feeds are a first-class, top-tier signal.** Hugo, Astro, Jekyll and Eleventy all emit RSS or Atom by default, discoverable from one `<link rel="alternate">` in `<head>`. Atom entries carry `<published>` and `<updated>` as separate elements.
2. **The API returns candidates, never a single date.**

---

## 3. Repository layout

pnpm workspaces monorepo:

```
website-date/
├─ packages/
│  └─ pagedate/                  # the library — zero runtime deps
│     ├─ src/
│     │  ├─ index.ts             # public API surface
│     │  ├─ types.ts             # Candidate, DateResult, Conflict, Env, Adapter
│     │  ├─ extract/
│     │  │  ├─ jsonld.ts         # schema.org, @graph traversal
│     │  │  ├─ meta.ts           # OpenGraph, Dublin Core, citation_*, itemprop
│     │  │  ├─ timeTags.ts       # <time datetime> w/ context scoring
│     │  │  ├─ urlSlug.ts        # /YYYY/MM/DD/
│     │  │  ├─ imagePath.ts      # dated upload directories in og:image
│     │  │  ├─ inlineState.ts    # CMS state inlined into <script>
│     │  │  ├─ visibleText.ts    # labelled multilingual "Updated on…" patterns
│     │  │  ├─ bareText.ts       # unlabelled dates in rendered text
│     │  │  ├─ labels.ts         # the multilingual label vocabulary
│     │  │  ├─ context.ts        # article-vs-furniture scoring
│     │  │  ├─ patterns.ts       # the date-shaped-text finder
│     │  │  ├─ feed.ts           # RSS/Atom discovery + entry match
│     │  │  ├─ sitemap.ts        # sitemap.xml <lastmod>, index-aware
│     │  │  ├─ headers.ts        # conditional Last-Modified
│     │  │  ├─ urlGuard.ts       # what the library will and will not fetch
│     │  │  └─ xml.ts            # feed/sitemap parsing seam
│     │  ├─ parse/
│     │  │  ├─ normalize.ts      # → ISO + precision
│     │  │  ├─ locale.ts         # month names, digit systems, DD/MM vs MM/DD
│     │  │  └─ plausibility.ts   # range + "is this just now?" checks
│     │  ├─ resolve.ts           # candidate → DateResult + conflict detection
│     │  ├─ staleness.ts         # age comparison, in intervals
│     │  ├─ fetchEnv.ts          # the network Env, runtime-agnostic
│     │  ├─ edge/index.ts        # Workers, Deno, Bun — no node: imports
│     │  └─ node/
│     │     ├─ index.ts          # Node entry: parser, DNS, network Env
│     │     ├─ batch.ts          # NDJSON in, NDJSON out, host-fair pool
│     │     └─ cli.ts            # the `pagedate` binary
│     ├─ scripts/                # evaluation and triage tools
│     └─ test/
├─ packages/
│  └─ pagedate-mcp/              # MCP server — page_freshness, page_date
│     └─ src/
│        ├─ server.ts            # stdio transport, the `pagedate-mcp` binary
│        └─ tools.ts             # tool schemas + the prose rendering
├─ apps/
│  └─ extension/                 # WXT — MV3 Chrome + Firefox from one codebase
│     ├─ entrypoints/
│     │  ├─ background.ts        # optional auto-read, badge, overlay, menu sync
│     │  ├─ extract.ts           # injected into the tab; the only DOM work
│     │  ├─ annotate.content.ts  # search-results annotator, registered at runtime
│     │  ├─ popup/               # the on-demand panel
│     │  └─ options/
│     ├─ lib/
│     │  ├─ analyze.ts           # read → extract → resolve → cache
│     │  ├─ page-read.ts         # the injected script's contract
│     │  ├─ link-date.ts         # the url/fetch tier ladder (§6.1a)
│     │  ├─ link-menu.ts         # the right-click entry
│     │  ├─ link-read.ts         # fetching one link, on consent
│     │  ├─ annotate.ts          # the per-page fetch cap
│     │  ├─ search-sites.ts      # result selectors, per engine
│     │  ├─ archive.ts           # Internet Archive CDX lookup
│     │  ├─ overlay.ts, toast.ts # the injected on-page surfaces
│     │  ├─ badge.ts, spread.ts, evidence.ts, format.ts
│     │  ├─ messages.ts          # the message catalogue
│     │  └─ locales/             # eight translations of it
│     └─ wxt.config.ts
├─ fixtures/                     # 17 captured pages + annotations
├─ corpus/                       # the permalink corpus (manifest committed, HTML not)
├─ corpus-external/              # htmldate's cached subset + gold corrections
├─ scripts/                      # corpus build, benchmarks, validate.sh
├─ bench/                        # competitor harnesses, isolated node_modules
├─ results/                      # committed output of the last validation run
└─ docs/
```

---

## 4. Library design

### 4.1 Public API

```ts
export function extractFromDocument(
  doc: Document,
  url: string,
  options?: ExtractOptions,
): Candidate[]

export function resolve(
  candidates: Candidate[],
  url: string,
  env?: Env,
): Promise<DateResult>

// Convenience wrapper for Node, tests and simple use. The only entry point
// that fetches: feed (§4.4), sitemap (§4.5) and, on request, response headers
// (§4.10).
export function findDates(
  doc: Document,
  url: string,
  env?: Env,
  options?: ResolveOptions & ExtractOptions & NetworkOptions,
): Promise<DateResult>

export type ExtractOptions = {
  mode?: Mode                 // 'fast' | 'standard' (default) | 'extensive'
  dayFirst?: DayFirstHint     // override the DD/MM vs MM/DD heuristic
  minConfidence?: Confidence  // discard anything below this tier
}

export type NetworkOptions = {
  sitemap?: boolean      // default true, skipped when the page declares `modified`
  httpHeaders?: boolean  // default false — see §4.10
}
```

`extractFromDocument` is synchronous and DOM-only. `resolve` is asynchronous and network-backed. The two halves are separate because they run on opposite sides of the MV3 boundary; see §6.2.

`pagedate/node` adds `findDatesFromUrl` and `findDatesFromHtml`, which supply a parser and a guarded network `Env`. `linkedom` and `node-html-parser` are optional peer dependencies needed only on that path.

### 4.2 Types

```ts
type Confidence =
  | 'declared'   // the site explicitly stated this in structured metadata
  | 'derived'    // structured but weaker, or from an adjacent site-owned document
  | 'inferred'   // taken from URL shape, prose, or transport headers

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
  conflict?: Conflict                        // see §4.8
  archive?: ArchiveTimeline                  // only when explicitly requested
}

type Env = {
  // The library never calls the network directly. Node tests inject a fixture
  // replayer; the extension injects a shim scoped to the page's own origin.
  fetchText?(url: string): Promise<string | null>
  fetchHeaders?(url: string): Promise<Record<string, string> | null>
  now?(): Date                               // deterministic plausibility under test
  parseXml?(xml: string): Document | null    // DOMParser in browsers, injected in Node
}
```

`Conflict` is a union discriminated on `kind`. Each arm carries the values its sentence was built from alongside an English `detail` string, so a caller writing its own sentence in another language reads the fields rather than parsing `detail`. The extension does this in nine locales.

### 4.3 Signal ladder

**`declared`**

- **JSON-LD** `datePublished` / `dateModified`. Traverses `@graph`, handles arrays, nested `@type`, and multiple `<script type="application/ld+json">` blocks. Prefers nodes whose `@type` is `Article`/`BlogPosting`/`NewsArticle`/`TechArticle` over `WebPage`.
- **OpenGraph** `article:published_time` / `article:modified_time`.
- **RSS/Atom feed** entry matching this URL — Atom `<published>` and `<updated>`, RSS `<pubDate>`, plus `<atom:updated>` when present. See §4.4.

**`derived`**

- `<time datetime>`, scored by context. Inside an `<article>` header or footer, or adjacent to author markup, scores high; in a sidebar list, low. `<time>` inside `<nav>`, `<aside>` or elements matching common "related/recent/popular" class patterns is rejected.
- Dublin Core `DC.date.issued` / `DC.date.modified`, `citation_publication_date`, `itemprop="datePublished"`, `<meta name="date">`, and publisher-specific tags (Parse.ly, Sailthru).
- Inlined CMS state — WordPress's `post_date` and equivalents, read out of a `<script>` body rather than the rendered DOM.
- `sitemap.xml` `<lastmod>` for the exact URL. See §4.5.

**`inferred`**

- URL slug patterns: `/2024/03/12/`, `/2024-03-12-`, `/2024/03/`. Precision follows what is present.
- Image upload path — the `/2016/05/04/` in a declared `og:image`. Day-partitioned paths only. See §4.9.
- HTTP `Last-Modified`, opt-in and ranked last. See §4.10. `document.lastModified` is never used: it falls back to the current time when the header is absent.
- Visible-text patterns — labelled (`Updated on`, `Pubblicato il`, `Veröffentlicht`, `公開日`) scoped to article context with the same exclusions as `<time>`, and unlabelled date-shaped text as the last resort.

**External provenance**, kept in a separate field and never merged into `published` or `modified`:

- Wayback CDX. The first capture is an upper bound on publication; digest changes are edit events (§7).

### 4.4 Feed discovery and matching

1. Read `<link rel="alternate" type="application/rss+xml">` and `application/atom+xml` from `<head>`; resolve relative hrefs against the page URL.
2. If absent, probe well-known paths in order: `/index.xml` (Hugo default), `/feed.xml`, `/rss.xml`, `/atom.xml`, `/feed/`. At most 2 are probed.
3. Parse with `DOMParser` in a browser or the injected `parseXml` in Node. No XML dependency ships.
4. Match the entry to the page by, in order: exact URL, then `<link rel=canonical>` URL, then path-only match ignoring query and hash, then path suffix match.
5. Atom yields both `<published>` and `<updated>`, mapped to `field` directly. RSS `<pubDate>` maps to `published` only.

Feeds usually list only recent entries, so this signal succeeds most often on recent posts.

### 4.5 Sitemap handling

`<link rel="sitemap">` if the page declares one, otherwise `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml`. Sitemap index files are followed, with the whole lookup sharing a budget of three fetched documents. Children are tried in order of how much path they share with the page. Gzipped children are skipped, as there is no unzip step. The matching `<url>` is found by `<loc>` (exact, then canonical, then path-only) and its `<lastmod>` read.

The signal reports `modified`, not `published`. A page whose only date comes from the sitemap therefore reports a modification date and no publication date.

`<lastmod>` reflects the sitemap generator's notion of change, which for most static-site generators is the source file mtime and for some CMSes is the build time. The latter case is detected: if every entry carries an identical `<lastmod>` and there are at least ten of them, the signal is dropped.

The lookup is skipped when the page already declares a modification date.

Measured: on the local corpus this resolves `danluu.com/everything-is-broken/`, a hand-written page with no date in its markup, to `2014-11-18`, corroborated by the page's own links to articles published in November 2014. Recorded in `fixtures/danluu-no-date/expected.json`.

### 4.6 Per-domain adapters

`Adapter` is an exported type and `adapter` is the top-ranked source in the resolver. No adapters ship. It is a seam for content that generic heuristics serve badly:

- **Stack Overflow / Stack Exchange** — page-level JSON-LD exists, but the useful timestamps are per-answer.
- **GitHub** — commit date for blob, README and wiki views; `relative-time` elements carry a `datetime` attribute.
- **Doc generators** — Docusaurus, VitePress, Starlight and MkDocs Material all render a git-derived "Last updated" footer, fingerprintable by `<meta name="generator">` or characteristic DOM classes.

Adapter output would be `declared` confidence and would short-circuit nothing; generic extractors still run, so conflicts stay visible.

### 4.7 Parsing and plausibility

- **Normalisation** takes every candidate to ISO 8601 truncated to its actual precision. `2024` stays `2024`.
- **Locale disambiguation** for `DD/MM` against `MM/DD`: `<html lang>`, then TLD, then an explicit caller hint, which beats both. When genuinely ambiguous, precision drops to month.
- **Month names** cover around 25 languages, folded to a diacritic-stripped form on both sides of the lookup, plus non-ASCII digit systems (Arabic, Persian, Devanagari, Thai, full-width), CJK structural dates (`2024年3月12日`) and ordinal suffixes in English, French, Spanish and Dutch. Folding recomposes to NFC after stripping diacritics; without that step Hangul decomposes into jamo and Arabic `آ` splits.
- **Timezone** is preserved as given, not normalised to UTC.
- **Plausibility** rejects anything before 1995, beyond now + 48h, or within 60 seconds of the current time.

### 4.8 Resolution and conflict detection

```
1. Filter candidates through plausibility.
2. Bucket by field.
3. Within each bucket, rank by: confidence tier → source priority → precision.
   Take the top as the resolved value for that field.
4. Reassign 'unknown' candidates: if no published exists and the candidate is
   earlier than the resolved modified, promote it to published.
5. Conflict detection — three kinds, all surfaced:
   a. 'declared-disagreement' — two `declared` candidates for the SAME field
      disagree by > 30 days.
   b. 'predated-content' — the page carries several machine-readable timestamps
      OLDER than the date it declares, indicating a republication or migration
      stamp.
   c. 'stale-declaration' — a declared published date predates a strong
      modification signal (declared/derived modified, or an archive edit event)
      by > 365 days, AND the site displays no modified date.
```

`published` and `modified` differing is not a conflict.

Conflict detection is linear in the number of candidates. A page repeating one declared date 3000 times is an ordinary input from the open web, and `test/hardening.test.ts` holds the bound.

### 4.9 Image upload paths

WordPress files uploads under `/wp-content/uploads/2016/05/` and Drupal under `/files/2016/05/04/`. The image a post declares as `og:image` or `twitter:image` is usually the one uploaded with it, and on CMS-shaped sites emitting no other date it can be the only machine-readable signal.

Only paths carrying a day are accepted. Six of the 55 pages in the external corpus declare a dated image path:

| shape | pages | agree with the page's real date |
|---|---|---|
| `/2016/05/04/` (day) | 2 | 2 |
| `/2016/05/` (month) | 4 | 1 |

The signal is worth about a point of strict accuracy on the external corpus, under both the published and the corrected answer key.

It is `inferred` and ranks below `url-slug`.

### 4.10 Transport signals — HTTP `Last-Modified`

Off by default.

On a static host this is a file's mtime. Behind a CDN or any dynamic renderer it is the moment the response was assembled. Three filters separate the cases:

1. Discard when `Last-Modified` is within five minutes of the response's own `Date` header.
2. Discard when `Cache-Control` says `no-store`, `no-cache` or `max-age=0`.
3. Discard when the response sets a cookie while serving itself.

Measured over the five local fixtures whose capture recorded a `Last-Modified`: one was filtered correctly, one was right by coincidence, one was outranked by a date the page declared, and two were false — a GitHub Pages rebuild reported as an edit to a year-old release announcement, and a static-site deploy reported as an edit to a page with no edits.

The signal is `inferred`, ranks below every other source, and requires `httpHeaders: true` or `--headers`.

### 4.11 What the library will fetch, and what it refuses

Feed and sitemap discovery reads URLs the analysed page wrote: `<link rel="alternate">`, `<link rel="sitemap">`, and `<loc>` inside a sitemap index. Unguarded, a document need only say

```html
<link rel="sitemap" href="http://169.254.169.254/latest/meta-data/">
```

to have a server fetch its own cloud credentials endpoint. Response bodies never reach the caller, but reachability, timing and any `<lastmod>`-shaped bytes in the reply do.

`isSafeFetchTarget` is the filter. The rule is public hosts only, not same-origin, because feeds legitimately live off-origin on FeedBurner and Substack. Refused:

- anything that is not `http:` or `https:` — `file:`, `data:`, `gopher:`
- URLs carrying credentials
- loopback, RFC 1918, carrier-grade NAT, link-local (including `169.254.169.254`), multicast and reserved IPv4; the IPv6 equivalents; and the IPv4-mapped and NAT64 spellings of all of them
- `localhost`, `.local`, `.internal`, `.home.arpa`, and single-label hostnames, which resolve through the resolver's search domain

Alternative encodings such as `http://2130706433/` and `http://0177.0.0.1/` need no special handling, because `URL` normalises them to dotted decimal before the guard runs. `test/urlGuard.test.ts` asserts that behaviour, since it belongs to another implementation.

`nodeEnv` applies the same filter to every request including its own, follows redirects by hand so each hop is re-checked, and caps response bodies at 5 MB.

`blockPrivateNetwork: 'off'` drops the address check while keeping the scheme test, so that analysing a local dev server does not require hand-rolling an `Env`.

Two limits:

- The guard never resolves DNS, so a public hostname pointing at a private address passes. `blockPrivateNetwork: 'strict'` adds a resolution preflight, which does not close DNS rebinding, because the socket is not pinned to the address that was checked.
- This is the Node path. The extension is stricter: `apps/extension/lib/analyze.ts` refuses anything cross-origin and fetches with `credentials: 'omit'`.

### 4.12 One transport, three runtimes

The redirect walk, the timeout and the capped read live in `src/fetchEnv.ts`, not in `src/node/`. `fetch`, `AbortController`, `TextDecoder` and `ReadableStream` exist in Node, Workers, Deno, Bun and an extension service worker alike.

Two injection points hold what is genuinely runtime-specific, and each degrades rather than failing:

- **`resolveHostname`** backs `blockPrivateNetwork: 'strict'`. Node supplies it via `node:dns`. Without one, `'strict'` falls back to `'literal'` — the address filter on every hop, minus the resolution preflight.
- **`parseXml`** defaults to the global `DOMParser`, which browsers, extension workers and Deno have and Node and Cloudflare Workers do not. Absent, the feed and sitemap signals are skipped, which `findDates` already treats as a supported state.

`pagedate/edge` is therefore a re-export plus `webEnv`. `test/edge.test.ts` walks the import graph from the entry and fails on any `node:` or bare import. The same walker runs over `src/node/index.ts` and must find one, so the check cannot pass by resolving nothing.

### 4.13 Staleness

`isStale` and `staleness` live in `src/staleness.ts`.

`toInstant` resolves a partial value to the start of its period, which is correct for the gap arithmetic in `resolve.ts` and incorrect for a threshold test. This module therefore widens each candidate to the half-open interval its precision allows and compares both ends. When the threshold falls inside that interval, the answer is `stale: null, reason: 'imprecise'`, with `ageDays` and `maxAgeDays` bracketing the range.

`isStale` counts an undecidable page as stale by default; `whenUnknown: false` inverts it.

`basis` is a required decision rather than a guessed default. `modified` answers whether a page has been kept current; `published` answers when it was written.

---

## 5. Fixture harness and testing

`scripts/fixture.ts <url> <slug>` snapshots a page into `fixtures/<slug>/`:

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

alongside `page.html`, `headers.json`, and any discovered `feed.xml` or `sitemap.xml`.

There are 17 fixtures in 8 languages, and five have no publication date at all. Those five are the negative cases, which the corpus benchmarks cannot score. See [fixtures/README.md](../fixtures/README.md).

Tests use Vitest. `documentFrom` builds a `Document` through the library's own `parseHtml`, so the tests exercise the parser that ships. The test `Env` replays `headers.json`, `feed.xml` and `sitemap.xml`, and throws on any un-stubbed network access.

Assertions cover the resolved date plus `source` and `confidence` per candidate. The aggregate pass rate is printed, so a change that raises the total while breaking a previously-passing fixture is visible.

Conflict cases have their own fixtures.

---

## 6. Extension

### 6.1 Permission model

The on-demand popup is the default; every ambient feature is opt-in.

On-demand needs `activeTab`. Reading every page needs `<all_urls>`, which appears in the install prompt. The panel therefore ships on `activeTab`, and each ambient feature is a settings toggle that requests its optional permission when enabled and returns it when disabled.

```jsonc
// permissions — identical on both browsers
["activeTab", "storage", "scripting", "contextMenus"]
// optional_host_permissions
["*://*/*", "*://web.archive.org/*", /* five search-engine origins */]
```

`contextMenus` is the only non-on-demand addition. It grants the ability to add a menu entry: no page access, no data, and no warning in either store. The entry does nothing until clicked, and the click authorises the one page it then reads.

A content script declared in the manifest contributes its `matches` to Chrome's install-time prompt whether or not the feature is ever enabled. The search-results annotator is therefore registered at runtime — `registration: 'runtime'` in WXT, then `scripting.registerContentScripts` once the setting is on and the grant exists — and CI asserts the built manifest of both targets carries no content script and no host permission.

### 6.1a Reading a page you are not on

Two surfaces do this: the right-click link check and the search-results annotator. Both use the same two tiers.

| tier | evidence | cost |
| --- | --- | --- |
| `url` | the address: `/2019/03/04/some-post/` | none. No request reaches any site. |
| `fetch` | the page's own metadata | a request to a site the reader did not open |

The URL tier runs first even when fetching is allowed, and a hit short-circuits. On a results page of ten links this typically answers most of them.

- **The right-click check needs no standing permission.** It may request one origin at the moment of the click (`lib/link-menu.ts`). Declining ends it, and the URL tier may already have answered without prompting.
- **The fetch tier on search results is capped at 10 per page load** (`MAX_FETCHES_PER_PAGE`). Concurrency is 3; credentials are never sent.
- **The two grants are requested separately.** The cheap tier needs five engines; the fetch tier needs the whole web. Declining the second lands on `url`, not `off`.

Both syncs in the background worker — the menu entry and the script registration — are read-modify-write against browser-global state, triggered from four places: install, startup, settings change, and worker start. They run through a small serial queue; without it, two overlapping `removeAll()` → `create()` runs both clear and then both create, and Chrome reports `Cannot create item with duplicate id`.

### 6.2 Split across the MV3 boundary

```
injected script  →  extractFromDocument(document, url)  →  Candidate[]
   (in the tab)      sync, no network, on the DOM that already exists
        │
        │  a handful of candidate objects, not the document
        ▼
service worker  →  resolve(candidates, url, env)  →  DateResult
                   env fetches feed and sitemap, same-origin only
        │
        ├─→ popup panel
        ├─→ toolbar badge
        └─→ injected on-page overlay
```

Extraction runs in the tab. The alternative — reading `document.documentElement.outerHTML`, moving that string across the message boundary and rebuilding a second DOM — reparses a page the browser has already parsed and copies a string with a median of 88 KB, reaching 1.3 MB on the benchmark corpus.

The extractor is injected on demand rather than declared in the manifest. It runs on a click, or on a navigation the reader opted into.

The injection is two calls. The first runs the extractor and stashes its result under a known key in the isolated world; the second reads that key back, rather than depending on what `executeScript({ files })` resolves to and therefore on the module format the bundler emitted. The result carries the URL it was read from, so the caller can confirm the read belongs to the page it asked about. On an SPA the URL changes before the new view renders, and a read fired on navigation can otherwise return the previous route's candidates and cache them under the new URL for a week.

All network access lives in the service worker, which never needs a DOM.

`analyze()` is the single read-extract-resolve-cache pipeline shared by the popup, the badge and the overlay.

### 6.3 Rendering

- The overlay injects into a closed shadow DOM.
- Confidence tiers render visibly distinctly: solid against dashed border, plus an explicit source label.
- Conflicts get the loudest available treatment, except `stale-declaration`, which is informational and toned down.
- Overlay colours are checked against contrast ratios on an unknown page, in light and dark, and respect `prefers-contrast: more`.
- SPAs hydrate dates after load, so the background pass settles before reading and re-checks that `location.href` still matches what it read.

### 6.4 Caching

`storage.local`, keyed `d:<url>` → `{ result, fetchedAt, version }`.

- Results have a 7-day TTL.
- `version` is bumped whenever the heuristics or the shape of the stored result changes, and every entry below the current version is discarded on read.
- The options page shows the cache size and can clear it.

### 6.5 Distribution

Chrome Web Store and addons.mozilla.org, MV3 on both from one codebase. Store assets — icons, screenshots, permission justifications, the AMO source-code submission — are generated and documented in [PUBLISHING.md](PUBLISHING.md).

---

## 7. Wayback timeline

```
https://web.archive.org/cdx/search/cdx
  ?url=<encoded>
  &output=json
  &fl=timestamp,digest,statuscode
  &filter=statuscode:200
  &collapse=digest
  &limit=200
```

Rows whose digest differs from the previous row are edit events. This is the only available witness to a post declaring 2019, rewritten since, with no modification date in its markup.

It is off by default, behind its own optional permission, and can be set to ask each time.

Limitations, encoded in the UI:

- `collapse=digest` dedupes adjacent rows only, confirmed against the [CDX server docs](https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/README.md). A page alternating between two states still yields many rows, so the result is post-filtered client-side.
- The digest covers the whole HTML, so rotating ads, CSRF nonces and embedded render timestamps produce false-positive changes. Fetching snapshots and diffing readability-extracted main text is out of scope.
- Archive coverage is inversely correlated with need. Large news sites are captured hourly and already emit clean `datePublished`; an undated static-site post is captured twice or never.

The feature is presented as "roughly when this changed", never as a diff.

---

## 8. Environment

- **Node 22.12 or newer**, for development and for the published packages. The scripts run TypeScript directly, and Node 20 reached end of life in April 2026. CI uses Node 24 and pnpm 11.18, pinned in `packageManager`.
- **Declarations are emitted by `tsc`, not by the bundler.** `tsup` builds the JS; `tsc -p tsconfig.build.json --emitDeclarationOnly` builds the `.d.ts` beside it. tsup generates declarations through a bundled `rollup-plugin-dts`, which supports TypeScript 6 at the newest and injects a `baseUrl` that TypeScript 6 deprecates, so that path is closed in both directions. The cost of emitting with `tsc` is unbundled declarations.
- Loading an unpacked extension from a dev server across the WSL/Windows filesystem boundary makes file watching unreliable, so extension work belongs on a native filesystem.
- Firefox Developer Edition and Chrome or Chromium, for dual-target testing.

---

## 9. Verification

| What | How it is verified |
|---|---|
| Library behaviour | `pnpm --filter pagedate test` — Vitest over the fixtures, asserting the resolved date plus `source` and `confidence` per candidate. Aggregate pass rate printed. |
| Conflicts | Dedicated fixtures assert `conflict` is populated with the right `kind`, and that ordinary published≠modified pages do not trip it. |
| Network purity | The fixture `Env` throws on any un-stubbed fetch. |
| Cost on hostile input | `test/hardening.test.ts` — documents built to be expensive, with time bounds set to catch a return of quadratic behaviour. |
| Parser agreement | `bench/parity.mjs` runs linkedom and node-html-parser over every corpus page; `bench/parity-browser.mjs` runs real Chromium against the shipped extractor bundle. Both exit non-zero on any disagreement. |
| Edge purity | `test/edge.test.ts` walks the import graph from `pagedate/edge` and fails on any `node:` or bare import. The same walker runs over `src/node/index.ts` and must find one. |
| Accuracy | `scripts/corpus/score.ts` on the dev split during development, the held-out split once at the end. Competitors via `bench/bench_corpus.mjs` and `scripts/bench_python.py`. |
| Everything, reproducibly | `./scripts/validate.sh` — toolchain, build, typecheck, tests, corpus integrity, both parity checks, then every published table into `results/`. |
| Extension | `pnpm --filter @website-date/extension test`, plus a CI assertion that neither built manifest carries a content script or a host permission. Manual: unpacked in Chrome and as a temporary add-on in Firefox against a JSON-LD news site, an undated blog with a feed, an SPA that hydrates late, a page with CSS aggressive enough to eat a non-shadow-DOM overlay, and a page behind `activeTab` only. |
| MCP server | `pnpm --filter pagedate-mcp test` — tool schemas, the prose rendering, and that `UNDETERMINED` is reached rather than a date invented. |

---

## 10. Decision log

### API shape

| Decision | Rationale |
|---|---|
| Candidates and a conflict field, not a single date | A single-date API cannot express "claims 2019, edited 2024", which is the case the project exists to report |
| Confidence as a tier, not a numeric score | A tier names the kind of evidence found; a score implies a calibration that does not exist |
| Precision never widened | A supplied January 1st is indistinguishable to the caller from a date the page stated |
| `Conflict` carries fields as well as prose | The UI writes its sentence in the reader's language; the alternative is parsing English out of `detail` |
| `Env` as a network injection point | Keeps the library pure with respect to network, which makes it testable in Node against fixtures and gives the MV3 split a natural seam |
| `extractFromDocument` and `resolve` as separate exports | Extraction is synchronous and DOM-only, resolution is asynchronous and network-backed; they run on opposite sides of the MV3 boundary (§6.2) |

### Signals

| Decision | Rationale |
|---|---|
| Feeds as a top-tier signal | Site-declared, and present on exactly the static-site blogs where inline metadata is absent |
| Sitemap `<lastmod>` reports `modified` | That is what `<lastmod>` is defined to mean; reading it as publication would invent the one thing the site did not say (§4.5) |
| Sitemap dropped when every entry shares a timestamp | That is a build stamp. The ten-entry floor prevents discarding a small site legitimately published in one sitting |
| Sitemap lookup skipped when `modified` is already declared | The request can only confirm what is known |
| Image paths accepted at day precision, never month | A monthly upload bucket holds every image a site used that month, including reused stock banners. Measured 2/2 against 1/4 (§4.9) |
| Image path ranks below `url-slug` | A post's URL is minted with the post; its preview image is reusable |
| `Last-Modified` kept but opt-in | Real on static hosts, the serve time behind a CDN. Measured: two false positives and no gains (§4.10) |
| `document.lastModified` never used | It falls back to the current time when the header is absent |
| Timezone preserved rather than normalised to UTC | Normalising shifts the displayed day for no gain |
| Ambiguous numeric dates degrade to month precision | Guessing DD/MM against MM/DD produces a confidently wrong day |
| Adapters as a seam, none shipped | Generic heuristics optimise for news, which is the case needing least help, but no per-domain rule has yet earned its maintenance (§4.6) |
| Port htmldate rather than reinvent | Apache-2.0 since v1.8.0, multilingual, production-proven on millions of documents |

### Resolution

| Decision | Rationale |
|---|---|
| Ranking tables built with `Object.create(null)` | `Candidate.source` is a free-form string supplied by adapters. On a plain object `SOURCE_RANK['constructor']` resolves to an inherited function, the fallback never fires, `rank()` returns `NaN`, and the candidate can never be picked |
| `published` ≠ `modified` is not a conflict | Encoding that distinction is what keeps the conflict flag from being permanently lit |
| Conflict detection linear, not quadratic | A page repeating one declared date 3000 times is an ordinary input from the open web |
| Three named conflict kinds rather than one flag | They warrant different UI treatment; `stale-declaration` is informational where the other two are errors |

### Runtime and transport

| Decision | Rationale |
|---|---|
| Transport shared in `fetchEnv.ts` | One redirect walk and one capped read for Node, Workers, Deno and Bun. A second implementation is a second set of guard bugs (§4.12) |
| `'strict'` degrades to `'literal'` rather than throwing | No portable DNS resolver exists; failing closed would push callers off the guarded path into hand-rolling an `Env` |
| Public hosts only, rather than same-origin only | Feeds legitimately live off-origin on FeedBurner and Substack; address filtering already covers the threat |
| Redirects followed by hand | `redirect: 'follow'` would let a public URL bounce to a private one unchecked |
| Response bodies capped at 5 MB | A timeout does not bound memory: a server drip-feeding inside the deadline stays inside it while it fills the heap |
| `blockPrivateNetwork: 'off'` provided | Analysing a local dev server is ordinary, and the alternative is hand-rolling an unguarded `Env` |
| `node-html-parser` on the Node path | Roughly 3× faster than linkedom, with parity asserted over every corpus page rather than assumed |
| Staleness answers `null` on imprecise input | A page stating "2024" straddles a 180-day threshold; picking a side is the same invention as a fabricated January 1st (§4.13) |
| `isStale` counts undecidable pages as stale | Its use case is filtering a corpus, where letting an undated document through is how an old page gets quoted as current |
| `basis` has no silent default | `published` and `modified` answer different questions; picking one quietly makes the other caller wrong |

### Extension

| Decision | Rationale |
|---|---|
| Popup-first, everything ambient opt-in | An extension that reads every page and queries archive.org for every URL is a browsing-history side channel. It is also the difference between `activeTab` and `<all_urls>` at install time |
| Extraction in the tab, not in the worker | The DOM is already parsed. Shipping the HTML out costs a copy of up to 1.3 MB and a second parse (§6.2) |
| Extractor injected on demand, not declared | Loading code into every page visited is a different privacy proposition from loading it into the page asked about |
| Injection reads a stashed key rather than the `executeScript` return | The return value depends on the module format the bundler emitted, which is not a stable contract |
| The read carries the URL it came from | On an SPA the URL changes before the view renders, so a navigation-triggered read can otherwise be cached under the wrong URL for a week |
| Search annotator registered at runtime | A manifest-declared content script puts its `matches` in the install prompt for every installer, including the majority who never enable it (§6.1) |
| URL tier tried before the fetch tier | A dated permalink is a fact the site minted about its own post; fetching to confirm it buys nothing |
| The two annotator grants requested separately | Five engines and the whole web are different asks, and bundling them hides a difference the browser's own dialogue states |
| Fetch tier capped at 10 per page load | An infinite-scroll results page would otherwise issue unbounded requests to third parties |
| Menu and registration syncs run through a serial queue | Two overlapping `removeAll()` → `create()` runs both clear and then both create, and Chrome rejects the duplicate id |
| Overlay in a closed shadow DOM | Site CSS otherwise restyles or hides it |
| Cache `version` covers result shape as well as heuristics | A structurally valid entry missing a newly-rendered field produces a sentence with a hole in it, for a week, per reader |
| Archive lookup off by default | Querying web.archive.org tells them which page is being read |
| Archive presented as "roughly when this changed" | The digest covers the whole HTML, so ads and nonces register as changes |

### Toolchain

| Decision | Rationale |
|---|---|
| Declarations emitted by `tsc`, not tsup | tsup's declaration step supports TypeScript 6 at the newest and injects a `baseUrl` that TypeScript 6 deprecates, closing that path in both directions |
| Node 22.12 floor | Node 20 reached end of life in April 2026 |
| Unit tests run the parser that ships | Testing through a second parser measures a configuration nobody deploys (§4.12, and the entity-decoding case in BENCHMARK.md) |
