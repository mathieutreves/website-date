# Benchmark

Run, not cited. A published table is a snapshot — versions move on, tools break,
and the corpus behind it may not be reachable. Everything below was measured
against current versions on the same pages, and every table here is reproduced
by `./scripts/validate.sh` into `results/`.

Two corpora, because one of them is the other project's test set:

| | pages | labels | whose test set |
| --- | --- | --- | --- |
| **permalink** | 1248 | dated URL path (1236), feed `<pubDate>` (12) | nobody's |
| **htmldate** | 55 | hand-annotated | htmldate's own unit tests |

---

## 1. The permalink corpus

Pages harvested from Wayback by dated permalink, pinned to a capture, 2005–2026,
33 hosts, 10 declared languages plus a stratum that declares none. The label is
the date in the URL path — a signal no HTML extractor reads, which is the entire
point. See
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

### "Now" is the capture instant, per page

Every harness takes the current time from `entry.snapshot`, the moment the page
was archived, rather than from a constant or from the system clock.

A constant is not a neutral choice, and it fails in one direction only. The
plausibility check discards dates in the future, so any page published after the
constant has its correct, *declared* date thrown away and scored as a miss — on
this corpus that is the twelve pages captured during the 2026 harvest, six in
each split and the whole of one host. The competitors are unaffected by the same
constant, because none of them takes an injected clock: they read the system
time, which is later than any capture here and therefore rejects nothing. A
benchmark built that way reports a harness constant as a property of the library.

The capture instant is the honest simulation — that is when this exact HTML was
in front of a reader — and it is *stricter* than what the competitors get, since
it also stops a 2012 page from accepting a 2015 date. That is the right
direction for a benchmark whose author is one of the entrants.

### Held-out test split — 253 pages

Hosts are assigned to dev/test by hash of the hostname, so a site tuned against
cannot leak its templates into the held-out set. **This is the number that
counts.**

```
  tool                           exact  wrong  miss | precision  accuracy   ms/page
  ---------------------------------------------------------------------------------
    htmldate (extensive)           236     17     0 |     93.3%     93.3%     29.70
  ▸ pagedate (standard)            226     14    13 |     94.2%     89.3%      7.24
  ▸ pagedate (extensive)           226     15    12 |     93.8%     89.3%      8.15
    htmldate (fast)                217     11    25 |     95.2%     85.8%      6.85
    metascraper                    178     41    34 |     81.3%     70.4%     13.93
    articleDateExtractor           176     13    64 |     93.1%     69.6%     46.16
  ▸ pagedate (fast)                170      9    74 |     95.0%     67.2%      5.33
    newspaper4k                    166      5    82 |     97.1%     65.6%    157.98
    goose3                         155      2    96 |     98.7%     61.3%    114.61
    @extractus/article-extractor   139     35    79 |     79.9%     54.9%    135.28
    unfluff                        125      2   126 |     98.4%     49.4%     98.42
    date_guesser                   114     22   117 |     83.8%     45.1%    158.07
```

### The dev/test gap

| | dev (tuned on) | test (held out) | Δ |
| --- | ---: | ---: | ---: |
| pagedate (standard) | 96.0% | 89.3% | −6.7 |
| htmldate (extensive) | 86.3% | 93.3% | +7.0 |
| metascraper | 67.4% | 70.4% | +3.0 |

A gap between the two splits is what tuning on a corpus and reporting on it looks
like, so its size is the number to read rather than either figure alone.

htmldate is the control, and its **+7.0** is the part that constrains how −6.7
can be read. A tool tuned on none of this does *better* on the held-out hosts
than on the dev ones, and metascraper's +3.0 points the same way: the two splits
are not equally hard, and the held-out set suits both of them. So −6.7 is a gap
against a baseline somewhere above zero, not against zero. Part of it is tuning
residue and part is that the test split is a different set of sites; two splits
and one control cannot separate them.

**One place the residue is visible.** Japanese scores 94.9% on dev and 62.5% on
test. The year-first format the dev hosts use is handled because those hosts were
visible during development; the test pages are a different publisher whose markup
is not. That is the held-out split doing its job.

