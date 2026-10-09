# Verification

Unless otherwise dated, the checks below were performed on 2026-10-05.

These observations describe this local environment and account session, not a platform-wide availability guarantee. Credentials and full authenticated responses are not included in this document. Live reports remain untracked in `.local`.

## Real reads through MCP

A Chrome session was imported locally with the user's explicit authorization. Cookie values were not printed, temporary extraction files were removed and the clipboard was cleared. The local database uses mode 0600 in a private directory. Session requests used twscrape 0.20.1 through an HTTP proxy with TLS verification enabled.

The initial live script made 17 calls: 15 returned successful results and 2 returned explicit upstream errors. Further checks verified fixes and historical search:

| Read                                   | Observation                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Public `getTweet`                      | 4/4 samples succeeded: ID 20, Go's March 2025 release post, a September 2026 long post, and an August 2026 post                           |
| Session `getTweet` / `getTweetDetails` | Detail reads succeeded; the long-post sample returned the remaining paragraphs omitted by oEmbed                                          |
| `searchTweets`                         | `from:golang` returned 10 posts; `from:golang until:2026-01-01` returned 10 historical posts, including December 2025 releases            |
| `getUserTweets`                        | Returned 5 posts; after fixing pinned ordering and explicit filtering, the sample was descending by timestamp with no reply or repost IDs |
| `getUser`                              | Username lookup succeeded for golang                                                                                                      |
| `searchUsers`                          | Returned 3 profiles for golang                                                                                                            |
| `getUserAbout`                         | Returned account-about information                                                                                                        |
| `getUserMedia`                         | Returned 3 posts                                                                                                                          |
| `getUserFollowers`                     | Returned 3 profiles with `partial=true`; upstream warnings mean the sample is incomplete                                                  |
| `getUserFollowing`                     | Successful empty collection for this sample; not a completeness guarantee                                                                 |
| `getTweetReplies`                      | Returned 1 reply for the chosen post                                                                                                      |
| `getTweetThread`                       | Initially empty for a reply URL; fixed by resolving its conversation root first, then returned 3 posts with the root ID                   |
| `searchTrends`                         | Returned 3 posts matching the trend query; this is not a ranked trend-list endpoint                                                       |
| `getUserById`                          | Upstream failure; prefer `getUser` by username. Retry may report a preserved account cooldown                                             |
| `getTrends`                            | Upstream GraphQL error; category trend retrieval is not established                                                                       |

The first historical probe used `before:`, which returned no results and did not establish historical access. The corrected X search operator `until:` did return historical posts. Successful historical retrieval does not imply exhaustive search indexing.

`getRetweeters`, `getBookmarks`, `getVerifiedFollowers`, `getUserSubscriptions`, list tools and community tools are registered and mapped to library methods but were **not live-verified**. Private bookmarks were not accessed. No real replies, likes, reposts, follows or messages were sent. One temporary plain-text test post was explicitly authorized, published and deleted as recorded below. Official API reads/publishing remain verified with isolated HTTP interception, not live developer credentials.

## Real session publish/delete through MCP

On explicit user authorization, the new session write adapter used the already imported local browser session. No official API credentials were supplied. The test posted one clearly marked temporary functionality-test message on 2026-10-05, with no links or media.

- `sendTweet`: confirmed a new test post ID (retained only in the private local report), `status=published`, `source=x-session` (7.322 seconds).
- `getTweetDetails`: exact text read back; author matched the intended browser account (4.112 seconds).
- `deleteTweet`: confirmed the same ID with `status=deleted` (7.035 seconds).
- `getTweetDetails` after deletion: returned the expected `NOT_FOUND` error (3.957 seconds).

The untracked `.local/write-test-report.json` retains the receipt, exact text and `readBackVerified`, `deleteAcknowledged`, `deletionVerified` flags. Write mode was enabled only in the test subprocess; the project's `.env` remains `TWITTER_ENABLE_WRITE=false`. Only this new test post was deleted. This proves one account's plain-text session create/delete flow, not continuous availability, all account types, media posting, replies or live official API access. The MCP now registers 27 tools.

## Browser import helper checks

