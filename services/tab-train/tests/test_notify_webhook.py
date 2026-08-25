"""Tests for tab_train.notify_webhook."""

from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from tab_train.notify_webhook import notify, notify_started


class NotifyWebhookTest(unittest.TestCase):
    def test_noop_without_url(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(notify("nightly-sft", "ok"))

    def test_posts_json_payload(self) -> None:
        captured: dict[str, object] = {}

        class FakeResp:
            status = 200

            def __enter__(self) -> "FakeResp":
                return self

            def __exit__(self, *args: object) -> None:
                return None

        def fake_urlopen(req: object, timeout: int = 0) -> FakeResp:
            captured["req"] = req
            return FakeResp()

        env = {
                "TAB_TRAIN_WEBHOOK_URL": "https://example.test/hook",
                "TAB_TRAIN_WEBHOOK_TOKEN": "tok",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch("urllib.request.urlopen", fake_urlopen):
                self.assertTrue(
                        notify(
                                "seed",
                                "promoted",
                                detail="tab-seed",
                                adapter="tab-seed",
                                scores={"gate": 0.9},
                        ),
                )
        req = captured["req"]
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.full_url, "https://example.test/hook")
        self.assertEqual(req.headers["Authorization"], "Bearer tok")
        body = json.loads(req.data.decode("utf-8"))
        self.assertEqual(body["job"], "seed")
        self.assertEqual(body["outcome"], "promoted")
        self.assertEqual(body["adapter"], "tab-seed")
        self.assertEqual(body["scores"]["gate"], 0.9)

    def test_notify_started(self) -> None:
        with mock.patch("tab_train.notify_webhook.notify") as mocked:
            notify_started("distill", detail="cron")
            mocked.assert_called_once_with("distill", "started", detail="cron")


if __name__ == "__main__":
    unittest.main()
