/**
 * The tool bodies, and the rendering that makes them worth calling.
 *
 * Separate from `server.ts` — which is transport wiring and nothing else — so
 * that what an agent actually receives can be tested without standing up a
 * protocol.
 *
 * ## Why this returns prose and not just JSON
 *
 * An MCP tool's result is read by a language model, and a model handed
 * `{"published":"2019-03-04"}` will use that date and say nothing about it. The
 * entire premise of this library is that the date alone is the wrong answer —
 * that a page declaring 2019 and quietly rewritten in 2024 is a different fact
 * from a page written in 2019, and that "the site did not say" is a real
 * outcome rather than a null to be papered over. None of that survives being
 * flattened to a value.
 *
 * So every tool returns two things: `structuredContent`, which is the same
 * `DateResult` a programmatic caller would get, and a text rendering that puts
 * the provenance and the confidence tier in the model's context whether it
 * wanted them or not. The text leads with the caveat when there is one, because
 * a model that reads only the first line should still come away with the right
 * impression.
 */

import type { Candidate, Confidence, DateResult, Mode } from 'pagedate'
import { staleness, type StalenessBasis } from 'pagedate/node'

export type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent: Record<string, unknown>
  isError?: boolean
}

/** Plain-English gloss of a confidence tier. `declared` vs `derived` means nothing to a model otherwise. */
const TIER: Record<Confidence, string> = {
  declared: 'declared by the site in machine-readable metadata',
  derived: 'derived from structured but weaker markup',
  inferred: 'inferred from the URL, prose, or a transport header',
}

const PRECISION_NOTE: Record<string, string> = {
  year: ' — the page gave only a year, so the month and day are unknown',
  month: ' — the page gave only a month, so the day is unknown',
}

function describe(candidate: Candidate): string {
  const precision = PRECISION_NOTE[candidate.precision] ?? ''
  return `${candidate.value} (${TIER[candidate.confidence]}; source: ${candidate.source})${precision}`
}

/**
 * The sentence that has to survive being the only thing read.
 *
 * A conflict is the finding an agent is least equipped to reconstruct for
 * itself and most likely to mislead a user by omitting, so it goes first and it
 * goes in words.
 */
function conflictLine(result: DateResult): string | null {
  if (!result.conflict) return null
  const { kind, gapDays, detail } = result.conflict

  const headline =
    kind === 'stale-declaration'
      ? 'WARNING — this page appears to have been rewritten since the date it claims.'
      : kind === 'declared-disagreement'
        ? 'WARNING — this page contradicts itself about when it was published.'
        : 'WARNING — this page carries content older than the publication date it declares, so that date is probably a republication stamp.'

  return `${headline}\n${detail} (gap: ${gapDays} days)`
}

export function renderDates(url: string, result: DateResult, includeCandidates: boolean): string {
  const lines: string[] = []

  const conflict = conflictLine(result)
  if (conflict) lines.push(conflict, '')

  lines.push(`Page: ${url}`)
  lines.push(
    result.published
      ? `Published: ${describe(result.published)}`
      : 'Published: not stated. The page carries no publication date this tool can find — treat its age as unknown rather than recent.',
  )
  lines.push(
    result.modified
      ? `Last modified: ${describe(result.modified)}`
      : 'Last modified: not stated.',
  )

  if (includeCandidates && result.candidates.length > 0) {
    lines.push('', `All ${result.candidates.length} date signals found on the page:`)
    for (const candidate of result.candidates) {
      lines.push(`  - [${candidate.field}] ${describe(candidate)}${candidate.note ? ` — ${candidate.note}` : ''}`)
    }
  }

  return lines.join('\n')
}

/*
 * The optional fields are spelled `?: T | undefined` rather than `?: T`, against
 * the repository's `exactOptionalPropertyTypes`. That is not laziness: these
 * objects are decoded from JSON sent by a client, and Zod's inferred type for an
 * optional field is exactly `T | undefined` — a key that is present and
 * explicitly null-ish is a shape a wire protocol can and does produce. Declaring
 * it away would only move the cast somewhere less honest.
 */
