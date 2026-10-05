# Configuration

[Project overview](../README.md) · [Authentication](authentication.md)

## Configuration

| Variable                                                                                           | Default                         | Purpose                                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `TWITTER_READ_BACKEND`                                                                             | `oembed`                        | `getTweet`: `oembed`, `twscrape` or `api`                                   |
| `TWITTER_DISCOVERY_BACKEND`                                                                        | `twscrape`                      | `searchTweets` / `getUserTweets`: session reads or explicit `api`           |
| `TWSCRAPE_ACCOUNTS_DB`                                                                             | `.local/accounts.db`            | Absolute path or project-relative twscrape database path                    |
| `TWSCRAPE_PYTHON`                                                                                  | Project `.venv`, then `python3` | Python executable; Docker supplies its own path                             |
| `TWSCRAPE_HTTP_BACKEND`                                                                            | `httpx`                         | `curl` requires separately installing twscrape's optional curl dependencies |
| `REQUEST_TIMEOUT_MS`                                                                               | `20000`                         | Whole session operation / per official API or public request, 100–120000 ms |
| `PROXY_URL`                                                                                        | unset                           | HTTP(S) proxy; TLS verification stays enabled                               |
| `TWITTER_WRITE_BACKEND`                                                                            | `api`                           | Explicit write provider: `api` or `session`; independent of read providers  |
| `TWITTER_WRITE_ACCOUNT`                                                                            | unset                           | Required exact local account label for session writes; no pool rotation     |
| `TWITTER_ENABLE_WRITE`                                                                             | `false`                         | Explicit publish/delete opt-in                                              |
| `TWITTER_BEARER_TOKEN`                                                                             | unset                           | Optional official API read credentials                                      |
| `TWITTER_API_KEY`, `TWITTER_API_SECRET_KEY`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` | unset                           | Optional OAuth 1.0a credentials for official reads/publishing               |

Official API mode is optional and may incur charges. Setting `TWITTER_DISCOVERY_BACKEND=api` restores one-page recent search (7 days) and user timeline requests with `nextToken` pagination. `TWITTER_READ_BACKEND=api` controls only single-post lookup. Extra twscrape tools still use the session backend. There is no automatic paid fallback.

Writes require `TWITTER_ENABLE_WRITE=true` and explicit user authorization for the specific post/deletion. The default write backend remains `api`, requiring all four OAuth credentials and app write permissions. To use your existing local cookies instead, configure:

```dotenv
TWITTER_WRITE_BACKEND=session
TWITTER_WRITE_ACCOUNT=my-session
TWITTER_ENABLE_WRITE=true
```

`TWITTER_WRITE_ACCOUNT` is the exact label passed to `npm run auth:import`, not necessarily the X handle. The writer uses one named active session, discovers current CreateTweet/DeleteTweet metadata from the X web bundle, and reuses twscrape's transaction signature generator. It is a separate adapter: twscrape's own API remains read-only. Mutation HTTP requests use zero retries and no redirects, including when reads use the optional curl backend. No account/provider fallback is made. `PUBLISH_OUTCOME_UNKNOWN` or `DELETE_OUTCOME_UNKNOWN` means inspect the account/post before retrying. `SESSION_BOOTSTRAP_FAILED` means metadata/signature preparation failed before a write was attempted. The supported session write flow is plain-text posting/deletion; media upload, replies and quote posting are not exposed. Internal web endpoints can change without notice; there is no availability guarantee. Keep write mode off during normal research.

## Errors

Failures return `isError=true` and a JSON error envelope. Common codes:

- `AUTH_REQUIRED`: session database/account or official API credentials missing.
- `AUTH_FAILED`: no active session or credentials rejected; reimport the session locally.
- `ACCOUNT_UNAVAILABLE`: all configured sessions are busy or rate limited for this endpoint; locks are preserved.
- `SERVER_BUSY`: another session operation is in progress in this MCP process.
- `TWSCRAPE_UNAVAILABLE`: Python/dependencies could not start; run setup or correct the executable.
- `REQUEST_TIMEOUT`: session read exceeded its deadline; no complete result is available.
- `INVALID_INPUT`, `NOT_FOUND`, `UPSTREAM_FORMAT`, `UPSTREAM_ERROR`, `NETWORK_ERROR`: input, visibility, parser or network failure.
- `RATE_LIMITED`, `API_ACCESS_REQUIRED`, `FORBIDDEN`: public/official API limits or access restrictions.
- `WRITE_DISABLED`, `PUBLISH_OUTCOME_UNKNOWN`, `DELETE_OUTCOME_UNKNOWN`: write guard or uncertain outcome.
- `SESSION_BOOTSTRAP_FAILED`, `WRITE_REJECTED`: preflight incompatibility or an explicit X write rejection; no retry was made.

Worker stderr and raw authenticated upstream logs are not forwarded to the model. Never interpret a missing result as proof that content was deleted.
