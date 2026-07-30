/**
 * The human pass over proposed negative labels.
 *
 *   node scripts/corpus/review-negative.ts                  # render the queue
 *   node scripts/corpus/review-negative.ts --id <id>        # one page, full detail
 *   node scripts/corpus/review-negative.ts --apply decisions.txt
 *
 * `harvest-negative.ts` proposes pages whose answer should be "no publication
 * date" from their page type. It cannot confirm that, and neither can any model:
 * CONTRIBUTING.md puts the answer key outside what may be generated, and this is
 * the label where that matters most. A negative asserted wrongly — a page that
 * does have a publication date, recorded as having none — is a free false
 * positive handed to every tool in the table, in the direction that flatters
 * this project, because declining to answer is what this library does more than
 * its competitors do. It would raise our number by lowering theirs, on a page
 * where they were right.
 *
 * So this tool does the reading and leaves the deciding. For each candidate it
 * prints every date-shaped string in the document with enough context to see
 * what the date belongs to, which is the whole question: a homepage covered in
 * datelines still has no publication date **of its own**, and the distinction
 * between "there is no date here" and "every date here belongs to something
 * else" is one a person can make in about five seconds per page and a regex
 * cannot make at all.
 *
 * ## Deciding
 *
 * - **confirm** — the page has no publication date of its own. Dates belonging
 *   to linked articles, to comments, to a copyright footer or to a "last
 *   updated" line do not count against this: the corpus scores `published`, and
 *   none of those is one.
 * - **reject** — the page does have a publication date. Common on `policy`
 *   pages, which sometimes carry a real "published" stamp, and on hosts whose
 *   "homepage" capture is really a redirect to an article.
 *
 * Write decisions one per line as `<id> confirm` or `<id> reject`, then
 * `--apply` the file. Rejected entries stay in the manifest with
 * `review: 'rejected'` and are scored by nothing — the record of what was
 * considered and turned down is worth more than a smaller manifest.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { isNegative, readManifest, splitOf, writeFileAtomic, writeManifest } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    apply: { type: 'string' },
    limit: { type: 'string', default: '40' },
    /** Show entries already decided, to re-check a call. */
    all: { type: 'boolean', default: false },
  },
})

/**
 * Date-shaped strings, in the renderings this corpus actually contains.
 *
 * Deliberately broader than anything the library reads. The reviewer's question
 * is "is there a publication date on this page", and a finder that only surfaced
 * what our own extractors already find would hide exactly the cases where a
 * negative label is wrong — a date in a format we do not parse is still a date,
 * and confirming a negative because *we* could not see one is the closed loop
 * this whole review exists to break.
 */
const DATE_SHAPES = [
  /\b(19|20)\d{2}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[./]\d{1,2}[./](19|20)\d{2}\b/g,
  /\b(19|20)\d{2}[./]\d{1,2}[./]\d{1,2}\b/g,
  /\b(19|20)\d{2}年\d{1,2}月\d{1,2}日/g,
  /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|gen|mag|giu|lug|ago|set|ott|dic|mrz|mai|okt|dez|janv|f[ée]vr|avr|juil|ao[uû]t|d[ée]c|ene|abr|ma[yi]o|ag|dic)[a-zà-ÿ]*\.?\s+(19|20)\d{2}/gi,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+(19|20)\d{2}\b/gi,
]

/** Attributes and tags whose presence is worth flagging regardless of format. */
const DECLARED_HINTS = [
  /<meta[^>]+(article:published_time|article:modified_time|datePublished|dateModified|DC\.date|citation_publication_date)[^>]*>/gi,
  /"date(Published|Modified|Created)"\s*:\s*"[^"]{4,40}"/gi,
  /<time[^>]*datetime=["'][^"']{4,40}["'][^>]*>/gi,
]

const strip = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')

function findDates(html: string): { text: string[]; declared: string[] } {
  const body = strip(html)
  const text = new Set<string>()
  for (const shape of DATE_SHAPES) {
    for (const match of body.matchAll(shape)) {
      const at = match.index ?? 0
      const context = body.slice(Math.max(0, at - 45), at + match[0].length + 45).trim()
      text.add(`${match[0]}   …${context}…`)
      if (text.size > 30) break
    }
  }
  const declared = new Set<string>()
  for (const shape of DECLARED_HINTS) {
    for (const match of html.matchAll(shape)) {
      declared.add(match[0].slice(0, 160))
      if (declared.size > 15) break
    }
  }
  return { text: [...text], declared: [...declared] }
}

