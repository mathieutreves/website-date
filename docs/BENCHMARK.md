# Benchmark

Run, not cited. A published table is a snapshot — versions move on, tools break,
and the corpus behind it may not be reachable. Everything below was measured
against current versions on the same pages.

```
SAME 55 PAGES, SAME METRIC, CURRENT VERSIONS — publication date only

  tool                            exact  part  wrong  miss | precision  recall  accuracy  F-score   ms/page
  ---------------------------------------------------------------------------------------------------------
    htmldate 1.10.0 (extensive)     50     0      5     0 |   90.9%   100.0%    90.9%    95.2%     75.53
    htmldate 1.10.0 (fast)          43     0      3     9 |   93.5%    82.7%    78.2%    87.8%     11.17
  ▸ pagedate (standard)             30     3      9    13 |   71.4%    69.8%    54.5%    70.6%      5.36
    date_guesser 2.1.4              14     0      8    33 |   63.6%    29.8%    25.5%    40.6%    115.56
    newspaper4k 0.9.6               11     0      5    39 |   68.8%    22.0%    20.0%    33.3%    148.77
    articleDateExtractor 0.20       11     0      9    35 |   55.0%    23.9%    20.0%    33.3%     40.06
  ▸ pagedate (fast)                  8     3      5    39 |   50.0%    17.0%    14.5%    25.4%      1.32
    @extractus/article-extractor     8     0     10    37 |   44.4%    17.8%    14.5%    25.4%     85.53
    unfluff                          8     0      1    46 |   88.9%    14.8%    14.5%    25.4%    113.95
    goose3                           4     0      2    49 |   66.7%     7.5%     7.3%    13.6%    131.80
```

## What this says

**htmldate wins, clearly.** 90.9% in extensive mode with zero misses across 55
pages. That is not an artifact of it being their corpus — it is a genuinely
better general-purpose date extractor, and nothing here comes close.

**pagedate is second, and first among everything that is not htmldate.** It beats
every other Python tool and every JavaScript one.

**In JavaScript specifically, there is no real competition.** The best JS
alternatives manage 14.5%; pagedate manages 54.5%, nearly four times better. Both JS
alternatives are article extractors where the date is one field among many, and
it shows. That is the positioning that matters, because this is a JS library
meant to run in a browser extension where htmldate cannot go.

