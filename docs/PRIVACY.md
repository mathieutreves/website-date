# Privacy policy — Page Date

Last updated: 30 September 2026. Applies to the Page Date browser extension for Chrome and Firefox.

## Summary

Page Date has no servers, no accounts, no analytics and no telemetry. Nothing you do with it is sent to the developer. Everything it stores stays on the device that stored it.

On its default settings Page Date makes no network request of its own: it reads the page your browser has already loaded. Requests leave your browser only in the cases listed below, each of which you have to ask for: to the Internet Archive, if you switch that on; to a page whose link you right-clicked; and to search results, if you switch on the tier that reads them.

## What is stored, and where

Everything is held in the browser's own `storage.local` for this extension. It is never written to `storage.sync`, so it does not travel between your devices, and it is deleted when you uninstall the extension.

**Your settings.** Which date format you prefer, whether the on-page overlay is shown and where, whether automatic reading is on, whether Internet Archive lookups are off, asked for, or automatic, whether the right-click entry is shown, and whether search results are annotated and at which tier.

**A result cache.** For each page Page Date has analysed, one entry holding the page's URL (without any `#fragment`) and the dates found for it, so that revisiting a page does not require re-reading it. It is a record of pages the extension analysed, which on the default settings means pages whose toolbar icon you clicked.

The cache is bounded in three ways:

- **Seven days.** An entry older than that is never used, and is deleted the next time the extension's background worker starts or a new result is stored. Between those moments an expired entry can still be on disk; it is not read.
- **300 pages and 4 MB.** Past either limit the oldest entries are deleted first.
- **Not in private windows.** A page analysed in a private or incognito window is shown and not written to the cache.

A page reached by an in-page navigation, where a site changes the address without loading a new page, is also shown without being cached, because the extension cannot be sure the page's metadata has caught up with its address.

The options page shows how large this cache is and has a button that clears it. Clearing your browser's data for the extension removes it too.

## What is sent over the network

**To the site you are reading: nothing.** Page Date reads the page from the copy your browser has already loaded. It does not re-request the page, and it does not request the site's feed, sitemap or anything else.

**To the Internet Archive, only if you enable it.** The "check the Internet Archive" setting is off by default and has its own permission. When it is on, Page Date asks `web.archive.org` for the capture history of the page's URL, in order to detect a page that has been rewritten since the date it claims.

This tells the Internet Archive which page you are reading. The setting is off until you turn it on, is described in plain words next to the toggle, and can be set to ask each time rather than always. On "ask each time" the browser's permission prompt is shown for every lookup, and the permission is handed back as soon as that lookup finishes. The request carries no cookies or credentials, and the Internet Archive's own privacy policy governs what they do with it: <https://archive.org/about/terms.php>.

**To a link you right-clicked, only if you ask.** Choosing "When was this page written?" on a link first reads the link's address, which involves no request: an address like `/2019/03/04/some-post/` already contains a date. Only if the address says nothing does Page Date ask your permission to read that one site, and then request that one page. The browser shows you that prompt, naming the site, and declining ends it there. Once the page has been read the permission is removed again, unless you had already granted it through one of the settings above.

The request is sent without cookies or credentials, so the site sees an anonymous reader. The answer is shown and not stored: a link check writes nothing to the result cache.

**To search results, only if you switch it on and only at the tier you choose.** The "show ages next to search results" setting is off by default and has two tiers:

- **From the link address only.** Page Date reads the addresses of the results already on your screen. No request is made to anyone.
- **Also read the pages themselves.** Page Date requests the result pages, which means contacting sites you have not opened. Those sites see a request, without cookies or credentials, and could in principle infer that their page appeared in somebody's search results.

The second tier is capped at the first 10 results per page load, so scrolling a results page cannot produce an unbounded series of requests. Only public `http` and `https` addresses are requested: a result pointing at `localhost` or a private network address is skipped. At most the first 2 MB of each page is read, and it is discarded once its dates have been extracted. Nothing from this tier is written to the result cache.