`auth:browser` uses pinned Sweet Cookie 0.4.4 as a host development helper. Offline tests covered the real library's inline-cookie API, fixed host/name/profile selection, expired/partitioned/wrong-domain cookie rejection, conflicting sessions, private stdin import, explicit replacement, non-disclosure of values and preservation of account locks. The CLI was exercised with fake exported cookies and an isolated temporary SQLite database; `--check` left it untouched.

Automatic OS/browser decryption was **not live-verified** in this step. No real browser credentials were re-extracted and the existing real account database was not changed. Keychain permissions and App-Bound Encryption remain platform-dependent. The previous live session publishing proof used the already imported session, not this new automatic browser helper.

## Automated checks

- 57 Node tests passed, including MCP structured-output contracts, official/session writes and actual worker process behavior.
- 19 Python tests passed, including limits, generator cleanup, precision-safe IDs, filtering/sorting, reply-to-root resolution, write error redaction and cancellation.
- TypeScript build, Prettier/Ruff formatting and Git whitespace checks passed.
- Publication path/link/ignore checks and npm dry-run manifest checks passed. Gitleaks scanned the existing Git history and candidate source; the custom X-cookie rule was also verified with a random synthetic cookie. These checks do not prove the absence of every possible credential.
- Docker rebuilt successfully with the final importer and writer changes. A non-root container initialized MCP with 27 tools; both write tools returned `WRITE_DISABLED` by default. The session writer and signer imports also passed on container Python 3.11.2, and Compose configuration validation passed. Before the addition, the previous image also completed public ID-20 lookup and a real session-based golang profile lookup. The image default UID is 1000; secrets/database files and nested Python caches are excluded from the build. The final image inspection found no project `.env`, account database, `.pyc` files or host browser-import helper. For the previous host database bind mount, the test used the host's unprivileged UID/GID to preserve restrictive file permissions. No second test post was made in Docker.

The default `test:session` runs core/public research reads; `npm run test:session -- --extended` also probes the known failing user-ID/trend endpoints. Any tool error produces a nonzero exit status.

## Public endpoint limits

Four successful oEmbed samples did not encounter a rate limit. This is a functional smoke test, not a sustained-load or quota test. No dependable numeric sustained-rate guarantee was established. Long-post truncation was observed directly. The endpoint is retained for lightweight public lookup, with explicit limitations and 429/error handling; it is not used as a search or timeline backend.

## Browser comparison and session pagination — 2026-10-09

X browser search was inspected with the user's authorization, using `polymarket -filter:retweets`. Top/Latest tabs, scroll-based loading and advanced language/date/engagement filters were visibly present. The first Top post matched the MCP result, but subsequent ordering differed; identical ranking, translations, location filtering and sidebar trends are not established. Quoted cards in the browser exposed a wrapper issue: nested quoted posts previously consumed independent search slots. Search/timeline pagination now normalizes actual timeline entries in order and retains quoted context separately.

Through the real local stdio MCP and the existing twscrape session, with writes forced off:

- Top search continued through five calls of ten posts each: **50 unique IDs**, no cross-page duplicates, no partial warnings. Calls took 5.281, 0.002, 4.671, 0.002 and 4.331 seconds. Fast calls served preserved overflow; later calls read new upstream pages. Some Top results were old, reinforcing the need for date filters.
- The public `Polymarket` account timeline continued through three calls of twenty posts each: **60 unique IDs**, no cross-page duplicates, no partial warnings. Calls took 10.100, 4.687 and 8.663 seconds.
- Session search with `language=zh`, reply/repost exclusion, `minLikes=100`, `sinceDate=2026-10-01`, `untilDate=2026-10-10` returned ten posts in 5.556 seconds. Every returned post met the date and available like-count threshold and had no reply/repost relationship ID. This is sample verification of X's filter behavior, not a guarantee for every operator or account.

Sanitized local reports remain ignored under `.local`; no reusable cookies, account identity or raw authenticated responses are included here. These checks prove bounded browsing continuation for this session, not complete search coverage, sustained quotas or restored `getTrends` availability. Invalid/expired/cross-query cursors, buffer boundaries, deduplication, loop limits and network-failure recovery are covered separately by isolated tests. No live write was performed in this follow-up. The updated regression suite passed 63 Node tests and 22 Python tests; formatting and publication checks also passed.
