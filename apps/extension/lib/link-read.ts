import type { Candidate } from 'pagedate'

/**
 * The contract between the worker and the script it injects to read a *linked*
 * page — the one the reader right-clicked but has not opened.
 *
 * Same shape and same reasoning as `page-read.ts`: types only, so the service
 * worker can talk about the result without pulling the extractor and its
 * pattern tables into its own bundle.
 *
 * Two globals rather than one, because unlike `extract.ts` this script needs an
 * argument. `executeScript({ files })` takes none — there is no `args` for a
 * file injection — so the request is written into the isolated world by a tiny
 * `func` injection first, and the script reads it from there. Both land in the
 * same isolated world for the frame, so the page can neither see nor forge
 * either one.
 *
 * The request carries the markup as well as the address. The worker fetches —
 * it is the only context whose requests the host permission exempts from CORS —
 * and the tab parses, because it is the only one with a `DOMParser`.
 */

export const LINK_REQUEST_GLOBAL = '__pagedateLinkRequest'
export const LINK_RESULT_GLOBAL = '__pagedateLinkResult'

export type LinkRequest = {
  url: string
  /** The page's markup, already fetched by the worker. */
  html: string
}

export type LinkRead = {
  /** Echoed back so the worker can prove the answer is about what it asked. */
  url: string
  /** `null` when the markup could not be parsed into a document. */
  candidates: Candidate[] | null
}

/**
 * Decide whether an injection result is a link read worth trusting.
 *
 * Split out for the same reason as `acceptPageRead`: what arrives is whatever
 * `executeScript` resolved to — `undefined` on a frame that refused injection —
 * and `LinkRead` is an assertion about it rather than a fact. It crossed a
 * structured-clone boundary from a script running in a page we do not control.
 */
export function acceptLinkRead(result: unknown, expectedUrl: string): Candidate[] | null {
  const read = result as LinkRead | undefined
  if (!read || typeof read !== 'object') return null
  if (read.url !== expectedUrl) return null
  if (read.candidates === null) return null
  return Array.isArray(read.candidates) ? read.candidates : null
}
