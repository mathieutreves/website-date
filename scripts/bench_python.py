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
    """Same host-level split as score.ts, so the two report on the same pages."""
    return "test" if hashlib.sha1(host.encode()).digest()[0] % 3 == 0 else "dev"


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

        tools["htmldate (fast)"] = lambda html, url: find_date(html, extensive_search=False)
        tools["htmldate (extensive)"] = lambda html, url: find_date(html, extensive_search=True)
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
        yield entry["file"], url, path, entry["date"]


def load_permalink_pages(split: str, max_lag: int):
    """The harvested corpus, filtered exactly as score.ts filters it.

    Entries whose label appears nowhere in the page are dropped: with the URL
    neutralised no tool could recover them, so scoring them would punish every
    tool equally for correctly finding nothing.
    """
    manifest = os.path.join(ROOT, "corpus", "manifest.jsonl")
    cache = os.path.join(ROOT, "corpus", "cache")
    with open(manifest, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            entry = json.loads(line)
            if not entry.get("fetch") or not entry["label"].get("published"):
                continue
            if split != "all" and split_of(entry["strata"]["host"]) != split:
                continue
            if entry["captureLagDays"] > max_lag:
                continue
            if entry["strata"].get("labelInPage") is False:
                continue
            path = os.path.join(cache, f"{entry['id']}.html")
            if not os.path.exists(path):
                continue
            yield entry["id"], neutralise(entry["url"]), path, entry["label"]["published"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", choices=["htmldate", "permalink"], default="htmldate")
    parser.add_argument("--split", default="dev")
    parser.add_argument("--max-lag", type=int, default=30)
    args = parser.parse_args()

    pages = list(
        load_htmldate_pages()
        if args.corpus == "htmldate"
        else load_permalink_pages(args.split, args.max_lag)
    )
    print(f"{len(pages)} pages from the {args.corpus} corpus", file=sys.stderr)

    tools = build_tools()
    print(f"tools: {', '.join(tools)}", file=sys.stderr)

    for name, run in tools.items():
        for file_id, url, path, gold in pages:
            with open(path, encoding="utf-8", errors="replace") as handle:
                html = handle.read()
            if args.corpus == "permalink":
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
