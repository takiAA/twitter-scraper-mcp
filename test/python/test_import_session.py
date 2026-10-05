import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from twscrape import API

spec = importlib.util.spec_from_file_location(
    "session_importer",
    Path(__file__).resolve().parents[2] / "scripts/import-session.py",
)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportSessionTests(unittest.IsolatedAsyncioTestCase):
    def payload(self, **extra):
        return {
            "label": "test",
            "cookies": {"auth_token": "fake-auth", "ct0": "fake-csrf"},
            **extra,
        }

    async def test_refresh_preserves_cooldowns_and_never_prints_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "accounts.db"
            with patch.dict(os.environ, {"TWSCRAPE_ACCOUNTS_DB": str(db)}):
                result = await importer.import_session(self.payload())
                self.assertEqual(result["label"], "test")
                self.assertNotIn("fake-auth", str(result))
                pool = API(str(db)).pool
                await pool.lock_until("test", "SearchTimeline", 9999999999, 2)
                with self.assertRaises(importer.ImportErrorSafe) as caught:
                    await importer.import_session(self.payload())
                self.assertEqual(caught.exception.code, "ACCOUNT_EXISTS")
                await importer.import_session(
                    self.payload(
                        replace=True,
                        cookies={"auth_token": "new-auth", "ct0": "new-csrf"},
                    )
                )
                account = await pool.get("test")
                self.assertIn("SearchTimeline", account.locks)
                self.assertEqual(account.cookies["auth_token"], "new-auth")
                if os.name != "nt":
                    self.assertEqual(db.stat().st_mode & 0o777, 0o600)

    async def test_invalid_payload_never_creates_a_database(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "accounts.db"
            with patch.dict(os.environ, {"TWSCRAPE_ACCOUNTS_DB": str(db)}):
                for extra in [
                    {"label": "bad\nlabel"},
                    {"cookies": {"auth_token": "secret"}},
                    {
                        "cookies": {
                            "auth_token": "secret",
                            "ct0": "secret",
                            "extra": "secret",
                        }
                    },
                    {"replace": "yes"},
                    {"cookies": {"auth_token": "secret;foo", "ct0": "secret"}},
                ]:
                    with self.assertRaises(importer.ImportErrorSafe) as caught:
                        await importer.import_session(self.payload(**extra))
                    self.assertNotIn("secret", caught.exception.message)
                self.assertFalse(db.exists())
