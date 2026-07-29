import { fileURLToPath } from 'node:url'
import { defineConfig } from 'wxt'

/**
 * The workspace root, not this package. `zip.sourcesRoot` below needs an
 * absolute path — WXT passes it straight to `path.relative`, so a relative one
 * silently produces a zip rooted in the wrong place.
 */
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  // MV3 on both targets. WXT defaults Firefox to MV2, where `browser.scripting`
  // does not exist and the popup's only way of reading the page would break.
  // Firefox has supported MV3 since 109, which is the floor set below.
  manifestVersion: 3,

  manifest: ({ browser }) => ({
    // Placeholders, resolved by the browser against the active
    // `_locales/<code>/messages.json`. These two strings are the ones every
    // reader sees *before* installing — the store listing and the extensions
    // page — so spelling the English out here would have left them untranslated
    // for exactly the audience the rest of the UI translates itself for.
    //
    // The catalogues are generated from lib/messages.ts and lib/locales/, so
    // `extName` and `extDescription` are ordinary keys with the same drift
    // check as every other message. `extName` is the same in every locale on
    // purpose: it is what the listing is called and what people search for.
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',

    // `version` is deliberately absent: WXT falls back to the one in
    // package.json, so there is a single number to bump. Setting it here too
    // lets the store build and the workspace disagree.
    //
    // `icons` is absent for a different reason: WXT discovers them from
    // public/icon/{16,32,48,96,128}.png and writes the manifest key itself.
    // Both stores reject a submission without a 128; ci.yml asserts the four
    // the stores require reach the built manifest, so that failure happens here
    // rather than on upload. 96 is not among them — it is there because it is
    // what Firefox's about:addons actually renders.

    // On-demand only. An extension that reads every page you visit is a
    // browsing-history side channel; activeTab grants access to one tab, on
    // your click, and asks for nothing at install time.
    //
    // Identical on both browsers, because nothing is parsed in the background.
    // Extraction runs in the tab, where a DOM already exists, so Chrome never
    // needs `offscreen` to borrow a `DOMParser` its service worker lacks — and
    // there is no Chrome/Firefox fork here to keep in step. See
    // entrypoints/extract.ts.
    //
    // `contextMenus` is the one addition that is not on-demand, and it is the
    // cheapest permission in the list: it grants the ability to *put an entry
    // in a menu* and nothing else. Neither store shows a warning for it, because
    // there is no data behind it. The entry does no work until it is clicked,
    // and the click is what authorises the one page it then reads.
    permissions: ['activeTab', 'storage', 'scripting', 'contextMenus'],

    // Requested at the moment a feature needing them is enabled, never upfront,
    // and handed back when it is switched off again. `*://*/*` backs the
    // opt-in "check every page automatically" setting: it is what turns the
    // always-on badge from impossible into a choice the reader makes knowingly,
    // rather than a cost silently folded into installing the extension.
    //
    // The search-engine origins are listed separately from `*://*/*` on purpose,
    // even though the latter would subsume them. Annotating results at the
    // cheap tier needs access to five engines and to nothing else, and asking
    // for that is a far smaller thing than asking for the whole web — a
    // difference the browser's own prompt states in words, and which collapsing
    // them into one pattern would erase. See lib/settings.ts.
    optional_host_permissions: [
      '*://*/*',
      '*://web.archive.org/*',
      '*://*.google.com/*',
      '*://*.bing.com/*',
      '*://duckduckgo.com/*',
      '*://news.ycombinator.com/*',
      '*://old.reddit.com/*',
    ],

    // `options_ui.open_in_tab` is not set here: WXT owns that key and reads it
    // from a meta tag on entrypoints/options/index.html.

    browser_specific_settings: {
      gecko: {
        id: 'pagedate@mathieutreves.github.io',
        strict_min_version: '109.0',
      },
      // Android is declared separately, and later: Firefox for Android only
      // opened up to general add-ons in 120. It is also the only mobile browser
      // worth targeting — Chrome for Android has no extensions at all, and
      // Safari would need a native wrapper and an App Store listing.
      //
      // The toolbar badge is close to invisible there, since the icon lives
      // inside the ⋮ menu. On Android the on-page readout is not a convenience,
      // it is the only ambient surface available.
      gecko_android: {
        strict_min_version: '120.0',
      },
    },
  }),

  /**
   * `wxt zip -b firefox` also emits a sources zip, because Vite minifies and
   * AMO therefore requires source: reviewers rebuild it and diff the result
   * against the uploaded XPI, and "there must be no differences".
   *
   * WXT roots that zip at this package by default, which cannot work here.
   * `pagedate` is a `workspace:*` dependency, so a zip containing only
   * apps/extension has no lockfile, no pnpm-workspace.yaml and no library to
   * build against — a guaranteed failed review. Rooting it at the workspace
   * means what reviewers receive is what CI builds.
   */
  zip: {
    // Otherwise the artifacts are named from the package name, `@website-date/
    // extension`, run through WXT's filename sanitiser.
    name: 'page-date',
    sourcesRoot: workspaceRoot,

    // Everything the benchmark needs and the build does not. corpus/ alone is
    // ~53 MB of other people's HTML under no licence we control — sending it
    // to a reviewer would be both pointless and not ours to send. Dot
    // directories (.output, .wxt, .git) need no entry: WXT's glob skips them.
    excludeSources: [
      'corpus/**',
      'corpus-external/**',
      'fixtures/**',
      'bench/**',
      'results/**',
      // Build output, which the reviewer's own build regenerates. Shipping a
      // prebuilt copy invites the reviewer to diff against a stale artifact.
      '**/dist/**',
      // Store listing assets. Generated, and no part of the extension.
      'apps/extension/screenshots/**',
    ],
  },
})
