import { defineConfig } from 'wxt'

export default defineConfig({
  // MV3 on both targets. WXT defaults Firefox to MV2, where `browser.scripting`
  // does not exist and the popup's only way of reading the page would break.
  // Firefox has supported MV3 since 109, which is the floor set below.
  manifestVersion: 3,

  manifest: {
    name: 'Page Date',
    description:
      'Shows when a page was published and last modified, with where each date came from and how much to trust it.',
    version: '0.1.0',
    default_locale: 'en',

    // On-demand only. An extension that reads every page you visit is a
    // browsing-history side channel; activeTab grants access to one tab, on
    // your click, and asks for nothing at install time.
    permissions: ['activeTab', 'storage', 'scripting'],

    // Requested at the moment a feature needing them is enabled, never upfront,
    // and handed back when it is switched off again. `*://*/*` backs the
    // opt-in "check every page automatically" setting: it is what turns the
    // always-on badge from impossible into a choice the reader makes knowingly,
    // rather than a cost silently folded into installing the extension.
    optional_host_permissions: ['*://*/*', '*://web.archive.org/*'],

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
  },
})