Reading every site is a larger grant than reading five search engines, and the browser's permission prompt for this tier says so. If you decline it while the address-only tier is already on, that tier keeps working.

Neither tier sends anything to the developer, and neither sends your search query anywhere. Page Date reads the results your browser has already received.

**Nowhere else.** No usage statistics, no crash reports, no advertising or tracking identifiers, and no third-party services of any kind are contacted.

## Permissions

Page Date asks for nothing at install time beyond what it needs to work on one page at a time, on your click.

| Permission | Why |
|---|---|
| `activeTab` | Read the page you are on, at the moment you click the toolbar icon; and, when you choose the right-click menu entry, show the answer on the page you are on. It grants access to that one tab, on that one click, and expires. It is what lets the extension work without asking to see every page you visit. |
| `storage` | Keep your settings and the result cache described above, on your device. |
| `scripting` | Read the rendered page's markup; draw the optional on-page overlay and the right-click answer; and, once you switch on search-result annotation, register the script that adds ages to results pages. |
| `contextMenus` | Put the "When was this page written?" entry in the right-click menu. It grants the ability to add a menu item and nothing else: no access to any page, and no data. Neither store shows a warning for it. |
| `*://*/*` (optional) | Requested only when you switch on "check every page automatically", or the search-annotation tier that reads result pages. Both are off by default. Switching them off hands the permission back, unless the other is still on. |
| `*://web.archive.org/*` (optional) | Requested only when you switch on Internet Archive lookups, which are off by default. On "always" it is kept until you switch the setting off; on "ask each time" it is requested for each lookup and handed back when that lookup finishes. |
| Five search-engine origins (optional) | Google, Bing, DuckDuckGo, Hacker News and old Reddit. Requested only when you switch on search-result annotation, and handed back when you switch it off. Listed separately from `*://*/*` because annotating results at the cheap tier needs those five sites and nothing else. |
| One site at a time (optional, temporary) | When you right-click a link whose address carries no date, Page Date asks for access to that one site, at that moment, and removes it again as soon as the page has been read. |

Every optional permission is requested when you enable the feature that needs it and revoked when you disable it, rather than sitting in the manifest permanently.

**Installing Page Date grants nothing.** A browser extension that declares a content script in its manifest makes the browser ask for access to those sites at install time, for everyone, whether or not the feature is used. Page Date's search-result annotator is therefore registered only after you turn the setting on, and the project's continuous integration checks the built extension for both browsers and fails if any content script or host permission has appeared in the manifest.

## What Page Date never does

- Sell, rent or share your data. There is no data collection to sell from.
- Build a profile, or use anything it reads for advertising or for training any model.
- Transmit your browsing history anywhere. The result cache is a local cache, not a report.
- Load or execute remote code. Everything that runs ships in the extension package and is auditable in the repository.

## Children

Page Date is a general-purpose reading tool with no accounts and no data collection, and is not directed at children.

## Changes

Any change to this policy is a commit in the public repository, so its full history is visible at <https://github.com/mathieutreves/website-date/commits/main/docs/PRIVACY.md>. A change that widens what leaves your browser will ship with a version that asks you again.

## Contact

Open an issue at <https://github.com/mathieutreves/website-date/issues>.

The source for the entire extension is at <https://github.com/mathieutreves/website-date> under the MIT licence. Every claim on this page can be checked against it: `apps/extension/lib/analyze.ts` holds the page read, `apps/extension/lib/cache.ts` the result cache and its limits, `apps/extension/lib/archive.ts` the Internet Archive lookup, `apps/extension/lib/link-date.ts` the two tiers used for links and search results, `apps/extension/lib/link-menu.ts` the right-click check and the permission it hands back, `apps/extension/lib/annotate.ts` and `apps/extension/lib/fetch-relay.ts` the fetch cap and the rules on which result pages may be requested, and `apps/extension/lib/settings.ts` the permission grants.
