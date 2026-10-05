"""Bounded JSON bridge for session reads."""

import asyncio
import json
import os
import sys
from contextlib import aclosing
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

os.environ["TWS_TELEMETRY"] = "0"
os.environ["TWS_LOG_LEVEL"] = "ERROR"


class ProviderError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def safe(value):
    """Keep snowflakes exact, including nested models; omit no secrets by accident."""
    if hasattr(value, "dict"):
        value = value.dict()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [safe(v) for v in value]
    if isinstance(value, int) and abs(value) > 9007199254740991:
        return str(value)
    return value


def user(value):
    d = safe(value)
    return {
        "id": str(d.get("id_str", d["id"])),
        "name": d["displayname"],
        "username": d["username"],
        "url": d["url"],
        "description": d["rawDescription"],
        "followersCount": d["followersCount"],
        "followingCount": d["friendsCount"],
        "verified": d.get("verified"),
        "protected": d.get("protected"),
        "source": "twscrape",
    }


def tweet(value):
    d = safe(value)
    return {
        "id": str(d.get("id_str", d["id"])),
        "text": d["rawContent"],
        "url": d["url"],
        "author": {"name": d["user"]["displayname"], "username": d["user"]["username"]},
        "publishedAt": d["date"],
        "source": "twscrape",
        "metrics": {
            k: d[n]
            for k, n in (
                ("reply_count", "replyCount"),
                ("retweet_count", "retweetCount"),
                ("like_count", "likeCount"),
                ("quote_count", "quoteCount"),
                ("bookmark_count", "bookmarkedCount"),
                ("view_count", "viewCount"),
            )
            if d.get(n) is not None
        },
        "conversationId": str(d.get("conversationIdStr", d.get("conversationId"))),
        "inReplyToId": str(d["inReplyToTweetId"])
        if d.get("inReplyToTweetId")
        else None,
        "quotedTweetId": str(d["quotedTweet"]["id"]) if d.get("quotedTweet") else None,
        "retweetedTweetId": str(d["retweetedTweet"]["id"])
        if d.get("retweetedTweet")
        else None,
        "media": d.get("media"),
        "links": d.get("links", []),
    }


async def collect(gen, limit, convert=safe, predicate=None):
    items, seen = [], set()
    async with aclosing(gen):
        async for item in gen:
            if predicate and not predicate(item):
                continue
            data = convert(item)
            identity = data.get("id") if isinstance(data, dict) else None
            if identity is not None and identity in seen:
                continue
            seen.add(identity)
            items.append(data)
            if len(items) >= limit:
                break
    return items


async def dispatch(api, op, p):
    limit = p.get("limit", p.get("maxResults", 10))
    base = {
        "source": "twscrape",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "twscrapeVersion": version("twscrape"),
    }
    if p.get("nextToken"):
        raise ProviderError(
            "INVALID_INPUT",
            "nextToken belongs to official API mode. twscrape uses bounded reads; use sinceId or search date operators for incremental reads.",
        )
    if op == "getTweetDetails":
        result = await api.tweet_details(int(p["tweetId"]))
        if result is None:
            raise ProviderError("NOT_FOUND", "Post unavailable to this session.")
        return {**tweet(result), **base}
    if op in ("getUser", "getUserById", "getUserAbout", "getCommunity"):
        methods = {
            "getUser": ("user_by_login", p.get("username")),
            "getUserById": ("user_by_id", int(p.get("userId", "1"))),
            "getUserAbout": ("user_about", p.get("username")),
            "getCommunity": ("community_info", int(p.get("communityId", "1"))),
        }
        method, arg = methods[op]
        result = await getattr(api, method)(arg)
        if result is None:
            raise ProviderError("NOT_FOUND", "Resource unavailable to this session.")
        return {
            "data": user(result) if op in ("getUser", "getUserById") else safe(result),
            **base,
        }
    if op == "searchTweets":
        query = p["query"] + (f" since_id:{p['sinceId']}" if p.get("sinceId") else "")
        gen = api.search(
            query,
            limit=limit,
            kv={"product": "Latest" if p["sortOrder"] == "recency" else "Top"},
        )
        items = await collect(gen, limit, tweet)
        return {
            "tweets": items,
            "query": p["query"],
            "sortOrder": p["sortOrder"],
            "resultCount": len(items),
            "nextToken": None,
            "limitReached": len(items) == limit,
            "coverage": "bounded",
            "partial": False,
            **base,
        }
    if op == "getUserTweets":
        owner = await api.user_by_login(p["username"].lstrip("@"))
        if owner is None:
            raise ProviderError("NOT_FOUND", "User unavailable to this session.")
        method = api.user_tweets if p["excludeReplies"] else api.user_tweets_and_replies

        # sinceId is a local result filter: this is bounded sampling, not a completeness guarantee.
        def wanted(t):
            return (
                (not p["excludeRetweets"] or t.retweetedTweet is None)
                and (not p["excludeReplies"] or t.inReplyToTweetId is None)
                and (not p.get("sinceId") or t.id > int(p["sinceId"]))
            )

        items = await collect(method(owner.id, limit=limit), limit, tweet, wanted)
        items.sort(key=lambda t: t["publishedAt"], reverse=True)
        return {
            "tweets": items,
            "user": user(owner),
            "resultCount": len(items),
            "nextToken": None,
            "limitReached": len(items) == limit,
            "coverage": "bounded",
            "partial": False,
            **base,
        }
    if op == "getTweetThread":
        focal = await api.tweet_details(int(p["tweetId"]))
        if focal is None:
            raise ProviderError("NOT_FOUND", "Post unavailable to this session.")
        root_id = focal.conversationId
        items = await collect(api.tweet_thread(root_id, limit=limit), limit, tweet)
        return {
            "items": items,
            "resultCount": len(items),
            "limitReached": len(items) == limit,
            "coverage": "bounded",
            "partial": False,
            "rootTweetId": str(root_id),
            **base,
        }
    mapping = {
        "getTweetReplies": ("tweet_replies", "tweetId", tweet),
        "getRetweeters": ("retweeters", "tweetId", user),
        "getBookmarks": ("bookmarks", None, tweet),
        "getUserFollowers": ("followers", "userId", user),
        "getUserFollowing": ("following", "userId", user),
        "getVerifiedFollowers": ("verified_followers", "userId", user),
        "getUserSubscriptions": ("subscriptions", "userId", user),
        "getUserMedia": ("user_media", "userId", tweet),
        "searchUsers": ("search_user", "query", user),
        "searchTrends": ("search_trend", "query", tweet),
        "getListTweets": ("list_timeline", "listId", tweet),
        "getListMembers": ("list_members", "listId", user),
        "getCommunityMembers": ("community_members", "communityId", user),
        "getCommunityModerators": ("community_moderators", "communityId", user),
        "getCommunityTweets": ("community_tweets", "communityId", tweet),
        "getTrends": ("trends", "category", safe),
    }
    if op not in mapping:
        raise ProviderError("INVALID_INPUT", "Unknown read operation.")
    method, key, convert = mapping[op]
    args = [] if key is None else [int(p[key]) if key.endswith("Id") else p[key]]
    items = await collect(getattr(api, method)(*args, limit=limit), limit, convert)
    return {
        "items": items,
        "resultCount": len(items),
        "limitReached": len(items) == limit,
        "coverage": "bounded",
        "partial": False,
        **base,
    }


