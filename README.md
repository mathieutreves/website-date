# website-date

Find out when a web page was *actually* written — and when it was quietly rewritten since.

Most pages don't show a date. Many that do show the original publication date while the content has been edited for years. This project detects both, reports **where each date came from** and **how much to trust it**, and flags the case where a site contradicts itself.

Two pieces:

- **`pagedate`** — a zero-dependency, browser-first library. Takes a `Document`, returns date candidates with provenance and confidence.
- **A browser extension** (Chrome + Firefox, MV3 via WXT) that renders the result on demand.

## Status

**Pre-Phase-0.** Nothing is built yet. The design is written; the first step is a bake-off against existing extractors that can still redirect it.

## Design

See [docs/DESIGN.md](docs/DESIGN.md) — architecture, signal ladder, resolution algorithm, build phases, and the decision log.

## Why not just use an existing library?

Several extract dates. None are browser-first with zero deps, expose published and modified as distinct outputs, *and* carry a confidence/provenance field. That last one is what makes the output actionable rather than just another number on the screen. Prior art is surveyed in [§1 of the design doc](docs/DESIGN.md#1-context).
