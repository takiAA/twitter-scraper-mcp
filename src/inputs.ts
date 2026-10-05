import { z } from 'zod';

const nextToken = z.string().min(1).max(4096).regex(/^\S+$/).optional();
const sinceId = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .optional();

export const searchInput = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .describe('X search query, e.g. from:golang -is:retweet'),
    maxResults: z.number().int().min(10).max(100).default(10),
    sortOrder: z.enum(['recency', 'relevancy']).default('recency'),
    nextToken,
    sinceId,
  })
  .strict();

export const userTweetsInput = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^@?[A-Za-z0-9_]{1,15}$/)
      .describe('Username, with or without @; not a profile URL'),
    maxResults: z.number().int().min(5).max(100).default(10),
    excludeReplies: z.boolean().default(false),
    excludeRetweets: z.boolean().default(true),
    nextToken,
    sinceId,
  })
  .strict();

export type SearchOptions = z.output<typeof searchInput>;
export type UserTweetsOptions = z.output<typeof userTweetsInput>;
