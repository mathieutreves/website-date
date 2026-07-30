#!/usr/bin/env python3
"""
Run every installed Python date extractor over the cached corpus.

Emits one JSON line per (tool, page). Written to be run against *current*
versions rather than trusting a published table: the tools have moved on since
that table was generated, and some of them have moved backwards.

  python3 scripts/bench_python.py                    > /tmp/bench-python.jsonl
  python3 scripts/bench_python.py --corpus permalink > /tmp/bench-python-corpus.jsonl

Two corpora, because one of them is the other project's test set:

  htmldate   corpus-external/htmldate — 55 cached pages of mostly German news,
             selected by htmldate as its own unit tests
  permalink  corpus/ — pages harvested from Wayback by dated permalink, across
             more years, languages and site types, and nobody's test set

On the permalink corpus **the URL is neutralised for every tool**, because the
labels were read out of the URL path. A tool that reads URLs would otherwise be
handed the answer. htmldate is given no URL at all by this harness, but
newspaper4k, date_guesser and articleDateExtractor all take one.

The permalink is blanked in the HTML as well — see neutralise_html for why doing
only the argument measures the wrong thing.
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import warnings
from contextlib import redirect_stderr, redirect_stdout
from urllib.parse import urlsplit, urlunsplit

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "corpus-external", "htmldate")
CACHE = os.path.join(CORPUS, "cache")

DATE_PATH = re.compile(r"/(19|20)\d{2}/\d{1,2}/\d{1,2}(?=/|$)")
DATE_SLUG = re.compile(r"/(19|20)\d{2}-\d{2}-\d{2}")
# The same shapes as they appear inside a document rather than in the argument.
HTML_PATH = re.compile(r"/(19|20)\d{2}/\d{1,2}/\d{1,2}(?=[/\"'<\s])")


def neutralise(raw_url: str) -> str:
    """Blank date-shaped path segments so no tool can read the label off the URL."""
    parts = urlsplit(raw_url)
    path = DATE_SLUG.sub("/yr-mo-dy", DATE_PATH.sub("/yr/mo/dy", parts.path))
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def neutralise_html(html: str) -> str:
    """Blank the dated permalink where the document repeats it.

    Blanking only the URL argument does not stop a tool reading the label: every
    page here restates its own permalink in <link rel="canonical">, og:url and
    dozens of hrefs. Measured on the dev split, applying this costs pagedate
    194 -> 184 and htmldate (fast) 192 -> 163. Both read in-page URLs; the point
    is how differently, so leaving them in would rank the tools by how hard they
    hunt for a URL rather than by how well they read a document.

    A leading slash is required so a date written as text is left alone.
    """
    return DATE_SLUG.sub("/yr-mo-dy", HTML_PATH.sub("/yr/mo/dy", html))


def split_of(host: str) -> str:
    """Same host-level split as scripts/corpus/schema.ts, so the two report on the
    same pages.

    Three pools, not two. `test` keeps the predicate it always had — digest[0] %
    3 — so every held-out figure ever published from this corpus still describes
    the same set of hosts; only the dev side is subdivided, on an independent
    byte, to carve out a `diag` pool that may be read and investigated.

    This is a hand-kept copy of a TypeScript function, which is a real risk. The
    JS harness imports the original; Python cannot, so if you change one, change
    both. `scripts/corpus/agreement.ts` is not a check on this — nothing is.
    """
    digest = hashlib.sha1(host.encode()).digest()
    if digest[0] % 3 == 0:
        return "test"
    return "diag" if digest[1] % 4 == 0 else "dev"


def norm(value) -> str | None:
    """Reduce whatever a tool returns to YYYY-MM-DD, or None."""
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if not text or text.lower() in {"none", "nat"}:
        return None
    return text[:10] if len(text) >= 10 and text[4] == "-" and text[7] == "-" else None


def build_tools():
    tools = {}

    try:
        from htmldate import find_date

        # original_date=True, because every gold label in both corpora is a
        # *publication* date and that is the flag which asks for one. Left at its
        # default, htmldate returns the most recent date on the page instead,
        # which is a different question and one nothing here is scoring.
        #
        # Getting this wrong is worth ~11 points to htmldate and is not a
        # symmetric risk: every other tool in this file exposes only a
        # publication date — `publish_date`, `extractArticlePublishedDate`,
        # `.published` — so htmldate is the only one with a switch to set
        # correctly, and the only one a harness author can under-serve.
        tools["htmldate (fast)"] = lambda html, url: find_date(
            html, extensive_search=False, original_date=True
        )
        tools["htmldate (extensive)"] = lambda html, url: find_date(
            html, extensive_search=True, original_date=True
        )
    except Exception:
        pass

    try:
        from newspaper import Article

        def newspaper_date(html, url):
            # fetch_images defaults on and makes real network requests while
            # parsing, which would charge this tool ~1s/page it does not spend
            # doing the job being measured.
            article = Article(url or "https://example.com/", fetch_images=False)
            article.download(input_html=html)
            article.parse()
            return article.publish_date

        tools["newspaper4k"] = newspaper_date
    except Exception:
        pass

    try:
        from goose3 import Goose

        # Same reason as newspaper4k: image fetching is network I/O unrelated
        # to date extraction.
        goose = Goose({"enable_image_fetching": False})

        def goose_date(html, url):
            return goose.extract(raw_html=html).publish_date

        tools["goose3"] = goose_date
    except Exception:
        pass

    try:
        from date_guesser import guess_date

        tools["date_guesser"] = lambda html, url: guess_date(
            url=url or "https://example.com/", html=html
        ).date
    except Exception:
        pass

    try:
        import articleDateExtractor

        tools["articleDateExtractor"] = lambda html, url: articleDateExtractor.extractArticlePublishedDate(
            url or "https://example.com/", html
        )
    except Exception:
        pass

    return tools


def load_htmldate_pages():
    with open(os.path.join(CORPUS, "eval_default.json"), encoding="utf-8") as handle:
        index = json.load(handle)
    cached = set(os.listdir(CACHE))
    for url, entry in index.items():
        if entry["file"] not in cached:
            continue
        path = os.path.join(CACHE, entry["file"])
        # Never blanked: these labels were hand-annotated from the documents, not
        # read out of the URL, so there is no permalink to hold out.
        yield entry["file"], url, path, entry["date"], False


def load_permalink_pages(split: str, max_lag: int, include_unreviewed: bool = False):
    """The harvested corpus, filtered exactly as score.ts filters it.

    Entries whose label appears nowhere in the page are dropped: with the URL
    neutralised no tool could recover them, so scoring them would punish every
    tool equally for correctly finding nothing.

    Negative entries — pages asserted to have no publication date — are kept and
    yielded with a gold of None. They are the tier that makes an invented date
    visible, and a filter testing `entry["label"]["published"]` for truth drops
    every one of them.

    The fourth element of each tuple is the gold date or None; the fifth says
    whether the permalink must be blanked in the HTML, which is per entry and
    comes from `holdOut`. A feed-labelled entry keeps its real URL, because its
    label did not come from there.
    """
    manifest = os.path.join(ROOT, "corpus", "manifest.jsonl")
    cache = os.path.join(ROOT, "corpus", "cache")
    with open(manifest, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            entry = json.loads(line)
            if not entry.get("fetch"):
                continue
            negative = entry["label"].get("source") == "none" or entry["label"].get("published") is None
            if negative:
                # Only negatives a person has confirmed are scored. An
                # unreviewed one that is wrong hands every tool a false positive
                # on a page that does have a date — see isScorableNegative.
                if not include_unreviewed and entry["label"].get("review") != "confirmed":
                    continue
            elif not entry["label"].get("published"):
                continue
            if split != "all" and split_of(entry["strata"]["host"]) != split:
                continue
            # Neither lag nor labelInPage is defined for a page with no date.
            if not negative and entry["captureLagDays"] > max_lag:
                continue
            if not negative and entry["strata"].get("labelInPage") is False:
                continue
            path = os.path.join(cache, f"{entry['id']}.html")
            if not os.path.exists(path):
                continue
            blank = "url-slug" in entry.get("holdOut", [])
            url = neutralise(entry["url"]) if blank else entry["url"]
            yield entry["id"], url, path, entry["label"]["published"], blank


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", choices=["htmldate", "permalink"], default="htmldate")
    parser.add_argument("--split", default="dev")
    parser.add_argument("--max-lag", type=int, default=30)
    parser.add_argument(
        "--include-unreviewed",
        action="store_true",
        help="count negative labels no person has confirmed. Preview only.",
    )
    args = parser.parse_args()

    pages = list(
        load_htmldate_pages()
        if args.corpus == "htmldate"
        else load_permalink_pages(args.split, args.max_lag, args.include_unreviewed)
    )
    negatives = sum(1 for p in pages if p[3] is None)
    print(
        f"{len(pages)} pages from the {args.corpus} corpus "
        f"({len(pages) - negatives} dated, {negatives} with no date)",
        file=sys.stderr,
    )

    tools = build_tools()
    print(f"tools: {', '.join(tools)}", file=sys.stderr)

    for name, run in tools.items():
        for file_id, url, path, gold, blank in pages:
            with open(path, encoding="utf-8", errors="replace") as handle:
                html = handle.read()
            # Per entry, from holdOut — not "every page on the permalink corpus".
            if blank:
                html = neutralise_html(html)

            started = time.perf_counter()
            found = None
            try:
                # Several of these print or log to stdout, which would corrupt
                # the JSONL stream.
                sink = io.StringIO()
                with redirect_stdout(sink), redirect_stderr(sink):
                    found = run(html, url)
            except Exception:
                found = None
            elapsed = (time.perf_counter() - started) * 1000

            print(
                json.dumps(
                    {
                        "tool": name,
                        "file": file_id,
                        "gold": gold,
                        "found": norm(found),
                        "ms": round(elapsed, 2),
                    }
                ),
                flush=True,
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
