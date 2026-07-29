import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOMParser } from 'linkedom'
import { extractFromDocument, resolve, type DateResult, type Env } from 'pagedate'
import { overlayData, paintOverlay } from '../lib/overlay.js'
import { DEFAULTS } from '../lib/settings.js'
import {
  CANVAS,
  SHOTS,
  composite,
  contactSheet,
  frameDocument,
  mockArticle,
  mockArticleCss,
  type Shot,
} from '../lib/screenshot-source.js'
import { optionsView } from '../entrypoints/options/render.js'
import { view } from '../entrypoints/popup/render.js'

/**
 * Build the store screenshots from the real UI.
 *
 *   pnpm gen:screenshots
 *
 * Writes one self-contained ${CANVAS.width}×${CANVAS.height} HTML page per
 * shot into `screenshots/`, plus a contact sheet with the capture recipe.
 * Nothing here rasterises: turning HTML into PNG needs a browser, and this
 * environment has none — so the last step is a DevTools capture, which is also
 * the only way to be certain the pixels came from a real browser's renderer
 * rather than an approximation of one.
 *
 * The point of generating them is that they cannot drift. Change the popup and
 * the screenshots change with it; a hand-built mock in a design tool would go
 * on advertising last year's layout indefinitely.
 */

const root = join(import.meta.dirname, '..')
const fixtures = join(root, '..', '..', 'fixtures')
const outDir = join(root, 'screenshots')

/**
 * Pinned, and matching `test/pipeline.test.ts`.
 *
 * Every headline in these shots is a relative age, so a wall-clock `now` would
 * mean the output changed on days nobody touched the code — which makes the
 * drift check meaningless and every regeneration a diff. Bump this when the
 * fixtures are recaptured.
 */
const NOW = new Date('2026-07-29T00:00:00Z')

/** The popup's env, minus the network: fixtures are captured with their feeds. */
const offlineEnv = (): Env => ({
  fetchText: async () => null,
  parseXml: (xml) => {
    try {
      return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
    } catch {
      return null
    }
  },
})

const css = (entrypoint: string): string =>
  readFileSync(join(root, 'entrypoints', entrypoint, 'style.css'), 'utf8')

/** The same read-extract-resolve the popup performs, against a captured page. */
async function analyseFixture(slug: string): Promise<{ result: DateResult; url: string }> {
  const { url } = JSON.parse(readFileSync(join(fixtures, slug, 'expected.json'), 'utf8')) as {
    url: string
  }
  const html = readFileSync(join(fixtures, slug, 'page.html'), 'utf8')
  const doc = new DOMParser().parseFromString(html, 'text/html') as unknown as Document
  const result = await resolve(extractFromDocument(doc, url), url, offlineEnv(), { now: NOW })
  return { result, url }
}

/** Widths the frame is laid out at, before the shot's scale is applied. */
const FRAME_WIDTH: Record<Shot['kind'], number> = {
  // The popup's own width, from `body { width: 360px }`. Anything else would
  // photograph a panel that does not exist.
  popup: 360,
  options: 820,
  overlay: 980,
}

async function build(shot: Shot): Promise<string> {
  if (shot.kind === 'popup') {
    if (!shot.fixture) throw new Error(`${shot.id}: a popup shot needs a fixture`)
    const { result, url } = await analyseFixture(shot.fixture)
    return frameDocument({
      css: css('popup'),
      // The popup's own wrapper — `#app` is styled, so rendering `view()` bare
      // would produce a panel with none of its own padding.
      bodyHtml: `<main id="app">${view(result, url, { now: NOW, dateFormat: DEFAULTS.dateFormat })}</main>`,
    })
  }

  if (shot.kind === 'options') {
    /*
     * The real defaults, not a configured state.
     *
     * Every capability is off here, which is the claim the caption makes, and
     * a screenshot that quietly showed them switched on would be advertising
     * the opposite of the design. It also means the overlay controls render
     * disabled — correct, and the reason they are disabled rather than hidden.
     */
    return frameDocument({
      css: css('options'),
      bodyHtml: `<main id="app">${optionsView(DEFAULTS, { count: 128, bytes: 41_984 })}</main>`,
    })
  }

  if (!shot.fixture) throw new Error(`${shot.id}: an overlay shot needs a fixture`)
  const { result } = await analyseFixture(shot.fixture)
  const data = overlayData(result, NOW, 'always', DEFAULTS.overlayPosition, DEFAULTS.dateFormat)
  if (!data) throw new Error(`${shot.id}: ${shot.fixture} produced no overlay`)

  /*
   * The real injected renderer, serialised exactly as `executeScript` does it.
   *
   * `paintOverlay` is documented as self-contained for that reason — it closes
   * over nothing — so `toString()` is a faithful copy rather than a
   * reimplementation that could drift from what the extension actually draws.
   */
  return frameDocument({
    css: mockArticleCss(),
    bodyHtml: mockArticle(),
    script: `(${paintOverlay.toString()})(${JSON.stringify(data).replace(/<\//g, '<\\/')})`,
  })
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

for (const shot of SHOTS) {
  const frame = await build(shot)
  const width = FRAME_WIDTH[shot.kind]
  writeFileSync(join(outDir, `${shot.id}.html`), composite(shot, frame, width))
}

writeFileSync(join(outDir, 'index.html'), contactSheet(SHOTS))

console.log(
  `wrote ${SHOTS.length} shots at ${CANVAS.width}×${CANVAS.height} to ${outDir}\n` +
    `open screenshots/index.html for the capture recipe`,
)