**And one place the corpus cannot adjudicate at all.** Reporting a UTC
declaration in the day the site shows its own readers is right in general — a
publication date is a civil date somewhere, and UTC is not automatically that
somewhere — but the label in this corpus *is* a local-versus-UTC choice, made
independently by each site's CMS. Two European papers here mint the permalink on
one convention and print the byline on the other, and nothing in those documents
decides which is "the" date. The rule wins pages on one split and loses them on
the other, and neither outcome is evidence about the rule.

The residue is small mostly because of how the corpus is shaped. At 253 held-out
pages across six languages, no single site sets the number; the extraction rules
that carry across hosts are general ones — a date format, a class of furniture,
a ranking rule for two declarations that disagree — and general rules transfer to
held-out hosts where per-site patches do not.

### Read the error columns, not just the accuracy

htmldate (extensive) never declines to answer: 0 misses, 17 wrong. pagedate
declines on 13 pages and is wrong on 14. Its precision on answered pages is
94.2% against htmldate's 93.3% — a difference of two pages, which on 253 is
noise.

Note what declining costs pagedate here. Every page in this corpus *has* a date,
so it can only lose points — there is no true negative to be scored for. Those 13
declines are 5.1 points, and pagedate trails by 4.0. That does not prove it would
lead on a corpus containing undated pages, because no such benchmark exists to
try it on; it does mean the headline gap is smaller than the abstention policy
that produces it, and a reader should not take the ranking as settling which
behaviour is better.

Which is better is not a benchmark question. It depends on whether a confidently
wrong date costs you more than no date — and that is precisely why this library
reports a confidence tier rather than a single value. A single-number leaderboard
cannot express the difference, which is a limitation of the leaderboard.

### By stratum

Publication era, on the dev split — the interesting axis, because markup
conventions changed underneath the whole problem:

| era | n | accuracy |
| --- | ---: | ---: |
| 2006 | 8 | 100.0% |
| 2009 | 17 | 100.0% |
| 2012 | 40 | 72.5% |
| 2015 | 69 | 95.7% |
| 2018 | 65 | 98.5% |
| 2021 | 91 | 97.8% |
| 2023 | 86 | 97.7% |
| 2025 | 93 | 100.0% |
| 2026 | 6 | 100.0% |

On the held-out split the era curve is flatter and lower — 66.7% in 2006 and
82.8% in 2009 against 100% on dev — but those strata are 12 and 29 pages and are
different hosts entirely, so the two columns are not a before-and-after of
anything.

2012 is the hard year and it is worth saying why: OpenGraph and JSON-LD were not
yet universal, and sites had stopped emitting hAtom microformats. TechCrunch in
2012 printed `<div class="post-time">posted yesterday</div>` — a date no parser
can recover, only a URL can. At 72.5% it is the worst stratum in the corpus.
Three signals carry most of what is recoverable there: English ordinal suffixes
("November 1st, 2012"), WordPress's `post_date` read out of inlined script state,
and suppression of a newspaper's registration date lifted from a page footer.

By language, with the sample sizes stated because they matter more than the
percentages. Dev split first:

| language | n | accuracy |
| --- | ---: | ---: |
| de | 13 | 100.0% |
| es | 6 | 100.0% |
| pt | 57 | 100.0% |
| ru | 77 | 97.4% |
| en | 210 | 97.1% |
| ar | 23 | 95.7% |
| ja | 39 | 94.9% |
| it | 31 | 74.2% |
| unknown | 19 | 100.0% |

and the held-out split, which contains a different set of languages entirely
because hosts — not pages — are what the split assigns:

| language | n | accuracy |
| --- | ---: | ---: |
| de | 47 | 100.0% |
| en | 36 | 100.0% |
| fr | 62 | 98.4% |
| nl | 30 | 93.3% |
| it | 33 | 90.9% |
| ja | 16 | 62.5% |
| unknown | 29 | 62.1% |

`unknown` at 62.1% is the second-worst row here and deserves the same caution as
`ja`: it is not a language, it is 29 pages whose markup declares none, drawn from
whichever hosts omit `<html lang>`. It is a bucket, not a stratum.

**Every one of these rows is one or two hosts.** German is `deutsche-startups.de`
and `sprachlog.de`; Arabic is Al Jazeera; Spanish is six El País pages. A
language appears in whichever split its hosts hashed into, which is why French
and Dutch have no dev row and Russian, Arabic and Portuguese have no test row.
Read a row as "this template, in this language" — the corpus can now show that
the extractors are not silently English-only, which is what it was expanded to
show, but it cannot support a ranking of languages.

