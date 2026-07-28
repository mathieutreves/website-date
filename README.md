# website-date

Find out when a web page was *actually* written — and whether it has been quietly rewritten since.

Most pages don't show a date. Many that do show the original publication date while the content has been edited for years. This project reports both dates, **where each one came from**, **how much to trust it**, and flags the case where a site contradicts itself.

Two pieces:

- **`pagedate`** — a zero-runtime-dependency, browser-first library. Takes a `Document`, returns date candidates with provenance and confidence.
- **A browser extension** (Chrome + Firefox, MV3 via WXT) that renders the result on demand.

---

## Status

Library, CLI and extension all work and are tested. Nothing is published to npm or the extension stores yet.

| | |
| --- | --- |
| Library tests | 231 passing |
| Extension tests | 113 passing |
| Annotated fixtures | 17 pages, 8 languages |
| Benchmark corpus | 590 pages, 20 hosts, 5 languages, 2005–2026 |
| Published-date accuracy, held-out split | **76.7%** |
| Runtime dependencies | none |

---

## What makes it different

Every other tool in this space returns *a date*. That is the design mistake, because the interesting cases cannot be expressed as one:

```js
result.published  // { value: '2019-03-04', confidence: 'declared', source: 'jsonld' }
result.modified   // { value: '2024-11-02', confidence: 'derived',  source: 'sitemap' }
result.conflict   // { kind: 'stale-declaration', gapDays: 2070, detail: '…' }
result.candidates // everything found, unresolved, with a note explaining each
```

Three commitments follow from that:

**Precision is never inflated.** A page that says "2024" yields `{ value: '2024', precision: 'year' }`, not a fabricated January 1st. Every other tool measured here always emits a full date, whether or not the page gave one.

**Confidence is a tier, not a score.** `declared` means the site stated it in machine-readable metadata; `derived` means structured but weaker; `inferred` means guessed from prose, a URL, or a transport header. `minConfidence: 'declared'` answers "what does this site actually claim" and will happily return nothing.

**Answering "there is no date here" is a correct answer.** Five of the 17 fixtures have no publication date, and the corpus scores true negatives. Benchmarks in this field almost never do — htmldate's corpus contains only pages with determinable dates, so false positives are *structurally unmeasurable* there, and every precision figure in the literature inherits that blind spot.

---

## Install and use

### Browser / extension content script

Zero dependencies, no HTML parser bundled — the DOM already exists.

```js
import { extractFromDocument, resolve } from 'pagedate'

const candidates = extractFromDocument(document, location.href)
const result = await resolve(candidates, location.href)
```

### Node

`node-html-parser` and `linkedom` are optional peer dependencies, needed only for this path.

```bash
pnpm add pagedate node-html-parser linkedom
```

```js
import { findDatesFromUrl, findDatesFromHtml } from 'pagedate/node'

await findDatesFromUrl('https://example.com/post')  // fetches, incl. feed and sitemap
await findDatesFromHtml(html, url)                   // offline
```

Two parsers for two jobs: HTML goes through `node-html-parser` (~2.5× faster than linkedom), XML through linkedom, which is loaded only if you actually touch a feed or sitemap. `<link>` is a void element in HTML but not in RSS, so an HTML parser reading a feed silently empties every `<link>` it meets.

### CLI

```bash
npx pagedate https://example.com/post
npx pagedate --file page.html --url https://example.com/post --all
cat page.html | npx pagedate --url https://example.com/post --json
```

Exit codes: `0` a date was found, `1` none found, `2` the page could not be read.

### Options

```js
extractFromDocument(document, url, {
  mode: 'standard',          // 'fast' | 'standard' (default) | 'extensive'
  dayFirst: 'day-first',     // override the DD/MM vs MM/DD heuristic
  minConfidence: 'declared', // ignore anything the site did not state itself
})
```

Text scanning is most of the extraction cost, so `mode` is the main performance lever. On the 262-page dev split:

