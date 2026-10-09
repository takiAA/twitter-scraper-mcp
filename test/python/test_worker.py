import asyncio
import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "worker", Path(__file__).resolve().parents[2] / "python/worker.py"
)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_collection_hard_cap_dedup_and_release(self):
        state = []

        async def gen():
            try:
                for n in [1, 1, 2, 3, 4]:
                    yield {"id": str(n)}
            finally:
                state.append("closed")

        result = await worker.collect(gen(), 2)
        self.assertEqual(result, [{"id": "1"}, {"id": "2"}])
        self.assertEqual(state, ["closed"])

    async def test_normalize_exact_ids_and_metadata(self):
        source = {
            "id": 2096765359282061544,
            "id_str": "2096765359282061544",
            "date": datetime(2026, 10, 5, tzinfo=timezone.utc),
            "rawContent": "完整正文",
            "url": "https://x.com/test/status/2096765359282061544",
            "user": {"displayname": "Test", "username": "test"},
            "conversationId": 2096765359282061544,
            "likeCount": 5,
            "quotedTweet": {"id": 1897009050392379653},
            "media": {"photos": []},
        }
        data = worker.tweet(source)
        self.assertEqual(data["id"], "2096765359282061544")
        self.assertEqual(data["quotedTweetId"], "1897009050392379653")
        self.assertEqual(data["text"], "完整正文")
        self.assertEqual(data["metrics"], {"like_count": 5})
        self.assertIn("2026-10-05", data["publishedAt"])

    async def test_search_mapping_and_strict_limit(self):
        calls = []

        async def gen(q, **kw):
            calls.append((q, kw))
            for i in range(5):
                yield {"id": i}

        api = SimpleNamespace(search=gen)
        with patch.object(worker, "tweet", lambda x: x):
            result = await worker.dispatch(
                api,
                "searchTweets",
                {
                    "query": "python",
                    "sortOrder": "relevancy",
                    "maxResults": 2,
                    "sinceId": "100",
                },
            )
        self.assertEqual(
            calls, [("python since_id:100", {"limit": 2, "kv": {"product": "Top"}})]
        )
        self.assertEqual(len(result["tweets"]), 2)
        self.assertTrue(result["limitReached"])
        self.assertEqual(result["coverage"], "bounded")
        self.assertIsNone(result["nextToken"])

    async def test_raw_search_page_keeps_timeline_order_and_excludes_quote_only_hits(
        self,
    ):
        calls, closed = [], []
        entries = [
            {
                "content": {
                    "itemContent": {"tweet_results": {"result": {"rest_id": "3"}}}
                }
            },
            {
                "content": {
                    "items": [
                        {
                            "item": {
                                "itemContent": {
                                    "tweet_results": {
                                        "result": {"tweet": {"rest_id": "1"}}
                                    }
                                }
                            }
                        }
                    ]
                }
            },
        ]
        body = {"entries": entries, "cursor": "bottom"}

        async def raw(q, **kw):
            calls.append((q, kw))
            try:
                yield SimpleNamespace(json=lambda: body)
                self.fail("Only one raw page should be consumed")
            finally:
                closed.append(True)

        api = SimpleNamespace(
            search_raw=raw,
            _get_cursor=lambda b: b["cursor"],
            _gql_entries=lambda b: b["entries"],
        )
        with (
            patch(
                "twscrape.models.parse_tweets",
                lambda _: [SimpleNamespace(id=n) for n in [1, 2, 3]],
            ),
            patch.object(worker, "tweet", lambda t: {"id": str(t.id)}),
        ):
            result = await worker.dispatch(
                api,
                "searchTweetsPage",
                {"query": "polymarket", "sortOrder": "relevancy", "cursor": "previous"},
            )
        self.assertEqual([t["id"] for t in result["tweets"]], ["3", "1"])
        self.assertEqual(result["cursor"], "bottom")
        self.assertEqual(
            calls,
            [
                (
                    "polymarket",
                    {"limit": 1, "kv": {"cursor": "previous", "product": "Top"}},
                )
            ],
        )
        self.assertEqual(closed, [True])

    async def test_raw_timeline_page_reuses_profile_and_applies_filters(self):
        rows = [
            SimpleNamespace(
                id=n,
                retweetedTweet=None if n != 4 else {},
                inReplyToTweetId=None if n != 3 else 1,
            )
            for n in [1, 2, 3, 4]
        ]
        body = {
            "entries": [
                {
                    "content": {
                        "itemContent": {
                            "tweet_results": {"result": {"rest_id": str(n)}}
                        }
                    }
                }
                for n in [1, 2, 3, 4]
            ]
        }

        async def raw(uid, **kw):
            self.assertEqual(uid, 7)
            yield SimpleNamespace(json=lambda: body)

        api = SimpleNamespace(
            user_tweets_raw=raw,
            _get_cursor=lambda _: None,
            _gql_entries=lambda b: b["entries"],
        )
        with (
            patch("twscrape.models.parse_tweets", lambda _: rows),
            patch.object(worker, "tweet", lambda t: {"id": str(t.id)}),
        ):
            result = await worker.dispatch(
                api,
                "getUserTweetsPage",
                {
                    "username": "test",
                    "user": {"id": "7", "username": "test"},
                    "excludeReplies": True,
                    "excludeRetweets": True,
                    "sinceId": "1",
                },
            )
        self.assertEqual(result["tweets"], [{"id": "2"}])
        self.assertEqual(result["user"]["id"], "7")

    async def test_timeline_missing_parsed_root_does_not_silently_return_empty(self):
        async def raw(*args, **kw):
            yield SimpleNamespace(json=dict)

        api = SimpleNamespace(
            search_raw=raw,
            _get_cursor=lambda _: None,
            _gql_entries=lambda _: [
                {
                    "content": {
                        "itemContent": {"tweet_results": {"result": {"rest_id": "1"}}}
                    }
                }
            ],
        )
        with (
            patch("twscrape.models.parse_tweets", lambda _: []),
            self.assertRaises(worker.ProviderError) as e,
        ):
            await worker.dispatch(
                api, "searchTweetsPage", {"query": "x", "sortOrder": "recency"}
            )
        self.assertEqual(e.exception.code, "UPSTREAM_FORMAT")

    async def test_reject_api_cursor_and_unknown_operation(self):
        for op, params in [("searchTweets", {"nextToken": "api-cursor"}), ("post", {})]:
            with self.assertRaises(worker.ProviderError) as e:
                await worker.dispatch(SimpleNamespace(), op, params)
            self.assertEqual(e.exception.code, "INVALID_INPUT")

    async def test_empty_and_missing_detail_are_distinct(self):
        async def empty(**kw):
            if False:
                yield None

        result = await worker.dispatch(
            SimpleNamespace(bookmarks=empty), "getBookmarks", {"limit": 5}
        )
        self.assertEqual(result["items"], [])
        self.assertFalse(result["limitReached"])

        async def missing(_):
            return None

        with self.assertRaises(worker.ProviderError) as e:
            await worker.dispatch(
                SimpleNamespace(tweet_details=missing),
                "getTweetDetails",
                {"tweetId": "20"},
            )
        self.assertEqual(e.exception.code, "NOT_FOUND")

    async def test_timeline_filters_replies_retweets_and_sorts_pinned_sample(self):
        owner = SimpleNamespace(id=7)

        async def by_login(name):
            self.assertEqual(name, "golang")
            return owner

        async def gen(uid, **kwargs):
            rows = [
                (1, "2020-01-01", None, None),
                (3, "2026-10-05", None, None),
                (4, "2026-10-05", 1, None),
                (5, "2026-10-05", None, {}),
                (2, "2026-10-04", None, None),
            ]
            for n, date, reply, retweet in rows:
                yield SimpleNamespace(
                    id=n, date=date, inReplyToTweetId=reply, retweetedTweet=retweet
                )

        api = SimpleNamespace(user_by_login=by_login, user_tweets=gen)
        with (
            patch.object(
                worker,
                "user",
                lambda _: {"id": "7", "name": "Go", "username": "golang"},
            ),
            patch.object(
                worker, "tweet", lambda t: {"id": str(t.id), "publishedAt": t.date}
            ),
        ):
            result = await worker.dispatch(
                api,
                "getUserTweets",
                {
                    "username": "@golang",
                    "maxResults": 5,
                    "excludeReplies": True,
                    "excludeRetweets": True,
                    "sinceId": "1",
                },
            )
        self.assertEqual([t["id"] for t in result["tweets"]], ["3", "2"])

    async def test_thread_resolves_reply_to_conversation_root(self):
        calls = []

        async def details(tid):
            calls.append(("details", tid))
            return SimpleNamespace(conversationId=100)

        async def thread(tid, **kwargs):
            calls.append(("thread", tid))
            yield {"id": "100"}

        with patch.object(worker, "tweet", lambda x: x):
            result = await worker.dispatch(
                SimpleNamespace(tweet_details=details, tweet_thread=thread),
                "getTweetThread",
                {"tweetId": "101", "limit": 3},
            )
        self.assertEqual(calls, [("details", 101), ("thread", 100)])
        self.assertEqual(result["rootTweetId"], "100")
        self.assertEqual(result["resultCount"], 1)

    async def test_real_library_supports_every_exposed_read(self):
        from twscrape import API

        methods = [
            "search",
            "search_raw",
            "user_tweets_raw",
            "user_tweets_and_replies_raw",
            "search_user",
            "search_trend",
            "tweet_details",
            "tweet_replies",
            "tweet_thread",
            "retweeters",
            "bookmarks",
            "user_by_id",
            "user_by_login",
            "user_about",
            "followers",
            "following",
            "verified_followers",
            "subscriptions",
            "user_tweets",
            "user_tweets_and_replies",
            "user_media",
            "list_timeline",
            "list_members",
            "community_info",
            "community_members",
            "community_moderators",
            "community_tweets",
            "trends",
        ]
        for method in methods:
            self.assertTrue(callable(getattr(API, method)))

    async def test_missing_database_and_unknown_error_redaction(self):
        result = await worker.main(
            {
                "db": "/nonexistent/twscrape-test.db",
                "timeoutMs": 1000,
                "operation": "getBookmarks",
                "params": {},
            }
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "AUTH_REQUIRED")

        async def broken(_):
            raise RuntimeError("auth_token=secret")

        with patch.object(worker, "run", broken):
            result = await worker.main({"timeoutMs": 1000})
        self.assertNotIn("secret", str(result))

    async def test_timeout_cancels_and_releases_operation(self):
        released = []

        async def slow(_):
            try:
                await asyncio.sleep(10)
            finally:
                released.append(True)

        with patch.object(worker, "run", slow):
            result = await worker.main({"timeoutMs": 5})
        self.assertEqual(result["error"]["code"], "REQUEST_TIMEOUT")
        self.assertEqual(released, [True])


if __name__ == "__main__":
    unittest.main()
