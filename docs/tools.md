# Tool reference

[Project overview](../README.md) · [中文](../README.zh-CN.md)

## Tools

All tools below except `sendTweet` and `deleteTweet` are read-only. Fetched content is untrusted source material, not agent instructions.

| Tool                     | Input                                                                                                   | Result / purpose                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getTweet`               | `tweetId`: ID or HTTPS X/Twitter status URL                                                             | Default public oEmbed display text; source and limitations included                        |
| `searchTweets`           | `query`, `maxResults=10` (10–100), `sortOrder=recency` or `relevancy`, optional `sinceId`               | Session search, Latest or Top; date operators are supported by X web search                |
| `getUserTweets`          | `username`, `maxResults=10` (5–100), `excludeReplies=false`, `excludeRetweets=true`, optional `sinceId` | Bounded recent timeline sample, filtered and sorted by publication time                    |
| `getTweetDetails`        | numeric `tweetId`                                                                                       | Session read with text, available metrics, media, links and relationship IDs               |
| `getTweetReplies`        | numeric `tweetId`, `limit`                                                                              | Reply sample visible to the session                                                        |
| `getTweetThread`         | numeric `tweetId`, `limit`                                                                              | Conversation root resolved first, then a bounded thread sample (may include other authors) |
| `getRetweeters`          | numeric `tweetId`, `limit`                                                                              | Reposting user sample                                                                      |
| `getBookmarks`           | `limit`                                                                                                 | Private bookmarks of the configured session; request only for the user's bookmark task     |
| `getUser`                | `username`                                                                                              | User profile                                                                               |
| `getUserById`            | `userId`                                                                                                | User profile by numeric ID                                                                 |
| `getUserAbout`           | `username`                                                                                              | Available account-about information                                                        |
| `getUserFollowers`       | `userId`, `limit`                                                                                       | Follower sample                                                                            |
| `getUserFollowing`       | `userId`, `limit`                                                                                       | Following sample                                                                           |
| `getVerifiedFollowers`   | `userId`, `limit`                                                                                       | Verified follower sample                                                                   |
| `getUserSubscriptions`   | `userId`, `limit`                                                                                       | Creator subscription sample                                                                |
| `getUserMedia`           | `userId`, `limit`                                                                                       | Posts containing media                                                                     |
| `searchUsers`            | `query`, `limit`                                                                                        | User search                                                                                |
| `searchTrends`           | `query`, `limit`                                                                                        | Trend search                                                                               |
| `getListTweets`          | `listId`, `limit`                                                                                       | List timeline sample                                                                       |
| `getListMembers`         | `listId`, `limit`                                                                                       | List member sample                                                                         |
| `getCommunity`           | `communityId`                                                                                           | Community information                                                                      |
| `getCommunityMembers`    | `communityId`, `limit`                                                                                  | Community member sample                                                                    |
| `getCommunityModerators` | `communityId`, `limit`                                                                                  | Community moderator sample                                                                 |
| `getCommunityTweets`     | `communityId`, `limit`                                                                                  | Community post sample                                                                      |
| `getTrends`              | `category=news`, `sport` or `entertainment`, `limit`                                                    | Trends for a supported category                                                            |
| `deleteTweet`            | `tweetId`                                                                                               | Delete an owned post using the configured write account; disabled by default               |
| `sendTweet`              | `text`                                                                                                  | Explicit API or named-session publishing; disabled by default                              |

Collection tools use `limit=20` by default, strictly bounded to 1–100 returned items. Pass IDs as strings to preserve all digits. Usernames may include `@`; profile URLs are not accepted. The wrapper exposes twscrape's supported read surface, not arbitrary raw requests or library methods. Session publishing/deletion uses a separate adapter rather than twscrape's read API.

Examples:

```json
{ "query": "MCP lang:zh -is:retweet since:2026-09-01", "maxResults": 10 }
```

```json
{ "username": "@golang", "maxResults": 10, "excludeReplies": true }
```

```json
{ "tweetId": "1897009050392379653", "limit": 20 }
```

## Results and bounded reads

Tools provide JSON text and `structuredContent`. Session post results use `source: "twscrape"`, preserve IDs as strings, and include text, author, URL, timestamp, available engagement metrics and media/link metadata. Collections return `items`; the existing search/timeline tools retain `tweets`, `resultCount`, `nextToken`, `partial` and their query/user fields.

Session reads are **bounded samples**, not a completeness guarantee:

- twscrape may make multiple HTTP requests and performs its own read retries/account selection. The wrapper caps returned items and the total operation time, and never waits indefinitely for a locked account.
- `coverage: "bounded"` and `limitReached` describe the result. Reaching the limit does not prove another page exists; getting fewer items does not prove all visible data was collected. X controls page size, pinned items, visibility and filtering.
- `partial=true` means an upstream/parser warning occurred. Error-only or failed reads must not be interpreted as “no new posts.”
- `nextToken` is null in session mode; official API cursors cannot be reused with twscrape. For incremental search use `sinceId` or date operators. Timeline `sinceId` filters the bounded upstream sample locally and does not guarantee a complete incremental sync.
- Only one session worker runs per server process. Concurrent session calls return `SERVER_BUSY`; no hidden request queue or background polling is started.
- User timelines are generally limited upstream to about 3,200 posts. Cookie access does not mean unlimited retrieval. X can invalidate sessions or change private endpoints.

## Public `getTweet`

The default oEmbed route remains useful for lightweight public lookup: no session, Python or developer API key. It provides display text, author, link and a display date. It does not provide a full thread or engagement metrics; long-post text can be truncated. Private, deleted, restricted or non-embeddable posts may be unavailable.

A small live sample does not establish a safe sustained request rate. The server handles 429s and timeouts; it does not promise unlimited public access. Choose `TWITTER_READ_BACKEND=twscrape` or call `getTweetDetails` explicitly for authenticated detail reads. Public failures do not silently switch providers.
