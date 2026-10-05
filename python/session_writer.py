"""Opt-in writes using one named local session; never retry a mutation."""

import asyncio
import json
import re
from pathlib import Path


class WriteError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def unknown(operation):
    return WriteError(
        "PUBLISH_OUTCOME_UNKNOWN"
        if operation == "sendTweet"
        else "DELETE_OUTCOME_UNKNOWN",
        "The write outcome is unknown. Check the account before retrying. No automatic retry was made.",
    )


def parse_operations(text):
    result = {}
    for operation in ("CreateTweet", "DeleteTweet"):
        match = re.search(
            r'queryId:"([\w-]+)",operationName:"'
            + operation
            + r'"[^}]*metadata:\{(.*?)\}',
            text,
        )
        if not match:
            continue
        flags = re.search(r"featureSwitches:(\[[^\]]*\])", match[2])
        result[operation] = {
            "queryId": match[1],
            "features": json.loads(flags[1]) if flags else [],
        }
    return result


async def bounded_text(client, url, limit):
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > limit:
                raise ValueError("Oversized web asset")
            chunks.append(chunk)
    return b"".join(chunks).decode("utf8")


async def bootstrap(account, proxy, timeout):
    import httpx
    from twscrape.api import GQL_FEATURES
    from twscrape.queue_client import XClIdGenStore
    from twscrape.xclid import get_scripts_list

    # Cookies stay on x.com; asset downloads use a separate, credential-free client.
    async with httpx.AsyncClient(
        proxy=proxy, cookies=account.cookies, follow_redirects=False, timeout=timeout
    ) as client:
        page = await bounded_text(client, "https://x.com/home", 2 * 1024 * 1024)
    urls = list(
        dict.fromkeys(
            u
            for u in get_scripts_list(page)
            if re.fullmatch(
                r"https://abs\.twimg\.com/responsive-web/client-web/main\.[\w.-]+\.js",
                u,
            )
        )
    )
    operations = {}
    async with httpx.AsyncClient(
        proxy=proxy, follow_redirects=False, timeout=timeout
    ) as client:
        for url in urls[:2]:
            operations.update(
                parse_operations(await bounded_text(client, url, 8 * 1024 * 1024))
            )
    if set(operations) != {"CreateTweet", "DeleteTweet"}:
        raise ValueError("Current web build does not expose supported write metadata")
    for spec in operations.values():
        spec["features"] = {
            name: bool(GQL_FEATURES.get(name, False)) for name in spec["features"]
        }
    signer = await XClIdGenStore.get(
        account.username, proxy=proxy, cookies=account.cookies
    )
    return operations, signer


def check_response(response, operation):
    if response.status_code >= 500 or 300 <= response.status_code < 400:
        raise unknown(operation)
    if response.status_code == 401:
        raise WriteError(
            "AUTH_FAILED", "X rejected this session. Reimport cookies locally."
        )
    if response.status_code == 429:
        raise WriteError("RATE_LIMITED", "X rate limited the write. No retry was made.")
    if response.status_code >= 400:
        raise WriteError(
            "WRITE_REJECTED", f"X rejected the write (HTTP {response.status_code})."
        )
    try:
        body = response.json()
    except Exception:
        raise unknown(operation)
    if not isinstance(body, dict):
        raise unknown(operation)
    if body.get("errors"):
        # Do not forward raw authenticated responses or upstream error messages.
        codes = sorted(
            {
                str(e.get("code"))
                for e in body["errors"]
                if isinstance(e, dict) and isinstance(e.get("code"), int)
            }
        )
        # A success payload alongside errors may still represent a completed write.
        if body.get("data"):
            raise unknown(operation)
        raise WriteError(
            "WRITE_REJECTED",
            "X rejected the write"
            + (" (codes: " + ", ".join(codes) + ")" if codes else "")
            + ". No retry was made.",
        )
    return body