| mode | accuracy | ms/page | what it reads |
| --- | --- | --- | --- |
| `fast` | 59.9% | 4.2 | declared metadata only — JSON-LD, OpenGraph, `<time>`, URL |
| `standard` | **89.7%** | 4.4 | the above plus rendered text and inline state |
| `extensive` | 89.7% | 4.3 | the above plus unlabelled text, always |

`extensive` does **not** improve accuracy — that has been measured repeatedly and it does not. It exists to populate `candidates` for conflict detection and for showing a reader everything a page contains.

### Network signals

`findDates` and the Node helpers can also ask the *site* about the page, rather than only the page about itself. Each costs at least one request, so each is a decision:

```js
await findDatesFromUrl(url, {
  sitemap: true,      // default. Looks the page up in the site's sitemap.
  httpHeaders: false, // default. Reads Last-Modified from the response headers.
})
```

- **Feeds** (`<published>`, `<updated>`, `<pubDate>`) are `declared` and always looked for. This is what makes an undated static-site post solvable at all.
- **Sitemap `<lastmod>`** is `derived` and reports `modified`, because that is what `<lastmod>` means. Ignored entirely when every entry carries the same timestamp — that is a build stamp, not a fact about any page.
- **HTTP `Last-Modified`** is off by default, and that is a measured decision rather than a cautious one: behind a CDN it is the serve time, and on the fixtures it invented two edits while finding nothing new.

---

## Results

Two corpora, because one of them is the other project's test set.

### 1. The permalink corpus — 590 pages, nobody's test set

Built for this project: pages harvested from Wayback by dated permalink, pinned to a capture, across 2005–2026, five languages and 20 hosts. Labels come from the URL path, which no HTML extractor reads.

**The URL is therefore neutralised for every tool** — blanked in the argument *and* in the HTML, because every page restates its own permalink in `<link rel="canonical">`, `og:url` and a dozen `<a href>`s. Blanking only the argument is not a fair test: it costs pagedate 194→184 and htmldate 192→163 on the same pages, so leaving it in ranks tools by how hard they hunt for a URL rather than how well they read a document.

**Held-out test split — the number that counts.** Hosts are assigned to dev/test by hash, so nothing here shares a site, and therefore a template, with anything pagedate was tuned on.

| tool | exact | wrong | missed | accuracy |
| --- | ---: | ---: | ---: | ---: |
| htmldate (extensive) | 74 | 16 | 0 | **82.2%** |
| **pagedate (standard)** | 69 | 6 | 15 | **76.7%** |
| htmldate (fast) | 69 | 6 | 15 | 76.7% |
| metascraper | 60 | 12 | 18 | 66.7% |
| articleDateExtractor | 55 | 9 | 26 | 61.1% |
| @extractus/article-extractor | 53 | 11 | 26 | 58.9% |
| newspaper4k | 50 | 5 | 35 | 55.6% |
| goose3 | 48 | 2 | 40 | 53.3% |
| pagedate (fast) | 44 | 5 | 41 | 48.9% |
| unfluff | 38 | 2 | 50 | 42.2% |
| date_guesser | 34 | 12 | 44 | 37.8% |

**On the dev split pagedate leads by 11.5 points, and that lead does not survive.**

| | dev (262 pages, tuned on) | test (90 pages, held out) |
| --- | ---: | ---: |
| pagedate (standard) | 89.7% | 76.7% |
| htmldate (extensive) | 78.2% | 82.2% |

A 13-point drop against a 4-point rise is the signature of overfitting, and the dev figure should not be quoted. What the held-out split supports is narrower and still worth something: pagedate is level with htmldate's fast mode, ahead of every other tool measured, and the only one of them that runs in a browser.

Note the shape of the two error columns. htmldate (extensive) never declines to answer — 0 misses, 16 wrong. pagedate answers 15 fewer pages and is wrong on 6. Which is better depends entirely on whether a confidently wrong date costs you more than no date, and this is the whole reason the library reports a confidence tier instead of a number.

### 2. The htmldate corpus — 55 pages, their test set

