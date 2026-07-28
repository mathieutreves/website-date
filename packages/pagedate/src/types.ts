/**
 * How much to trust a candidate. This is the field that makes the output
 * actionable rather than just another date on the screen — see docs/DESIGN.md §1.
 */
export type Confidence =
  /** The site explicitly stated this in structured metadata it controls. */
  | 'declared'
  /** Structured but weaker, or from an adjacent site-owned document. */
  | 'derived'
  /** Guessed from URL shape, prose, or transport headers. */
  | 'inferred'

export type Field = 'published' | 'modified' | 'unknown'

/**
 * How precise the underlying source actually was. Never inflated: a source that
 * said "2024" yields `year`, not `day` — see {@link Candidate.value}.
 */
export type Precision = 'year' | 'month' | 'day' | 'minute'

export type Candidate = {
  /**
   * ISO 8601, truncated to `precision`. A `year` candidate is `"2024"`, a
   * `month` candidate `"2024-03"`. Precision is never invented.
   */
  value: string
  precision: Precision
  field: Field
  /** Stable identifier for the extractor, e.g. `'jsonld'`, `'atom-feed'`. */
  source: string
  confidence: Confidence
  /** Human-readable provenance, surfaced in the extension UI on hover. */
  note?: string
}

export type ConflictKind =
  /** Two `declared` candidates for the same field disagree. The site contradicts itself. */
  | 'declared-disagreement'
  /** A declared publish date long predates a strong modification signal the site doesn't show. */
  | 'stale-declaration'

export type Conflict = {
  kind: ConflictKind
  gapDays: number
  /** Rendered verbatim in the UI. */
  detail: string
}

export type ArchiveEvent = {
  /** ISO 8601 instant of the capture that first showed changed content. */
  at: string
  digest: string
}

export type ArchiveTimeline = {
  firstCapture?: string
  lastCapture?: string
  /** Captures whose content digest differed from the preceding capture. */
  events: ArchiveEvent[]
  /** True when the CDX row limit was hit, so the history is incomplete. */
  truncated: boolean
}

export type DateResult = {
  published?: Candidate
  modified?: Candidate
  /** Everything found, unresolved and unranked. Always present. */
  candidates: Candidate[]
  conflict?: Conflict
  /** Only populated when the archive timeline was explicitly requested. */
  archive?: ArchiveTimeline
}

/**
 * Injected side effects. The library never touches the network directly: Node
 * tests inject a fixture replayer, the extension injects a shim that routes
 * through the service worker. `now` is injectable so plausibility checks are
 * deterministic under test.
 */
export type Env = {
  fetchText?: (url: string) => Promise<string | null>
  fetchHeaders?: (url: string) => Promise<Record<string, string> | null>
  now?: () => Date
  /**
   * Parses feed and sitemap XML. Defaults to the global `DOMParser`, which
   * exists in browsers and service workers but not in Node — tests inject one
   * rather than the library taking a parser dependency.
   */
  parseXml?: (xml: string) => Document | null
}

/**
 * Per-domain override. Adapters short-circuit nothing — generic extractors
 * still run, so contradictions between the two remain visible.
 */
export type Adapter = {
  name: string
  matches: (url: URL, doc: Document) => boolean
  extract: (doc: Document, url: URL) => Candidate[]
}
