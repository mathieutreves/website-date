# Page Date Detection — Design

The architecture of the `pagedate` library and the Page Date extension: what each
signal is, how candidates are ranked, and why the decisions that look odd are the
way they are.

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

**What this is:** a library that returns date *candidates with provenance and confidence*, plus a WXT extension that renders them — including **disagreement between sources**, which is the actual complaint being solved.

---

## 2. Scope & non-goals

**In scope:** library, extension, and an archive lookup that can tell a page has been rewritten since the date it claims. Open source, MIT.

**Non-goals:**

- Full article/content extraction. Dates only. Not competing with `@extractus`.
- Server-side rendering as a design driver. Node works and is a supported entry point, but the browser is the target — a live `Document` is the primary input, and no HTML parser ships in the bundle.
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
│     │  ├─ staleness.ts         # "too old to use?", in intervals not points
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
// The two halves exist separately because they split across the MV3 boundary:
// extraction is sync + DOM-only (content script), resolution is async +
// network-backed (service worker). This is not incidental — see §6.2.

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

// Convenience wrapper for Node/tests/simple use. This is the only entry point
// that fetches: feed (§4.4), sitemap (§4.5) and, on request, response headers
// (§4.10). Each network signal is a decision, so each is an option.
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

`pagedate/node` adds `findDatesFromUrl` and `findDatesFromHtml`, which supply a
parser and a guarded network `Env`. `linkedom` and `node-html-parser` are
optional peer dependencies needed only on that path.

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
  conflict?: Conflict                        // see §4.8
  archive?: ArchiveTimeline                  // only when explicitly requested
}

