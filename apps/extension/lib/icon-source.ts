import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

/**
 * The toolbar icon, as arithmetic.
 *
 * Checked-in PNGs with no way to regenerate them are how an icon becomes
 * un-editable: the real source is a designer's file nobody has, so the mark is
 * frozen and the only permitted change is replacing it wholesale. The geometry
 * below *is* the source — a dozen numbers — and `pnpm gen:icons` re-renders
 * every size from it.
 *
 * No image library, on purpose. Rasterising a rounded rectangle, a circle and a
 * diagonal is one page of arithmetic; `sharp` is a per-platform native binary,
 * and carrying one through CI to draw a page and a dot is a bad trade.
 *
 * Split from the generator script for the same reason `locale-source.ts` is:
 * a test imports this and compares it against what is on disk. If the writing
 * happened here, importing it would rewrite the files and the drift check would
 * pass by definition.
 */

/* ------------------------------------------------------------------ the mark */

/*
 * A page with the corner turned down, carrying one line of text and a filled
 * disc.
 *
 * The disc is not decoration. Filled / half / ring is how the popup encodes
 * confidence, and a filled one is a date the site stated outright — so the icon
 * opens with the same alphabet as the panel behind it. The line above it is
 * what stops the disc reading as a hole punched through the page.
 *
 * Geometry is normalised to a 0..1 square, so one description serves every size.
 *
 * Every number is a multiple of 1/16, and that is the whole trick. Normalised
 * geometry rendered at 16px lands its edges mid-pixel, and the antialiaser then
 * does the only thing it can: splits one crisp edge into two grey rows. The text
 * line went first — spanning 0.42..0.48 it came out as two half-lit rows that
 * read as a smudge. Snapped to sixteenths it is exactly one pixel at 16, two at
 * 32, three at 48, and the fold's diagonal is the only thing still being
 * smoothed. 16px is the size nearly everyone will actually see; a mark that
 * resolves at 128 and turns to mush at 16 is a mark that does not work.
 */
const PAGE = { left: 3 / 16, right: 13 / 16, top: 1 / 16, bottom: 15 / 16, radius: 2 / 16 }

/*
 * The turned-down corner: a straight fold from a point along the top edge to a
 * point down the right edge, everything beyond it cut away. Kept shallow — a
 * deep fold eats the line's width and, at 16px, starts reading as a chipped
 * rectangle rather than as a page.
 */
const FOLD = { alongTop: 8 / 16, downRight: 5 / 16 }

/** Centred, in the lower half. When the badge is on, the browser paints it over
 *  the bottom-right of this square and takes part of the disc with it — the
 *  silhouette and the fold are what stay identifiable underneath, which is why
 *  the outline does the identifying and the interior only qualifies it. */
const DISC = { x: 8 / 16, y: 11 / 16, radius: 2 / 16 }

/** Squared off, not rounded: at 16px this is one pixel tall, and rounding the
 *  ends of a one-pixel bar erases it. */
const LINE = { left: 5 / 16, right: 11 / 16, top: 7 / 16, bottom: 8 / 16 }

/**
 * The declared-confidence teal, `--declared` from the popup's dark ramp.
 *
 * A toolbar is light on one machine and near-black on another, and the icon
 * cannot ask which. That rules out both ends of the ramp — dark ink vanishes on
 * a dark toolbar, pale ink on a light one. This is the middle step, and it holds
 * on either.
 */
const INK = [13, 148, 136] as const

/** Inside the page, short of the folded corner, clear of the disc and the line. */
function covered(x: number, y: number): boolean {
  return insideRoundedRect(x, y) && !beyondFold(x, y) && !insideDisc(x, y) && !insideLine(x, y)
}

function insideRoundedRect(x: number, y: number): boolean {
  const { left, right, top, bottom, radius } = PAGE
  if (x < left || x > right || y < top || y > bottom) return false
  // Clamp into the inner rectangle and measure: inside the straight edges that
  // distance is zero, and around a corner it is the arc.
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  return Math.hypot(x - cx, y - cy) <= radius
}

/**
 * Which side of the fold a point falls on, by the sign of the 2-D cross product
 * of the fold's direction with it. Better behaved than comparing slopes, which
 * divides by zero the moment the fold approaches axis-aligned.
 */
function beyondFold(x: number, y: number): boolean {
  const ax = FOLD.alongTop
  const ay = PAGE.top
  const dx = PAGE.right - ax
  const dy = FOLD.downRight - ay
  return dx * (y - ay) - dy * (x - ax) < 0
}

const insideDisc = (x: number, y: number): boolean =>
  Math.hypot(x - DISC.x, y - DISC.y) <= DISC.radius

const insideLine = (x: number, y: number): boolean =>
  x >= LINE.left && x <= LINE.right && y >= LINE.top && y <= LINE.bottom

/* ------------------------------------------------------------- rasterisation */

/**
 * 4×4 supersampling.
 *
 * The browser does no smoothing of its own — whatever is in the file is what the
 * toolbar shows — and at 16px a hard edge is the difference between a page and a
 * smudge. Sixteen samples per pixel is where the fold's diagonal stops looking
 * like a staircase; more is invisible.
 */
const SAMPLES = 4

/** Straight RGBA, one byte per channel, no filter bytes and no padding. */
export function renderPixels(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (covered((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size))
            hits++
        }
      }
      const at = (py * size + px) * 4
      pixels[at] = INK[0]
      pixels[at + 1] = INK[1]
      pixels[at + 2] = INK[2]
      // Unassociated alpha, which is what PNG stores. Premultiplying here would
      // darken every edge pixel against a light toolbar.
      pixels[at + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255)
    }
  }

  return pixels
}

/* --------------------------------------------------------------- PNG encoding */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const tail = Buffer.alloc(4)
  // The CRC covers the type and the data, but not the length.
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, tail])
}

/** 8-bit RGBA, no interlacing, one filter-type-0 byte per scanline. */
export function encodePng(size: number, pixels: Buffer): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour with alpha
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter method: adaptive
  ihdr[12] = 0 // no interlace

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let row = 0; row < size; row++) {
    raw[row * (stride + 1)] = 0 // filter type: none
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export const renderIcon = (size: number): Buffer => encodePng(size, renderPixels(size))

/* ----------------------------------------------------------------- the sizes */

/*
 * 16 and 32 are the toolbar at 1× and 2×. 48 is the browser's extensions page,
 * 96 is Firefox's about:addons, and 128 is both stores' listing image as well as
 * what Chrome scales down whenever it has no exact match.
 *
 * WXT discovers these by filename — `public/icon/<size>.png` becomes
 * `manifest.icons` with no configuration — which is why the layout below is not
 * a matter of taste.
 */
export const ICON_SIZES = [16, 32, 48, 96, 128] as const

export const iconDir = (root: string): string => join(root, 'public', 'icon')

export const iconFilePath = (root: string, size: number): string =>
  join(iconDir(root), `${size}.png`)
