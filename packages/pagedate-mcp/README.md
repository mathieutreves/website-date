# pagedate-mcp

An MCP server that tells an agent **how old a page is, and how much to trust that** — before it cites it.

Wraps [`pagedate`](../pagedate). Separate package because `pagedate` has zero runtime dependencies and an MCP server cannot; the library stays clean and the server pays for its own.

## Install

```jsonc
// claude_desktop_config.json, or any MCP client's server config
{
  "mcpServers": {
    "pagedate": {
      "command": "npx",
      "args": ["-y", "pagedate-mcp"]
    }
  }
}
```

## Tools

### `page_freshness(url, maxAgeDays, basis?, minConfidence?, mode?)`

The one to reach for. Fetches the page and returns `FRESH`, `STALE`, or `UNDETERMINED`.

```
STALE — about 691 days old, beyond the 180-day threshold (basis: published date).

Page: https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/
Published: 2024-09-05 (derived from structured but weaker markup; source: marked-date)
Last modified: not stated.
```

`UNDETERMINED` is a real answer and comes in two flavours, each of which says in words what it does not license:

- **The page states no date.** An absent date is not evidence of recency, and the text says so — this is the failure mode the tool exists to prevent.
- **The page dated itself too coarsely.** A page that said only "2024" is somewhere in a 366-day window; against a 180-day threshold there is no answer, and inventing one would mean inventing a January 1st.

`basis` picks the question: `published` is "when was this written", `modified` is "has this been kept current", `either` (default) is "how old is what I am looking at".

### `page_date(url, mode?, minConfidence?, includeCandidates?)`

The full reading — both dates, each with its source and confidence tier, plus any contradiction the page carries. Conflicts lead the output:

```
WARNING — this page appears to have been rewritten since the date it claims.
declared 2019-03-04 but the archive shows changed content on 2024-11-02 (gap: 2070 days)
```

## Why the output is prose

A model handed `{"published": "2019-03-04"}` uses that date and says nothing about it. The premise of this library is that the bare date is the wrong answer — a page written in 2019 and a page declaring 2019 while quietly rewritten since are different facts, and "the site did not say" is an outcome rather than a null.

So every tool returns both: `structuredContent` carrying the same `DateResult` a programmatic caller gets, and a text rendering that puts the provenance and the confidence tier into the model's context whether it asked for them or not.

## Fetching URLs a model chose

Every URL this server fetches was picked by something other than its operator, so `blockPrivateNetwork` defaults to **`'strict'`** here rather than the library's `'literal'`: the address filter runs on every redirect hop *and* each hostname is resolved and refused if it answers with a private address. That closes "`https://harmless.example/` is a CNAME for `169.254.169.254`". See the caveat on the option in `pagedate/node` for what it still does not close — a DNS rebind between the check and the connection.

Override it if you are analysing your own network, and only then:

```js
import { createServer } from 'pagedate-mcp'
createServer({ fetch: { blockPrivateNetwork: 'off' } })
```

## Licence

MIT.