async def write(request):
    import httpx
    from twscrape import API
    from twscrape.account import TOKEN
    from twscrape.logger import logger

    logger.remove()
    operation, params = request["operation"], request["params"]
    if request.get("writeEnabled") is not True:
        raise WriteError("WRITE_DISABLED", "Session writes are disabled.")
    label = request.get("writeAccount")
    if not isinstance(label, str) or not label.strip():
        raise WriteError(
            "AUTH_REQUIRED",
            "Set TWITTER_WRITE_ACCOUNT to an exact account label from your local database.",
        )
    if operation == "sendTweet":
        if (
            not isinstance(params.get("text"), str)
            or not params["text"].strip()
            or len(params["text"]) > 25000
        ):
            raise WriteError("INVALID_INPUT", "Invalid post text.")
    elif operation == "deleteTweet":
        if not re.fullmatch(r"[1-9]\d{0,19}", str(params.get("tweetId", ""))):
            raise WriteError("INVALID_INPUT", "Invalid tweet ID.")
    else:
        raise WriteError("INVALID_INPUT", "Unsupported write operation.")
    if not Path(request["db"]).is_file():
        raise WriteError("AUTH_REQUIRED", "Import your session locally first.")
    account = await API(request["db"]).pool.get_account(label)
    if not account or not account.active or not account.has_session:
        raise WriteError(
            "AUTH_FAILED",
            "The named session is missing or inactive. No account fallback was made.",
        )
    proxy, timeout = (
        account.resolve_proxy(request.get("proxy")),
        request["timeoutMs"] / 1000,
    )
    try:
        operations, signer = await bootstrap(account, proxy, timeout)
    except asyncio.CancelledError:
        raise
    except Exception:
        raise WriteError(
            "SESSION_BOOTSTRAP_FAILED",
            "Could not prepare current X write metadata/signature. No write was attempted.",
        )
    action = "CreateTweet" if operation == "sendTweet" else "DeleteTweet"
    spec = operations[action]
    path = f"/i/api/graphql/{spec['queryId']}/{action}"
    variables = (
        {
            "tweet_text": params["text"],
            "dark_request": False,
            "media": {"media_entities": [], "possibly_sensitive": False},
            "semantic_annotation_ids": [],
            "disallowed_reply_options": None,
        }
        if operation == "sendTweet"
        else {"tweet_id": params["tweetId"], "dark_request": False}
    )
    headers = {
        "authorization": TOKEN,
        "x-csrf-token": account.cookies["ct0"],
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "origin": "https://x.com",
        "referer": "https://x.com/compose/post",
        "x-client-transaction-id": signer.calc("POST", path),
    }
    # Do not use twscrape's read client: its curl backend retries requests.
    # httpx has zero transport retries by default; redirects are also disabled.
    async with httpx.AsyncClient(
        proxy=proxy,
        cookies=account.cookies,
        headers=headers,
        follow_redirects=False,
        timeout=timeout,
    ) as client:
        try:
            response = await client.post(
                "https://x.com" + path,
                json={
                    "variables": variables,
                    "features": spec["features"],
                    "queryId": spec["queryId"],
                },
            )
        except (Exception, asyncio.CancelledError):
            raise unknown(operation)
    body = check_response(response, operation)
    try:
        if operation == "sendTweet":
            post = body["data"]["create_tweet"]["tweet_results"]["result"]
            post = post.get("tweet", post)
            tid, text = post["rest_id"], post["legacy"]["full_text"]
            if (
                not isinstance(tid, str)
                or not re.fullmatch(r"[1-9]\d{0,19}", tid)
                or not isinstance(text, str)
            ):
                raise ValueError()
            return {
                "id": tid,
                "text": text,
                "url": f"https://x.com/i/status/{tid}",
                "status": "published",
                "source": "x-session",
                "account": label,
            }
        if "delete_tweet" not in body["data"]:
            raise ValueError()
        return {
            "id": params["tweetId"],
            "status": "deleted",
            "source": "x-session",
            "account": label,
        }
    except Exception:
        raise unknown(operation)