type Env = {
  // The library NEVER calls network directly. Node tests inject a fixture
  // replayer; the extension injects a shim scoped to the page's own origin.
  fetchText?(url: string): Promise<string | null>
  fetchHeaders?(url: string): Promise<Record<string, string> | null>
  now?(): Date                               // deterministic plausibility under test
  parseXml?(xml: string): Document | null    // DOMParser in browsers, injected in Node
}
```

`Conflict` is a union discriminated on `kind`, and each arm carries the values
its sentence was built from alongside the English `detail` string. A caller that
wants prose takes `detail`; a caller writing its own sentence in its own language
takes the fields and never parses the English. The extension is the second kind
of caller, in nine locales.

The `Env` injection point is load-bearing. It keeps the library pure with respect
to network, which means the whole thing is testable in Node against fixtures.

### 4.3 Signal ladder

**`declared` — the site said so**

- **JSON-LD** `datePublished` / `dateModified`. Traverses `@graph`, handles arrays, nested `@type`, and multiple `<script type="application/ld+json">` blocks. Prefers nodes whose `@type` is `Article`/`BlogPosting`/`NewsArticle`/`TechArticle` over `WebPage`.
- **OpenGraph** `article:published_time` / `article:modified_time` (`<meta property=…>`).
- **RSS/Atom feed** entry matching this URL — Atom `<published>` and `<updated>`, RSS `<pubDate>` (plus `<atom:updated>` when present). See §4.4.

**`derived` — structured but weaker**

- `<time datetime>` — scored by context. Inside `<article>` header/footer, or adjacent to author markup, scores high; in a sidebar "recent posts" list, low. `<time>` elements inside `<nav>`, `<aside>`, or elements matching common "related/recent/popular" class patterns are rejected.
- Dublin Core `DC.date.issued` / `DC.date.modified`, `citation_publication_date`, `itemprop="datePublished"`, `<meta name="date">`, publisher-specific tags (Parse.ly, Sailthru).
- Inlined CMS state — WordPress's `post_date` and equivalents, read out of a `<script>` body rather than the rendered DOM.
- **`sitemap.xml` `<lastmod>`** for the exact URL. Cheap, surprisingly reliable, almost nobody uses it. See §4.5.

**`inferred` — guessed**

- **URL slug** patterns: `/2024/03/12/`, `/2024-03-12-`, `/2024/03/`. Precision follows what's present.
- **Image upload path** — the `/2016/05/04/` in the `og:image` a page declares. Day-partitioned paths only; monthly buckets are wrong more often than right. See §4.9.
- **HTTP `Last-Modified`** — **opt-in**, ranked last, and off by default on measured evidence. See §4.10. **`document.lastModified` is never used**: it silently falls back to *now* when the header is absent, which makes it worse than useless.
- **Visible-text patterns** — labelled (`Updated on`, `Pubblicato il`, `Veröffentlicht`, `公開日`) scoped to article context with the same exclusions as `<time>`, and unlabelled date-shaped text as the last resort.

**External provenance (separate field, never merged into `published`/`modified`)**

- Wayback CDX: first capture is an *upper bound* on publication; digest changes are edit events (§7).

### 4.4 Feed discovery & matching

1. Read `<link rel="alternate" type="application/rss+xml">` and `application/atom+xml` from `<head>`; resolve relative hrefs against the page URL.
2. If absent, probe well-known paths in order: `/index.xml` (Hugo default), `/feed.xml`, `/rss.xml`, `/atom.xml`, `/feed/`. At most 2 are probed before giving up — these are extra requests.
3. Parse with `DOMParser` (browser) or the injected `parseXml` (Node). No XML dependency ships.
4. Match the entry to the page by, in order: exact URL → `<link rel=canonical>` URL → path-only match ignoring query/hash → path suffix match.
5. Atom yields both `<published>` and `<updated>` — mapped to `field` directly. RSS `<pubDate>` maps to `published` only.

Feeds usually list only recent entries, so this succeeds most often on recent posts. That is fine — it's a high-value signal when it hits and costs one request when it doesn't.

### 4.5 Sitemap handling

`<link rel="sitemap">` if the page declares one, otherwise `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml`. Sitemap **index** files are followed, with the whole lookup sharing a budget of three fetched documents; children are tried in order of how much path they share with the page, since a post at `/guide/install/` is far likelier to be listed in `/guide/sitemap.xml` than in the first child alphabetically. Gzipped children are skipped — there is no unzip, and fetching one buys a parse failure at the price of a request. Find `<url>` whose `<loc>` matches the page (exact → canonical → path-only), read `<lastmod>`.

The signal says **`modified`, not `published`**. `<lastmod>` is defined as when the file changed; on a page never edited the two coincide, but laundering one into the other would be exactly the invention this library refuses elsewhere. A page whose only date comes from the sitemap therefore reports a modification date and an explicitly undeclared publication date.

`<lastmod>` reflects the *sitemap generator's* notion of change, which for most SSGs is the source file mtime — good — but for some CMSes is the build time, in which case it collapses to one instant for every URL. That is detected: if **every** entry carries an identical `<lastmod>` **and** there are at least ten of them, the signal is dropped. The count matters, because a small site published in one sitting legitimately has three identical values, and discarding a real signal is the more expensive error here.

The lookup is skipped entirely when the page already declares a modification date — the only field a sitemap can speak to — so the request is spent only where it can change the answer.

Measured: on the local corpus it answers `danluu.com/everything-is-broken/`, a hand-written page with no date anywhere in its markup, with `2014-11-18` — corroborated by the page's own links to articles published in November 2014. The reasoning is recorded in `fixtures/danluu-no-date/expected.json`.

### 4.6 Per-domain adapters

`Adapter` is an exported type and `adapter` is the top-ranked source in the resolver, but **no adapters ship**. It is a seam, not a feature, and it is worth keeping open for content that generic heuristics serve badly — generic heuristics optimize for news, which is the case where help isn't needed:

- **Stack Overflow / Stack Exchange** — page-level JSON-LD exists, but the useful thing is **per-answer** timestamps. The question being from 2011 doesn't matter if the top answer was edited last year.
- **GitHub** — commit date for blob/README/wiki views; `relative-time` elements carry a `datetime` attribute.
- **Doc generators** — Docusaurus, VitePress, Starlight and MkDocs Material all render a git-derived "Last updated" footer, fingerprintable by `<meta name="generator">` or characteristic DOM classes. One adapter would cover thousands of sites, which is the argument for the layer earning its complexity.

Adapter output would be `declared` confidence and short-circuit nothing — generic extractors still run, so conflicts stay visible.

### 4.7 Parsing & plausibility

- **Normalize** every candidate to ISO 8601 truncated to its actual precision. Precision is never invented — `2024` stays `2024`, not `2024-01-01`.
- **Locale disambiguation** for `DD/MM` vs `MM/DD`: `<html lang>`, then TLD, then an explicit caller hint which beats both. When genuinely ambiguous, precision drops to month rather than guessing.
- **Month names** cover ~25 languages, folded to a diacritic-stripped form on both sides of the lookup, plus non-ASCII digit systems (Arabic, Persian, Devanagari, Thai, full-width), CJK structural dates (`2024年3月12日`) and ordinal suffixes in English, French, Spanish and Dutch. Folding recomposes to NFC after stripping diacritics — without that, Hangul shatters into jamo and Arabic `آ` splits.
- **Timezone**: preserved as given. Not normalized to UTC — it shifts the displayed day for no benefit.
- **Plausibility filter**: reject before 1995, reject beyond now + 48h, reject anything within 60s of "now" (that's a render timestamp, not a publication date).

### 4.8 Resolution & conflict detection

```
1. Filter candidates through plausibility.
2. Bucket by field.
3. Within each bucket, rank by: confidence tier → source priority → precision.
   Take the top as the resolved value for that field.
