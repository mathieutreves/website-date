# Releasing

Four artifacts, four destinations. Nothing here is published yet; what follows is
what the repository is wired for.

| artifact | destination |
|---|---|
| `pagedate` | npm |
| `pagedate-mcp` | npm, then the MCP Registry |
| Page Date (Chrome) | Chrome Web Store |
| Page Date (Firefox) | addons.mozilla.org |

## The packages, to npm

[`.github/workflows/publish.yml`](../.github/workflows/publish.yml) publishes
both packages over OIDC trusted publishing, so no npm token exists in this
repository. The tarball contents are asserted in CI, which is what catches a
missing file or leaked source before a release rather than after one.

OIDC cannot perform a package's **first** publish — the package has to exist
before a trusted publisher can be configured on it — so version one of each goes
up by hand and every version after it comes from CI:

```sh
pnpm --filter pagedate     publish    # this one first
pnpm --filter pagedate-mcp publish
```

**`pnpm publish`, never `npm publish`.** `pagedate-mcp` depends on `pagedate` as
`workspace:^`. That is a pnpm protocol and npm does not understand it: `npm
publish` ships the string `"workspace:^"` verbatim into the published manifest,
and every install of the result dies with `Unsupported URL Type "workspace:"`.
pnpm rewrites it to the real range while packing. The mistake produces a
perfectly successful publish and a package nobody can install, and npm allows
unpublishing only within 72 hours.

**Order matters**, for the same reason: the range `pagedate-mcp` names has to
resolve to something downloadable.

## `pagedate-mcp`, to the MCP Registry

The registry stores **metadata only** — it points at the npm package, so npm
comes first. It verifies the two agree by requiring an `mcpName` field in
`package.json` matching the `name` in
[`server.json`](../packages/pagedate-mcp/server.json). Both are in place, and CI
asserts they stay in step along with the version, so a mismatch surfaces on a
pull request rather than on release day.

