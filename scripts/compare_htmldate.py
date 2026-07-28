#!/usr/bin/env python3
"""
Run htmldate over the cached corpus and emit one JSON line per page.

Kept separate from the Node side so each tool runs in its own process with its
own parser, exactly as a real caller would use it. The runner in
packages/pagedate/scripts/compare.ts consumes this output.

  python3 scripts/compare_htmldate.py --mode fast > /tmp/htmldate-fast.jsonl
  python3 scripts/compare_htmldate.py --mode extensive > /tmp/htmldate-ext.jsonl
"""

import argparse
import json
import os
import sys
import time

from htmldate import find_date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "corpus-external", "htmldate")
CACHE = os.path.join(CORPUS, "cache")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["fast", "extensive"], default="fast")
    args = parser.parse_args()

    with open(os.path.join(CORPUS, "eval_default.json"), encoding="utf-8") as handle:
        index = json.load(handle)

    cached = set(os.listdir(CACHE))

    for url, entry in index.items():
        if entry["file"] not in cached:
            continue

        with open(os.path.join(CACHE, entry["file"]), encoding="utf-8", errors="replace") as handle:
            html = handle.read()

        started = time.perf_counter()
        try:
            # extensive_search=False is htmldate's "fast" mode; True is the
            # "extensive" row of their published table.
            found = find_date(html, extensive_search=(args.mode == "extensive"))
        except Exception:
            found = None
        elapsed_ms = (time.perf_counter() - started) * 1000

        print(
            json.dumps(
                {
                    "url": url,
                    "file": entry["file"],
                    "gold": entry["date"],
                    "found": found,
                    "ms": round(elapsed_ms, 2),
                }
            ),
            flush=True,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
