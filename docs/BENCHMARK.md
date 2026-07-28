# Benchmark

Run, not cited. A published table is a snapshot — versions move on, tools break,
and the corpus behind it may not be reachable. Everything below was measured
against current versions on the same pages, and every table here is reproduced
by `./scripts/validate.sh` into `results/`.

Two corpora, because one of them is the other project's test set:

| | pages | labels | whose test set |
| --- | --- | --- | --- |
| **permalink** | 590 | dated URL path | nobody's |
| **htmldate** | 55 | hand-annotated | htmldate's own unit tests |

---

## 1. The permalink corpus

Pages harvested from Wayback by dated permalink, pinned to a capture, 2005–2026,
20 hosts, 5 languages. The label is the date in the URL path — a signal no HTML
extractor reads, which is the entire point. See
[CORPUS-BUILD.md](CORPUS-BUILD.md) for how it is built and why labels are the
hard part.

### The URL has to be neutralised, in the HTML as well as the argument

These labels came out of the URL, so any tool that reads URLs is being handed the
answer. pagedate has `holdOut` for exactly this; the competitors do not, and
disabling one side's URL reader while leaving the others' intact would be worse
than useless. So every tool gets the same URL with the date segments blanked.

Blanking only the *argument* does not achieve that. Every page restates its own
permalink in `<link rel="canonical">`, `og:url`, JSON-LD `url`, inline
JavaScript and a dozen `<a href>`s. Measured on the same pages:

| | URL argument blanked only | permalink blanked in the HTML too |
| --- | ---: | ---: |
| pagedate (standard) | 194 | 184 |
| htmldate (fast) | 192 | **163** |

Both read in-page URLs; the point is how differently. Leaving them in ranks tools
by how hard they hunt for a URL rather than by how well they read a document, so
the harnesses blank both. This makes the permalink figures *stricter* than
`score.ts` reports for production use, where reading a URL is perfectly
legitimate.

### Held-out test split — 90 pages

Hosts are assigned to dev/test by hash of the hostname, so a site tuned against
cannot leak its templates into the held-out set. **This is the number that
counts.**

```
  tool                           exact  wrong  miss |  accuracy   ms/page
  ------------------------------------------------------------------
    htmldate (extensive)            74     16     0 |     82.2%     59.79
  ▸ pagedate (standard)             69      6    15 |     76.7%     20.92
  ▸ pagedate (extensive)            69      6    15 |     76.7%     10.62
    htmldate (fast)                 69      6    15 |     76.7%      9.56
    metascraper                     60     12    18 |     66.7%     18.40
    articleDateExtractor            55      9    26 |     61.1%     54.50
    @extractus/article-extractor    53     11    26 |     58.9%    129.59
    newspaper4k                     50      5    35 |     55.6%    155.63
    goose3                          48      2    40 |     53.3%    117.42
  ▸ pagedate (fast)                 44      5    41 |     48.9%     13.11
    unfluff                         38      2    50 |     42.2%     87.04
    date_guesser                    34     12    44 |     37.8%    180.77
```

### The dev-split lead does not survive, and that is the finding

| | dev (262 pages, tuned on) | test (90 pages, held out) | Δ |
| --- | ---: | ---: | ---: |
| pagedate (standard) | 89.7% | 76.7% | **−13.0** |
| htmldate (extensive) | 78.2% | 82.2% | +4.0 |
| htmldate (fast) | 72.5% | 76.7% | +4.2 |
| metascraper | 60.7% | 66.7% | +6.0 |

A 13-point drop for the tool tuned on dev, against a rise for every tool that was
not, is the signature of overfitting and nothing else. **The dev figure should
not be quoted**, and the 11.5-point lead it shows is not real.

What the held-out split does support: pagedate is level with htmldate's fast
mode, ahead of every other tool measured, and the only one of them that runs in
a browser.

### Read the error columns, not just the accuracy

htmldate (extensive) never declines to answer: 0 misses, 16 wrong. pagedate
answers 15 fewer pages and is wrong on 6. Its precision on answered pages is
92.0% against htmldate's 82.2%.

Which is better is not a benchmark question. It depends on whether a confidently
wrong date costs you more than no date — and that is precisely why this library
reports a confidence tier rather than a single value. A single-number leaderboard
cannot express the difference, which is a limitation of the leaderboard.

### By stratum

Publication era, on the dev split — the interesting axis, because markup
conventions changed underneath the whole problem:

| era | n | accuracy |
| --- | ---: | ---: |
| 2006 | 2 | 100.0% |
| 2009 | 13 | 100.0% |
| 2012 | 25 | 64.0% |
| 2015 | 36 | 91.7% |
| 2018 | 40 | 90.0% |
| 2021 | 40 | 97.5% |
| 2023 | 46 | 95.7% |
| 2025 | 54 | 96.3% |

