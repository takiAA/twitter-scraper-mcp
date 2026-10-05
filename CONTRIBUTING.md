# Contributing

Use Node 22.19+, Python 3.11+ and npm. Install with `npm ci --ignore-scripts` and `npm run setup:twscrape`.

Before opening a pull request:

```bash
npm run format
npm test
npm run format:check
npm run test:client
```

Keep changes focused and describe the user-visible behavior, compatibility impact and validation. Preserve stdio protocol cleanliness: no debug output on stdout. Add regression tests for behavior changes; network tests must use fake credentials and deny real outbound requests.

Never publish a real post from automated tests. Live public reads are opt-in through `npm run test:live`. Any manual authenticated integration must state what was actually verified and must not include secrets or private responses in commits or logs.

Provider adapters belong in the service layer. MCP schemas and tool metadata belong in the server layer. Update the English and Chinese README and migration notes when changing tool contracts, configuration or supported authentication.

Use package-lock.json for JavaScript and pinned requirements.txt for the Python worker. Dependency updates should pass the full test suite; do not force audit upgrades without reviewing their behavior. CI tests Node 22 and 24 and builds a container without accessing X.

Before publication, also run `npm run publication:check` and a separately installed `gitleaks` through `npm run security:scan`. See [the publication checklist](docs/publication.md). Browser import is a host development helper, not a startup behavior; never run extraction implicitly in tests or service initialization. Manual cookie instructions belong in the bilingual authentication guides, not copied credentials in examples.

Use focused commits with imperative messages. Keep code/provider behavior, container/CI work and documentation updates reviewable. Follow the [code of conduct](CODE_OF_CONDUCT.md), and read the [disclaimer](DISCLAIMER.md) when discussing upstream access guarantees.
