import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
import session_writer as writer


class SessionWriteTests(unittest.IsolatedAsyncioTestCase):
    def request(self, operation="sendTweet", **extra):
        return {
            "operation": operation,
            "params": {"text": "test"}
            if operation == "sendTweet"
            else {"tweetId": "123"},
            "db": "/fake/db",
            "timeoutMs": 1000,
            "writeEnabled": True,
            "writeAccount": "test-account",
            **extra,
        }

    async def run_write(self, response, operation="sendTweet"):
        account = SimpleNamespace(
            active=True,
            has_session=True,
            username="test-account",
            cookies={"ct0": "secret", "auth_token": "secret"},
            resolve_proxy=lambda p: p,
        )
        get = AsyncMock(return_value=account)
        post = AsyncMock(
            side_effect=response if isinstance(response, BaseException) else None,
            return_value=response,
        )

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                pass

            async def post(self, *a, **kw):
                return await post(*a, **kw)

        operations = {
            "CreateTweet": {"queryId": "current-id", "features": {}},
            "DeleteTweet": {"queryId": "delete-id", "features": {}},
        }
        with (
            patch(
                "twscrape.API",
                return_value=SimpleNamespace(pool=SimpleNamespace(get_account=get)),
            ),
            patch.object(Path, "is_file", return_value=True),
            patch.object(
                writer,
                "bootstrap",
                AsyncMock(
                    return_value=(operations, SimpleNamespace(calc=lambda *a: "signed"))
                ),
            ),
            patch("httpx.AsyncClient", return_value=Client()) as client,
        ):
            try:
                return await writer.write(self.request(operation))
            finally:
                get.assert_awaited_once_with("test-account")
                self.assertEqual(post.await_count, 1)
                self.assertFalse(client.call_args.kwargs["follow_redirects"])
                self.assertNotIn("transport", client.call_args.kwargs)

    async def test_publish_and_delete_receipts(self):
        created = httpx.Response(
            200,
            json={
                "data": {
                    "create_tweet": {
                        "tweet_results": {
                            "result": {
                                "rest_id": "123",
                                "legacy": {"full_text": "test"},
                            }
                        }
                    }
                }
            },
        )
        result = await self.run_write(created)
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["account"], "test-account")
        deleted = await self.run_write(
            httpx.Response(200, json={"data": {"delete_tweet": {}}}), "deleteTweet"
        )
        self.assertEqual(deleted["id"], "123")
        self.assertEqual(deleted["status"], "deleted")

    async def test_timeout_unknown_never_retries(self):
        for operation, code in [
            ("sendTweet", "PUBLISH_OUTCOME_UNKNOWN"),
            ("deleteTweet", "DELETE_OUTCOME_UNKNOWN"),
        ]:
            with self.assertRaises(writer.WriteError) as caught:
                await self.run_write(httpx.ReadTimeout("auth_token=secret"), operation)
            self.assertEqual(caught.exception.code, code)
            self.assertNotIn("secret", caught.exception.message)

    async def test_cancelled_mutation_is_unknown(self):
        with self.assertRaises(writer.WriteError) as caught:
            await self.run_write(asyncio.CancelledError(), "deleteTweet")
        self.assertEqual(caught.exception.code, "DELETE_OUTCOME_UNKNOWN")

    async def test_rejection_and_ambiguous_payloads(self):
        for response, code in [
            (
                httpx.Response(
                    200, json={"errors": [{"code": 226, "message": "secret"}]}
                ),
                "WRITE_REJECTED",
            ),
            (httpx.Response(503), "PUBLISH_OUTCOME_UNKNOWN"),
            (httpx.Response(200, json={"data": {}}), "PUBLISH_OUTCOME_UNKNOWN"),
            (
                httpx.Response(
                    200, json={"data": {"create_tweet": {}}, "errors": [{}]}
                ),
                "PUBLISH_OUTCOME_UNKNOWN",
            ),
        ]:
            with self.assertRaises(writer.WriteError) as caught:
                await self.run_write(response)
            self.assertEqual(caught.exception.code, code)
            self.assertNotIn("secret", caught.exception.message)

    async def test_opt_in_and_named_account_required(self):
        for extra, code in [
            ({"writeEnabled": False}, "WRITE_DISABLED"),
            ({"writeAccount": ""}, "AUTH_REQUIRED"),
        ]:
            with patch("twscrape.API") as api:
                with self.assertRaises(writer.WriteError) as caught:
                    await writer.write(self.request(**extra))
                self.assertEqual(caught.exception.code, code)
                api.assert_not_called()

    async def test_missing_named_account_fails_before_network(self):
        get_account = AsyncMock(return_value=None)
        with (
            patch(
                "twscrape.API",
                return_value=SimpleNamespace(
                    pool=SimpleNamespace(get_account=get_account)
                ),
            ),
            patch.object(Path, "is_file", return_value=True),
            patch.object(writer, "bootstrap", AsyncMock()) as bootstrap,
        ):
            with self.assertRaises(writer.WriteError) as caught:
                await writer.write(self.request())
            self.assertEqual(caught.exception.code, "AUTH_FAILED")
            get_account.assert_awaited_once_with("test-account")
            bootstrap.assert_not_called()

    def test_current_bundle_metadata_without_executing_javascript(self):
        result = writer.parse_operations(
            'queryId:"abc-123",operationName:"CreateTweet",operationType:"mutation",metadata:{featureSwitches:["flag"],fieldToggles:[]}'
        )
        self.assertEqual(
            result["CreateTweet"], {"queryId": "abc-123", "features": ["flag"]}
        )
        self.assertEqual(writer.parse_operations("unsupported new layout"), {})
