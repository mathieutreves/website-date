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

    // On-demand only. An extension that reads every page you visit is a
    // browsing-history side channel; activeTab grants access to one tab, on
    // your click, and asks for nothing at install time. The always-on banner
    // is deliberately deferred — it would require <all_urls>.
    permissions: ['activeTab', 'storage', 'scripting'],

    // Requested at the moment a feature needing them is enabled, never upfront.
    optional_host_permissions: ['*://web.archive.org/*'],

    browser_specific_settings: {
      gecko: {
        id: 'pagedate@mathieutreves.github.io',
        strict_min_version: '109.0',
      },
    },
  },
})
