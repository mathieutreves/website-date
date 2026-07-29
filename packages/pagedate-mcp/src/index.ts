/**
 * `pagedate-mcp` — an MCP server that answers "how old is this page, and how
 * much should you trust that answer".
 *
 * A separate package rather than a subpath of `pagedate`, and the reason is the
 * headline claim on the library: zero runtime dependencies. An MCP server needs
 * the protocol SDK and a schema validator, and a `pagedate/mcp` export would put
 * both into the dependency tree of every browser and extension consumer that
 * will never call it — or, worse, make them optional peers and turn a missing
 * install into a runtime failure. The library stays dependency-free and the
 * server pays for its own.
 *
 * ## Why an agent wants this
 *
 * A model reading a fetched page has no reliable way to date it. The date in the
 * prose may be a comment timestamp; the date in the URL may be a section index;
 * a page with no date at all reads exactly like a page written yesterday. The
 * failure that follows is specific and common: citing a 2019 tutorial as current
 * practice, or treating a silently-rewritten page as if its stated date still
 * described its contents. `page_freshness` is built for the check an agent
 * should run before it cites something, and it is allowed to answer "the page
 * did not say" — which is the answer that stops the bad citation.
 *
 * ## Fetching URLs a model chose
 *
 * Every URL this server fetches was, by definition, picked by something other
 * than its operator, which is the exact threat model `blockPrivateNetwork`
 * exists for. It therefore defaults to `'strict'` here, not to the library's
 * `'literal'`: the address filter runs on every redirect hop *and* each hostname
 * is resolved and refused if it answers with a private address. That closes
 * "https://harmless.example/ is a CNAME for 169.254.169.254", which is how an
 * agent gets talked into reading a cloud metadata endpoint. See the caveat on
 * the option in `pagedate/node` for what it still does not close.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { findDatesFromUrl, type FromUrlOptions } from 'pagedate/node'
import { z } from 'zod'
import { pageDate, pageFreshness, type Analyse } from './tools.js'

export { pageDate, pageFreshness, renderDates } from './tools.js'
export type { Analyse, ToolResult } from './tools.js'

const MODE = z
  .enum(['fast', 'standard', 'extensive'])
  .describe(
    'How hard to look. "standard" (default) reads metadata and rendered text. "fast" reads declared metadata only — quicker, and roughly 23 points less accurate. "extensive" adds unlabelled text; it does not improve accuracy and exists to populate the full candidate list.',
  )

const MIN_CONFIDENCE = z
  .enum(['declared', 'derived', 'inferred'])
  .describe(
    'Discard weaker signals. "declared" answers only "what does this site state about itself in machine-readable metadata", and will return nothing rather than guess. Use it when a wrong date is more costly than no date.',
  )

const URL_ARG = z.string().url().describe('Absolute http(s) URL of the page to analyse.')

export type ServerOptions = {
  /**
   * Passed through to `findDatesFromUrl`. `blockPrivateNetwork` defaults to
   * `'strict'` — see the note at the top of this file — and a caller overriding
   * it is deciding to trust the URLs its agent produces.
   */
  fetch?: FromUrlOptions
  /** Fixed clock, so freshness verdicts are reproducible under test. */
  now?: Date
}

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'pagedate', version: '0.1.0' })

  const analyse: Analyse = (url, perCall) =>
    findDatesFromUrl(url, {
      blockPrivateNetwork: 'strict',
      ...options.fetch,
      ...perCall,
    })

  server.registerTool(
    'page_date',
    {
      title: 'Find when a web page was published and last modified',
      description:
        'Fetch a web page and report its publication and last-modified dates, each with the source it came from and how much to trust it. Also flags the case where a page contradicts itself — for example declaring a 2019 publication date while carrying evidence of edits years later. Returns "not stated" rather than a guess when the page carries no date; that is a real answer and should be reported as such, not treated as "recent".',
      inputSchema: {
        url: URL_ARG,
        mode: MODE.optional(),
        minConfidence: MIN_CONFIDENCE.optional(),
        includeCandidates: z
          .boolean()
          .optional()
          .describe(
            'List every date signal found on the page, not just the resolved pair. Useful when investigating a disagreement; verbose otherwise.',
          ),
      },
    },
    async (args) => (await pageDate(args, analyse)) as never,
  )

  server.registerTool(
    'page_freshness',
    {
      title: 'Check whether a web page is too old to rely on',
      description:
        'Fetch a web page and judge whether it is older than a given threshold. Use this before citing a page as current. The verdict may be UNDETERMINED — because the page stated no date, or dated itself too coarsely to place — and in that case the page must not be described as either current or outdated.',
      inputSchema: {
        url: URL_ARG,
        maxAgeDays: z
          .number()
          .int()
          .positive()
          .describe('A page older than this many days counts as stale.'),
        basis: z
          .enum(['modified', 'published', 'either'])
          .optional()
          .describe(
            '"either" (default) uses the modification date when there is one, else the publication date — "how old is what I am looking at". "published" asks when it was written; "modified" asks whether it has been kept current.',
          ),
        minConfidence: MIN_CONFIDENCE.optional(),
        mode: MODE.optional(),
      },
    },
    async (args) => (await pageFreshness(args, analyse, options.now)) as never,
  )

  return server
}
