import { z } from 'zod';
const id = z
  .string()
  .regex(/^[1-9]\d{0,19}$/)
  .describe('Numeric ID as a string; preserve all digits');
const username = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{1,15}$/);
const limit = z.number().int().min(1).max(100).default(20);
const query = z.string().trim().min(1).max(4096);
const defs = [
  [
    'getTweetDetails',
    'Read a post through your X session with text, metrics, media and relationship IDs.',
    { tweetId: id },
  ],
  [
    'getTweetReplies',
    'Read a bounded sample of replies visible to your X session. Not an exhaustive conversation.',
    { tweetId: id, limit },
  ],
  [
    'getTweetThread',
    'Resolve a post to its conversation root and read a bounded thread sample through twscrape. Replies may include other authors; deleted or inaccessible posts may be missing.',
    { tweetId: id, limit },
  ],
  [
    'getRetweeters',
    'Read accounts that reposted a post, as visible to your session.',
    { tweetId: id, limit },
  ],
  [
    'getBookmarks',
    'Read private bookmarks of the configured X session. Return only when the user requests their bookmarks.',
    { limit },
  ],
  ['getUser', 'Look up a user profile by username through your X session.', { username }],
  [
    'getUserById',
    'Look up a user profile by numeric ID through your X session. This upstream endpoint failed in the 2026-10-05 live check; prefer getUser by username.',
    { userId: id },
  ],
  [
    'getUserAbout',
    'Read available account-about information. Missing fields remain unknown.',
    { username },
  ],
  [
    'getUserFollowers',
    'Read a bounded sample of followers. Not an exhaustive follower list.',
    { userId: id, limit },
  ],
  ['getUserFollowing', 'Read a bounded sample of accounts a user follows.', { userId: id, limit }],
  ['getVerifiedFollowers', 'Read a bounded sample of verified followers.', { userId: id, limit }],
  [
    'getUserSubscriptions',
    'Read a bounded sample of creator subscriptions visible to your session.',
    { userId: id, limit },
  ],
  [
    'getUserMedia',
    'Read a bounded sample of posts containing media from a user.',
    { userId: id, limit },
  ],
  ['searchUsers', 'Search X user profiles through your X session.', { query, limit }],
  [
    'searchTrends',
    'Search posts about a trend query through twscrape (search_trend returns posts, not a ranked trend list).',
    { query, limit },
  ],
  ['getListTweets', 'Read a bounded sample of posts in an X list.', { listId: id, limit }],
  ['getListMembers', 'Read a bounded sample of members of an X list.', { listId: id, limit }],
  ['getCommunity', 'Read X community information through your session.', { communityId: id }],
  [
    'getCommunityMembers',
    'Read a bounded sample of community members.',
    { communityId: id, limit },
  ],
  [
    'getCommunityModerators',
    'Read a bounded sample of community moderators.',
    { communityId: id, limit },
  ],
  ['getCommunityTweets', 'Read a bounded sample of community posts.', { communityId: id, limit }],
  [
    'getTrends',
    'Read a bounded sample of X trends for a supported category. This upstream endpoint failed in the 2026-10-05 live check; availability is not established.',
    { category: z.enum(['news', 'sport', 'entertainment']).default('news'), limit },
  ],
] as const;

export const scrapeTools = defs.map(([name, description, shape]) => ({
  name,
  description,
  schema: z.object(shape).strict(),
}));
export function scrapeInput(operation: string, input: unknown): Record<string, unknown> {
  const tool = scrapeTools.find((t) => t.name === operation);
  if (!tool) throw new Error('Unknown twscrape operation');
  const parsed = tool.schema.parse(input) as Record<string, unknown>;
  if (typeof parsed.username === 'string') parsed.username = parsed.username.replace(/^@/, '');
  return parsed;
}
