# Security policy

## Reporting a vulnerability

Report privately through GitHub's [security advisory form](https://github.com/mathieutreves/website-date/security/advisories/new), not through a public issue. You will get an acknowledgement within a week.

If you would rather not use GitHub, open a public issue with no detail in it — "I have a security report, how should I send it?" — and a private channel will be arranged.

Include the input that triggers the issue. For this project that usually means an HTML page or a URL; a page small enough to read is more useful than a 2 MB capture.

## In scope

The library takes a hostile document as input. Every page it parses was written by someone else.

**Requests the analysed page can cause.** Feed and sitemap discovery follows `<link rel="alternate">`, `<link rel="sitemap">` and `<loc>`, which are URLs the page chooses. `isSafeFetchTarget` in [`urlGuard.ts`](packages/pagedate/src/extract/urlGuard.ts) is the control against server-side request forgery: non-HTTP schemes, embedded credentials, loopback, link-local, RFC 1918 and cloud metadata addresses are refused, on every redirect hop rather than only the first. A way past it is a vulnerability.

The filter does not resolve DNS, so rebinding is a documented limit rather than a finding. `blockPrivateNetwork: 'strict'` adds a resolution preflight, which is a preflight and not a pin.

The guard and the transport around it live in [`fetchEnv.ts`](packages/pagedate/src/fetchEnv.ts) and are shared by the Node and edge entry points, so a finding against one is a finding against both. On a runtime with no DNS resolver, `'strict'` degrades to `'literal'` — the address filter without the preflight — rather than throwing or allowing everything.

**URLs an untrusted party chose.** `pagedate-mcp` fetches whatever a model asks it to, so `blockPrivateNetwork` defaults to `'strict'` there. A way to make that server reach an address the filter is meant to refuse is in scope.

**Cost a page can impose.** Extraction is bounded on adversarial input: fetches cap at 5 MB and 8 seconds with at most 3 redirects, parsing caps at 10 MB, and the element walk in `patterns.ts` is linear. `pagedate --batch` bounds concurrency and never issues more than one request per host, whatever `--concurrency` says. A page that makes any of these superlinear, or that gets past a cap, is in scope.

**Output that reaches a DOM.** The extension renders page-derived strings — the date, the source label, and notes quoting page text — into the popup, the injected overlay, the link toast and the search-result annotations. Anything that escapes as markup is in scope; the `produces no unescaped angle brackets from real page content` test covers this. The annotator is the sharpest case, writing into a page it does not control using text taken from a third page it fetched.

**Permission scope in the extension.** Installing grants nothing beyond `activeTab`, `storage`, `scripting` and `contextMenus`; every host permission is optional, requested when a feature is switched on and returned when it is switched off. Anything that obtains host access without that prompt is in scope, including a manifest regression that puts a content script's `matches` into the install-time prompt, which CI asserts against on both targets. The search-annotator fetch tier is capped at 10 result pages per page load; a way to exceed that is in scope.

**The extension's data.** Settings and the result cache live in `storage.local`. Anything that lets another extension or a page read them, or that sends them anywhere, is in scope. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Not in scope

- A wrong date. That is a bug; file it publicly.
- Findings against `fixtures/`, `corpus/` or `bench/` — captured third-party pages and benchmark harnesses, not shipped code.
- DNS rebinding against `isSafeFetchTarget`, as described above.
- Anything requiring the user to install a malicious extension alongside this one, or to run the CLI against a URL they were told to distrust.

## Supported versions

Pre-1.0: only the latest published version is supported. There is no backport branch, and `0.x` is not covered by semver guarantees.