export type DateToolInput = {
  url: string
  mode?: Mode | undefined
  includeCandidates?: boolean | undefined
  minConfidence?: Confidence | undefined
}

export type Analyse = (
  url: string,
  options: { mode?: Mode; minConfidence?: Confidence },
) => Promise<DateResult | null>

const unreachable = (url: string): ToolResult => ({
  content: [
    {
      type: 'text',
      text: `Could not read ${url}. It may be unreachable, may have refused the request, or may be on a private network this server declines to fetch. No conclusion about its date should be drawn from this.`,
    },
  ],
  structuredContent: { url, error: 'unreachable' },
  isError: true,
})

/**
 * Drop the keys the client left out, rather than forwarding `undefined`.
 *
 * The narrowing point between the wire types above — where an absent field is
 * legitimately `T | undefined` — and the library's options, where an optional
 * key must be absent or a real value and never explicitly undefined.
 */
const analysisOptions = (input: {
  mode?: Mode | undefined
  minConfidence?: Confidence | undefined
}): { mode?: Mode; minConfidence?: Confidence } => ({
  ...(input.mode ? { mode: input.mode } : {}),
  ...(input.minConfidence ? { minConfidence: input.minConfidence } : {}),
})

export async function pageDate(input: DateToolInput, analyse: Analyse): Promise<ToolResult> {
  const result = await analyse(input.url, analysisOptions(input))
  if (!result) return unreachable(input.url)

  return {
    content: [
      { type: 'text', text: renderDates(input.url, result, input.includeCandidates ?? false) },
    ],
    structuredContent: { url: input.url, ...result } as unknown as Record<string, unknown>,
  }
}

export type FreshnessToolInput = DateToolInput & {
  maxAgeDays: number
  basis?: StalenessBasis | undefined
}

export async function pageFreshness(
  input: FreshnessToolInput,
  analyse: Analyse,
  now?: Date,
): Promise<ToolResult> {
  const result = await analyse(input.url, analysisOptions(input))
  if (!result) return unreachable(input.url)

  const verdict = staleness(result, {
    maxAgeDays: input.maxAgeDays,
    ...(now ? { now } : {}),
    ...(input.basis ? { basis: input.basis } : {}),
    ...(input.minConfidence ? { minConfidence: input.minConfidence } : {}),
  })

  /*
   * `imprecise` and `no-date` are the answers this tool exists to give
   * honestly. A model that receives "stale: null" and nothing else will round it
   * to whichever verdict suits its next sentence, so each one says in words what
   * it does and does not license.
   */
  const headline =
    verdict.reason === 'fresh'
      ? `FRESH — about ${verdict.ageDays} days old, within the ${input.maxAgeDays}-day threshold (basis: ${verdict.basis} date).`
      : verdict.reason === 'stale'
        ? `STALE — about ${verdict.ageDays} days old, beyond the ${input.maxAgeDays}-day threshold (basis: ${verdict.basis} date).`
        : verdict.reason === 'imprecise'
          ? `UNDETERMINED — the page dated itself too coarsely to place against a ${input.maxAgeDays}-day threshold. It is between ${verdict.ageDays} and ${verdict.maxAgeDays} days old, and the threshold falls inside that range. Do not report it as either current or outdated.`
          : `UNDETERMINED — the page states no date this tool can find${input.minConfidence ? ` at the required "${input.minConfidence}" confidence` : ''}. Its age is unknown; absence of a date is not evidence that it is recent.`

  return {
    content: [
      { type: 'text', text: `${headline}\n\n${renderDates(input.url, result, false)}` },
    ],
    structuredContent: {
      url: input.url,
      stale: verdict.stale,
      reason: verdict.reason,
      ageDays: verdict.ageDays,
      maxAgeDays: verdict.maxAgeDays,
      basis: verdict.basis,
      published: result.published ?? null,
      modified: result.modified ?? null,
      conflict: result.conflict ?? null,
    },
  }
}
