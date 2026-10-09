# Changelog

## Unreleased — 1.1.0

### Changed

- Use the official MCP TypeScript SDK directly; remove FastMCP and the stale password scraper.
- Default to credential-free public oEmbed reads; support ID and HTTPS status URLs.
- Return structured post data plus JSON text compatibility, explicit tool schemas and read/write annotations.
- Authenticate official API operations directly with a bearer token (reads) or OAuth 1.0a.
- Disable publishing by default; distinguish uncertain outcomes and never automatically retry writes.
- Make proxy configuration and timeouts effective for both network backends; retain TLS verification.
- Require Node 22.19+, use a single npm lockfile and rebuild Docker as a non-root stdio process.

### Fixed

- Remove double response-body consumption and invalid raw tool returns from the old publishing path.
- Eliminate cached failed login state and misaligned fallback credentials by removing password authentication.
- Handle unavailable posts, malformed upstream responses, rate limits and invalid inputs explicitly.
- Replace the stale SSE test client with a stdio client that fails with a nonzero exit code.
- Resolve `.env` relative to the project rather than the invoking client's working directory.
- Exclude secrets from image builds and stop hiding compiled output under source mounts.

### Added

- Session search/timeline continuation with opaque process-local cursors, overflow retention, cross-page deduplication, 15-minute expiry and bounded memory/request budgets.
- Optional browser-style language, account, media, date and engagement search filters; original and effective query metadata.
- Timeline-entry ordering and quoted-post context without counting quote-only posts as separate search results.

- Explicit host `auth:browser` import with pinned Sweet Cookie, selected browser/profile, x.com cookie filtering and private stdin transport.
- Extraction-only checks, extension JSON fallback, explicit label replacement and preserved cooldown locks; no extraction on MCP startup.
- Explicit named-cookie-session plain-text publishing and deletion, independent of read providers; API remains the default write provider.
- `deleteTweet` MCP tool, current web mutation metadata discovery, no mutation retries/redirects, and separate publish/delete unknown-outcome errors.
- One user-authorized live session post verified through create, read-back, delete and post-deletion lookup.
- twscrape 0.20.1 integration through a bounded Python worker, hidden local session import and reusable account databases.
- 22 read-only tools covering details, threads, replies, profiles, social graphs, bookmarks, lists, communities and trends.
- Session read limits, timeouts, parser-warning visibility, precision-safe IDs, source metadata and no paid fallback.
- Node/Python regression tests, opt-in session smoke report, and Python-aware Docker/CI.
- `searchTweets` and `getUserTweets` default to local twscrape sessions; official API discovery remains explicitly selectable.
- Read-only diagnostic `--search` and `--user` commands; discovery SDK and MCP regression tests.
- Offline service, SDK HTTP, timeout and full MCP regression tests; opt-in live public smoke test.
- CI for Node 22/24 and container startup, dependency update configuration and formatting checks.
- Chinese quickstart, migration and architecture notes, contributor and security guidance.
- Bilingual manual Cookie guides, original repository illustrations, detailed tool/configuration references and a compact bilingual README.
- MIT license, disclaimer, conduct policy, issue/PR templates, publication checks and redacted Git-history secret scanning in CI.
