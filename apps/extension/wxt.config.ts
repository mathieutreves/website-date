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

    options_ui: {
      page: 'options.html',
      open_in_tab: false,
    },

    browser_specific_settings: {
      gecko: {
        id: 'pagedate@mathieutreves.github.io',
        strict_min_version: '109.0',
      },
    },
  },
})
