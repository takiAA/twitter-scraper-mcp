# Prepare a GitHub publication

This project is source-installed and `private: true`; no npm release is published by these steps. Release notes must distinguish shipped code, isolated verification, actual live checks and known upstream gaps.

## Before pushing

```bash
npm ci --ignore-scripts
npm run setup:twscrape
npm test
npm run format:check
npm run test:client
npm run publication:check
# Install Gitleaks separately, then scan locally (values redacted):
npm run security:scan
# Scan staged content too:
gitleaks git --staged --redact=100 --no-banner --config .gitleaks.toml
```

`publication:check` checks tracked/candidate paths, ignore rules, local documentation links, safe example credentials and the npm dry-run manifest. It never reads ignored credentials. It complements Gitleaks; neither proves the absence of every possible secret or vulnerability. The custom Gitleaks rule detects hex-valued X session cookies in addition to default provider rules.

Review the actual diff and index. Use explicit `git add` paths rather than blindly force-adding ignored files. Never include `.env`, `.local`, `.venv`, account databases, browser profiles, cookie exports, HAR captures, screenshots with values or private API responses. Keep any scan report local and redacted. Gitignore does not remove already tracked files or secrets from old commits.

Use a GitHub noreply author address if you do not want to publish your personal email in new commit metadata. Check historical metadata separately; changing author configuration does not rewrite older commits. If a credential was ever published, invalidate it before considering history cleanup. Coordinate any destructive rewrite with affected collaborators.

## Repository settings

After review, configure the GitHub repository settings directly:

- Enable secret scanning/push protection where available. Do not assume these settings are enabled because a workflow exists.
- Enable private vulnerability reporting if available, and align the reporting instructions in `SECURITY.md`.
- Require the CI checks on protected branches and PR review for the changes that need it.
- Prefer read-only default Actions permissions. Review dependency updates, especially authenticated providers and browser-import helpers.
- Add factual repository topics such as `mcp`, `agents`, `twitter`, `twscrape` and a concise description.

These are maintainer actions; repository files do not change GitHub account settings automatically. The [GitHub secret-scanning documentation](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) explains feature scope and availability.

## Release review

Verify the English/Chinese quickstarts and manual authentication tutorial. Keep badges truthful: a CI status badge reflects hosted runs; local checks do not mean GitHub CI has passed. Do not advertise an npm package, hosted service, complete archive or universal upstream availability before those exist.

Keep commits focused: provider refactor, session writes, local browser import, publication safeguards, container/CI setup, and documentation/community policy can be reviewed separately. Use [CHANGELOG.md](../CHANGELOG.md), [the disclaimer](../DISCLAIMER.md) and [verification](verification.md) to explain compatibility and limits.
