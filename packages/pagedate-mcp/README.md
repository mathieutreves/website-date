# pagedate-mcp

An MCP server that reports how old a page is, and how much to trust that reading, before an agent cites it.

Wraps [`pagedate`](../pagedate). It is a separate package because `pagedate` has no runtime dependencies and an MCP server requires some.

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

Fetches the page and returns `FRESH`, `STALE`, or `UNDETERMINED`.

```
STALE — about 691 days old, beyond the 180-day threshold (basis: published date).

Page: https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/
Published: 2024-09-05 (derived from structured but weaker markup; source: marked-date)
Last modified: not stated.
```

`UNDETERMINED` has two causes, and the text states what each does not license:

- **The page states no date.** An absent date is not evidence of recency.
- **The page dated itself too coarsely.** A page stating only "2024" is somewhere in a 366-day window; against a 180-day threshold there is no answer.

`basis` selects the question: `published` is when the page was written, `modified` is whether it has been kept current, `either` (default) is how old the current content is.

### `page_date(url, mode?, minConfidence?, includeCandidates?)`

Both dates, each with its source and confidence tier, plus any contradiction the page carries. Conflicts lead the output:

```
WARNING — this page appears to have been rewritten since the date it claims.
declared 2019-03-04 but the archive shows changed content on 2024-11-02 (gap: 2070 days)
```

## Output format

Every tool returns both `structuredContent`, carrying the same `DateResult` a programmatic caller gets, and a text rendering that states the provenance and the confidence tier.

## Fetching URLs a model chose

Every URL this server fetches was selected by something other than its operator, so `blockPrivateNetwork` defaults to `'strict'` rather than the library's `'literal'`: the address filter runs on every redirect hop, and each hostname is resolved and refused if it answers with a private address. That covers a hostname that is a CNAME for `169.254.169.254`. It does not cover a DNS rebind between the check and the connection; see the caveat on the option in `pagedate/node`.

Override it only when analysing your own network:

```js
import { createServer } from 'pagedate-mcp'
createServer({ fetch: { blockPrivateNetwork: 'off' } })
```

## Decisions

| Decision | Rationale |
| --- | --- |
| A separate package from `pagedate` | `pagedate` has zero runtime dependencies; an MCP server cannot |
| Tools return prose alongside structured data | A model handed `{"published": "2019-03-04"}` uses that date and says nothing about it. The text rendering puts provenance and confidence into context whether or not the model asked |
| `UNDETERMINED` is a named outcome, not a null | "The site did not say" is an answer, and the wording states that absence of a date is not evidence of recency |
| `blockPrivateNetwork` defaults to `'strict'` here | Every URL fetched was chosen by a model rather than by the operator, which is a different threat model from a CLI the user typed a URL into |

## Licence

MIT.
