# Migrating from 1.0 / the initial API rewrite

1. Use Node 22.19+ and Python 3.11+. Run `npm ci --ignore-scripts`, `npm run setup:twscrape`, then `npm run build`.
2. Existing `getTweet({tweetId})` and `sendTweet({text})` input names remain. `getTweet` returns a JSON object plus structured content rather than only raw text.
3. Public `getTweet` still defaults to oEmbed and does not require a session or Python. Choose `TWITTER_READ_BACKEND=twscrape` explicitly for session detail reads.
4. **Search and user timelines now default to twscrape.** Explicitly import your browser/profile with `npm run auth:browser -- --browser chrome --profile Default`, or use hidden manual input with `npm run auth:import`, or configure an existing `TWSCRAPE_ACCOUNTS_DB`. Password, email and 2FA automation from `agent-twitter-client` remain removed.
5. To retain the initial rewrite's official API discovery behavior, explicitly set `TWITTER_DISCOVERY_BACKEND=api` and provide API credentials. API usage may charge; no automatic fallback exists.
6. Session mode uses bounded reads and returns `nextToken=null`; official API mode retains one-page cursors. Do not reuse old API cursors in session mode. Read `coverage`, `limitReached` and `partial`; a bounded sample is not a complete archive or complete incremental sync.
7. The 22 additional tools expose twscrape reads only. `sendTweet` supports explicit official API or named-session write opt-in. The default write provider remains `api`; select `TWITTER_WRITE_BACKEND=session` plus an exact `TWITTER_WRITE_ACCOUNT` to use local cookies. A separate write adapter handles session mutations; twscrape itself does not publish. `deleteTweet({tweetId})` is new and uses the same write guards.
8. Keep sessions and private reports local. `.local`, `.venv`, database files, cookie exports and `.env` are excluded from Git/image builds. Importing a session does not publish or upload the database.
9. Use a direct stdio command, not SSE or a detached daemon. Python workers start lazily and have bounded lifetimes.
10. Docker now includes Python/twscrape; mount a writable account-data directory or use the Compose session volume. See the Docker guide for importing a session.

Live verification is recorded in `docs/verification.md`. Tool registration and mocked authentication do not establish account-level success. One explicitly authorized temporary session post was published, read back and deleted, then returned `NOT_FOUND`. Official API writes have not been tested with live developer credentials.