2012 is the hard year and it is worth saying why: OpenGraph and JSON-LD were not
yet universal, and sites had stopped emitting hAtom microformats. TechCrunch in
2012 printed `<div class="post-time">posted yesterday</div>` — a date no parser
can recover, only a URL can. Three fixes moved that stratum from 8.7% to 64.0%:
English ordinal suffixes ("November 1st, 2012", which the *finder* never matched
even though the parser could strip it), reading WordPress's `post_date` out of
inlined script state, and suppressing a newspaper's registration date lifted from
a page footer.

By language, with the sample sizes stated because they matter more than the
percentages:

| language | n | accuracy |
| --- | ---: | ---: |
| en | 206 | 92.2% |
| it | 31 | 74.2% |
| es | 6 | 50.0% |
| unknown | 19 | 100.0% |

Six Spanish pages is an anecdote. The corpus is 82% English and Italian, and the
multilingual question is **not** answered by it — see Limitations.

---

## 2. The htmldate corpus

Kept for continuity with [htmldate's published
table](https://github.com/adbar/htmldate). German-heavy news, and also that
project's unit-test set.

```
SAME 55 PAGES, SAME METRIC, CURRENT VERSIONS — publication date only

  tool                            exact  part  wrong  miss | precision  recall  accuracy  F-score   ms/page
  ---------------------------------------------------------------------------------------------------------
    htmldate (extensive)            50     0      5     0 |   90.9%   100.0%    90.9%    95.2%     85.75
    htmldate (fast)                 43     0      3     9 |   93.5%    82.7%    78.2%    87.8%     15.61
  ▸ pagedate (standard)             34     1     11     9 |   73.9%    79.1%    61.8%    76.4%      3.90
    date_guesser                    14     0      8    33 |   63.6%    29.8%    25.5%    40.6%    110.95
  ▸ pagedate (fast)                 13     3      5    34 |   61.9%    27.7%    23.6%    38.2%      1.44
    metascraper (with parse)        13     0     13    29 |   50.0%    31.0%    23.6%    38.2%     26.87
    metascraper (rules only)        13     0     13    29 |   50.0%    31.0%    23.6%    38.2%      6.70
    newspaper4k                     11     0      5    39 |   68.8%    22.0%    20.0%    33.3%    151.50
    articleDateExtractor            11     0      9    35 |   55.0%    23.9%    20.0%    33.3%     41.12
    @extractus/article-extractor     8     0     10    37 |   44.4%    17.8%    14.5%    25.4%     90.58
    unfluff                          8     0      1    46 |   88.9%    14.8%    14.5%    25.4%    132.00
    goose3                           4     0      2    49 |   66.7%     7.5%     7.3%    13.6%    133.53
```

**htmldate wins here and it is not close.** Partly home advantage, partly that it
is a genuinely better general-purpose extractor on news.

Note the inversion between the two corpora: htmldate is 29 points ahead here and
5.5 points ahead on held-out permalink data. A single corpus would have supported
either story.

### The other tools score far below htmldate's published table

| tool | their table | measured here |
| --- | --- | --- |
| articleDateExtractor | 65.6% | 20.0% |
| date_guesser | 54.4% | 25.5% |
| goose3 | 54.5% | 7.3% |
| newspaper4k | 68.0% | 20.0% |

The most likely explanation is corpus selection: their table covers 1000 pages,
only ~55 annotated pages are publicly reachable, and those are also their
*unit-test* set — pages kept precisely because they are awkward. A set curated
around one tool's hard cases flatters that tool and punishes everyone else. If
that is right, every non-htmldate number here, ours included, is understated
relative to the full corpus. It cannot be verified without the missing 745 pages.

Simple decay is a second possibility; several of these have not been updated in
years. Both can be true.

### Six gold entries are wrong

Dates belonging to other documents, crawl-time artifacts, a "last revised" date
scored as a publication. They are corrected in
[`corpus-external/corrections.json`](../corpus-external/corrections.json) with
quoted evidence for each, and scored as a **second table alongside the original,
never replacing it**. A benchmark author who quietly edits the answer key has
measured nothing.

```
  SAME RUNS, 6 GOLD ENTRIES CORRECTED

  tool                            exact  part  wrong  miss | precision  recall  accuracy  F-score
  ---------------------------------------------------------------------------------------------
    htmldate (fast)                 45     0      5     5 |   90.0%    90.0%    81.8%    90.0%   +3.6pt
    htmldate (extensive)            45     0     10     0 |   81.8%   100.0%    81.8%    90.0%   -9.1pt
  ▸ pagedate (standard)             39     1     10     5 |   78.0%    88.6%    70.9%    83.0%   +9.1pt
```

The notable result is not ours. **htmldate's extensive mode drops 9.1 points**
under the corrected key, because it confidently reports artifact dates where the
right answer is "none" — and converges exactly with its own fast mode, meaning
extensive's extra recall is spent entirely on dates that should not be found. Its
zero-miss record is a liability precisely there.

Caveats worth stating plainly: we are the author of both the library and the
corrections, six pages on a 55-page corpus is a large lever, and the per-page
evidence is in the file so anyone can disagree with each call. `eff.org.2015` was
considered and deliberately left alone as weak rather than wrong.

---

## Speed

| | extraction only | including HTML parsing |
| --- | ---: | ---: |
| pagedate (fast) | 1.4 ms | 13.4 ms |
| pagedate (standard) | 3.9 ms | 15.3 ms |
| htmldate (fast) | — | 15.6 ms |
| htmldate (extensive) | — | 85.8 ms |

Which number is honest depends entirely on where it runs:

- **In a browser extension the DOM already exists**, so nothing pays for parsing.
  The real cost is 1–4 ms, and htmldate cannot run there at any speed.
- **In Node the caller pays for parsing**, and that term dominates. The
  comparison there is really the parser, not the extractor.

### Could a faster parser help?

Not lxml — it is a Python C extension. Three Node parsers were measured on the
same pages:

| parser | parse | traverse | agrees with linkedom |
| --- | --- | --- | --- |
| linkedom | 10.34 ms | 2.25 ms | — |
| node-html-parser | 3.68 ms | 2.26 ms | **645 / 645** |
| happy-dom | 42.36 ms | 7.82 ms | not measured (already slower) |

node-html-parser was ~3× faster but originally lost 14 of 55 pages, always
returning `null`. Those losses were not the parser being fast — they were the
extractors assuming `parentElement`, `nextSibling` and `documentElement` exist.
Once each assumption was replaced with a form every implementation agrees on, the
two parsers give identical answers on all 645 corpus pages, and the Node path
switched to node-html-parser.

`bench/parity.mjs` is the regression test for that, and it exits non-zero on any
disagreement.

### What parity did not catch, until the tests moved

Parity compares final resolved dates. Two bugs hid underneath that:

**node-html-parser entity-decodes `<script>` bodies.** `<script>` is a raw-text
element — the spec says its contents are *not* decoded — so any JSON-LD block
containing `&quot;` became invalid JSON, was skipped as malformed, and the page
fell through to a weaker signal. Not a wrong date; a silently *worse* one, on
exactly the pages that had the strongest available answer. Fixed by reading
`innerHTML` where it differs from `textContent`.

**linkedom does not lowercase attribute names.** BBC emits `<time dateTime="…">`
and linkedom's `getAttribute('datetime')` returns `null`, so 23 `<time>` elements
per page were invisible. Every figure measured through linkedom was understating
the `<time>` signal.

Neither showed up as a wrong answer. Both showed up the moment the unit tests
were pointed at the parser the library actually ships — which is now the case,
and is why `documentFrom` in the test helpers calls the library's own
`parseHtml`.

---

## Fairness notes

Two competitors were being charged for work unrelated to date extraction:
`newspaper4k` and `goose3` both fetch images over the network during parsing by
default. Disabling that took newspaper4k from 5152 ms/page to 149 ms/page. Their
accuracy did not change, so the earlier figures were unfair only on speed — but
they were unfair, and a benchmark that flatters its author by mis-invoking the
competition is worth nothing.

`unfluff` deserves a note in the other direction: 95.0% precision against 42.2%
accuracy on the held-out split. It almost never answers, and is nearly always
right when it does.

pagedate's `partial` column — a coarser-but-consistent answer such as `2016-12`
against `2016-12-23` — is scored as **wrong** in every table above. No other tool
produces them, because no other tool declines to invent precision.

---

## Caveats

- **90 held-out pages is small.** One page is 1.1 points. Treat gaps under ~5
  points as noise. The 55-page corpus is worse: one page is 1.8 points.
- **Labels are silver, not gold.** They come from URL structure, not human
  adjudication.
- **Permalink labels carry ±1 day of timezone noise.** A post published at 23:30
  local gets a local-date URL and a UTC `article:published_time`, and both are
  correct. Roughly 3% of entries sit on this boundary — larger than most
  differences a benchmark is used to argue about. `--tolerance 1` reports the
  other reading; both are printed rather than one being chosen.
- **Publication date only.** Modified dates, confidence tiers and conflict
  detection — the things this library is actually built around — are measured by
  none of it.
- **True negatives are unmeasurable on both corpora.** Every page in each has a
  determinable date, so a tool that correctly answers "there is none" scores
  nothing for it. Only the 17-fixture local corpus tests that, and 5 of those 17
  are negative cases.

## Reproducing

```bash
./scripts/validate.sh
```

Or piecemeal — see the README's Reproducing section. `corpus/cache/` is
gitignored and rebuilt from the committed manifest by `scripts/corpus/fetch.ts`;
`scripts/corpus/verify.ts` confirms the result is byte-identical to what these
figures were measured on.