4. Reassign 'unknown' candidates: if no published exists and the candidate is
   earlier than the resolved modified, promote it to published.
5. Conflict detection — three distinct kinds, all surfaced:
   a. 'declared-disagreement' — two `declared` candidates for the SAME field
      disagree by > 30 days. The site contradicts itself.
   b. 'predated-content' — the page carries several machine-readable timestamps
      OLDER than the date it declares. A timestamp cannot precede the thing it
      belongs to, so the declared date is a republication or migration stamp
      rather than when the content was written.
   c. 'stale-declaration' — a declared published date predates a strong
      modification signal (declared/derived modified, or an archive edit event)
      by > 365 days, AND no modified date is displayed by the site itself.
      This is the "claims 2019 but the text is from last year" case.
```

`published` and `modified` simply *differing* is normal and is **not** a conflict. Encoding that distinction correctly is what keeps the conflict flag meaningful rather than permanently lit.

Conflict detection is linear in the number of candidates, not quadratic. A page repeating one declared date 3000 times is an ordinary input from the open web, and `test/hardening.test.ts` holds the bound.

### 4.8a Listings are not documents

A homepage, a section front and a tag archive carry dozens of dates and own none
of them. Every extractor that reads the body is built to find a date *near the
content*, and on a listing there is no content to be near — so the `<time>` in
the first card reads exactly like a byline, and the newest item's date is
returned as the page's own.

`isIndexPage` (`src/extract/indexPage.ts`) suppresses the body-scraped sources on
those pages. It is built from positive evidence in both directions: an explicit
`og:type=article` or a JSON-LD `Article` type, or an article-body container, ends
the test immediately; what remains has to clear a weight threshold assembled from
`og:type=website`, twelve or more headings, ten or more `<time>` elements, and
three or more sibling `<article>` elements. Measured across the corpus, JSON-LD
`Article` separates articles from listings 43% to 1%, and `og:type=article` 77%
to 12%.

It is deliberately asymmetric. A false "this is an index" deletes the correct
answer from a real article, and does it invisibly — strictly worse than the
invented date it exists to prevent, which is at least visible and arguable. So
the threshold is set to fire on **30% of listings and 1.7% of real articles**
rather than tuned for recall, and the DOM walk is wrapped in the same `safely`
the extractors use, so a document too deeply nested to traverse fails to "not an
index" and suppresses nothing.

`opengraph` is **not** suppressed even though `article:published_time` on a
homepage is wrong. It is the site stating it, and discarding a `declared` value
on a heuristic verdict about page shape inverts the confidence tiers the whole
library rests on. That case belongs in conflict detection, not in a filter.

This is the one behaviour in this document that a corpus of dated pages cannot
score: on such a corpus a false positive is structurally impossible, so the bug
was invisible until a negative tier existed to point at it. See
[CORPUS-BUILD.md](CORPUS-BUILD.md).

### 4.9 Image upload paths

WordPress files uploads under `/wp-content/uploads/2016/05/`, Drupal under `/files/2016/05/04/`, and the image a post declares as its `og:image` or `twitter:image` is usually the one uploaded with it. On CMS-shaped sites emitting no other date, it can be the only machine-readable signal on the page.

Only paths carrying a **day** are accepted. This is measured, not squeamishness. Six of the 55 pages in the external corpus declare a dated image path:

| shape | pages | agree with the page's real date |
|---|---|---|
| `/2016/05/04/` (day) | 2 | 2 |
| `/2016/05/` (month) | 4 | 1 |

A monthly bucket holds every image a site used that month, including the stock banner it has reused since — `verfassungsblog.de` previews a 2014 photo on a 2019 article, `wara-enforcement.org` a resized elephant thumbnail. Accepting months buys one exact answer and one false positive; accepting only days buys the exact answer alone. The signal is worth about a point of strict accuracy on the external corpus, under both the published and the corrected answer key.

It is `inferred` and ranks *below* `url-slug`: a post's URL is minted with the post, but its preview image is reusable.

### 4.10 Transport signals — HTTP `Last-Modified`

Off by default.

On a static host this is a file's mtime and is real information. Behind a CDN or any dynamic renderer it is the moment the response was assembled. Three filters try to tell those apart:

1. Discard when `Last-Modified` is within five minutes of the response's own `Date` header — that is a page built for this request.
2. Discard when `Cache-Control` says `no-store`, `no-cache` or `max-age=0`.
3. Discard when the response sets a cookie while serving itself.

What is left is still poor. Measured over the five local fixtures whose capture recorded a `Last-Modified`: one filtered correctly, one was right by coincidence (a news page published the same day), one was outranked by a date the page declared, and **two were false** — a GitHub Pages rebuild reported as an edit to a year-old release announcement, and a static-site deploy reported as an edit to a page that has none.

So it exists, because it is real information on the hosts where it is real; it is `inferred`; it ranks below every other source; and the caller has to ask for it (`httpHeaders: true`, or `--headers`). Enabling it by default costs accuracy on the corpus, which is the whole argument.

### 4.11 What the library will fetch, and what it refuses

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

Two limits are worth stating plainly. The guard never resolves DNS, so a public hostname pointing at a private address passes; `blockPrivateNetwork: 'strict'` adds a resolution preflight, which closes that but not DNS rebinding — the socket is not pinned to the address that was checked. And this is the *Node* path. The extension is stricter: `apps/extension/lib/analyze.ts` refuses anything cross-origin outright and fetches with `credentials: 'omit'`.

### 4.12 One transport, three runtimes

The redirect walk, the timeout and the capped read live in `src/fetchEnv.ts`, not in `src/node/`. Putting them inside `nodeEnv` would make the network half of a browser-first library Node-only for no reason other than where the code sits: `fetch`, `AbortController`, `TextDecoder` and `ReadableStream` exist in Node, Workers, Deno, Bun and an extension service worker alike.

What is genuinely runtime-specific sits behind two injection points, and each degrades rather than pretending:

- **`resolveHostname`** backs `blockPrivateNetwork: 'strict'`. Node supplies it via `node:dns`; without one, `'strict'` falls back to `'literal'` — the address filter on every hop, minus the resolution preflight. It does not throw and it does not silently allow everything.
- **`parseXml`** defaults to the global `DOMParser`, which browsers, extension workers and Deno have and which Node and Cloudflare Workers do not. Absent, the feed and sitemap signals are skipped, which `findDates` already treats as a supported state.

`pagedate/edge` is therefore almost nothing: a re-export plus `webEnv`. The claim it makes is about absence, so `test/edge.test.ts` walks the import graph from the entry and fails on any `node:` or bare import — a `node:module` behind a rarely-taken branch is exactly what passes review and fails at deploy. The same walker is run over `src/node/index.ts` and asserted to *find* one, so the check cannot pass by resolving nothing.

### 4.13 Staleness is an interval, not a subtraction

`isStale` and `staleness` (`src/staleness.ts`) exist because every programmatic caller writes the same twenty lines against `DateResult` and two of them go wrong the same way.

`toInstant` resolves a partial value to the **start** of its period, which is right for the gap arithmetic in `resolve.ts` and wrong for a threshold test: a page that said "2024" would be judged on its oldest possible reading as though that were its only one. So this module widens each candidate to the half-open interval its precision allows and compares both ends. When the threshold falls inside — stale on one reading, fresh on another — the answer is `stale: null, reason: 'imprecise'`, with `ageDays` and `maxAgeDays` bracketing the range.

That is the same refusal the extractors make in declining to invent a January 1st, applied one layer up. It is also the reason `isStale` needs a documented policy rather than a cast: it counts an undecidable page as stale, because the job it exists for is filtering a corpus, where letting an undated document through is how a three-year-old page ends up quoted as current.

`basis` is a required decision rather than a default worth guessing at. `modified` answers "has this been kept current", `published` answers "when was this written", and silently picking one makes the other caller wrong.

---

## 5. Fixture harness & testing

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

alongside `page.html`, `headers.json`, and any discovered `feed.xml` / `sitemap.xml`.

There are 17 of them, in 8 languages, and five have no publication date at all — the negative cases, which the corpus benchmarks structurally cannot score. See [fixtures/README.md](../fixtures/README.md).

Tests use **Vitest**, with `documentFrom` building a `Document` through the library's own `parseHtml` — the parser that actually ships, rather than a second one nobody deploys — and an `Env` that replays `headers.json` / `feed.xml` / `sitemap.xml` and **throws on any un-stubbed network access**. That assertion is what keeps the library honestly network-pure.

Assertions cover not just the resolved date but `source` and `confidence` per candidate, and the aggregate pass rate is printed so a heuristic change that raises the total while breaking a previously-passing fixture is visible rather than silent.

**Conflict cases have their own fixtures.** It's the differentiating behaviour; it needs deliberate coverage, not incidental.

---

## 6. Extension

### 6.1 Privacy posture drives the permission model

**On-demand popup is the default; everything ambient is opt-in.** An extension that reads every page and queries archive.org for every URL you visit is a browsing-history side channel.

This isn't only hygiene — it changes the install prompt. On-demand needs `activeTab`, which asks for nothing scary. Reading every page needs `<all_urls>`, which is the difference between an extension people install and one they don't. So the panel ships on `activeTab`, and each ambient feature is a settings toggle that requests its optional permission at the moment it is enabled and hands it back when it is disabled.

```jsonc
// permissions — identical on both browsers
["activeTab", "storage", "scripting", "contextMenus"]
// optional_host_permissions
["*://*/*", "*://web.archive.org/*", /* five search-engine origins */]
```

`contextMenus` is the only addition that is not on-demand, and it is the cheapest thing in the list: it grants the ability to put an entry in a menu. No page access, no data, and no warning in either store. The entry does nothing until clicked, and the click authorises the one page it then reads.

**The one way this promise breaks silently.** A content script *declared in the manifest* contributes its `matches` to Chrome's install-time prompt, whether or not the feature is ever enabled. The search-results annotator would therefore have demanded access to five engines from every installer, most of whom never turn it on. It is registered at runtime instead (`registration: 'runtime'` in WXT, then `scripting.registerContentScripts` once the setting is on *and* the grant exists), and CI asserts the built manifest of both targets carries no content script and no host permission — because nothing else would catch the regression.

### 6.1a Reading a page you are not on

Two surfaces do this — the right-click link check and the search-results annotator — and both are built on the same two-tier ladder, because the gap between the tiers *is* the privacy question.

| tier | evidence | cost |
| --- | --- | --- |
| `url` | the address: `/2019/03/04/some-post/` | none. No request reaches any site. |
| `fetch` | the page's own metadata | a request to a site the reader did not open |

The URL tier runs first even when fetching is allowed, and a hit short-circuits. A dated permalink is a fact the site minted about its own post; fetching to confirm what the address already says buys precision nobody asked for. On a results page of ten links this is typically most of them.

Three consequences follow, and each is in the code rather than in this document alone:

- **The right-click check needs no standing permission.** The click is unambiguous consent about one link, so it may ask for one origin at that moment (`lib/link-menu.ts`). Declining leaves the reader where they were, and the URL tier may already have answered without prompting at all.
- **The fetch tier on search results is capped at 10 per page load** (`MAX_FETCHES_PER_PAGE`). Without it, an infinite-scroll results page keeps issuing requests to third parties for as long as someone scrolls — which nobody consented to by enabling an annotation setting. Concurrency is 3; credentials are never sent.
- **The two grants are requested separately.** Annotating at the cheap tier needs five engines; the fetch tier needs the whole web. Bundling them into one prompt would erase a difference the browser's own dialogue states in words. Declining the second lands on `url`, not `off`.

Both syncs in the background worker — the menu entry and the script registration — are read-modify-write against browser-global state and are triggered from four places (install, startup, settings change, worker start). They run through a small serial queue; without it, two overlapping `removeAll()` → `create()` runs both clear and then both create, and Chrome reports `Cannot create item with duplicate id`.

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

**Extraction runs in the tab**, which is the whole point of a browser-first library. The alternative — reading `document.documentElement.outerHTML`, moving that string across a message boundary and rebuilding a second DOM from it — reparses a page the browser has already parsed and copies a string that is a median of 88 KB and reaches 1.3 MB on the benchmark corpus. What travels back instead is a handful of candidate objects.

The extractor is **injected on demand, not declared in the manifest**: an extension that loads code into every page you visit is a different privacy proposition from one that loads it into the page you asked about. It runs on a click, or on a navigation the reader opted into.

The injection is two calls, and the second is the cheap half — the first runs the extractor and stashes its result under a known key in the isolated world, the second reads that key back. Trusting what `executeScript({ files })` resolves to would mean depending on the module format the bundler emitted, which is not a contract to rest on. The result carries the URL it was read from, so the caller can prove the read belongs to the page it asked about; on an SPA the URL changes before the new view renders, and a read fired on navigation can otherwise return the previous route's candidates and have them cached under the new URL for a week.

All network lives in the service worker — CORS plus host permissions make this mandatory, and it's also where caching belongs. The worker never needs a DOM, because nothing is parsed there.

`analyze()` is the one read-extract-resolve-cache pipeline, shared by the popup, the badge and the overlay, so the three cannot disagree about the same page.

### 6.3 Rendering

- The overlay injects into a **closed shadow DOM**, or site CSS will eat it.
- **Confidence tiers render visibly distinctly.** "Declared by the site" and "guessed from body text" showing identically is the exact failure mode of every existing extension. Solid vs dashed border, plus an explicit source label.
- Conflicts get the loudest treatment available — that's the state worth interrupting for — except `stale-declaration`, which is informational rather than an error and is toned down accordingly. Three equally loud warnings would make the flag constant, and a constant flag is furniture.
- The overlay's colours are checked against contrast ratios on an unknown page, in light and dark, and respect `prefers-contrast: more`.
- SPAs hydrate dates after load, so the background pass settles before reading and re-checks that `location.href` still matches what it read.

### 6.4 Caching

`storage.local`, keyed `d:<url>` → `{ result, fetchedAt, version }`.

- Results have a 7-day TTL.
- `version` is bumped whenever either the heuristics **or the shape of the stored result** changes, and every entry below the current version is discarded on read. The shape matters as much as the heuristics: an entry that is structurally valid but missing a field the UI now renders produces a sentence with a hole in it, for a week, per reader.
- The options page shows the cache size and can clear it.

### 6.5 Distribution

Chrome Web Store and addons.mozilla.org, MV3 on both from one codebase. Store assets — icons, screenshots, permission justifications, the AMO source-code submission — are generated and documented in [RELEASING.md](RELEASING.md).

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

Rows where the digest differs from the previous row are edit events. This is the only witness to the one conflict a page will never admit to: a post declaring 2019, silently rewritten since, with no modification date anywhere in its markup.

It is **off by default**, behind its own optional permission, and settable to ask each time — because asking web.archive.org about a page tells them which page you are reading.

**Limitations encoded in the UI rather than papered over:**

- `collapse=digest` dedupes **adjacent** rows only — confirmed against the [CDX server docs](https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/README.md). A page alternating between two states still yields many rows, so the result is post-filtered client-side.
- The digest covers the whole HTML, so rotating ads, CSRF nonces and embedded render timestamps all produce false-positive "changes." The real fix — fetching snapshots and diffing readability-extracted main text — is too expensive to do eagerly, and is out of scope.
- **Archive coverage is inversely correlated with need.** Big news sites are captured hourly *and* already emit clean `datePublished`. The undated Hugo post is captured twice, or never.

So it is presented as **"roughly when this changed,"** never as a diff, and never as the headline feature.

---

## 8. Environment

- **Node 22.12 or newer**, for development and for the published packages alike. The scripts run TypeScript directly, and Node 20 reached end of life in April 2026. CI uses Node 24 and pnpm 11.18, pinned in `packageManager`.
- **Declarations are emitted by `tsc`, not by the bundler.** `tsup` builds the JS; `tsc -p tsconfig.build.json --emitDeclarationOnly` builds the `.d.ts` beside it. tsup generates declarations through a bundled `rollup-plugin-dts`, which reaches into the TypeScript compiler API and supports TS 6 at the newest — and injects a `baseUrl` that TS 6 itself deprecates, so that path is closed in both directions. Emitting with the compiler that already typechecks the source removes a component that can disagree with `tsc`, at the cost of unbundled declarations.
- Loading an unpacked extension from a dev server across the WSL↔Windows filesystem boundary makes file watching flaky, so extension work belongs on a native filesystem.
- Firefox Developer Edition + Chrome/Chromium for dual-target testing.

---

## 9. Verification

| What | How it's verified |
|---|---|
| Library behaviour | `pnpm --filter pagedate test` — Vitest over the fixtures, asserting the resolved date **plus** `source` and `confidence` per candidate. Aggregate pass rate printed. |
| Conflicts | Dedicated fixtures assert `conflict` is populated with the right `kind` — and that ordinary published≠modified pages do **not** trip it. |
| Network purity | The fixture `Env` throws on any un-stubbed fetch, so an extractor reaching for the network fails the suite rather than silently working. |
| Cost on hostile input | `test/hardening.test.ts` — documents built to be expensive, with time bounds set to catch a return of quadratic behaviour. |
| Parser agreement | `bench/parity.mjs` runs linkedom and node-html-parser over every corpus page; `bench/parity-browser.mjs` runs real Chromium against the shipped extractor bundle. Both exit non-zero on any disagreement. |
| Edge purity | `test/edge.test.ts` walks the import graph from `pagedate/edge` and fails on any `node:` or bare import. The same walker runs over `src/node/index.ts` and must *find* one, so the check cannot pass by resolving nothing. |
| Accuracy | `scripts/corpus/score.ts` on the dev split during development, the held-out split once at the end. Competitors via `bench/bench_corpus.mjs` and `scripts/bench_python.py`. |
| Everything, reproducibly | `./scripts/validate.sh` — toolchain, build, typecheck, tests, corpus integrity, both parity checks, then every published table into `results/`. |
| Extension | `pnpm --filter @website-date/extension test`, plus a CI assertion that neither built manifest carries a content script or a host permission — the one way "installing grants nothing" breaks silently. Manual: unpacked in Chrome and as a temporary add-on in Firefox against a JSON-LD news site, an undated blog with a feed, an SPA that hydrates late, a page with CSS aggressive enough to eat a non-shadow-DOM overlay, and a page behind `activeTab` only. |
| MCP server | `pnpm --filter pagedate-mcp test` — tool schemas, the prose rendering, and that `UNDETERMINED` is reached rather than a date being invented. |

---

## 10. Decision log

| Decision | Rationale |
|---|---|
| Candidates + conflict, not a single date | A single-date API cannot express "claims 2019, edited 2024" — the core complaint |
| Feeds as a top-tier signal | Site-declared, present on exactly the SSG blogs where inline metadata is missing |
| `Last-Modified` kept, but opt-in | Measured: two false positives and no gains on the local corpus. Real on static hosts, so it stays — behind a flag, ranked last (§4.10) |
| Sitemap `<lastmod>` says `modified` | It is defined as when the file changed. Reading it as a publication date would invent the one thing the site did not say (§4.5) |
| Image paths: days only, never months | A monthly upload bucket is where stock banners live. Days are per-upload directories; measured 2/2 against 1/4 (§4.9) |
| `Env` network injection | Keeps the library pure → testable in Node against fixtures → clean MV3 split |
| Conflict carries fields, not just prose | The UI writes the sentence in the reader's language; parsing English out of `detail` would be the alternative (§4.2) |
| Popup-first, everything ambient opt-in | Privacy, and it's the difference between `activeTab` and `<all_urls>` at install time |
| Extract in the tab, not in the worker | The DOM is already there. Shipping the HTML out to be reparsed costs a copy of up to 1.3 MB per page and a second parse of a page the browser already parsed (§6.2) |
| `node-html-parser` on the Node path | ~3× faster than linkedom, and parity is asserted over every corpus page rather than assumed |
| Adapters as a seam, none shipped | Generic heuristics optimize for news — the case where help isn't needed — but no per-domain rule has yet earned its maintenance (§4.6) |
| Transport shared, runtime bits injected | One redirect walk and one capped read for Node, Workers, Deno and Bun. A second implementation is a second set of guard bugs (§4.12) |
| Staleness answers `null` | A page that said "2024" straddles a 180-day threshold. Picking a side is the same invention as a fabricated January 1st (§4.13) |
| MCP defaults to `blockPrivateNetwork: 'strict'` | Every URL it fetches was chosen by a model, not by its operator — a different threat model from a CLI the user typed a URL into |
| Search annotator registered at runtime | A manifest-declared content script puts its `matches` in the install prompt for everyone, including the majority who never enable it (§6.1) |
| Port htmldate, don't reinvent | Apache-2.0 since v1.8.0, multilingual, production-proven on millions of documents |
| Listings suppress body-scraped sources | On an index page the body is other documents' metadata, so the newest item's date is returned as the page's own. Tuned for precision over recall: a wrong suppression deletes a correct answer invisibly (§4.8a) |
| `og:type` survives the listing filter | Suppressing a `declared` value on a heuristic guess about page shape inverts the confidence tiers. A homepage that declares `article:published_time` is a conflict, not a filter case (§4.8a) |
| Lowercase raw-text tags before parsing | node-html-parser drops the rest of the document when `<SCRIPT>` is closed by `</script>`. 65 kB of techtarget.com became three elements; the fix costs 0.12 ms of a 3.30 ms parse |
| No copyright-year fallback | It is how htmldate reaches zero misses, and it was measured here: on the pages where it would fire, 3 right and 1 wrong, all at year precision — no gain in exact accuracy, and a year is a fact about the site rather than the document |
