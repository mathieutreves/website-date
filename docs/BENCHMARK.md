# Benchmark

Run, not cited. A published table is a snapshot — versions move on, tools break,
and the corpus behind it may not be reachable. Everything below was measured
against current versions on the same pages, and every table here is reproduced
by `./scripts/validate.sh` into `results/`.

Two corpora, because one of them is the other project's test set:

| | pages | labels | whose test set |
| --- | --- | --- | --- |
| **permalink** | 4302 | dated URL path (4136), feed `<pubDate>` (12), no date (154, unreviewed) | nobody's |
| **htmldate** | 55 | hand-annotated | htmldate's own unit tests |

---

## 1. The permalink corpus

Pages harvested from Wayback by dated permalink, pinned to a capture, 2005–2026,
364 hosts, 19 languages. The label is the date in the URL path — a signal no HTML
extractor reads, which is the entire point. See
[CORPUS-BUILD.md](CORPUS-BUILD.md) for how it is built and why labels are the
hard part.

**Read the funnel, not just the total.** 4302 entries across 364 hosts, 4215 of
them with a capture on disk, and a headline figure is computed over the pages within 30 days of capture
whose label is recoverable from the document — 847 on dev, 197 on diag, 566 held
out. The rest are excluded rather than scored as failures, and every run prints
the funnel. The exclusion rule is a judgement call with a measurable effect;
`--include-unanswerable` reports the other end of it, 88.4% against 92.8% on dev.

**Three splits, not two.** Hosts hash to `dev`, `diag` or `test`. `diag` exists
so a surprising number can be investigated on unfamiliar hosts without spending
the held-out set, which is the resource that cannot be replaced once looked at.

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

### Held-out test split — 566 pages, 68 hosts

Hosts are assigned by hash of the hostname, so a site tuned against cannot leak
its templates into the held-out set. **This is the number that counts.**

```
  tool                            exact  part  wrong  miss    TN   FP | precision  accuracy  useful   ms/page
  -----------------------------------------------------------------------------------------------------------
    htmldate (extensive)           521     0     45     0     0    0 |   92.0%    92.0%    92.0%     23.29
  ▸ pagedate (extensive)           505     0     38    23     0    0 |   93.0%    89.2%    89.2%     37.25
  ▸ pagedate (standard)            496     0     37    33     0    0 |   93.1%    87.6%    87.6%     38.04
    htmldate (fast)                484     0     36    46     0    0 |   93.1%    85.5%    85.5%      7.24
    articleDateExtractor           403     0     41   122     0    0 |   90.8%    71.2%    71.2%     45.29
    metascraper                    395     0     87    84     0    0 |   82.0%    69.8%    69.8%     17.48
  ▸ pagedate (fast)                375     0     19   172     0    0 |   95.2%    66.3%    66.3%     35.13
    newspaper4k                    364     0     14   188     0    0 |   96.3%    64.3%    64.3%    157.50
    @extractus/article-extractor   352     0     47   167     0    0 |   88.2%    62.2%    62.2%    122.13
    goose3                         312     0     11   243     0    0 |   96.6%    55.1%    55.1%    123.12
    unfluff                        283     0     12   271     0    0 |   95.9%    50.0%    50.0%    114.28
    date_guesser                   274     0     52   240     0    0 |   84.0%    48.4%    48.4%    144.94
```

