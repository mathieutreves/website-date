/**
 * Store screenshots, composed from the real UI.
 *
 * The Chrome Web Store wants 1280×800. The popup is 360px wide, so a 1:1
 * capture fills 8% of the canvas — which is why store screenshots are scenes
 * rather than screen captures, and why they are usually mocked up by hand in a
 * design tool and then quietly drift from the product they advertise.
 *
 * These do not drift. Every pixel of UI in them is the real `view()` and
 * `optionsView()` output, rendered from real fixture pages through the real
 * pipeline, styled by the real stylesheet, with the real `paintOverlay` — the
 * same function `executeScript` injects — serialised into the page. Only the
 * canvas around it is composed here.
 *
 * Nothing in this file touches the filesystem or the entrypoints, so it stays
 * testable and `lib/` stays the layer that `entrypoints/` consumes rather than
 * the other way round. `scripts/gen-screenshots.ts` supplies the rendered HTML.
 */

export const CANVAS = { width: 1280, height: 800 } as const

/**
 * What a browser actually gives a popup, and therefore what the shot may show.
 *
 * Chrome and Firefox both cap a browser action popup at 600px and scroll past
 * it. A frame grown to its content would photograph a panel no user can see —
 * on the css-tricks page that is 789 candidates and some thousands of pixels.
 * Clamping here is not cropping the truth; it is the truth.
 */
export const POPUP_MAX_HEIGHT = 600

/** What the store accepts. 640×400 is legal too; this is the one that reads. */
export type CanvasSize = typeof CANVAS

export type ShotKind = 'popup' | 'options' | 'overlay'

export type Shot = {
  /** Also the filename, so the store's upload order is the sort order. */
  id: string
  kind: ShotKind
  /** Fixture slug under /fixtures. Absent for shots with no page behind them. */
  fixture?: string
  eyebrow: string
  title: string
  body: string
  /**
   * How much to magnify the UI on the canvas. The popup's 11px labels are the
   * point of the whole extension and are illegible in a store thumbnail at
   * 1:1, so the detail shots are enlarged; the scene shots are not.
   */
  scale: number
  /** Stacked for full-width surfaces, split for the popup. */
  layout: 'split' | 'stacked'
  /**
   * Pin the frame's height instead of letting it size to its content.
   *
   * Needed by the overlay shot and only by it: `paintOverlay` positions itself
   * `fixed`, which inside a frame means relative to the frame's viewport. A
   * frame grown to fit its article puts the readout at the bottom of the
   * article — past the bottom of the canvas — rather than at the bottom of the
   * window it is supposed to be sitting in.
   */
  frameHeight?: number
}

/**
 * Six shots for five slots — Chrome takes five, so one is dropped deliberately
 * rather than by whichever was generated last.
 *
 * The order is an argument. It opens with what the thing does, then
 * immediately with the thing nothing else does: every competitor surveyed in
 * the design doc returns a date, and none of them will tell you the page is
 * lying about it. That belongs second, not fifth.
 */
export const SHOTS: Shot[] = [
  {
    id: '01-provenance',
    kind: 'popup',
    fixture: 'ilpost-italian-news',
    eyebrow: 'Where the date came from',
    title: 'Not just when.\nHow we know.',
    body: 'Every date carries its source and how far to trust it — stated by the site, read from the markup, or inferred. Three tiers, marked by shape and colour as well as words.',
    scale: 1.5,
    layout: 'split',
  },
  {
    id: '02-conflict',
    kind: 'popup',
    fixture: 'csstricks-updated',
    eyebrow: 'The part nobody else does',
    title: 'When a page is\nolder than it says',
    body: 'This guide declares a date from this year, but carries 334 dated elements going back to 2013. Other extractors return the claim. This one tells you the claim is a republication.',
    scale: 1.5,
    layout: 'split',
  },
  {
    id: '03-spread',
    kind: 'popup',
    fixture: 'stackoverflow-answer',
    eyebrow: 'All the evidence, not one number',
    title: 'Fifty-two dates,\nfourteen years apart',
    body: 'Pages rarely carry one date. The spread shows every candidate found and where the answer sits among them, so a confident-looking result never hides a messy page.',
    scale: 1.5,
    layout: 'split',
  },
  {
    id: '04-honest',
    kind: 'popup',
    fixture: 'vitepress-docs',
    eyebrow: 'No invented answers',
    title: 'It says when\nit does not know',
    body: 'This page states when it was updated and never claims a publication date. So that is exactly what is reported — the absence out loud, rather than a guess dressed as a fact.',
    scale: 1.5,
    layout: 'split',
  },
  {
    id: '05-overlay',
    kind: 'overlay',
    fixture: 'simonwillison-post',
    eyebrow: 'Optional, and off by default',
    title: 'The age of the page,\nin the corner of it',
    body: 'Switch it on and every page carries its own age quietly, with no click at all. Switch it off and the permission it needed is handed straight back.',
    scale: 1,
    layout: 'stacked',
    frameHeight: 468,
  },
  {
    id: '06-settings',
    kind: 'options',
    eyebrow: 'Nothing on that you did not turn on',
    title: 'Asks for nothing\nat install time',
    body: 'Reading every page and checking the Internet Archive are both off until you enable them, and each requests its permission at that moment — not upfront, and not for ever.',
    // 1:1. The options page sets its own 560px column and uses larger type
    // than the popup, so it is already legible; magnifying it would only show
    // less of it.
    scale: 1,
    layout: 'stacked',
  },
]

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

