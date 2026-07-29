import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ICON_SIZES, iconFilePath, renderPixels } from '../lib/icon-source.js'

/**
 * The icons on disk still match the geometry that generated them.
 *
 * Comparing decoded pixels rather than file bytes is deliberate: deflate output
 * is a function of the zlib build, so a byte comparison would go red on a CI
 * image with a different Node than the one that last ran the generator — a
 * failure that says nothing about the icon.
 */

const ROOT = join(import.meta.dirname, '..')

type Png = { width: number; height: number; pixels: Buffer }

/** Enough of a PNG reader for files this module wrote: 8-bit RGBA, filter 0. */
function decode(file: Buffer): Png {
  expect([...file.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  let offset = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []

  while (offset < file.length) {
    const length = file.readUInt32BE(offset)
    const type = file.toString('ascii', offset + 4, offset + 8)
    const data = file.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect(data[8], 'bit depth').toBe(8)
      expect(data[9], 'colour type').toBe(6)
      expect(data[12], 'interlace').toBe(0)
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }

  const stride = width * 4
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(stride * height)
  for (let row = 0; row < height; row++) {
    expect(raw[row * (stride + 1)], `filter byte on row ${row}`).toBe(0)
    raw.copy(pixels, row * stride, row * (stride + 1) + 1, (row + 1) * (stride + 1))
  }

  return { width, height, pixels }
}

describe.each(ICON_SIZES)('icon/%i.png', (size) => {
  const png = decode(readFileSync(iconFilePath(ROOT, size)))

  it('is square, at the size its filename claims', () => {
    // WXT reads the size out of the filename and writes it into the manifest,
    // so a mismatch here is a manifest that lies to the browser.
    expect([png.width, png.height]).toEqual([size, size])
  })

  it('matches the geometry it is generated from', () => {
    expect(png.pixels.equals(renderPixels(size))).toBe(true)
  })

  it('leaves the corners transparent', () => {
    // A square of solid colour is what you get when the mark failed to render
    // and the background survived; the page has rounded corners, so it cannot
    // reach them.
    const alphaAt = (x: number, y: number) => png.pixels[(y * size + x) * 4 + 3]
    expect(alphaAt(0, 0)).toBe(0)
    expect(alphaAt(size - 1, 0)).toBe(0)
    expect(alphaAt(0, size - 1)).toBe(0)
    expect(alphaAt(size - 1, size - 1)).toBe(0)
  })

  it('is mostly opaque ink, so it reads as a silhouette', () => {
    let opaque = 0
    for (let at = 3; at < png.pixels.length; at += 4) {
      if (png.pixels[at]! > 250) opaque++
    }
    // Loose bounds on purpose: this catches an empty or a full square, not a
    // change of taste in the geometry.
    const share = opaque / (size * size)
    expect(share).toBeGreaterThan(0.3)
    expect(share).toBeLessThan(0.75)
  })
})
