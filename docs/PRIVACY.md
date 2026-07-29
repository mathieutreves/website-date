# Privacy policy — Page Date

Last updated: 29 July 2026. Applies to the Page Date browser extension for
Chrome and Firefox.

## The short version

Page Date has no servers, no accounts, no analytics and no telemetry. Nothing
you do with it is sent to the developer, because there is nowhere for it to be
sent. Everything it stores stays on the device that stored it.

Requests leave your browser only in the cases listed below: to the site you are
already reading; to the Internet Archive, if you switch that on; and to a page
you right-clicked or a search result you asked to have dated, if you switch
those on. Nothing else, and nothing to us.

## What is stored, and where

Everything lives in the browser's own `storage.local` for this extension. It is
never written to `storage.sync`, so it does not travel between your devices,
and it is deleted when you uninstall the extension.

**Your settings.** Which date format you prefer, whether the on-page overlay is
shown and where, whether automatic reading is on, whether Internet Archive
lookups are off, asked for, or automatic, whether the right-click entry is
shown, and whether search results are annotated and at which tier.

**A result cache.** For each page Page Date has analysed, one entry holding the
page's URL and the dates found for it, kept for seven days. This exists so that
revisiting a page does not mean re-reading it. It is a record of pages the
extension analysed, which on the default settings means pages whose toolbar
icon you clicked.

The options page shows how large this cache is and has a button that clears it.
Clearing your browser's data for the extension removes it too.

## What is sent over the network

**To the site you are reading.** When Page Date cannot find a date in the page
itself, it looks for the site's RSS or Atom feed, because that is often the only
place an undated post's date exists. This request goes only to the origin of the
page you are already on — cross-origin requests are refused rather than
attempted — and it is sent without cookies or credentials. It is the same kind
of request the page itself makes, to a server you were already talking to.

**To the Internet Archive, only if you enable it.** The "check the Internet
Archive" setting is **off by default** and has its own permission. When it is
on, Page Date asks `web.archive.org` for the capture history of the page's URL,
so it can spot a page that has been quietly rewritten since the date it claims.

This means telling the Internet Archive which page you are reading. That is a
real cost, which is why the setting is off until you turn it on, is stated in
plain words next to the toggle, and can be set to ask each time rather than
always. The request carries no cookies or credentials, and the Internet
Archive's own privacy policy governs what they do with it:
<https://archive.org/about/terms.php>.

**To a link you right-clicked, only if you ask.** Choosing "When was this page
written?" on a link first reads the link's *address*, which involves no request
at all — an address like `/2019/03/04/some-post/` already contains a date. Only
if the address says nothing does Page Date ask your permission to read that one
site, and then request that one page. The browser shows you that prompt, naming
the site, and declining ends it there.

The request is sent without cookies or credentials, so the site sees an
anonymous reader, not you. Nothing about it is stored beyond the ordinary result
cache described above.

**To search results, only if you switch it on and only at the tier you choose.**
The "show ages next to search results" setting is **off by default** and has two
tiers, which are different propositions:

- **From the link address only.** Page Date reads the addresses of the results
  already on your screen. **No request is made to anyone.** No site learns
  anything, because none is contacted.
- **Also read the pages themselves.** Page Date requests the result pages, which
  means contacting sites you have not opened, on the strength of them appearing
  in your results. Those sites see a request — without cookies or credentials —
  and could in principle infer that their page appeared in somebody's search.

The second tier is capped at the first 10 results per page load, so scrolling a
results page cannot turn into an unbounded series of requests. It asks for its
own, separate permission, because reading every site is a much larger thing to
grant than reading five search engines. Declining it leaves the address-only
tier working rather than turning everything off.

Neither tier sends anything to us, and neither sends your search query anywhere.
Page Date reads the results your browser has already received.

**Nowhere else.** No usage statistics, no crash reports, no advertising or
tracking identifiers, and no third-party services of any kind are contacted.

## Permissions, and why each exists

Page Date asks for nothing at install time beyond what it needs to work on one
page at a time, on your click.

| Permission | Why |
|---|---|
| `activeTab` | Read the page you are on, at the moment you click the toolbar icon. It grants access to that one tab, on that one click, and expires. It is what lets the extension work without ever asking to see every page you visit. |
| `storage` | Keep your settings and the result cache described above, on your device. |
| `scripting` | Read the rendered page's markup, and draw the optional on-page overlay. |
| `contextMenus` | Put the "When was this page written?" entry in the right-click menu. It grants the ability to add a menu item and nothing else — no access to any page, and no data of any kind. Neither store shows a warning for it. |
| `*://*/*` (optional) | Requested **only** when you switch on "check every page automatically", or when you choose the search-annotation tier that reads result pages. Both are off by default. Switching them off hands the permission back — unless the other one is still on, in which case it is kept for that. |
| `*://web.archive.org/*` (optional) | Requested **only** when you switch on Internet Archive lookups, which are off by default, and handed back when you switch them off. |
| Five search-engine origins (optional) | Google, Bing, DuckDuckGo, Hacker News and old Reddit. Requested **only** when you switch on search-result annotation, and handed back when you switch it off. Listed separately from `*://*/*` on purpose: annotating results at the cheap tier needs those five sites and nothing else, and that is a far smaller thing to grant than the whole web. |
| One site at a time (optional, temporary) | When you right-click a link whose address carries no date, Page Date asks for access to **that one site**, at that moment, and only then. |

Every optional permission is requested at the moment you enable the feature that
needs it and revoked the moment you disable it, rather than sitting in the
manifest forever because a feature might one day be used.

**Installing Page Date grants nothing.** There is one way that could quietly
stop being true — a browser extension that declares a content script in its
manifest makes the browser ask for access to those sites at install time, for
everyone, whether or not the feature is ever used. Page Date's search-result
annotator is therefore registered only after you turn the setting on, and the
project's continuous integration checks the built extension for both browsers
and fails if any content script or host permission has appeared in the manifest.

## What Page Date never does

- Sell, rent or share your data. There is no data collection to sell from.
- Build a profile, or use anything it reads for advertising or for training any
  model.
- Transmit your browsing history anywhere. The result cache is a local cache,
  not a report.
- Load or execute remote code. Everything that runs ships in the extension
  package and is auditable in the repository.

## Children

Page Date is a general-purpose reading tool with no accounts and no data
collection, and is not directed at children.

## Changes

Any change to this policy is a commit in the public repository, so its full
history is visible at
<https://github.com/mathieutreves/website-date/commits/main/docs/PRIVACY.md>.
A change that widens what leaves your browser would ship with a version that
asks you again, not quietly.

## Contact

Open an issue at <https://github.com/mathieutreves/website-date/issues>.

The source for the entire extension is at
<https://github.com/mathieutreves/website-date> under the MIT licence. Every
claim on this page can be checked against it — `apps/extension/lib/analyze.ts`
holds the network and caching behaviour, `apps/extension/lib/archive.ts` the
Internet Archive lookup, `apps/extension/lib/link-date.ts` the two tiers used
for links and search results, `apps/extension/lib/annotate.ts` the fetch cap,
and `apps/extension/lib/settings.ts` the permission grants.