async function main(): Promise<void> {
  const entries = readManifest(await readFile(MANIFEST, 'utf8'))

  if (values.apply) {
    const decisions = new Map<string, 'confirmed' | 'rejected'>()
    for (const line of (await readFile(values.apply, 'utf8')).split('\n')) {
      const clean = line.replace(/#.*$/, '').trim()
      if (!clean) continue
      const [id, verdict] = clean.split(/\s+/)
      if (verdict === 'confirm') decisions.set(id, 'confirmed')
      else if (verdict === 'reject') decisions.set(id, 'rejected')
      else throw new Error(`line "${clean}": verdict must be confirm or reject`)
    }

    let applied = 0
    let unknown = 0
    for (const entry of entries) {
      const verdict = decisions.get(entry.id)
      if (!verdict) continue
      if (!isNegative(entry)) {
        throw new Error(`${entry.id} is not a negative entry — refusing to set review on it`)
      }
      entry.label.review = verdict
      // A confirmed negative has been read by a person, which is exactly what
      // the gold tier means. Nothing else in this corpus can claim it.
      entry.label.tier = verdict === 'confirmed' ? 'gold' : 'silver'
      applied++
    }
    for (const id of decisions.keys()) {
      if (!entries.some((e) => e.id === id)) {
        console.error(`  unknown id, ignored: ${id}`)
        unknown++
      }
    }
    await writeFileAtomic(MANIFEST, writeManifest(entries))
    const confirmed = [...decisions.values()].filter((v) => v === 'confirmed').length
    console.log(
      `applied ${applied} decisions (${confirmed} confirmed, ${applied - confirmed} rejected)` +
        `${unknown ? `, ${unknown} unknown ids skipped` : ''}`,
    )
    return
  }

  const negatives = entries.filter(isNegative)
  const queue = negatives.filter(
    (e) => values.all || values.id === e.id || (!values.id && e.label.review === 'pending'),
  )
  const shown = values.id ? queue : queue.slice(0, Number(values.limit))

  const counts = { pending: 0, confirmed: 0, rejected: 0 }
  for (const e of negatives) counts[e.label.review ?? 'pending']++
  console.log(
    `\n${negatives.length} negative entries: ${counts.pending} pending, ` +
      `${counts.confirmed} confirmed, ${counts.rejected} rejected\n`,
  )
  if (counts.pending > 0) {
    console.log(`Only confirmed negatives are scored. Until this queue is worked,`)
    console.log(`the corpus still cannot charge any tool for inventing a date.\n`)
  }

  for (const entry of shown) {
    let html: string
    try {
      html = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
    } catch {
      console.log(`${entry.id}  ${entry.url}\n  NOT FETCHED — run scripts/corpus/fetch.ts\n`)
      continue
    }
    const { text, declared } = findDates(html)
    console.log('─'.repeat(100))
    console.log(`${entry.id}   ${entry.strata.pageType}   split=${splitOf(entry.strata.host)}`)
    console.log(`${entry.url}`)
    console.log(`capture ${entry.snapshot}   ${(entry.http.length / 1024).toFixed(0)} kB   ${entry.archiveUrl}`)
    if (declared.length) {
      console.log(`\n  MACHINE-READABLE DATE MARKUP (${declared.length}) — read these first:`)
      for (const d of declared.slice(0, 8)) console.log(`    ${d}`)
    } else {
      console.log(`\n  no machine-readable date markup`)
    }
    if (text.length) {
      console.log(`\n  DATE-SHAPED TEXT (${text.length}):`)
      for (const t of text.slice(0, 12)) console.log(`    ${t}`)
    } else {
      console.log(`  no date-shaped text`)
    }
    console.log(`\n  → ${entry.id} confirm    (no publication date of its own)`)
    console.log(`  → ${entry.id} reject     (it does have one)\n`)
  }

  if (shown.length < queue.length) {
    console.log(`… ${queue.length - shown.length} more. --limit to see them.`)
  }
}

await main()
