# Publishing

Four artifacts, four destinations. Cash cost is $5 once, for Chrome's one-time developer registration fee; npm, AMO and the MCP Registry are free.

| artifact | destination |
|---|---|
| `pagedate` | npm |
| `pagedate-mcp` | npm, then the MCP Registry |
| Page Date (Chrome) | Chrome Web Store |
| Page Date (Firefox) | addons.mozilla.org |

Rationale for the constraints below is collected in [Decisions](#decisions).

## The packages, to npm

The mechanics are documented in the header comment of [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). OIDC cannot perform a package's first publish, so version one of each package goes up by hand and every version after it comes from CI.

```sh
pnpm --filter pagedate     publish    # once, by hand, to create the package
pnpm --filter pagedate-mcp publish    # then this one, in this order
```

Then configure the trusted publisher on npmjs.com for each package. The tarball contents are asserted in CI on every commit.

**Use `pnpm publish`, never `npm publish`.** `pagedate-mcp` depends on `pagedate` as `workspace:^`, which is a pnpm protocol. `npm publish` ships the string `"workspace:^"` verbatim into the published manifest, and every install of the result fails with `Unsupported URL Type "workspace:"`. pnpm rewrites it to the real range while packing. The publish itself succeeds, and npm allows unpublishing only within 72 hours.

**Order matters for the first publish.** The range `pagedate-mcp` names has to resolve to something downloadable, so `pagedate` goes first.

## `pagedate-mcp`, to the MCP Registry

The registry stores metadata only and points at the npm package, so npm comes first. It verifies the two agree by requiring an `mcpName` field in `package.json` matching the `name` in [`server.json`](../packages/pagedate-mcp/server.json). Both are in place, and CI asserts they stay in step along with the version.

The namespace is `io.github.mathieutreves/`, which GitHub authentication entitles. [DNS authentication](https://modelcontextprotocol.io/registry/authentication) would allow a domain instead; that is a decision to make before the first publish, because the name is the identity and changing it later means abandoning the old one.

First publish, by hand, from `packages/pagedate-mcp` after the npm publish above:

```sh
brew install mcp-publisher          # or the tarball from the registry releases
mcp-publisher login github
mcp-publisher publish               # reads ./server.json
```

Verify it landed:

```sh
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.mathieutreves/pagedate"
```

After that the workflow does it, authenticating over `mcp-publisher login github-oidc` — no stored secret, the same trusted-publishing posture as npm.

The registry is in preview, and its own documentation warns that breaking changes and data resets may occur before general availability. `npx pagedate-mcp` works whether or not the registry knows about it.

### Secondary directories

None are required.

| directory | how |
|---|---|
| [Glama](https://glama.ai/mcp/servers) | auto-indexes public GitHub repos — nothing to do |
| [Smithery](https://smithery.ai) | `smithery mcp publish` |
| [mcp.so](https://mcp.so) | manual submission |
| `punkpeye/awesome-mcp-servers` | pull request |

An [MCPB bundle](https://github.com/modelcontextprotocol/mcpb) — a `.mcpb` zip giving one-click install in Claude Desktop with no Node required — is not built here. It needs a `manifest.json` and the runtime dependencies vendored into the archive, which is a different build from the npm one.

## The extension, to both stores

### Before the first submission

- **Icons** at `apps/extension/public/icon/{16,32,48,96,128}.png`. WXT discovers them and writes the manifest key; CI fails if any of the four the stores require is missing. 96 is not among those four and is present because Firefox's `about:addons` renders it.
- **Screenshots**, 1280×800, Chrome only. Generated — see below.
- **A privacy policy URL.** Use the rendered [docs/PRIVACY.md](https://github.com/mathieutreves/website-date/blob/main/docs/PRIVACY.md).

### Screenshots

```sh
pnpm --filter @website-date/extension gen:screenshots
```

Writes six 1280×800 pages to `apps/extension/screenshots/`; open `index.html` for the contact sheet and the capture recipe. Chrome accepts five, so one is dropped deliberately.

The UI in them is not a mockup. Each shot renders a real captured page through the real extract-resolve pipeline and displays the result with the real `view()`, `optionsView()` and `paintOverlay` — the last serialised with `toString()`, exactly as `executeScript` injects it — styled by the real stylesheet. Only the canvas around the UI is composed.

Two consequences. The popup frames are clamped to 600px, which is what a browser gives a popup; the css-tricks shot has 789 candidates behind it and would otherwise be thousands of pixels tall. And `now` is pinned to 2026-07-29, matching `pipeline.test.ts`, so regenerating on a different day does not produce a diff — every headline in these shots is a relative age.

Capture is a DevTools step, documented on the contact sheet: device toolbar at 1280×800, DPR 1, ⋮ → Capture screenshot. DPR 2 yields 2560×1600, which the store rejects.

`test/screenshots.test.ts` guards what can be guarded without a browser: the `srcdoc` escaping, the composite's structure, and that every shot still names a fixture that exists.

### Building the artifacts

```sh
pnpm --filter pagedate build
cd apps/extension
pnpm zip                  # Chrome:  .output/page-date-<version>-chrome.zip
pnpm zip -b firefox       # Firefox: .output/page-date-<version>-firefox.zip
                          #      and .output/page-date-<version>-sources.zip
```

The Firefox run produces two files. The second is required; see below.

### Chrome Web Store

A [one-time $5 registration fee](https://developer.chrome.com/docs/webstore/register) and a verified contact email. The dashboard asks for a justification for every permission, and vague answers are the most common cause of a slow review. These are accurate to what the code does:

| Field | Answer |
|---|---|
| Single purpose | Show when the current page was published and last modified, along with where each date came from and how much to trust it. |
| `activeTab` | Reads the current page's markup to find its dates, only when the user clicks the toolbar icon. Used instead of a broad host permission so the extension has no access to any page the user has not explicitly asked about. |
| `storage` | Stores the user's display preferences and a seven-day local cache of results, so revisiting a page does not require re-analysing it. Local to the device; never synced or transmitted. |
| `scripting` | Reads the rendered DOM of the active tab (the extension must see the hydrated page, not the initial HTML) and draws the optional on-page date overlay. |
| `contextMenus` | Adds one entry, "When was this page written?", to the link right-click menu. It grants the ability to add a menu item and nothing else — no page access and no data. The entry does nothing until clicked, and the click authorises the single page it then reads. |
| `*://*/*` (optional) | Requested only when the user enables "check every page automatically", or the search-annotation tier that reads result pages. Both are off by default. Each feature reads pages the user has not opened, which is impossible without it. Revoked as soon as no feature still needs it. |
| `*://web.archive.org/*` (optional) | Requested only when the user enables Internet Archive lookups, off by default. Used to detect a page silently rewritten since the date it claims, by comparing against public capture history. Revoked when the setting is turned off. |
| Five search-engine origins (optional) | Google, Bing, DuckDuckGo, Hacker News and old Reddit. Requested only when the user enables search-result annotation, off by default, so the addresses of results already on screen can be read and dated. Listed separately from `*://*/*` because the cheap tier contacts no site at all. |
| Remote code | No. Everything executed ships in the package. |
| Data collection | Nothing is collected. Nothing is sold or shared. Certify all four disclosures accordingly. |

Reviewers ask about content scripts. The built manifest declares none: the search-results annotator is registered at runtime with `scripting.registerContentScripts`, once the setting is on and the matching grant exists. CI asserts on both targets that no content script and no host permission has reached the manifest.

### Firefox (addons.mozilla.org)

Free, with a Mozilla account. The add-on ID and minimum versions are pinned in `wxt.config.ts`; `gecko_android` is declared, so the listing can be opted in to Firefox for Android later.

**Source code submission is mandatory.** Vite minifies the output, and AMO [requires source for anything built by a bundler or minifier](https://extensionworkshop.com/documentation/publish/source-code-submission/): reviewers rebuild it and diff against the uploaded XPI, and there must be no differences. Upload `page-date-<version>-sources.zip` alongside the extension zip.

That zip is rooted at the workspace rather than at `apps/extension`, because the extension depends on `pagedate` as a `workspace:*` package; a zip of the app alone has no lockfile and no library to build against. `corpus/`, `fixtures/` and the benchmark tooling are excluded, being tens of megabytes of third-party HTML the build never touches.

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

### Version bumps

For the extension: one number, in `apps/extension/package.json`. WXT reads the manifest version from it, and `wxt.config.ts` does not set `version`.

The three versions are independent and move on their own schedules. They are all at 0.1.0 by coincidence. `pagedate-mcp` depends on `pagedate` by range, so a breaking `0.x` bump in the library needs the server's dependency range moved and republished with it.

## Decisions

| Decision | Rationale |
| --- | --- |
| First publish by hand, everything after from CI | npm's OIDC trusted publishing cannot create a package that does not yet exist |
| `pnpm publish` rather than `npm publish` | npm ships the `workspace:^` protocol string verbatim, producing a package that installs nowhere; the publish succeeds and unpublishing is limited to 72 hours |
| `pagedate` published before `pagedate-mcp` | The dependency range has to resolve to something downloadable |
| npm before the MCP Registry | The registry stores metadata pointing at the npm package |
| `mcpName` and `server.json` asserted in CI | The registry rejects a mismatch, and release day is the wrong time to discover one |
| `io.github.` namespace rather than DNS | GitHub authentication entitles it directly; the choice is worth revisiting before the first publish, because the name is the identity |
| MCP Registry treated as discovery, not infrastructure | It is in preview, with breaking changes and data resets announced as possible |
| Screenshots generated from the real pipeline and UI | A set built by hand in a design tool advertises last year's layout indefinitely, and nothing reports it |
| `now` pinned to 2026-07-29 in screenshots | Every headline in them is a relative age, so an unpinned clock makes regeneration a diff |
| Popup frames clamped to 600px | That is the height a browser gives a popup; one shot has 789 candidates behind it |
| Icons asserted in CI | A store rejects the upload rather than the build, so the failure would otherwise surface at submission |
| Sources zip rooted at the workspace | The extension depends on `pagedate` as a workspace package, so an `apps/extension` zip has no lockfile and no library and fails AMO review |
| `corpus/`, `fixtures/` and bench excluded from the sources zip | Tens of megabytes of third-party HTML the build never touches |
| Version read from `package.json`, not set in `wxt.config.ts` | Two sources of the version can drift apart between the store build and the workspace |
