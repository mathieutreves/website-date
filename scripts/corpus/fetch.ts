/**
 * Download the pinned snapshot of every manifest entry.
 *
 *   node scripts/corpus/fetch.ts
 *   node scripts/corpus/fetch.ts --concurrency 2 --limit 500
 *
 * Fetches `web.archive.org/web/<ts>id_/<url>` — the `id_` modifier returns the
 * bytes the crawler stored, without Wayback's injected banner and link
 * rewriting. Fetching the ordinary replay URL instead would benchmark a page
 * that never existed, with an extra `<script>` block and every relative link
 * absolutised.
 *
 * Writes into corpus/cache/, which is gitignored: this is other people's HTML
 * under no license we control. The manifest is what gets committed, and
 * `fetch.sha256` in it is what makes a rebuilt corpus verifiably the same one.
 *
 * Resumable and polite. Re-running only fetches what is missing.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readManifest, writeFileAtomic, writeManifest, type CorpusEntry } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const OUT_DIR = join(ROOT, 'corpus')
const CACHE = join(OUT_DIR, 'cache')
const MANIFEST = join(OUT_DIR, 'manifest.jsonl')
const USER_AGENT =
  'pagedate-corpus/0.1 (benchmark corpus construction; +https://github.com/mathieutreves/website-date)'

const { values } = parseArgs({
  options: {
    concurrency: { type: 'string', default: '3' },
    limit: { type: 'string' },
    /** Re-fetch entries already on disk, e.g. after changing the URL form. */
    force: { type: 'boolean', default: false },
  },
})

const CONCURRENCY = Number(values.concurrency)

/**
 * Below this, the capture is a stub — an error page, a redirect body, or a
 * truncated crawl. Keeping them would quietly pad the corpus with pages that
 * have no date because they have no content.
 */
const MIN_BYTES = 500

const cachePath = (entry: CorpusEntry): string => join(CACHE, `${entry.id}.html`)

async function fetchOne(entry: CorpusEntry): Promise<{ bytes: number; sha256: string } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(entry.archiveUrl, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(90_000),
      })

      if (response.status === 429 || response.status === 503) {
        await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt))
        continue
      }
      if (!response.ok) return null

      const html = await response.text()
      if (html.length < MIN_BYTES) return null

      await writeFile(cachePath(entry), html)
      return {
        bytes: Buffer.byteLength(html),
        sha256: createHash('sha256').update(html).digest('hex'),
      }
    } catch {
      if (attempt === 3) return null
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt))
    }
  }
  return null
}

async function main(): Promise<void> {
  await mkdir(CACHE, { recursive: true })

  const entries = readManifest(await readFile(MANIFEST, 'utf8'))
  let todo = entries.filter((entry) => values.force || !entry.fetch)
  if (values.limit) todo = todo.slice(0, Number(values.limit))

  console.log(`${entries.length} entries, ${todo.length} to fetch`)

  let done = 0
  let failed = 0
  let index = 0

  const worker = async (): Promise<void> => {
    while (index < todo.length) {
      const entry = todo[index++]
      const result = await fetchOne(entry)
      if (result) {
        entry.fetch = { at: new Date().toISOString(), ...result }
        done++
      } else {
        failed++
      }
      const seen = done + failed
      if (seen % 25 === 0 || seen === todo.length) {
        console.log(`  ${seen}/${todo.length}  ok=${done} failed=${failed}`)
        await writeFileAtomic(MANIFEST, writeManifest(entries))
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await writeFileAtomic(MANIFEST, writeManifest(entries))

  const fetched = entries.filter((e) => e.fetch)
  const bytes = fetched.reduce((sum, e) => sum + (e.fetch?.bytes ?? 0), 0)
  console.log(
    `\n${fetched.length} pages on disk, ${(bytes / 1024 / 1024).toFixed(1)} MB` +
      ` (${failed} failed this run)`,
  )
}

await main()
