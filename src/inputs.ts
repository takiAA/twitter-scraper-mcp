import { z } from 'zod';

const nextToken = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^\S+$/)
  .describe(
    'Use the previous nextToken with the same query/sort/filters. Session tokens expire after 15 minutes or server restart.',
  )
  .optional();
const sinceId = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .optional();

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Use a valid YYYY-MM-DD date.');
const username = z.string().regex(/^@?[A-Za-z0-9_]{1,15}$/);
const searchFilters = z
  .object({
    language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[a-z]{2,4})?$/)
      .optional(),
    fromUsername: username.optional(),
    excludeReplies: z.boolean().optional(),
    excludeRetweets: z.boolean().optional(),
    hasMedia: z.boolean().optional(),
    minLikes: z.number().int().min(0).max(1000000000).optional(),
    minReplies: z.number().int().min(0).max(1000000000).optional(),
    minRetweets: z.number().int().min(0).max(1000000000).optional(),
    sinceDate: date.optional(),
    untilDate: date.describe('Exclusive upper date boundary.').optional(),
  })
  .strict()
  .refine(
    (f) => !f.sinceDate || !f.untilDate || f.sinceDate < f.untilDate,
    'sinceDate must precede untilDate.',
  );

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
    filters: searchFilters
      .describe(
        'Optional browser-style advanced filters for twscrape session search. Raw X operators in query remain supported.',
      )
      .optional(),
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

export function sessionSearchQuery(options: SearchOptions): string {
  const f = options.filters;
  const parts = [options.query];
  if (!f) return options.query;
  if (f.language) parts.push(`lang:${f.language}`);
  if (f.fromUsername) parts.push(`from:${f.fromUsername.replace(/^@/, '')}`);
  if (f.excludeReplies) parts.push('-filter:replies');
  if (f.excludeRetweets) parts.push('-filter:retweets');
  if (f.hasMedia !== undefined) parts.push(f.hasMedia ? 'filter:media' : '-filter:media');
  if (f.minLikes !== undefined) parts.push(`min_faves:${f.minLikes}`);
  if (f.minReplies !== undefined) parts.push(`min_replies:${f.minReplies}`);
  if (f.minRetweets !== undefined) parts.push(`min_retweets:${f.minRetweets}`);
  if (f.sinceDate) parts.push(`since:${f.sinceDate}`);
  if (f.untilDate) parts.push(`until:${f.untilDate}`);
  return parts.join(' ');
}