Two rows that look bad and mean different things:

- **`it` on dev, 74.2%.** All six misses are `ilpost.it` WordPress *attachment*
  pages — `/2012/11/01/article-slug/image-slug/` — photo permalinks with no date
  anywhere in the document. Returning nothing is arguably the correct answer; the
  label comes from a URL structure the page never restates.
- **`ja` on test, 62.5%.** This one is real. See the note on the residual
  overfitting gap above.

---

## 2. The htmldate corpus

Kept for continuity with [htmldate's published
table](https://github.com/adbar/htmldate). German-heavy news, and also that
project's unit-test set.

```
SAME 55 PAGES, SAME METRIC, CURRENT VERSIONS — publication date only

  tool                            exact  part  wrong  miss | precision  recall  accuracy  F-score   ms/page
  ---------------------------------------------------------------------------------------------------------
    htmldate (extensive)            53     0      2     0 |   96.4%   100.0%    96.4%    98.1%     73.98
    htmldate (fast)                 45     0      1     9 |   97.8%    83.3%    81.8%    90.0%     11.18
  ▸ pagedate (standard)             37     1      9     8 |   78.7%    82.2%    67.3%    80.4%      3.75
  ▸ pagedate (fast)                 14     3      4    34 |   66.7%    29.2%    25.5%    40.6%      1.57
    date_guesser                    14     0      8    33 |   63.6%    29.8%    25.5%    40.6%    113.25
    metascraper (with parse)        13     0     13    29 |   50.0%    31.0%    23.6%    38.2%     20.29
    metascraper (rules only)        13     0     13    29 |   50.0%    31.0%    23.6%    38.2%      6.67
    newspaper4k                     11     0      5    39 |   68.8%    22.0%    20.0%    33.3%    143.66
    articleDateExtractor            11     0      9    35 |   55.0%    23.9%    20.0%    33.3%     40.99
    @extractus/article-extractor     8     0     10    37 |   44.4%    17.8%    14.5%    25.4%     84.03
    unfluff                          8     0      1    46 |   88.9%    14.8%    14.5%    25.4%    119.12
    goose3                           4     0      2    49 |   66.7%     7.5%     7.3%    13.6%    133.80
```

**htmldate wins here and it is not close.** Partly home advantage, partly that it
is a genuinely better general-purpose extractor on news.

The two corpora agree on the ranking: htmldate leads both, by 29 points here and
4.0 on held-out permalink data. What differs is the margin, and the margin is the
interesting part — 29 points on the corpus curated around htmldate's own hard
cases, 4.0 on a corpus that is nobody's test set.

### htmldate is invoked with `original_date=True`

`find_date` takes an `original_date` flag. Left at its default it returns the
*most recent* date on the page; set, it returns the publication date. Every gold
label in both corpora here is a publication date, so the default asks a different
question from the one being scored.

Getting this wrong is worth roughly eleven points to htmldate — and it is not a
symmetric risk. htmldate is the only tool measured here with such a switch:
`newspaper4k` exposes `publish_date`, `articleDateExtractor` exposes
`extractArticlePublishedDate`, `@extractus` exposes `.published`, and none of
them can be asked for anything else. There is no equivalent mistake available to
make against anybody else, so the entire cost of it would fall on the one
competitor closest to us. It is called out here because a benchmark whose author
is an entrant should say out loud where the asymmetries are.

The honest summary of this project's accuracy claim is therefore: pagedate is
competitive with the best tool in this field and beats everything else, at a
quarter of htmldate's per-page cost — not that it leads.

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
    htmldate (fast)                 47     0      3     5 |   94.0%    90.4%    85.5%    92.2%   +3.6pt
    htmldate (extensive)            47     0      8     0 |   85.5%   100.0%    85.5%    92.2%  -10.9pt
  ▸ pagedate (standard)             42     1      8     4 |   82.4%    91.3%    76.4%    86.6%   +9.1pt
```

The notable result is not ours. **htmldate's extensive mode drops 10.9 points**
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
| pagedate (fast) | 1.5 ms | 10.6 ms |
| pagedate (standard) | 6.1 ms | 15.9 ms |
| htmldate (fast) | — | 11.2 ms |
| htmldate (extensive) | — | 75.5 ms |

Every figure here is a median of repeated passes taken after all modes have been
warmed, with the order rotated between rounds. That is not pedantry. Three modes
sharing most of their code cannot be separated by a stopwatch around each one:
whichever runs first pays to compile the parser adapters, the regex caches and
the resolver, and every later mode inherits that work. On 55 pages the bias this
removes is larger than the differences being measured.

Which number is honest depends entirely on where it runs:

- **In a browser extension the DOM already exists**, so nothing pays for parsing.
  The real cost is 1–7 ms, and htmldate cannot run there at any speed.
- **In Node the caller pays for parsing**, and that term dominates. The
  comparison there is really the parser, not the extractor.

### Could a faster parser help?

Not lxml — it is a Python C extension. Three Node parsers were measured on the
same pages:

| parser | parse | traverse | agrees with linkedom |
| --- | --- | --- | --- |
| linkedom | 10.34 ms | 2.25 ms | — |
| node-html-parser | 3.68 ms | 2.26 ms | **every page** |
| happy-dom | 42.36 ms | 7.82 ms | not measured (already slower) |

The Node path ships node-html-parser. Getting there meant removing every
extractor assumption about `parentElement`, `nextSibling` and `documentElement`
that only linkedom satisfied; what is left is DOM every implementation agrees on,
and the two parsers give identical answers on all 1242 permalink pages and all 55
htmldate pages.

`bench/parity.mjs` is the regression test for that, and it exits non-zero on any
disagreement.

### The parser the extension actually runs

Both parsers above are Node libraries, and neither is what the extension gets.
`bench/parity-browser.mjs` closes that: real Chromium, real `DOMParser`, the same
1242 corpus pages, through the same extractor bundle the content script carries,
compared against the Node path.

```
  real Chromium vs node-html-parser — 1242 pages

    same answer           1242
    DIFFERENT answer         0
```

What is still unmeasured is narrower than it was: Firefox's parser, and any page
whose DOM is built by JavaScript the archived capture never ran.

### The bugs parity cannot see

Parity compares final resolved dates, so a signal that degrades without changing
the answer passes it. Two parser quirks live in that blind spot, and both are why
the unit tests run against the parser the library ships — `documentFrom` in the
test helpers calls the library's own `parseHtml`:

**node-html-parser entity-decodes `<script>` bodies.** `<script>` is a raw-text
element — the spec says its contents are *not* decoded — so a JSON-LD block
containing `&quot;` parses as invalid JSON, is skipped as malformed, and the page
falls through to a weaker signal. Not a wrong date; a silently *worse* one, on
exactly the pages that had the strongest available answer. The extractor reads
`innerHTML` where it differs from `textContent` for that reason.

**linkedom does not lowercase attribute names.** BBC emits `<time dateTime="…">`
and linkedom's `getAttribute('datetime')` returns `null`, which makes 23 `<time>`
elements per page invisible. Anything measured through linkedom understates the
`<time>` signal.

---

## Fairness notes

`newspaper4k` and `goose3` both fetch images over the network during parsing by
default, which is work unrelated to date extraction and would be charged to their
ms/page. Both are invoked with it disabled. It costs newspaper4k nothing in
accuracy and roughly 5000 ms/page in time, and a benchmark that flatters its
author by mis-invoking the competition is worth nothing.

`unfluff` deserves a note in the other direction: 98.4% precision against 49.4%
accuracy on the held-out split. It almost never answers, and is nearly always
right when it does.

pagedate's `partial` column — a coarser-but-consistent answer such as `2016-12`
against `2016-12-23` — is scored as **wrong** in every table above. No other tool
produces them, because no other tool declines to invent precision.

`htmldate` is asked for a publication date rather than a most-recent date, which
is the question its `original_date` flag selects and the question every gold
label here poses. It is the only entrant with such a switch, so it is the only
one whose score depends on the harness author reading its API properly.

---

## Caveats

- **253 held-out pages is small.** One page is 0.4 points. Treat gaps under ~4
  points as noise. The 55-page corpus is far worse: one page is 1.8 points, so
  treat gaps under ~5 points there as noise.
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
