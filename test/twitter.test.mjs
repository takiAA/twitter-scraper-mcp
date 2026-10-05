import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../dist/src/config.js';
import {
  createTwitterService,
  normalizeTweetId,
  extractEmbedText,
  TwitterError,
} from '../dist/src/twitter.js';

const embed = {
  url: 'https://x.com/example/status/123',
  author_name: 'Example',
  author_url: 'https://x.com/example',
  html: '<blockquote><p>Hello &amp; 世界<br>Second line <a href="https://t.co/test">link</a></p>— Example <a href="https://x.com/example/status/123">October 5, 2026</a></blockquote>',
};
function service(options = {}, fetch = async () => Response.json(embed), createApi) {
  return createTwitterService({ ...loadConfig({}), ...options }, { fetch, createApi });
}
const rejectsCode = async (action, code) =>
  assert.rejects(action, (e) => e instanceof TwitterError && e.code === code);

test('ID and URL inputs are normalized without allowing arbitrary hosts', () => {
  for (const input of [
    '123',
    ' https://x.com/example/status/123?s=20 ',
    'https://twitter.com/i/web/status/123',
    'https://x.com/i/status/123',
    'https://x.com/example/status/123/photo/1',
  ])
    assert.equal(normalizeTweetId(input), '123');
  for (const input of [
    '',
    '0',
    'abc',
    'https://x.com.evil.test/example/status/123',
    'https://evil.test/123',
    'http://x.com/example/status/123',
    'https://user@x.com/example/status/123',
    'https://x.com:444/example/status/123',
    '123456789012345678901',
  ])
    assert.throws(
      () => normalizeTweetId(input),
      (e) => e.code === 'INVALID_INPUT',
    );
});
test('embed parsing preserves entities, line breaks and visible link text', () => {
  assert.deepEqual(extractEmbedText(embed.html), {
    text: 'Hello & 世界\nSecond line link',
    date: 'October 5, 2026',
  });
  assert.equal(
    extractEmbedText('<p>safe<script>secret()</script><style>bad</style></p>').text,
    'safe',
  );
  assert.throws(
    () => extractEmbedText('<div>changed format</div>'),
    (e) => e.code === 'UPSTREAM_FORMAT',
  );
});
test('public reads require no credentials and request only a fixed X endpoint', async () => {
  let requested;
  const api = service({}, async (url) => {
    requested = new URL(url);
    return Response.json(embed);
  });
  const result = await api.getTweet('https://x.com/example/status/123');
  assert.equal(result.id, '123');
  assert.equal(result.text, 'Hello & 世界\nSecond line link');
  assert.equal(result.author.username, 'example');
  assert.equal(result.source, 'oembed');
  assert.equal(requested.origin, 'https://publish.twitter.com');
  assert.equal(requested.searchParams.get('hide_thread'), 'true');
  assert.equal(requested.searchParams.get('url'), 'https://twitter.com/i/status/123');
});
test('invalid input never issues a network request', async () => {
  await rejectsCode(
    () => service({}, async () => assert.fail('network')).getTweet('https://evil.test'),
    'INVALID_INPUT',
  );
});
for (const [status, code] of [
  [401, 'AUTH_FAILED'],
  [402, 'API_ACCESS_REQUIRED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [429, 'RATE_LIMITED'],
  [503, 'UPSTREAM_ERROR'],
]) {
  test(`public HTTP ${status} produces ${code}`, async () => {
    await rejectsCode(
      () => service({}, async () => new Response('private response', { status })).getTweet('123'),
      code,
    );
  });
}
test('invalid, oversized and mismatched public responses fail explicitly', async () => {
  for (const response of [
    () => new Response('{'),
    () => Response.json({}),
    () => new Response('x'.repeat(1024 * 1024 + 1)),
    () => Response.json({ ...embed, url: 'https://x.com/example/status/999' }),
  ]) {
    await rejectsCode(() => service({}, async () => response()).getTweet('123'), 'UPSTREAM_FORMAT');
  }
});
test('network errors never expose raw credentials or proxy URLs', async () => {
  await assert.rejects(
    () =>
      service({}, async () => {
        throw new Error('secret-password https://user:password@proxy');
      }).getTweet('123'),
    (e) => e.code === 'NETWORK_ERROR' && !e.message.includes('password'),
  );
});
test('default mode cannot publish, even with a configured transport', async () => {
  await rejectsCode(
    () =>
      service({}, undefined, () => assert.fail('transport must not initialize')).sendTweet('hello'),
    'WRITE_DISABLED',
  );
});
test('blank text is rejected before initializing authentication', async () => {
  await rejectsCode(
    () =>
      service({ enableWrite: true }, undefined, () => assert.fail('transport')).sendTweet(' \n '),
    'INVALID_INPUT',
  );
});
test('failed initialization is not cached, so the next call can recover', async () => {
  let attempts = 0;
  const api = service({ readBackend: 'api' }, undefined, () => {
    if (++attempts === 1) throw new TwitterError('AUTH_REQUIRED', 'missing credentials');
    return { read: async () => ({ data: { id: '123', text: 'ok' } }), close() {} };
  });
  await rejectsCode(() => api.getTweet('123'), 'AUTH_REQUIRED');
  assert.equal((await api.getTweet('123')).text, 'ok');
  assert.equal(attempts, 2);
});
test('API reads return long-post text, author and metrics', async () => {
  const api = service({ readBackend: 'api' }, undefined, () => ({
    read: async () => ({
      data: {
        id: '123',
        text: 'short',
        note_tweet: { text: 'long' },
        author_id: '7',
        public_metrics: { like_count: 2 },
      },
      includes: { users: [{ id: '7', name: 'Example', username: 'example' }] },
    }),
    close() {},
  }));
  const result = await api.getTweet('123');
  assert.equal(result.text, 'long');
  assert.equal(result.metrics.like_count, 2);
  assert.equal(result.author.username, 'example');
});
test('publishing returns confirmed ID and URL with exactly one write', async () => {
  let posts = 0;
  const api = service({ enableWrite: true }, undefined, () => ({
    post: async (text) => {
      posts++;
      return { data: { id: '456', text } };
    },
    close() {},
  }));
  assert.deepEqual(await api.sendTweet(' hello '), {
    id: '456',
    text: ' hello ',
    url: 'https://x.com/i/status/456',
    status: 'published',
    source: 'x-api',
  });
  assert.equal(posts, 1);
});
test('ambiguous publication responses and network errors never trigger retries', async () => {
  for (const fail of [
    async () => ({}),
    async () => {
      throw new Error('timeout with secret');
    },
    async () => {
      throw { code: 503 };
    },
  ]) {
    let attempts = 0;
    const api = service({ enableWrite: true }, undefined, () => ({
      post: async () => {
        attempts++;
        return fail();
      },
      close() {},
    }));
    await rejectsCode(() => api.sendTweet('hello'), 'PUBLISH_OUTCOME_UNKNOWN');
    assert.equal(attempts, 1);
  }
});
test('API authentication rejection never falls back or returns a false success', async () => {
  let attempts = 0;
  const api = service({ enableWrite: true }, undefined, () => ({
    post: async () => {
      attempts++;
      throw { code: 401 };
    },
    close() {},
  }));
  await rejectsCode(() => api.sendTweet('hello'), 'AUTH_FAILED');
  assert.equal(attempts, 1);
});