/** Enough for both text nodes and the `srcdoc` attribute the frames ride in. */
export const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ESCAPES[c] as string)

/**
 * The document that goes inside the frame: the real stylesheet, the real
 * markup, and nothing else of ours.
 *
 * `color-scheme` is pinned rather than left to `light dark`. The stylesheet
 * follows the OS, which is right in the product and wrong here — it would mean
 * the screenshots came out light or dark depending on whose machine last ran
 * the generator, and the store listing is not the place to discover that.
 *
 * The height message is the only script: a frame cannot size itself to its
 * content from the outside, and `contentDocument` is unreachable across the
 * opaque origins a `file://` page gets. `postMessage` crosses that.
 */
export function frameDocument(options: {
  css: string
  bodyHtml: string
  scheme?: 'light' | 'dark'
  /** Extra rules applied after the real stylesheet, for the mock page only. */
  extraCss?: string
  /** Runs after the body is parsed. Used to inject the real overlay. */
  script?: string
}): string {
  const { css, bodyHtml, scheme = 'light', extraCss = '', script = '' } = options
  return `<!doctype html>
<html lang="en" style="color-scheme: ${scheme}">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${scheme}">
<style>${css}</style>
<style>:root { color-scheme: ${scheme}; }${extraCss}</style>
</head>
<body>
${bodyHtml}
<script>
${script}
const post = () => parent.postMessage(
  { pagedateShot: true, height: document.documentElement.scrollHeight },
  '*',
)
post()
addEventListener('load', post)
new ResizeObserver(post).observe(document.documentElement)
<\/script>
</body>
</html>`
}

/**
 * A generic article to sit behind the overlay.
 *
 * Deliberately not one of the fixtures. The overlay shot has to show the
 * readout on top of a page, and putting a real publication's article — masthead,
 * headline and all — into a store listing means advertising with someone else's
 * work. The overlay itself is a genuine render of a real fixture's dates; only
 * the paper under it is invented, and it is drawn to look like an illustration
 * rather than an imitation of any real site.
 */
export const mockArticle = (): string => `
<article class="mock">
  <p class="kicker">Essay</p>
  <h1>Everything on the web has a date, and almost nothing shows it</h1>
  <p class="lede">The date is nearly always there — in the structured data, in a
  meta tag, in the feed. It just is not on the page, where a reader could use it.</p>
  <p>A page with no visible date is not a page with no date. Publishers put it in
  JSON-LD for search engines, in OpenGraph for social cards, and in their feed for
  subscribers, and then leave it out of the layout because it makes old writing
  look old.</p>
  <p>Which leaves the reader doing forensics: scrolling for a comment thread,
  checking whether the design looks dated, guessing from the technologies
  mentioned. All to answer a question the page already knows the answer to.</p>
  <p>Worse are the pages that answer it wrongly. A guide first published a decade
  ago, edited lightly and stamped with today's date, is not a new article — but
  every tool that reads its declared date will say it is.</p>
</article>`

/** Styling for the mock page above. Nothing here is product CSS. */
export const mockArticleCss = (): string => `
body { width: auto; margin: 0; background: #fbfbfa; }
.mock {
  max-width: 46rem;
  margin: 0 auto;
  padding: 4.5rem 3rem 6rem;
  font: 17px/1.65 Georgia, 'Times New Roman', serif;
  color: #23262b;
}
.mock .kicker {
  margin: 0 0 1.25rem;
  font: 600 11px/1 system-ui, sans-serif;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8a9099;
}
.mock h1 {
  margin: 0 0 1.5rem;
  font: 700 40px/1.15 Georgia, 'Times New Roman', serif;
  letter-spacing: -0.015em;
}
.mock .lede { font-size: 20px; line-height: 1.55; color: #464b53; }
.mock p { margin: 0 0 1.15rem; }`

