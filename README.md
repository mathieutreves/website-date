# website-date

Find out when a web page was *actually* written — and when it was quietly rewritten since.

Most pages don't show a date. Many that do show the original publication date while the content has been edited for years. This project detects both, reports **where each date came from** and **how much to trust it**, and flags the case where a site contradicts itself.

Two pieces:

- **`pagedate`** — a zero-dependency, browser-first library. Takes a `Document`, returns date candidates with provenance and confidence.
- **A browser extension** (Chrome + Firefox, MV3 via WXT) that renders the result on demand.

## Status

Library core works. CLI works. Extension not built yet.

On the local corpus: **100%** published accuracy, **90.9%** modified. On [htmldate](https://github.com/adbar/htmldate)'s public cached subset: **41.8%** strict — see [Evaluation](#evaluation).

## Usage

### In a browser or extension content script

Zero dependencies, no HTML parser bundled — the DOM already exists.

```js
import { extractFromDocument, resolve } from 'pagedate'

const candidates = extractFromDocument(document, location.href)
const result = await resolve(candidates, location.href)

result.published // { value: '2023-04-11', confidence: 'declared', source: 'jsonld', ... }
result.conflict  // set when the page contradicts itself
```

### In Node

`linkedom` is an optional peer dependency, needed only for this path.

```bash
pnpm add pagedate linkedom
```

```js
import { findDatesFromUrl, findDatesFromHtml } from 'pagedate/node'

await findDatesFromUrl('https://example.com/post')   // fetches, incl. feed lookup
await findDatesFromHtml(html, url)                    // offline
```

### CLI

```bash
npx pagedate https://example.com/post
npx pagedate --file page.html --url https://example.com/post --all
cat page.html | npx pagedate --url https://example.com/post --json
```

Exit codes: `0` a date was found, `1` none found, `2` the page could not be read.

## Evaluation

```bash
pnpm test                                    # unit tests + local corpus metrics
node scripts/fetch-htmldate-corpus.ts        # download the external corpus
node packages/pagedate/scripts/eval-htmldate.ts
```

The local corpus reports precision/recall/accuracy/F-score in the same shapes htmldate publishes, plus two things a single-date benchmark cannot express: **true negatives** (pages that genuinely have no date, where returning nothing is correct) and **confidence-tier calibration** (if `declared` and `inferred` are right equally often, the tiering is decorative).

Note that htmldate's published 1000-page benchmark is **not** reproducible — only ~69 of the cached pages are in their public repo. Numbers here are not directly comparable to theirs.

## Adding fixtures

```bash
node scripts/fixture.ts https://example.com/post
```

Snapshots the page, headers, feed and sitemap, then writes an `expected.json` skeleton to fill in by hand. That judgement about what a page actually means is the corpus.

## Design

See [docs/DESIGN.md](docs/DESIGN.md) — architecture, signal ladder, resolution algorithm, build phases, and the decision log.

## Why not just use an existing library?

Several extract dates. None are browser-first with zero deps, expose published and modified as distinct outputs, *and* carry a confidence/provenance field. That last one is what makes the output actionable rather than just another number on the screen. Prior art is surveyed in [§1 of the design doc](docs/DESIGN.md#1-context).