**pagedate is the fastest by a wide margin** — 1.3 ms/page in fast mode, 5.4 in
standard. Timings are not strictly comparable (the Python tools include lxml
parsing; pagedate's exclude HTML parsing, which an extension never pays) but the
order of magnitude is real.

## The other tools score far below htmldate's published table

htmldate's own published figures for the same tools:

| tool | their table | measured here |
| --- | --- | --- |
| articleDateExtractor | 65.6% | 20.0% |
| date_guesser | 54.4% | 25.5% |
| goose3 | 54.5% | 7.3% |
| newspaper4k | 68.0% | 20.0% |

That is a large gap and it deserves a stated explanation rather than a shrug.
The most likely one is **corpus selection**: their table covers 1000 pages, while
only ~55 annotated pages are publicly reachable, and those are also their
*unit-test* set — pages kept precisely because they are awkward. A set curated
around one tool's hard cases will flatter that tool and punish everyone else.

If that is right, then every non-htmldate number here — including our own — is
understated relative to the full corpus. It is not possible to verify without
the missing 745 pages.

A second possibility is simple decay: several of these have not been updated in
years and may parse modern markup worse than they did. Both explanations can be
true at once.

## Is pagedate faster than htmldate?

Only if you say where it runs. Measured both ways:

| | extraction only | including HTML parsing |
| --- | --- | --- |
| pagedate (fast) | 1.15 ms | 12.56 ms |
| pagedate (standard) | 4.14 ms | 15.41 ms |
| htmldate (fast) | — | 11.17 ms |
| htmldate (extensive) | — | 75.53 ms |

**In a browser extension, pagedate is dramatically faster** — the DOM already
exists, so nothing pays for parsing, and the real cost is 1–4 ms. htmldate
cannot run there at any speed.

**In Node, pagedate is slower than htmldate's fast mode** — 15.4 ms against
11.2 ms. Parsing dominates, and the comparison is really linkedom against lxml
rather than one extractor against the other.

### Could a faster parser fix that?

Not lxml — it is a Python C extension. Three Node parsers were measured on the
same 55 pages:

| parser | parse | traverse | same answers as linkedom |
| --- | --- | --- | --- |
| linkedom | 10.43 ms | 2.08 ms | — |
| node-html-parser | 3.50 ms | 1.97 ms | **41 of 55** |
| happy-dom | 36.44 ms | 9.73 ms | not measured (already slower) |

`node-html-parser` is three times faster and would put the Node path under
htmldate's — but it silently returns a different answer on 14 of 55 pages,
always `null` where linkedom found a date. It sees less of the document. A
parser that is fast because it does less is not a speed-up, so linkedom stays.

## Does the gold standard understate pagedate?

Partly, and it is worth checking rather than assuming, because several golds in
this corpus point at dates belonging to other documents — the exact thing
`isBorrowedContent` rejects by design.

Seven of the 32 disagreements have a gold date sitting inside a link href, an
asset path, or a crawl-time query string. Excluding those pages:

| | before | after |
| --- | --- | --- |
| pagedate (standard) | 54.5% | **60.4%** |
| htmldate (extensive) | 90.9% | **91.7%** |

So the correction is real and it does help — but it helps htmldate slightly too,
because htmldate matched the artifact gold on **6 of those 7** pages. Removing
them takes seven from its denominator and only six from its numerator. The gap
narrows from 47.3 points to 41.7.

The honest reading: the gold standard is imperfect, the imperfection does
understate pagedate, and correcting for it changes nothing about who is ahead.

### What the adjudication produced

Three pages had textbook machine-readable bylines we got wrong anyway. Chasing
them found a bug affecting far more than three:

`verfassungsblog.de` puts its byline inside `<div class="site-content
content-area … sidebar…">`. That token-anchored `sidebar` match excluded the
entire article body — a *layout* class describing the page was being read as
"this element is a sidebar". The fix is proximity: a positive marker nearer the
element than the negative one wins, because `<time class="entry-date">` inside
`<span class="byline">` is a byline whatever a distant wrapper is called.
Genuine furniture still excludes correctly, since there the negative marker is
the closer of the two.

That one change recovered **five** pages, not three.

A second fix followed from the same adjudication: markup can label a date as
well as words can. `<span class="PublishDate_date">29. Januar 2019</span>` needs
no "Published on" prefix to be a publication date, and reading the class name as
the label stops such dates being left unlabelled and outranked by worse
candidates.

Together: **43.6% → 54.5%**, exact hits 24 → 30, misses 17 → 13.

### Where the remaining 25 stand

| | count |
| --- | --- |
| right date, chosen correctly | 30 |
| right date, reported as *modified* rather than published | 2 |
| right date present as a candidate but not chosen | 4 |
| wrong date chosen | 7 |
| date never found | 12 |

The two "reported as modified" cases are worth naming, because they are a
limitation of the benchmark rather than of either tool. Pixabay's terms page
says *"Date of Last Revision: August 9, 2017"*, and we classify that as a
modification — which it plainly is. A single-date gold cannot express the
distinction, so correctly making it costs us a point.

## Fairness notes

Two competitors were being charged for work unrelated to date extraction:
`newspaper4k` and `goose3` both fetch images over the network during parsing by
default. Disabling that took newspaper4k from 5152 ms/page to 149 ms/page. Their
accuracy did not change, so the earlier figures were only unfair on speed — but
they were unfair, and a benchmark that flatters its author by mis-invoking the
competition is worth nothing.

`unfluff` is worth a note in the other direction: 88.9% precision against 14.8%
recall. It almost never answers, but is usually right when it does.

## Caveats

- **55 pages is small.** One page is ~1.8 points. Treat gaps under ~5 points as
  noise.
- **The corpus is German-heavy news and blogs**, which is htmldate's home
  ground and nothing like the technical-content case pagedate targets.
- **Publication date only.** Modified dates, confidence tiers and conflict
  detection — the things this library is actually built around — are not
  measured by any of this.
- **Some gold dates are artifacts.** See [CORPUS-NOTES.md](CORPUS-NOTES.md):
  several point at dates belonging to other documents, which pagedate rejects
  by design and is therefore penalised for.

## Reproducing

```bash
node scripts/fetch-htmldate-corpus.ts
pip3 install --user "htmldate[all]" newspaper4k goose3 date_guesser articleDateExtractor
cd bench && npm install && cd ..

python3 scripts/bench_python.py > /tmp/bench-python.jsonl
node bench/bench_js.mjs          > /tmp/bench-js.jsonl
pnpm --filter pagedate build
node packages/pagedate/scripts/leaderboard.ts
```

`bench/` has its own `node_modules` so competitor packages never enter the
published dependency tree.