/**
 * The 1280×800 canvas.
 *
 * Everything here is chrome around the UI, and it is built to lose. Dark ink on
 * a near-white ground, one accent, no gradients behind text — a store thumbnail
 * is ~300px wide, so the title has to survive being shrunk to a quarter size
 * and the UI has to be the brightest object on the canvas.
 */
export function composite(shot: Shot, frameSrcdoc: string, frameWidth: number): string {
  const title = escapeHtml(shot.title)
    .split('\n')
    .join('<br>')

  return `<!doctype html>
<html lang="en" style="color-scheme: light">
<head>
<meta charset="utf-8">
<title>${escapeHtml(shot.id)} — Page Date store screenshot</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #55606d; }
  /*
   * Exact, and not responsive. This page has one job: be captured at
   * ${CANVAS.width}×${CANVAS.height}. A layout that reflowed at other sizes
   * would only make it possible to capture the wrong thing.
   */
  .canvas {
    position: relative;
    width: ${CANVAS.width}px;
    height: ${CANVAS.height}px;
    overflow: hidden;
    background:
      radial-gradient(120% 90% at 8% 0%, #ffffff 0%, #eef1f5 46%, #e4e9ef 100%);
    font: 400 17px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #1b1e24;
    display: grid;
    ${
      shot.layout === 'split'
        ? `grid-template-columns: 470px 1fr;
    align-items: center;
    gap: 56px;
    padding: 0 64px;`
        : `grid-template-rows: auto 1fr;
    gap: 30px;
    padding: 60px 64px 0;`
    }
  }
  /* One accent, used twice: the rule above the eyebrow and nothing else. */
  .eyebrow {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 18px;
    font: 600 12.5px/1 system-ui, sans-serif;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: #0f766e;
  }
  .eyebrow::before {
    content: '';
    width: 26px;
    height: 3px;
    border-radius: 2px;
    background: #0f766e;
  }
  h1 {
    margin: 0 0 ${shot.layout === 'split' ? '20px' : '14px'};
    font-weight: 660;
    font-size: ${shot.layout === 'split' ? '46px' : '40px'};
    line-height: 1.08;
    letter-spacing: -0.026em;
  }
  .body {
    margin: 0;
    max-width: ${shot.layout === 'split' ? '100%' : '62ch'};
    font-size: ${shot.layout === 'split' ? '17.5px' : '17px'};
    line-height: 1.55;
    color: #4a515b;
  }
  .stage {
    display: flex;
    ${
      shot.layout === 'split'
        ? 'align-items: center; justify-content: center;'
        : 'align-items: flex-start; justify-content: center;'
    }
    min-width: 0;
    min-height: 0;
  }
  /*
   * The frame is laid out at its true CSS width and scaled from the top-left,
   * so the wrapper has to carry the scaled box or the grid centres the
   * unscaled one and everything lands off-axis.
   */
  .scaler {
    position: relative;
    width: ${Math.round(frameWidth * shot.scale)}px;
    ${shot.frameHeight ? `height: ${Math.round(shot.frameHeight * shot.scale)}px;` : ''}
  }
  .scaler iframe {
    display: block;
    border: 0;
    width: ${frameWidth}px;
    ${shot.frameHeight ? `height: ${shot.frameHeight}px;` : ''}
    transform: scale(${shot.scale});
    transform-origin: top left;
  }
  /* The popup is an object floating over the browser, so it casts a shadow and
     the page surfaces do not. */
  .popup .scaler {
    border-radius: 13px;
    overflow: hidden;
    box-shadow:
      0 1px 1px rgba(20, 26, 36, 0.06),
      0 8px 18px -6px rgba(20, 26, 36, 0.18),
      0 34px 60px -22px rgba(20, 26, 36, 0.34);
  }
  /* Browser chrome, reduced to the two cues that say "this is a window". */
  .window {
    width: ${Math.round(frameWidth * shot.scale)}px;
    border-radius: 12px 12px 0 0;
    overflow: hidden;
    background: #fff;
    box-shadow:
      0 -1px 0 rgba(20, 26, 36, 0.07) inset,
      0 12px 26px -10px rgba(20, 26, 36, 0.22),
      0 44px 70px -30px rgba(20, 26, 36, 0.3);
  }
  .titlebar {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 42px;
    padding: 0 16px;
    background: #e9edf2;
    border-bottom: 1px solid #d7dde5;
  }
  .dots { display: flex; gap: 7px; }
  .dots i { width: 11px; height: 11px; border-radius: 50%; background: #c6ced8; }
  .omnibox {
    flex: 1;
    height: 24px;
    border-radius: 12px;
    background: #fbfcfd;
    border: 1px solid #d9dfe7;
  }
  .window .scaler iframe { width: ${frameWidth}px; }
</style>
</head>
<body>
  <div class="canvas ${shot.kind === 'popup' ? 'popup' : ''}">
    <div class="caption">
      <p class="eyebrow">${escapeHtml(shot.eyebrow)}</p>
      <h1>${title}</h1>
      <p class="body">${escapeHtml(shot.body)}</p>
    </div>
    <div class="stage">
      ${
        shot.kind === 'popup'
          ? `<div class="scaler"><iframe id="frame" scrolling="no" srcdoc="${escapeHtml(frameSrcdoc)}"></iframe></div>`
          : `<div class="window"><div class="titlebar"><span class="dots"><i></i><i></i><i></i></span><span class="omnibox"></span></div><div class="scaler"><iframe id="frame" scrolling="no" srcdoc="${escapeHtml(frameSrcdoc)}"></iframe></div></div>`
      }
    </div>
  </div>
${
  shot.frameHeight
    ? ''
    : `<script>
  const frame = document.getElementById('frame')
  const scaler = frame.parentElement
  const cap = ${shot.kind === 'popup' ? POPUP_MAX_HEIGHT : Infinity}
  addEventListener('message', (event) => {
    if (!event.data || !event.data.pagedateShot) return
    const height = Math.min(event.data.height, cap)
    frame.style.height = height + 'px'
    scaler.style.height = height * ${shot.scale} + 'px'
  })
</script>`
}
</body>
</html>`
}

