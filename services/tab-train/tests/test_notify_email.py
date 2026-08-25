"""Tests for tab_train.notify_email."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from tab_train.notify_email import notify


class NotifyEmailTest(unittest.TestCase):
    def test_noop_without_recipient(self) -> None:
        with mock.patch.dict(os.environ, {"TAB_TRAIN_SMTP_HOST": "smtp.test"}, clear=True):
            self.assertFalse(notify("seed", "promoted", scores={"gate": 0.9}))

    def test_noop_without_smtp_host(self) -> None:
        env = {"TAB_TRAIN_NOTIFY_EMAIL": "ops@test.local"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertFalse(notify("seed", "eval_failed"))

    def test_sends_plain_message(self) -> None:
        sent: dict[str, object] = {}

        class FakeSmtp:
            def __init__(self, host: str, port: int, timeout: int = 0) -> None:
                sent["host"] = host
                sent["port"] = port

            def __enter__(self) -> "FakeSmtp":
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def starttls(self) -> None:
                sent["tls"] = True

            def login(self, user: str, password: str) -> None:
                sent["login"] = (user, password)

            def send_message(self, msg: object) -> None:
                sent["msg"] = msg

        env = {
                "TAB_TRAIN_NOTIFY_EMAIL": "ops@test.local,other@test.local",
                "TAB_TRAIN_SMTP_HOST": "smtp.test",
                "TAB_TRAIN_SMTP_PORT": "587",
                "TAB_TRAIN_SMTP_USER": "user",
                "TAB_TRAIN_SMTP_PASSWORD": "pass",
                "TAB_TRAIN_SMTP_FROM": "tab-train@test.local",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch("tab_train.notify_email.smtplib.SMTP", FakeSmtp):
                self.assertTrue(
                        notify(
                                "distill",
                                "promoted",
                                detail="slot=distill baseline=tab-fim",
                                adapter="tab-distill",
                                scores={"gate": 0.91, "candidate": {"gate": 0.91}},
                        ),
                )
        self.assertEqual(sent["host"], "smtp.test")
        self.assertEqual(sent["port"], 587)
        self.assertEqual(sent["login"], ("user", "pass"))
        msg = sent["msg"]
        self.assertIn("[tab-train] distill promoted: tab-distill", msg["Subject"])
        self.assertEqual(msg["From"], "tab-train@test.local")
        body = msg.get_content()
        self.assertIn("Gate / validation scores:", body)
        self.assertIn('"gate": 0.91', body)
        self.assertIn("Champion snapshot:", body)

    def test_never_raises_on_smtp_error(self) -> None:
        class BrokenSmtp:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            def __enter__(self) -> "BrokenSmtp":
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def starttls(self) -> None:
                raise OSError("connection refused")

        env = {
                "TAB_TRAIN_NOTIFY_EMAIL": "ops@test.local",
                "TAB_TRAIN_SMTP_HOST": "smtp.test",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch("tab_train.notify_email.smtplib.SMTP", BrokenSmtp):
                self.assertFalse(notify("seed", "eval_failed", scores={"gate": 0.5}))


if __name__ == "__main__":
    unittest.main()
