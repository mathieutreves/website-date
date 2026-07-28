#!/usr/bin/env python3
"""
Run every installed Python date extractor over the cached corpus.

Emits one JSON line per (tool, page). Written to be run against *current*
versions rather than trusting a published table: the tools have moved on since
that table was generated, and some of them have moved backwards.

  python3 scripts/bench_python.py > /tmp/bench-python.jsonl
"""

import io
import json
import os
import sys
import time
import warnings
from contextlib import redirect_stderr, redirect_stdout

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "corpus-external", "htmldate")
CACHE = os.path.join(CORPUS, "cache")


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


def main() -> int:
    with open(os.path.join(CORPUS, "eval_default.json"), encoding="utf-8") as handle:
        index = json.load(handle)
    cached = set(os.listdir(CACHE))

    tools = build_tools()
    print(f"tools: {', '.join(tools)}", file=sys.stderr)

    for name, run in tools.items():
        for url, entry in index.items():
            if entry["file"] not in cached:
                continue
            with open(
                os.path.join(CACHE, entry["file"]), encoding="utf-8", errors="replace"
            ) as handle:
                html = handle.read()

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
                        "file": entry["file"],
                        "gold": entry["date"],
                        "found": norm(found),
                        "ms": round(elapsed, 2),
                    }
                ),
                flush=True,
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