/** A contact sheet, so the set is reviewed together rather than one at a time. */
export function contactSheet(shots: Shot[]): string {
  const cards = shots
    .map(
      (shot, index) => `
    <a class="card" href="./${escapeHtml(shot.id)}.html">
      <span class="n">${index + 1}</span>
      <span class="meta">
        <strong>${escapeHtml(shot.id)}</strong>
        <em>${escapeHtml(shot.eyebrow)}</em>
      </span>
    </a>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en" style="color-scheme: light">
<head>
<meta charset="utf-8">
<title>Page Date — store screenshots</title>
<style>
  body {
    margin: 0 auto;
    padding: 48px 32px 72px;
    max-width: 60rem;
    background: #fbfcfd;
    color: #1b1e24;
    font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 6px; }
  p.sub { margin: 0 0 32px; color: #5a616b; }
  ol { padding-left: 1.2rem; color: #3c424b; }
  li { margin-bottom: 6px; }
  code { background: #eef1f5; padding: 1px 5px; border-radius: 4px; font-size: 14px; }
  .grid { display: grid; gap: 10px; margin: 28px 0 40px; }
  .card {
    display: flex; align-items: center; gap: 16px;
    padding: 14px 18px; border: 1px solid #e2e7ed; border-radius: 10px;
    background: #fff; text-decoration: none; color: inherit;
  }
  .card:hover { border-color: #0f766e; }
  .n {
    width: 26px; height: 26px; flex: none; border-radius: 50%;
    background: #0f766e; color: #fff;
    font: 600 13px/26px system-ui, sans-serif; text-align: center;
  }
  .meta { display: flex; flex-direction: column; }
  .meta em { font-style: normal; font-size: 14px; color: #6a717b; }
</style>
</head>
<body>
  <h1>Store screenshots</h1>
  <p class="sub">${CANVAS.width}×${CANVAS.height}, generated from the real UI. Chrome accepts five.</p>
  <div class="grid">${cards}</div>
  <h2>Capturing them</h2>
  <ol>
    <li>Open a shot in Chrome and press <code>F12</code>.</li>
    <li>Toggle the device toolbar (<code>Ctrl+Shift+M</code>), pick <strong>Responsive</strong>,
        and set the size to <code>${CANVAS.width} × ${CANVAS.height}</code> with <strong>DPR 1</strong>.</li>
    <li>Device-toolbar <code>⋮</code> menu → <strong>Capture screenshot</strong>.</li>
  </ol>
  <p>That writes exactly ${CANVAS.width}×${CANVAS.height} — no cropping, and no
     chance of a 2× capture the store will reject. Re-run
     <code>pnpm gen:screenshots</code> after any UI change and recapture.</p>
</body>
</html>`
}
