import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOMParser } from 'linkedom'
import { extractFromDocument, resolve, type Env } from 'pagedate'
import {
  CANVAS,
  POPUP_MAX_HEIGHT,
  SHOTS,
  composite,
  frameDocument,
} from '../lib/screenshot-source.js'
import { view } from '../entrypoints/popup/render.js'

/**
 * The store screenshots are generated, gitignored and never rendered by CI —
 * so nothing else would notice them breaking until they were opened by hand,
 * the evening before a submission.
 *
 * What is checked here is the part that can be checked without a browser: that
 * the composite is structurally what it claims, that the real UI survives the
 * trip through a `srcdoc` attribute intact, and that every shot still points at
 * a fixture that exists.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')
const NOW = new Date('2026-07-29T00:00:00Z')

const offlineEnv = (): Env => ({
  fetchText: async () => null,
  parseXml: () => null,
})

const parse = (html: string): Document =>
  new DOMParser().parseFromString(html, 'text/html') as unknown as Document

/** A real popup render, the same way `gen-screenshots.ts` produces one. */
async function popupFrame(slug: string): Promise<string> {
  const { url } = JSON.parse(readFileSync(join(FIXTURES, slug, 'expected.json'), 'utf8')) as {
    url: string
  }
  const doc = parse(readFileSync(join(FIXTURES, slug, 'page.html'), 'utf8'))
  const result = await resolve(extractFromDocument(doc, url), url, offlineEnv(), { now: NOW })
  return frameDocument({
    css: 'body { width: 360px }',
    bodyHtml: `<main id="app">${view(result, url, { now: NOW })}</main>`,
  })
}

describe('shot definitions', () => {
  it('has unique ids, which are also the filenames', () => {
    const ids = SHOTS.map((shot) => shot.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * The drift guard. A renamed or deleted fixture would otherwise surface as a
   * generator crash at submission time, or — worse, if the slug still resolved
   * to something — as a screenshot quietly advertising the wrong page.
   */
  it('names only fixtures that exist', () => {
    for (const shot of SHOTS) {
      if (!shot.fixture) continue
      expect(existsSync(join(FIXTURES, shot.fixture, 'page.html')), shot.id).toBe(true)
    }
  })

  it('gives every shot needing a page a fixture to read', () => {
    for (const shot of SHOTS) {
      if (shot.kind === 'options') continue
      expect(shot.fixture, shot.id).toBeTruthy()
    }
  })
})

describe('composite', () => {
  it('is exactly the size the store accepts', async () => {
    const html = composite(SHOTS[0]!, await popupFrame('ilpost-italian-news'), 360)
    expect(html).toContain(`width: ${CANVAS.width}px`)
    expect(html).toContain(`height: ${CANVAS.height}px`)
  })

  /**
   * The frame rides inside a `srcdoc` attribute, so every quote and angle
   * bracket in the popup's markup and stylesheet has to survive being escaped
   * and read back. A single unescaped `"` truncates the attribute and the shot
   * renders as a blank frame — which is exactly the kind of thing that is only
   * noticed after upload.
   */
  it('round-trips the real popup markup through srcdoc', async () => {
    const frame = await popupFrame('ilpost-italian-news')
    const doc = parse(composite(SHOTS[0]!, frame, 360))

    const srcdoc = doc.querySelector('iframe')?.getAttribute('srcdoc')
    expect(srcdoc).toBeTruthy()

    const inner = parse(srcdoc as string)
    expect(inner.querySelector('#app')).toBeTruthy()
    // Provenance is the product; a shot that lost it is worth failing over.
    expect(inner.querySelector('.marker')).toBeTruthy()
    expect(inner.body.textContent).toContain('2026')
  })

  /**
   * `</script>` anywhere in the escaped frame would close the composite's own
   * script element early and swallow the rest of the document. The frame's
   * closing tag must arrive entity-encoded.
   */
  it('leaves no raw script terminator inside the embedded frame', async () => {
    const html = composite(SHOTS[0]!, await popupFrame('ilpost-italian-news'), 360)
    const raw = html.match(/<\/script>/g) ?? []
    // Exactly one: the composite's own sizing script.
    expect(raw).toHaveLength(1)
    expect(html).toContain('&lt;/script&gt;')
    // The literal a template-escaped `<\/script>` would leave behind, which is
    // a syntax error in raw HTML rather than the tag it looks like.
    expect(html).not.toContain('<\\/script>')
  })

  it('clamps a popup to the height a browser would actually give it', async () => {
    // 789 candidates, some thousands of pixels of list.
    const html = composite(SHOTS[1]!, await popupFrame('csstricks-updated'), 360)
    expect(html).toContain(`const cap = ${POPUP_MAX_HEIGHT}`)
  })

  /**
   * A pinned frame carries its height in CSS and must not also listen for one:
   * the overlay positions itself `fixed`, so a frame that grew to its content
   * would put the readout below the bottom of the canvas.
   */
  it('pins the overlay frame instead of sizing it to content', () => {
    const overlay = SHOTS.find((shot) => shot.kind === 'overlay')
    expect(overlay?.frameHeight).toBeGreaterThan(0)

    const html = composite(overlay!, frameDocument({ css: '', bodyHtml: '<p>page</p>' }), 980)
    expect(html).toContain(`height: ${overlay!.frameHeight}px`)
    expect(html).not.toContain('addEventListener(\'message\'')
  })
})