Kept for continuity with [htmldate's published table](https://github.com/adbar/htmldate). German-heavy news, and their own unit-test set.

| tool | accuracy | ms/page |
| --- | ---: | ---: |
| htmldate (extensive) | 90.9% | 85.8 |
| htmldate (fast) | 78.2% | 15.6 |
| **pagedate (standard)** | 61.8% | 3.9 |
| date_guesser | 25.5% | 111.0 |
| pagedate (fast) | 23.6% | 1.4 |
| metascraper | 23.6% | 26.9 |
| newspaper4k / articleDateExtractor | 20.0% | 151.5 / 41.1 |
| @extractus / unfluff | 14.5% | 90.6 / 132.0 |
| goose3 | 7.3% | 133.5 |

**htmldate wins here and it is not close.** That is partly home advantage and partly that it is a genuinely better general-purpose extractor on news.

Six gold entries in this corpus are wrong — dates belonging to other documents, crawl-time artifacts, a "last revised" date scored as publication. They are corrected in [`corpus-external/corrections.json`](corpus-external/corrections.json), with quoted evidence for each, and scored as a **second table alongside the original, never replacing it**. Under the corrected key htmldate's extensive mode *drops 9.1 points* — it confidently reports artifact dates where the right answer is "none" — and converges with its own fast mode, meaning extensive's extra recall is spent entirely on dates that should not be found.

### Speed

| | extraction only | including HTML parsing |
| --- | ---: | ---: |
| pagedate (fast) | 1.4 ms | 13.4 ms |
| pagedate (standard) | 3.9 ms | 15.3 ms |
| htmldate (fast) | — | 15.6 ms |
| htmldate (extensive) | — | 85.8 ms |

Which number is honest depends on where it runs. **In an extension the DOM already exists and nothing pays for parsing**, so the real cost is 1–4 ms and htmldate cannot run there at any speed. In Node the caller pays for parsing, and that term dominates — the comparison there is really the parser, not the extractor.

---

## Reproducing all of it

```bash
./scripts/validate.sh
```

That runs the whole pipeline and writes every table to `results/`: toolchain versions, build, typecheck, unit tests, corpus integrity, parser parity, then all four benchmark tables. `--quick` skips the corpus rebuild and the Python tools.

Piecemeal:

```bash
pnpm install && pnpm --filter pagedate build
pnpm --filter pagedate test

node scripts/corpus/fetch.ts       # rebuild corpus/cache from the pinned captures
node scripts/corpus/verify.ts      # confirm it is byte-identical to ours
node scripts/corpus/score.ts       # pagedate, per stratum
node bench/bench_corpus.mjs        # JS tools, permalink corpus
python3 scripts/bench_python.py --corpus permalink | node scripts/tally.ts /dev/stdin
```

Competitors are installed separately, so nothing enters the published dependency tree:

```bash
cd bench && npm install && cd ..
pip install -r scripts/requirements-bench.txt
```

**`corpus/cache/` is gitignored** — it is other people's HTML under no licence we control. `corpus/manifest.jsonl` **is** committed, and `fetch.sha256` on each entry means a rebuilt corpus is verifiably the same one. `verify.ts` checks it. That is the difference between a benchmark you can reproduce and a table you have to trust.

### Parser parity

The Node path ships `node-html-parser`; the extension gets a real browser DOM. `bench/parity.mjs` runs both parsers over all 645 corpus pages and exits non-zero on any disagreement, because a published figure measured through a parser nobody runs describes nothing. They currently agree on every page.

This check earns its place. Switching the test suite onto the shipped parser immediately surfaced a silent bug: node-html-parser entity-decodes `<script>` bodies, which is wrong — `<script>` is a raw-text element — and it turned any JSON-LD block containing `&quot;` into invalid JSON. The block was skipped as malformed and the page fell through to a weaker signal, losing the strongest available answer on exactly the pages that had one.

---

## How it works

Signals are collected independently, then ranked. Nothing short-circuits, so conflicts stay visible.

| tier | signal |
| --- | --- |
| `declared` | JSON-LD `datePublished`/`dateModified` (full `@graph` walk), OpenGraph, RSS/Atom feed entries, per-domain adapters |
| `derived` | `<time datetime>` scored by context, Dublin Core, `citation_*`, `itemprop`, sitemap `<lastmod>`, inlined CMS state |
| `inferred` | URL slug, preview-image path, visible text (`Updated on…`, `Veröffentlicht`, `公開日`), HTTP `Last-Modified` |

Resolution ranks by confidence → source → precision, promotes an unlabelled date to `published` when nothing claims the field, and then looks for three kinds of contradiction:

- **`declared-disagreement`** — two things the site declared for the same field differ by more than 30 days.
- **`predated-content`** — the page carries several machine-readable timestamps *older* than the date it claims. A reader cannot comment on an article before it exists, so this is a republication stamp rather than a writing date.
- **`stale-declaration`** — a publication date long predates archive evidence of edits the page does not show.

`published` and `modified` merely *differing* is normal and deliberately **not** a conflict. That distinction is what stops the flag being permanently lit and therefore ignored.

Language support covers ~25 languages of month names, non-ASCII digit systems (Arabic, Persian, Devanagari, Thai, full-width), CJK structural dates (`2024年3月12日`), and ordinal suffixes in English, French, Spanish and Dutch. Unicode folding recomposes to NFC after stripping diacritics — without that, Hangul shatters into jamo and Arabic `آ` splits.

---

## Repository layout

```
packages/pagedate/       the library — zero runtime dependencies
  src/extract/           one module per signal
  src/parse/             normalisation, locale, plausibility
  src/resolve.ts         ranking and conflict detection
  src/node/              Node entry point: parser + real network Env
  scripts/               evaluation and triage tools
apps/extension/          WXT, MV3, Chrome + Firefox from one codebase
fixtures/                17 hand-annotated pages, 8 languages
corpus/                  the permalink corpus (manifest committed, HTML not)
scripts/corpus/          harvest → fetch → enrich → verify → score
scripts/validate.sh      reproduce every published number
bench/                   competitor harnesses, isolated node_modules
docs/                    design, benchmark, corpus notes
results/                 committed output of the last validation run
```

---

## Limitations

- **The corpus is 82% English and Italian.** Spanish and French are thin; German, Japanese, Dutch and Polish seeds yielded nothing, because Wayback's CDX prefix matching only finds date permalinks at the path root. "Does this work outside English" is not yet answered.
- **Permalink labels carry ±1 day of timezone noise.** A post published at 23:30 local gets a local-date URL and a UTC `article:published_time`; both are correct. Measured, this is ~3% of entries — larger than most differences a benchmark is used to argue about.
- **Labels are silver, not gold.** They come from URL structure, not human adjudication.
- **90 held-out pages is small.** One page is 1.1 points. Treat gaps under ~5 points as noise.
- **The extension's parser is measured by nothing.** Tests use node-html-parser, benchmarks use node-html-parser, the extension uses the browser.

---

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) — architecture, signal ladder, resolution algorithm, decision log
- [docs/BENCHMARK.md](docs/BENCHMARK.md) — full tables, fairness notes, what was tried and rejected
- [docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md) — how the corpus is built and why labels are the hard part
- [docs/CORPUS-NOTES.md](docs/CORPUS-NOTES.md) — gold-standard caveats in the external corpus

## Prior art

`htmldate` (Python) is the reference implementation and the one to beat. `metascraper`, `@extractus/article-extractor` and `unfluff` extract dates as a side effect of article extraction. None of them are browser-first with zero dependencies, expose published and modified as distinct outputs, *and* carry a provenance and confidence field — which is what makes the output actionable rather than one more number on a screen. Surveyed in [§1 of the design doc](docs/DESIGN.md#1-context).

## Licence

MIT. Portions of the discard patterns are adapted from htmldate (Apache-2.0).
