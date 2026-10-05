"""Import an explicitly supplied X session via hidden input or a private stdin pipe."""

import asyncio
import getpass
import json
import os
from pathlib import Path
import sys

os.environ["TWS_TELEMETRY"] = "0"
os.umask(0o077)
root = Path(__file__).resolve().parents[1]


class ImportErrorSafe(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def validate(payload):
    if not isinstance(payload, dict):
        raise ImportErrorSafe("INVALID_INPUT", "Invalid session input.")
    label = payload.get("label")
    cookies = payload.get("cookies")
    if (
        not isinstance(label, str)
        or not label.strip()
        or len(label) > 80
        or any(ord(c) < 32 or ord(c) == 127 for c in label)
    ):
        raise ImportErrorSafe(
            "INVALID_INPUT",
            "Use a label of 1–80 characters without control characters.",
        )
    if not isinstance(cookies, dict) or set(cookies) != {"auth_token", "ct0"}:
        raise ImportErrorSafe("INVALID_INPUT", "Only auth_token and ct0 are accepted.")
    for value in cookies.values():
        if (
            not isinstance(value, str)
            or not value
            or len(value) > 2048
            or any(ord(c) < 33 or ord(c) > 126 or c in ";," for c in value)
        ):
            raise ImportErrorSafe(
                "INVALID_INPUT", "Invalid cookie format. Values were not printed."
            )
    if not isinstance(payload.get("replace", False), bool):
        raise ImportErrorSafe("INVALID_INPUT", "Invalid replacement setting.")
    return label.strip(), cookies, payload.get("replace", False)


async def import_session(payload):
    label, cookies, replace = validate(payload)
    from twscrape import API
    from twscrape.logger import logger

    logger.remove()
    db = Path(
        os.environ.get("TWSCRAPE_ACCOUNTS_DB") or str(root / ".local/accounts.db")
    ).expanduser()
    db = (db if db.is_absolute() else root / db).resolve()
    db.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if db.exists():
        db.chmod(0o600)
    pool = API(str(db)).pool
    if not replace and await pool.get_account(label):
        raise ImportErrorSafe(
            "ACCOUNT_EXISTS",
            "This label exists. Use --replace or choose another label.",
        )
    # Upsert preserves existing locks/stats/proxy. Never reset cooldowns here.
    await pool.add_account_cookies(
        label, f"auth_token={cookies['auth_token']}; ct0={cookies['ct0']}"
    )
    db.chmod(0o600)
    return {"ok": True, "label": label, "db": str(db)}


async def main(from_stdin):
    if from_stdin:
        try:
            raw = sys.stdin.buffer.read(16385)
            if len(raw) > 16384:
                raise ValueError()
            payload = json.loads(raw)
        except Exception:
            raise ImportErrorSafe("INVALID_INPUT", "Invalid piped session input.")
    else:
        if not sys.stdin.isatty():
            raise ImportErrorSafe(
                "TTY_REQUIRED",
                "Run interactively; credentials use hidden input, not command-line arguments.",
            )
        label = (
            input("Local session label [browser-session]: ").strip()
            or "browser-session"
        )
        auth = getpass.getpass("X auth_token (hidden): ").strip()
        csrf = getpass.getpass("X ct0 (hidden): ").strip()
        # Choosing the label explicitly in this manual flow retains refresh behavior.
        payload = {
            "label": label,
            "cookies": {"auth_token": auth, "ct0": csrf},
            "replace": True,
        }
    return await import_session(payload)


if __name__ == "__main__":
    from_stdin = sys.argv[1:] == ["--from-stdin"]
    try:
        if sys.argv[1:] and not from_stdin:
            raise ImportErrorSafe("INVALID_INPUT", "Unsupported importer option.")
        response = asyncio.run(main(from_stdin))
    except ImportErrorSafe as e:
        response = {"ok": False, "error": e.code, "message": e.message}
    except ImportError:
        response = {
            "ok": False,
            "error": "DEPENDENCIES_MISSING",
            "message": "Run npm run setup:twscrape first.",
        }
    except KeyboardInterrupt:
        response = {"ok": False, "error": "CANCELLED", "message": "Import cancelled."}
    except Exception:
        # Never leak getpass input, account records, upstream exceptions or tracebacks.
        response = {
            "ok": False,
            "error": "IMPORT_FAILED",
            "message": "Local import failed. Check database permissions and installed dependencies.",
        }
    if from_stdin:
        print(json.dumps(response))
    elif response["ok"]:
        print(
            f"Session imported locally into {response['db']}. Values were not printed. Restart the MCP server to use it."
        )
    else:
        print(response["message"], file=sys.stderr)
    if not response["ok"]:
        sys.exit(1)
