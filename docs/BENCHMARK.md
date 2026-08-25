# Benchmark

Every table here was measured against current versions on the same pages, and every one is reproduced by `./scripts/validate.sh` into `results/`.

Two corpora:

| | pages | labels | whose test set |
| --- | --- | --- | --- |
| **permalink** | 1248 | dated URL path (1236), feed `<pubDate>` (12) | nobody's |
| **htmldate** | 55 | hand-annotated | htmldate's own unit tests |

Rationale for the harness decisions described below is collected in [Method decisions](#method-decisions).

---

## 1. The permalink corpus

Pages harvested from the Wayback Machine by dated permalink, pinned to a capture, spanning 2005–2026, across 33 hosts and 10 declared languages plus a stratum that declares none. The label is the date in the URL path. See [CORPUS-BUILD.md](CORPUS-BUILD.md) for how it is built.

### URL neutralisation

The labels come from the URL, so any tool that reads URLs would be handed the answer. pagedate has `holdOut` for this; the competitors do not. Every tool therefore receives the same URL with the date segments blanked.

Blanking only the argument is insufficient, because every page restates its own permalink in `<link rel="canonical">`, `og:url`, JSON-LD `url`, inline JavaScript and numerous `<a href>` elements. Measured on the same pages:

| | URL argument blanked only | permalink blanked in the HTML too |
| --- | ---: | ---: |
| pagedate (standard) | 194 | 184 |
| htmldate (fast) | 192 | **163** |

Both read in-page URLs, to different degrees. The harnesses blank both, which makes these figures stricter than `score.ts` reports for production use, where reading a URL is legitimate.

### "Now" is the capture instant, per page

Every harness takes the current time from `entry.snapshot`, the moment the page was archived.

A fixed constant fails in one direction. The plausibility check discards dates in the future, so any page published after the constant has its correct declared date thrown away and scored as a miss. On this corpus that is the twelve pages captured during the 2026 harvest, six in each split and the whole of one host. The competitors are unaffected by the same constant, because none takes an injected clock: they read the system time, which is later than any capture here.

The capture instant is also stricter than what the competitors get, since it prevents a 2012 page accepting a 2015 date.

### Held-out test split — 253 pages

Hosts are assigned to dev and test by hash of the hostname, so a site tuned against cannot leak its templates into the held-out set.

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

htmldate is the control. It was tuned on none of this corpus and scores 7.0 points higher on the held-out hosts than on the dev ones; metascraper is +3.0. The two splits are therefore not equally hard, and the held-out set suits both. −6.7 is a gap against a baseline above zero. Part of it is tuning residue and part is that the test split is a different set of sites; two splits and one control cannot separate them.

One place the residue is visible: Japanese scores 94.9% on dev and 62.5% on test. The year-first format the dev hosts use is handled because those hosts were visible during development; the test pages are a different publisher whose markup is not.

One place the corpus cannot adjudicate at all: the label is itself a local-versus-UTC choice, made independently by each site's CMS. Two European papers here mint the permalink on one convention and print the byline on the other, and nothing in those documents decides which is the date. The `localise` rule wins pages on one split and loses them on the other, and neither outcome is evidence about the rule.

The residue is limited by the shape of the corpus. At 253 held-out pages across six languages no single site sets the number, and the extraction rules that carry across hosts are general ones: a date format, a class of furniture, a ranking rule for two declarations that disagree.

### The error columns

htmldate (extensive) never declines to answer: 0 misses, 17 wrong. pagedate declines on 13 pages and is wrong on 14. Its precision on answered pages is 94.2% against htmldate's 93.3%, a difference of two pages, which on 253 is noise.

Every page in this corpus has a date, so declining can only cost accuracy; there is no true negative to be scored for. Those 13 declines are 5.1 points, and pagedate trails by 4.0. That does not establish that pagedate would lead on a corpus containing undated pages, because no such benchmark exists to test it on. It does mean the headline gap is smaller than the abstention policy that produces it.

Which behaviour is better depends on whether a confidently wrong date costs more than no date, which a single-number leaderboard cannot express.

### By stratum

Publication era, dev split:

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

On the held-out split the era curve is flatter and lower — 66.7% in 2006 and 82.8% in 2009 against 100% on dev — but those strata are 12 and 29 pages from entirely different hosts, so the two columns are not a comparison.

2012 is the hardest year. OpenGraph and JSON-LD were not yet universal, and sites had stopped emitting hAtom microformats; TechCrunch in 2012 printed `<div class="post-time">posted yesterday</div>`, which no parser can recover. Three signals carry most of what is recoverable there: English ordinal suffixes ("November 1st, 2012"), WordPress's `post_date` read out of inlined script state, and suppression of a newspaper's registration date lifted from a page footer.

By language, dev split:

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

Held-out split, which contains a different set of languages because hosts rather than pages are what the split assigns:

| language | n | accuracy |
| --- | ---: | ---: |
| de | 47 | 100.0% |
| en | 36 | 100.0% |
| fr | 62 | 98.4% |
| nl | 30 | 93.3% |
| it | 33 | 90.9% |
| ja | 16 | 62.5% |
| unknown | 29 | 62.1% |

Every row is one or two hosts. German is `deutsche-startups.de` and `sprachlog.de`; Arabic is Al Jazeera; Spanish is six El País pages. A language appears in whichever split its hosts hashed into, which is why French and Dutch have no dev row and Russian, Arabic and Portuguese have no test row. A row states "this template, in this language". The corpus can show that the extractors are not silently English-only, which is what it was expanded to show; it cannot support a ranking of languages.

`unknown` at 62.1% is not a language. It is 29 pages whose markup declares none, drawn from whichever hosts omit `<html lang>`.

Two rows with different causes:

- **`it` on dev, 74.2%.** All six misses are `ilpost.it` WordPress attachment pages — `/2012/11/01/article-slug/image-slug/` — photo permalinks with no date anywhere in the document. The label comes from a URL structure the page never restates.
- **`ja` on test, 62.5%.** Residual overfitting, described above.

---

## 2. The htmldate corpus

Retained for continuity with [htmldate's published table](https://github.com/adbar/htmldate). German-heavy news, and that project's unit-test set.

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

htmldate leads by 29 points here, partly through home advantage and partly because it is a better general-purpose extractor on news.

The two corpora agree on the ranking and differ in the margin: 29 points on the corpus curated around htmldate's own hard cases, 4.0 on a corpus that is nobody's test set.

### htmldate is invoked with `original_date=True`

`find_date` takes an `original_date` flag. Left at its default it returns the most recent date on the page; set, it returns the publication date. Every gold label in both corpora is a publication date.

The flag is worth roughly eleven points to htmldate. It is also the only such switch among the tools measured: `newspaper4k` exposes `publish_date`, `articleDateExtractor` exposes `extractArticlePublishedDate`, `@extractus` exposes `.published`, and none can be asked for anything else. There is no equivalent mistake available against any other entrant, so the entire cost of getting it wrong would fall on the competitor closest to this project.

The resulting accuracy claim is that pagedate is competitive with the best tool in this field and ahead of the rest, at a quarter of htmldate's per-page cost — not that it leads.

### The other tools score below htmldate's published table

| tool | their table | measured here |
| --- | --- | --- |
| articleDateExtractor | 65.6% | 20.0% |
| date_guesser | 54.4% | 25.5% |
| goose3 | 54.5% | 7.3% |
| newspaper4k | 68.0% | 20.0% |

The most likely explanation is corpus selection. Their table covers 1000 pages, only around 55 annotated pages are publicly reachable, and those are also their unit-test set — pages kept because they are awkward. A set curated around one tool's hard cases flatters that tool. If that is right, every non-htmldate number here, including this project's, is understated relative to the full corpus. It cannot be verified without the missing 745 pages.

Simple decay is a second possibility; several of these tools have not been updated in years. Both can be true.

### Six gold entries are wrong

Dates belonging to other documents, crawl-time artifacts, and a "last revised" date scored as publication. They are corrected in [`corpus-external/corrections.json`](../corpus-external/corrections.json) with quoted evidence for each, and scored as a second table alongside the original rather than replacing it.

```
  SAME RUNS, 6 GOLD ENTRIES CORRECTED

  tool                            exact  part  wrong  miss | precision  recall  accuracy  F-score
  ---------------------------------------------------------------------------------------------
    htmldate (fast)                 47     0      3     5 |   94.0%    90.4%    85.5%    92.2%   +3.6pt
    htmldate (extensive)            47     0      8     0 |   85.5%   100.0%    85.5%    92.2%  -10.9pt
  ▸ pagedate (standard)             42     1      8     4 |   82.4%    91.3%    76.4%    86.6%   +9.1pt
```

htmldate's extensive mode drops 10.9 points under the corrected key, because it reports artifact dates where the correct answer is none, and converges exactly with its own fast mode. Its extra recall is therefore spent on dates that should not be found.

Caveats: this project is the author of both the library and the corrections; six pages on a 55-page corpus is a large lever; and the per-page evidence is in the file so each call can be disputed. `eff.org.2015` was considered and left alone as weak rather than wrong.

---

## Speed

| | extraction only | including HTML parsing |
| --- | ---: | ---: |
| pagedate (fast) | 1.5 ms | 10.6 ms |
| pagedate (standard) | 6.1 ms | 15.9 ms |
| htmldate (fast) | — | 11.2 ms |
| htmldate (extensive) | — | 75.5 ms |

Every figure is a median of repeated passes taken after all modes have been warmed, with the order rotated between rounds. Three modes sharing most of their code cannot be separated by a stopwatch around each one: whichever runs first pays to compile the parser adapters, the regex caches and the resolver, and every later mode inherits that work. On 55 pages the bias this removes is larger than the differences being measured.

Which column applies depends on the environment. In a browser extension the DOM already exists, so nothing pays for parsing and the real cost is 1–7 ms; htmldate cannot run there. In Node the caller pays for parsing and that term dominates, so the comparison is largely between parsers.

### Parser choice

lxml is not available, being a Python C extension. Three Node parsers were measured on the same pages:

| parser | parse | traverse | agrees with linkedom |
| --- | --- | --- | --- |
| linkedom | 10.34 ms | 2.25 ms | — |
| node-html-parser | 3.68 ms | 2.26 ms | **every page** |
| happy-dom | 42.36 ms | 7.82 ms | not measured (already slower) |

The Node path ships node-html-parser. Reaching that meant removing every extractor assumption about `parentElement`, `nextSibling` and `documentElement` that only linkedom satisfied. The two parsers give identical answers on all 1242 permalink pages and all 55 htmldate pages, and `bench/parity.mjs` is the regression test, exiting non-zero on any disagreement.

### The parser the extension runs

Both parsers above are Node libraries; neither is what the extension gets. `bench/parity-browser.mjs` runs real Chromium and its `DOMParser` over the same 1242 corpus pages, through the same extractor bundle the content script carries, and compares against the Node path.

```
  real Chromium vs node-html-parser — 1242 pages

    same answer           1242
    DIFFERENT answer         0
```

Unmeasured: Firefox's parser, and any page whose DOM is built by JavaScript the archived capture never ran.

### Bugs parity cannot see

Parity compares final resolved dates, so a signal that degrades without changing the answer passes it. Two parser quirks sit in that blind spot, and both are why the unit tests run against the parser the library ships (`documentFrom` in the test helpers calls the library's own `parseHtml`):

**node-html-parser entity-decodes `<script>` bodies.** `<script>` is a raw-text element whose contents are not decoded, so a JSON-LD block containing `&quot;` parses as invalid JSON, is skipped as malformed, and the page falls through to a weaker signal — a silently worse answer on exactly the pages that had the strongest one available. The extractor reads `innerHTML` where it differs from `textContent` for that reason.

**linkedom does not lowercase attribute names.** BBC emits `<time dateTime="…">` and linkedom's `getAttribute('datetime')` returns `null`, making 23 `<time>` elements per page invisible. Anything measured through linkedom understates the `<time>` signal.

---

## Fairness notes

`newspaper4k` and `goose3` both fetch images over the network during parsing by default, which is work unrelated to date extraction and would be charged to their ms/page. Both are invoked with it disabled. It costs newspaper4k nothing in accuracy and roughly 5000 ms/page in time.

`unfluff` scores 98.4% precision against 49.4% accuracy on the held-out split: it rarely answers, and is nearly always right when it does.

pagedate's `partial` column — a coarser but consistent answer such as `2016-12` against `2016-12-23` — is scored as wrong in every table above. No other tool produces them, because no other tool declines to invent precision.

`htmldate` is asked for a publication date rather than a most-recent date, as described above.

---

## Caveats

- **253 held-out pages is small.** One page is 0.4 points; treat gaps under about 4 points as noise. The 55-page corpus is worse: one page is 1.8 points, so treat gaps under about 5 points there as noise.
- **Labels are silver, not gold.** They come from URL structure, not human adjudication.
- **Permalink labels carry ±1 day of timezone noise.** A post published at 23:30 local gets a local-date URL and a UTC `article:published_time`, and both are correct. Roughly 3% of entries sit on this boundary. `--tolerance 1` reports the other reading; both are printed.
- **Publication date only.** Modified dates, confidence tiers and conflict detection are measured by none of this.
- **True negatives are unmeasurable on both corpora.** Every page in each has a determinable date, so a tool that correctly answers "there is none" scores nothing for it. Only the 17-fixture local corpus tests that, and 5 of those 17 are negative cases.

## Method decisions

| Decision | Rationale |
| --- | --- |
| Run the benchmarks rather than cite published tables | A published table is a snapshot: versions move, tools break, and the corpus behind it may not be reachable |
| Two corpora kept, not one | They fail differently. The permalink corpus rewards year-first formats, furniture rejection and ranking rules; the external one is bare `DD.MM.YYYY` in unmarked markup, dates inside an `href` or an `<input value>`, and six wrong gold labels |
| Blank the permalink in the HTML as well as the argument | Otherwise the benchmark ranks tools by how hard they hunt for a URL rather than by how well they read a document |
| Take "now" from each page's capture instant | A fixed constant discards the declared dates of pages published after it, and only for the one entrant that accepts an injected clock |
| Split by hash of hostname | Splitting by page would put a site's template on both sides |
| Report the dev/test gap with a control | With two splits and one control, tuning residue and split difficulty cannot be separated; reporting the gap without a control implies they can |
| Invoke htmldate with `original_date=True` | It is the flag that selects the question every gold label poses, and htmldate is the only entrant that has one |
| Disable competitors' image fetching | It is work unrelated to date extraction that would be charged to their per-page time |
| Score `partial` answers as wrong | It is the strict reading, and it penalises only this project, since no other tool emits them |
| Correct the six gold entries in a second table, never in place | Editing an answer key and reporting one number measures nothing |
| Rotate mode order and warm before timing | Modes sharing code otherwise charge the first one for work all of them inherit; on 55 pages that bias exceeds the differences being measured |
| Test through the parser that ships | Two parser quirks change which signal wins without changing the final answer, so parity alone cannot catch them |

## Reproducing

```bash
./scripts/validate.sh
```

Or piecemeal — see the README's Reproducing section. `corpus/cache/` is gitignored and rebuilt from the committed manifest by `scripts/corpus/fetch.ts`; `scripts/corpus/verify.ts` confirms the result is byte-identical to what these figures were measured on.