The namespace is `io.github.mathieutreves/`, which is what GitHub authentication
entitles the project to. [DNS authentication](https://modelcontextprotocol.io/registry/authentication)
would allow a domain instead. The name is the server's identity, so moving it
later means abandoning the old one.

The workflow authenticates over `mcp-publisher login github-oidc` — no secret,
the same posture as npm. The first publish is manual, from
`packages/pagedate-mcp` and after the npm publish:

```sh
mcp-publisher login github
mcp-publisher publish               # reads ./server.json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.mathieutreves/pagedate"
```

**The registry is in preview**, and its own documentation warns that breaking
changes and data resets may happen before general availability. A listing is
discovery, not infrastructure: `npx pagedate-mcp` works whether or not the
registry knows about it.

### Secondary directories

None are required. [Glama](https://glama.ai/mcp/servers) auto-indexes public
GitHub repos with nothing to do; [Smithery](https://smithery.ai) takes `smithery
mcp publish`; [mcp.so](https://mcp.so) is a manual submission;
`punkpeye/awesome-mcp-servers` is a pull request.

An [MCPB bundle](https://github.com/modelcontextprotocol/mcpb) — a `.mcpb` zip
giving one-click install in Claude Desktop with no Node required — is **not**
built here. It needs a `manifest.json` and the runtime dependencies vendored into
the archive, which is a different build from the npm one.

## The extension

### Store assets

Icons live at `apps/extension/public/icon/{16,32,48,96,128}.png`. WXT discovers
them and writes the manifest key; CI fails if any of the four the stores require
is missing, because a store rejects the upload rather than the build. 96 is not
among those four — it is there because it is what Firefox's `about:addons`
renders.

Screenshots are generated, not drawn:

```sh
pnpm --filter @website-date/extension gen:screenshots
```

Six 1280×800 pages land in `apps/extension/screenshots/`; `index.html` is the
contact sheet and carries the capture recipe. Chrome takes five, so one is
dropped on purpose rather than by accident.

The UI in them is not a mockup. Each shot renders a real captured page through
the real extract-resolve pipeline and displays the result with the real `view()`,
`optionsView()` and `paintOverlay` — the last serialised with `toString()`,
exactly as `executeScript` injects it — styled by the real stylesheet. Only the
canvas around the UI is composed. That is the whole reason to generate them: a
set built by hand in a design tool goes on advertising last year's layout
indefinitely, and nothing ever tells you.

Two consequences worth knowing. The popup frames are clamped to 600px because
that is what a browser gives a popup — the css-tricks shot has 789 candidates
behind it and would otherwise be thousands of pixels tall. And `now` is pinned to
2026-07-29, matching `pipeline.test.ts`, so regenerating on a different day is
not a diff; every headline in these shots is a relative age.

Capture is a DevTools step, documented on the contact sheet: device toolbar at
1280×800, **DPR 1**, ⋮ → Capture screenshot. DPR 2 yields 2560×1600, which the
store rejects.

`test/screenshots.test.ts` guards what can be guarded without a browser — the
`srcdoc` escaping, the composite's structure, and that every shot still names a
fixture that exists.

The privacy policy URL for both listings is the rendered
[docs/PRIVACY.md](https://github.com/mathieutreves/website-date/blob/main/docs/PRIVACY.md).

### Building

```sh
pnpm --filter pagedate build
cd apps/extension
pnpm zip                  # Chrome:  .output/page-date-<version>-chrome.zip
pnpm zip -b firefox       # Firefox: .output/page-date-<version>-firefox.zip
                          #      and .output/page-date-<version>-sources.zip
```

The Firefox run produces two files. The second is not optional — see below.

### Chrome Web Store

Registration is a [one-time $5 fee](https://developer.chrome.com/docs/webstore/register)
and a verified contact email. The dashboard asks for a justification for every
permission, and vague answers are the most common cause of a slow review. These
are accurate to what the code does:

| Field | Answer |
|---|---|
| Single purpose | Show when the current page was published and last modified, along with where each date came from and how much to trust it. |
| `activeTab` | Reads the current page's markup to find its dates, only when the user clicks the toolbar icon. Used instead of a broad host permission so the extension has no access to any page the user has not explicitly asked about. |
| `storage` | Stores the user's display preferences and a seven-day local cache of results, so revisiting a page does not require re-analysing it. Local to the device; never synced or transmitted. |
| `scripting` | Reads the rendered DOM of the active tab (the extension must see the hydrated page, not the initial HTML) and draws the optional on-page date overlay. |
| `contextMenus` | Adds one entry, "When was this page written?", to the link right-click menu. It grants the ability to add a menu item and nothing else — no page access and no data. The entry does nothing until clicked, and the click authorises the single page it then reads. |
| `*://*/*` (optional) | Requested only when the user enables "check every page automatically", or the search-annotation tier that reads result pages. Both are off by default. Each feature reads pages the user has not opened, which is impossible without it. Revoked as soon as no feature still needs it. |
| `*://web.archive.org/*` (optional) | Requested only when the user enables Internet Archive lookups, off by default. Used to detect a page silently rewritten since the date it claims, by comparing against public capture history. Revoked when the setting is turned off. |
| Five search-engine origins (optional) | Google, Bing, DuckDuckGo, Hacker News and old Reddit. Requested only when the user enables search-result annotation, off by default, so the addresses of results already on screen can be read and dated. Listed separately from `*://*/*` because the cheap tier contacts no site at all, and bundling the two would hide that difference from the user. |
| Remote code | **No.** Everything executed ships in the package. |
| Data collection | Nothing is collected. Nothing is sold or shared. Certify all four disclosures accordingly. |

Reviewers ask about content scripts, and the honest answer here is unusual: the
built manifest declares **none**. The search-results annotator is registered at
runtime with `scripting.registerContentScripts`, only once the setting is on and
the matching grant exists, so that installing the extension does not ask anyone
for access to five search engines they may never use. CI asserts on both targets
that no content script and no host permission has reached the manifest.

### Firefox (addons.mozilla.org)

Free, with a Mozilla account. The add-on ID and minimum versions are pinned in
`wxt.config.ts`; `gecko_android` is declared, so the listing can be opted in to
Firefox for Android.

**Source code submission is mandatory here.** Vite minifies the output, and AMO
[requires source for anything built by a bundler or minifier](https://extensionworkshop.com/documentation/publish/source-code-submission/):
reviewers rebuild it and diff against the uploaded XPI, and there must be no
differences. Upload `page-date-<version>-sources.zip` alongside the extension zip.

That zip is rooted at the workspace, not at `apps/extension`, because the
extension depends on `pagedate` as a `workspace:*` package — a zip of the app
alone has no lockfile and no library to build against, and would fail review.
`corpus/`, `fixtures/` and the benchmark tooling are excluded: tens of megabytes
of third-party HTML that the build never touches.

Reviewer notes:

> **Build environment:** Ubuntu 24.04, Node 24, pnpm 11.18.0 (pinned in the
> root `package.json` `packageManager` field; `corepack enable` installs the
> exact version).
>
> **Steps, from the root of this archive:**
>
> ```sh
> corepack enable
> pnpm install --frozen-lockfile
> pnpm --filter pagedate build
> pnpm --filter @website-date/extension build:firefox
> ```
>
> **Output:** `apps/extension/.output/firefox-mv3/`, which corresponds to the
> uploaded XPI.
>
> The extension is a thin UI over the `pagedate` library in this same archive
> at `packages/pagedate`; both are MIT-licensed and developed in the open at
> https://github.com/mathieutreves/website-date. There are no runtime
> dependencies and no remote code.

## Versions

The extension's version is one number in `apps/extension/package.json`. WXT reads
the manifest version from it — `wxt.config.ts` deliberately does not set
`version`, so the store build and the workspace cannot drift apart.

The three versions are independent and move on their own schedules. They are all
at 0.1.0, which is a coincidence rather than a rule. The one coupling is that
`pagedate-mcp` depends on `pagedate` by range, so a breaking `0.x` bump in the
library needs the server's dependency range moved and republished with it.