async def run(request):
    from twscrape import API
    from twscrape.accounts_pool import NoAccountError
    from twscrape.logger import logger
    import twscrape.api as api_module
    from twscrape.queue_client import QueueClient, GqlFeaturesOutdatedError

    warnings = []
    logger.remove()
    # Track only severity; never forward authenticated responses or log messages.
    logger.add(lambda m: warnings.append(m.record["level"].name), level="WARNING")

    class StrictApiError(GqlFeaturesOutdatedError):
        pass

    class StrictQueueClient(QueueClient):
        async def _check_rep(self, rep):
            await super()._check_rep(rep)
            body = rep.json()
            if rep.status_code >= 400 or (body.get("errors") and not body.get("data")):
                raise StrictApiError("X returned errors without usable data.")
            if body.get("errors"):
                warnings.append("PARTIAL")

        async def req(self, *args, **kwargs):
            result = await super().req(*args, **kwargs)
            if result is None:
                raise ProviderError(
                    "UPSTREAM_ERROR",
                    "twscrape could not read this endpoint; check session and upstream compatibility.",
                )
            return result

    api_module.QueueClient = StrictQueueClient
    db = Path(request["db"])
    if not db.is_file():
        raise ProviderError(
            "AUTH_REQUIRED",
            "Import your X session locally with npm run auth:import, or set TWSCRAPE_ACCOUNTS_DB to your existing twscrape database.",
        )
    api = API(
        str(db), proxy=request.get("proxy"), raise_when_no_account=True, wait_timeout=0
    )
    try:
        result = await dispatch(api, request["operation"], request["params"])
    except GqlFeaturesOutdatedError:
        raise ProviderError(
            "UPSTREAM_ERROR",
            "X returned an unsupported GraphQL response. Update twscrape or retry after upstream recovery.",
        )
    except NoAccountError:
        accounts = await api.pool.get_all()
        if not accounts:
            raise ProviderError(
                "AUTH_REQUIRED",
                "No session in the configured twscrape database. Run npm run auth:import.",
            )
        if not any(a.active for a in accounts):
            raise ProviderError(
                "AUTH_FAILED",
                "No active X session. Reimport your browser cookies locally.",
            )
        raise ProviderError(
            "ACCOUNT_UNAVAILABLE",
            "All sessions are busy or rate limited for this endpoint. Wait before retrying; account locks were preserved.",
        )
    if warnings:
        if result.get("resultCount") == 0:
            raise ProviderError(
                "UPSTREAM_FORMAT",
                "twscrape reported a parsing or upstream warning; an empty result cannot be confirmed.",
            )
        result["partial"] = True
    return result


async def main(request):
    try:
        data = await asyncio.wait_for(run(request), request["timeoutMs"] / 1000)
        return {"ok": True, "data": data}
    except ProviderError as e:
        return {"ok": False, "error": {"code": e.code, "message": e.message}}
    except asyncio.TimeoutError:
        return {
            "ok": False,
            "error": {
                "code": "REQUEST_TIMEOUT",
                "message": "twscrape read timed out. No complete result is available; wait before retrying.",
            },
        }
    except ImportError:
        return {
            "ok": False,
            "error": {
                "code": "TWSCRAPE_UNAVAILABLE",
                "message": "Install the Python dependencies with npm run setup:twscrape.",
            },
        }
    except Exception:
        return {
            "ok": False,
            "error": {
                "code": "UPSTREAM_ERROR",
                "message": "twscrape could not complete this read. Check connectivity, session and installed library compatibility.",
            },
        }


if __name__ == "__main__":
    os.umask(0o077)
    try:
        request = json.loads(sys.stdin.buffer.read(131073))
        response = asyncio.run(main(request))
    except Exception:
        response = {
            "ok": False,
            "error": {"code": "INVALID_INPUT", "message": "Invalid bridge request."},
        }
    print(json.dumps(response, ensure_ascii=False))
