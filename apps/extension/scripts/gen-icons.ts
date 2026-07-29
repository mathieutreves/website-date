import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ICON_SIZES, iconDir, iconFilePath, renderIcon } from '../lib/icon-source.js'

/**
 * Write `public/icon/<size>.png` for every size the browsers ask for.
 *
 * The mark itself lives in `lib/icon-source.ts`; this only puts it on disk.
 * `icons.test.ts` fails if this has not been re-run after the geometry changed.
 */

const root = join(import.meta.dirname, '..')
mkdirSync(iconDir(root), { recursive: true })
for (const size of ICON_SIZES) {
  writeFileSync(iconFilePath(root, size), renderIcon(size))
}
console.log(`wrote ${ICON_SIZES.length} icons to ${iconDir(root)}`)
