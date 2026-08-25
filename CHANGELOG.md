# Changelog

Notable changes to `pagedate` and to the Page Date extension. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the library follows [semantic versioning](https://semver.org/), with the usual `0.x` caveat that a minor bump may break you.

## [Unreleased]

### Added

- **`pagedate/edge`** — a subpath for Cloudflare Workers, Deno and Bun. Adds `webEnv()`, a network `Env` built from web-platform globals alone. It runs the same code as `nodeEnv()`: the redirect walk, timeout and capped body read live in a shared module. `blockPrivateNetwork: 'strict'` degrades to `'literal'` without an injected `resolveHostname`, and XML signals are skipped on runtimes with no `DOMParser` unless `parseXml` is supplied. A test walks the import graph from the entry point and fails on any `node:` or bare import.
- **`isStale(result, { maxAgeDays })` and `staleness(result, options)`.** Coarse precision is treated as an interval rather than a point, so a page stating only "2024" against a 180-day threshold returns `{ stale: null, reason: 'imprecise' }`. `basis` selects published, modified, or either. `isStale` counts an undecidable page as stale by default.
- **`pagedate --batch`** — NDJSON in, NDJSON out. `--concurrency` bounds requests in flight, and never more than one per host regardless. Results stream as they complete and carry their input line `index`; a JSON input object's non-`url` keys are carried through to the output. A page that fails gets an `error` record and does not stop the run.
- **`extractUrlSlug` is now exported**, for callers who have a URL and no document.
- **`pagedate-mcp`** — a new package exposing `page_freshness` and `page_date` over the Model Context Protocol. Separate from `pagedate` to keep that package's dependency count at zero. Its tools return prose alongside structured data, and `UNDETERMINED` states that absence of a date is not evidence of recency. `blockPrivateNetwork` defaults to `'strict'` there.
- **`server.json` and an `mcpName`**, so `pagedate-mcp` can be listed in the MCP Registry as `io.github.mathieutreves/pagedate`. The release workflow publishes both npm packages and then the registry entry, over OIDC with no stored token. See [docs/PUBLISHING.md](docs/PUBLISHING.md).

### Added — extension

- **"When was this page written?" on right-clicking a link.** Reads the link's address first, which costs no request and no prompt. Only when the address says nothing does it request access to that one origin, at that moment, and read the page. The result appears as a transient panel in the corner of the current page.
- **Ages next to search results** on Google, Bing, DuckDuckGo, Hacker News and old Reddit. Off by default, with two tiers: `url` reads addresses and contacts nobody, `fetch` requests the result pages. The fetch tier is capped at 10 results per page load, runs three at a time, sends no cookies, and asks for its own separate permission; declining it lands on `url` rather than `off`.
- The results annotator is registered at runtime rather than declared in the manifest, because a declared content script contributes its `matches` to Chrome's install-time prompt for every installer. CI now asserts the built manifest of both targets carries no content script and no host permission.

### Fixed

- **`page-scan` now respects the same furniture exclusions every other text extractor applies.** It runs only when everything else declined, which on a page whose only date sits in a sidebar is precisely because they correctly excluded that sidebar; reading every element regardless of position made it the one extractor that could turn `<aside class="recent-posts">` into a publication date. On the htmldate corpus the gate costs nothing (69.1% accuracy either way) and converts one wrong answer into an abstention: precision 76.0% → 77.6%.
- **A publication date is now reported in the day the site shows its readers rather than the day UTC falls on.** A page posting at 23:50 local and stamping `2025-12-05T05:50Z` in its JSON-LD was reported as published on the 5th, while its own byline and permalink said the 4th. When the page carries its own rendering of the same instant — a timezone-naive timestamp a real UTC offset away, or a day the markup explicitly labels as this page's publication date — that rendering now wins. Unlabelled neighbouring dates are ignored.
- **A class name is read for its most specific word rather than its leftmost.** `MaterialMeta--time` says both "metadata lives here" and "this is a date"; the first was winning on position alone, so the element asserted nothing and the article's own date lost to a rail of `<time>` tags beside it.
- **A date followed by the word "published" is only read as a byline when the markup says the element is one.** In running prose it is a sentence: "on 5 October 2018, just after the original report was published" was dating a page two and a half years early.
- **An unlabelled date no longer overturns a labelled one at the same confidence tier.** Horizont.net's own `<span class="PublishDate_date">29. Januar 2019</span>` was being displaced by a `<time>` from a related-articles rail, because `time-tag` sorts above `marked-date` and carried a minute. Source rank is a tie-break between candidates of equal standing; a genuinely stronger tier still wins.
- **`<aside>` is treated as furniture only outside an article.** Inside one it is routinely the article's own metadata block — ebene11.com puts the entire byline in `<aside class="blogData">` — and a blanket exclusion discarded the only date on the page. It is now decided by an enclosing `<article>`, as `<header>` and `<footer>` already were. `<nav>` remains excluded outright.

### Changed

- **Node 22.12 is now the floor** for both published packages. Node 20 reached end of life in April 2026, and `@types/node` is pinned to the major matching the floor rather than the newest, so a Node 24-only API cannot typecheck its way into a package claiming to run on 22.
- **The toolchain moved to TypeScript 7, Vitest 4 and WXT 0.21**, and declarations are now emitted by `tsc` rather than by the bundler. tsup builds the JS; `tsc --emitDeclarationOnly` builds the `.d.ts`. tsup's declaration step runs a bundled `rollup-plugin-dts` that supports TypeScript 6 at the newest and injects a `baseUrl` that TypeScript 6 deprecates, so it cannot build on either side of that line.
- **`pagedate-mcp` declared `zod ^3.24.1` while the MCP SDK requires `^3.25 || ^4.0`.** A fresh install was free to resolve a zod the SDK cannot use. The range now matches the SDK's, CI asserts it stays a subset of it, and the workspace resolves zod 4.
- **The htmldate comparison was wrong in htmldate's disfavour and has been corrected.** `find_date` takes an `original_date` flag; left at its default it returns the most recent date on a page rather than the publication date, which is what every gold label in both corpora is. Corrected, htmldate (extensive) goes 82.6% → 93.3% on the held-out permalink split and takes first place from pagedate, and 90.9% → 96.4% on its own corpus. It is the only tool measured with such a switch, so no other row moved. See docs/BENCHMARK.md.
- Benchmark harnesses take "now" from each page's capture timestamp instead of a fixed constant that predated part of the corpus. See docs/BENCHMARK.md. This moves the published figures and is a correction to the measurement, not to the library.
- `fixtures/aljazeera-arabic-news` expected `2026-07-27`, read off a UTC `datePublished` of `2026-07-27T21:02Z`. Doha is UTC+3, and the page's canonical URL and byline both say the 28th. Corrected.

## [0.1.0] — unreleased

First release. Nothing is on npm or in either extension store at time of writing, so this entry describes what the first published version contains.

### Library

- `extractFromDocument(document, url)` and `resolve(candidates, url)` — the browser-first path, with no HTML parser bundled and no runtime dependencies.
- Published and modified dates as separate outputs, each carrying a `source`, a `confidence` tier (`declared` / `derived` / `inferred`) and a `precision` (`year` / `month` / `day`). A page stating "2024" yields `{ value: '2024', precision: 'year' }`.
- `conflict` detection, including `stale-declaration`, the case where a page declares a date its own markup contradicts.
- Signals read: JSON-LD, OpenGraph and other meta tags, `<time>` elements, hAtom/microformat markup, labelled and unlabelled visible text in ten languages, URL permalinks, preview-image paths, inline JavaScript state, RSS/Atom feeds, sitemap `<lastmod>` and the `Last-Modified` header.
- `minConfidence`, to restrict the answer to what a site claims and return nothing when it claims nothing.
- `pagedate/node` subpath export and a `pagedate` CLI, with `linkedom` or `node-html-parser` as an optional peer.
- Network guards on the Node path: public hosts only, capped bytes, capped time, capped redirects. See [SECURITY.md](SECURITY.md).

### Extension

- Chrome and Firefox, MV3, `activeTab` only — no host permissions at install.
- Toolbar panel with provenance and confidence, and an on-page overlay showing page age with a position setting.
- Optional automatic reading, and optional Internet Archive lookup, both off by default and each behind its own permission prompt.
- Nine locales, generated from a single message catalogue with a drift check.
- No servers, no accounts, no analytics. See [docs/PRIVACY.md](docs/PRIVACY.md).

### Measurement

- A 1248-entry permalink corpus built for this project, labelled from URL structure, split by host into dev and held-out, with the labelling source neutralised before scoring.
- Head-to-head evaluation against `htmldate`, `metascraper`, `@extractus/article-extractor` and `unfluff`, with the caveats recorded in [docs/BENCHMARK.md](docs/BENCHMARK.md) and [docs/CORPUS-NOTES.md](docs/CORPUS-NOTES.md).
- `scripts/validate.sh` reproduces every published number.

[Unreleased]: https://github.com/mathieutreves/website-date/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mathieutreves/website-date/releases/tag/v0.1.0