The `TN`/`FP` columns are structurally zero here, and that is the single most
important caveat on this table: no page in this split lacks a date, so declining
to answer can only lose points and inventing one cannot be charged. See
[§ The negative tier](#the-negative-tier-and-what-it-costs-us).

**The ms/page column is not comparable to earlier editions of this file.** These
runs were made on a loaded machine with several benchmarks in flight; the
per-tool ordering is meaningful but the absolute values are inflated relative to
the isolated timings in the Speed section.

### Disclosure: this split was scored before tuning finished

`CONTRIBUTING.md` says to measure on dev, report on test, and say so in the pull
request if the held-out pages have been looked at. They have: the held-out split
was scored partway through the session that produced these numbers, and
extraction work — ordinal-suffix parsing, byline patterns, index-page detection —
continued against `dev` afterwards.

Knowing the held-out figure while tuning is what the split exists to prevent, so
this is a weaker estimate than a first-and-only scoring would be. It is recorded
here rather than quietly reported because a benchmark whose author is an entrant
has no other defence. The `diag` pool exists so that the next round of failure
investigation does not have to spend the held-out set again.

### The dev/test gap

| | dev (tuned on) | test (held out) | Δ |
| --- | ---: | ---: | ---: |
| pagedate (standard) | 93.2% | 87.6% | **−5.6** |
| htmldate (extensive) | 85.4% | 92.0% | **+6.6** |
| metascraper | 63.0% | 69.8% | +6.8 |

A gap between the two splits is what tuning on a corpus and reporting on it looks
like, so its size is the number to read rather than either figure alone.

**The two figures invert the ranking, which is the whole reason both are here.**
On dev, pagedate leads htmldate by 7.8 points. Held out, it trails by 4.4. Anyone
quoting the dev table would be quoting the tuning.

htmldate is the control, and its **+6.6** constrains how −5.6 can be read. A tool
tuned on none of this does *better* on the held-out hosts than on the dev ones,
and metascraper's +6.8 points the same way: the two splits are not equally hard,
and the held-out set suits both of them. So −5.6 is a gap against a baseline
somewhere above zero, not against zero. Part of it is tuning residue and part is
that the test split is a different set of sites; two splits and one control
cannot separate them — which is what the third pool is for.

**Where the residue is visible.** English is the largest stratum and the worst
one held out, at 84.2% against 90–100% for German, French, Italian and Dutch. It
carries 30 of the 37 wrong answers and 19 of the 33 misses. That is where the
work is, and it is not a multilingual problem.

**And one place the corpus cannot adjudicate at all.** Reporting a UTC
declaration in the day the site shows its own readers is right in general — a
publication date is a civil date somewhere, and UTC is not automatically that
somewhere — but the label in this corpus *is* a local-versus-UTC choice, made
independently by each site's CMS. Two European papers here mint the permalink on
one convention and print the byline on the other, and nothing in those documents
decides which is "the" date. The rule wins pages on one split and loses them on
the other, and neither outcome is evidence about the rule.

The residue is small mostly because of how the corpus is shaped. At 566 held-out
pages across 68 hosts, no single site sets the number; the extraction rules
that carry across hosts are general ones — a date format, a class of furniture,
a ranking rule for two declarations that disagree — and general rules transfer to
held-out hosts where per-site patches do not.

### Read the error columns, not just the accuracy

htmldate (extensive) never declines to answer: 0 misses, 45 wrong. pagedate
declines on 33 pages and is wrong on 37. Its precision on answered pages is
93.1% against htmldate's 92.0% — a difference of six pages, which on 566 is
at the edge of noise.

Note what declining costs pagedate here. Every page in this split *has* a date,
so it can only lose points — there is no true negative to be scored for. Those 33
declines are 5.8 points, and pagedate trails by 4.4. That does not prove it would
lead on a corpus containing undated pages; it does mean the headline gap is
smaller than the abstention policy that produces it, and a reader should not take
the ranking as settling which behaviour is better.

**This is no longer purely hypothetical, and the first evidence is against us.**
See the next section.

### The negative tier, and what it costs us

154 pages with no publication date — homepages and section fronts, which have no
publication date of their own — are harvested and awaiting human review. They are
not in any table above and score nowhere until a person confirms the labels,
because `CONTRIBUTING.md` forbids a model adjudicating the answer key and a
negative label is the one kind whose error silently *rewards* abstention.

A preview run against those unreviewed labels is worth recording anyway, because
it points the wrong way for this project's central claim:

| | dev, dated only | dev, with unreviewed negatives |
| --- | ---: | ---: |
| pagedate (standard) | 92.8% | 89.9% |
| correct refusals (TN) | — | 38 |
| **invented dates (FP)** | — | **32 of 70** |

**pagedate invents a date on 46% of the pages whose correct answer is "none".**
What it returns is the date of the newest article in the listing: before
index-page detection the sources were `marked-date` (20), `time-tag` (14),
`text-date` (7) and `visible-text` (5) — the top item of a feed, read as a byline.
That detection cut the rate from 59% to 46%; the rest is open.

Four of the remaining false positives come from `opengraph` at `declared`
confidence, and those are deliberately not suppressed: a homepage carrying
`article:published_time` is the *site* stating something wrong, and discarding a
declared value on a heuristic verdict about page shape would invert the
confidence tiers the library rests on.

Two things follow. First, a library whose pitch is that it declines to invent had
never been measured on pages where inventing is possible — the corpus made that
structurally impossible, exactly as this document criticises htmldate's corpus
for doing. Second, the preview is biased *in our favour* if the labels are wrong,
since pagedate abstains more than anything else here, which is why it stays a
preview until reviewed.

Which is better is not a benchmark question. It depends on whether a confidently
wrong date costs you more than no date — and that is precisely why this library
reports a confidence tier rather than a single value. A single-number leaderboard
cannot express the difference, which is a limitation of the leaderboard.

### By stratum

Publication era — the interesting axis, because markup conventions changed
underneath the whole problem. Both splits, since with 364 hosts the era curve is
now the same shape on each:

| era | dev n | dev | test n | test |
| --- | ---: | ---: | ---: | ---: |
| 2006 | 19 | 94.7% | 14 | 50.0% |
| 2009 | 59 | 88.1% | 32 | 75.0% |
| 2012 | 108 | 82.4% | 46 | 60.9% |
| 2015 | 143 | 89.5% | 113 | 89.4% |
| 2018 | 85 | 97.6% | 84 | 91.7% |
| 2021 | 155 | 98.1% | 102 | 97.1% |
| 2023 | 132 | 97.0% | 89 | 94.4% |
| 2025 | 144 | 94.4% | 80 | 92.5% |

**The era curve is the clearest signal in this corpus, and it is monotone.**
Everything from 2018 onward sits above 91% on both splits; everything before 2015
falls away, to 50% for 2006 held out. That is not a tuning artifact — it is the
web before OpenGraph and JSON-LD were universal and after sites had stopped
emitting hAtom microformats.

2006–2012 held out is where a third of all remaining error lives, on 92 pages.
TechCrunch in 2012 printed `<div class="post-time">posted yesterday</div>` — a
date no parser can recover, only a URL can. Three signals carry most of what *is*
recoverable there: English ordinal suffixes ("November 1st, 2012"), WordPress's
`post_date` read out of inlined script state, and suppression of a newspaper's
registration date lifted from a page footer.

Anyone reading these figures as a guide to production use should note that the
weak strata are old pages, and weight accordingly: a crawler over the current web
meets the 2021+ rows, and an archive project meets the 2006 one.

By language, with the sample sizes stated because they matter more than the
percentages. Dev split first:

| language | n | accuracy |
| --- | ---: | ---: |
| de | 14 | 100.0% |
| pt | 59 | 100.0% |
| zh | 9 | 100.0% |
| ja | 39 | 94.9% |
| ru | 88 | 94.3% |
| en | 549 | 93.3% |
| ar | 24 | 91.7% |
| fr | 9 | 88.9% |
| no | 9 | 88.9% |
| it | 38 | 81.6% |
| es | 5 | 20.0% |

and the held-out split:

| language | n | accuracy |
| --- | ---: | ---: |
| de | 47 | 100.0% |
| zh | 17 | 100.0% |
| es | 7 | 100.0% |
| ar | 5 | 100.0% |
| ru | 4 | 100.0% |
| fr | 66 | 95.5% |
| nl | 30 | 93.3% |
| it | 52 | 90.4% |
| en | 322 | 84.2% |
| ja | 13 | 76.9% |

**English is the largest stratum and the worst large one held out.** At 322 pages
it is the only row here big enough to be a measurement rather than a hint, and it
carries 30 of the 37 wrong answers and 19 of the 33 misses. The multilingual
support is not what needs work; the English long tail is.

**Spanish at 20% on dev is four pages of `elconfidencial.com`**, all wrong by one
or two days, on a template that dates its own `/pass_<hash>/` permalinks
inconsistently. On five pages that is an anecdote, and it is reported rather than
dropped because dropping the rows that look bad is how a benchmark stops meaning
anything.

**Most rows are one or two hosts.** A language appears in whichever split its
hosts hashed into, which is why Russian is 88 pages on dev and 4 held out. Read a
row as "this template, in this language" — the corpus can show that the
extractors are not silently English-only, which is what it was expanded to show,
but it cannot support a ranking of languages.

**The strata themselves were wrong until recently, and one conclusion with them.**
`strata.lang` was filled from `<html lang>` with a TLD fallback, which put 606
pages into a single `unknown` bucket containing `japanese.engadget.com` and
`cctv.com` alongside English blogs. Reading the page's own text cut that to 95 and
surfaced Chinese, Hebrew, Czech and Finnish. It also deleted a finding: German
read 58.3% before, which looked like a real weakness in the language the external
corpus is built from, and was `ipcc.ch` — a Swiss domain publishing in English —
being filed as German by its TLD. German is 100% on both splits.

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
and the two parsers agree on 4211 of the 4215 permalink pages and on all 55
htmldate pages. They agreed on every page when the corpus was 1242; the four
exceptions arrived with the Tranco harvest and are unresolved.

`bench/parity.mjs` is the regression test for that, and it exits non-zero on any
disagreement. It runs the library's own `parseHtml` rather than importing
node-html-parser directly — measuring a parser the Node path does not ship is the
same mistake this check exists to prevent, in the opposite direction.

### The parser the extension actually runs

Both parsers above are Node libraries, and neither is what the extension gets.
`bench/parity-browser.mjs` closes that: real Chromium, real `DOMParser`, the same
corpus pages, through the same extractor bundle the content script carries,
compared against the Node path.

```
  real Chromium vs node-html-parser — 1242 pages

    same answer           1242
    DIFFERENT answer         0
```

That run predates the corpus expansion and covers the original 1242 pages; the
2973 pages added since have not been through a browser.

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

### One bug parity did catch, once the corpus was big enough

**node-html-parser loses the rest of the document when a raw-text element's
opening and closing tags differ in case.** Minimal repro:

```html
<SCRIPT>var a=1;</script><p>after</p>   <!-- <p> is lost -->
<script>var a=1;</SCRIPT><p>after</p>   <!-- <p> is lost -->
```

Matching case parses correctly either way, so it is the mismatch and not the
uppercase. HTML tag names are case-insensitive, so this is a spec violation;
linkedom handles all four spellings. It is not a rounding error: `techtarget.com`
writes `<SCRIPT LANGUAGE="JavaScript">` closed by `</script>`, and 65 kB of HTML
becomes **three elements** — after which the extractors correctly report no date
on a page that has one.

`parseHtml` lowercases the four raw-text tag names before parsing, which costs
0.12 ms of a 3.30 ms parse. `test/hardening.test.ts` covers both mismatch
directions so the workaround cannot be dropped silently, including by a parser
bump that makes it unnecessary.

Two things about how this was found are worth recording, because both are
arguments for the checks rather than for the fix:

- **It survived a year of passing parity runs.** Every affected page arrived in
  the Tranco harvest; none was in the original 1248. Tripling the corpus is what
  surfaced it, and "the parsers agree on every page" was true when written.
- **`bench/parity.mjs` was testing the wrong parser.** It imported `parse` from
  node-html-parser directly rather than the library's `parseHtml`, so it measured
  a code path no caller runs — half the disagreements it reported were in a
  parser the Node path does not ship. It now calls `parseHtml`, for the same
  reason the unit tests do.

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
against `2016-12-23` — is **correct at the precision the page offered**, and is
counted neither as a hit nor as a miss. `accuracy` stays exact-only so it remains
comparable with every published figure in this field; the `useful` column credits
partials, and answers "did the tool say something true". No other tool here can
score a `partial`, because none of them will emit `2016-12` rather than an
invented `2016-12-01`, so on their rows the two columns are equal by
construction. That equality is the difference being shown.

Scoring a partial as wrong — which these tables previously did — had the effect
of penalising the library for the one behaviour this document spends most of its
length defending.

**Tolerance applies to every tool or to none.** `--tolerance 1` lives in
`scripts/tally.ts`, which renders all tools from the same rows, rather than in
`score.ts`, which scores pagedate alone. The distinction is not cosmetic: the
±1 day figures quoted for pagedate had never been computed for a competitor, and
putting one beside another tool's strict number would compare a lenient measure
of ourselves against a strict measure of everyone else. Both columns are reported
below, for all entrants.

`htmldate` is asked for a publication date rather than a most-recent date, which
is the question its `original_date` flag selects and the question every gold
label here poses. It is the only entrant with such a switch, so it is the only
one whose score depends on the harness author reading its API properly.

---

## Caveats

- **566 held-out pages is small.** One page is 0.18 points. Treat gaps under ~2
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
- **True negatives are unmeasurable in every table above.** Every page scored has
  a determinable date, so a tool that correctly answers "there is none" scores
  nothing for it and a tool that invents one is charged nothing. The 154-page
  negative tier that would close this is harvested and unreviewed; the preview
  against it is in § The negative tier, and it is the least flattering number in
  this document. Until those labels are checked, the 17-fixture local corpus is
  the only place this behaviour is tested, and 5 of those 17 are negative cases.
- **The held-out split was scored before tuning finished.** See the disclosure
  above; this figure is a weaker estimate than a first-and-only scoring.

## Reproducing

```bash
./scripts/validate.sh
```

Or piecemeal — see the README's Reproducing section. `corpus/cache/` is
gitignored and rebuilt from the committed manifest by `scripts/corpus/fetch.ts`;
`scripts/corpus/verify.ts` confirms the result is byte-identical to what these
figures were measured on.
