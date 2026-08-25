"""Tests for tab_train.notify (webhook + email orchestration)."""

from __future__ import annotations

import unittest
from unittest import mock

from tab_train.notify import notify, should_email


class NotifyUnifiedTest(unittest.TestCase):
    def test_should_email_score_outcomes(self) -> None:
        self.assertTrue(should_email("promoted", None))
        self.assertTrue(should_email("eval_failed", None))
        self.assertFalse(should_email("ok", None))
        self.assertTrue(should_email("ok", {"gate": 0.9}))
        self.assertFalse(should_email("skipped", {"gate": 0.9}))

    def test_calls_both_channels(self) -> None:
        with mock.patch("tab_train.notify.notify_webhook.notify") as wh:
            with mock.patch("tab_train.notify.notify_email.notify") as em:
                notify(
                        "seed",
                        "promoted",
                        adapter="tab-seed",
                        scores={"gate": 0.9},
                )
        wh.assert_called_once()
        em.assert_called_once()

    def test_skip_webhook_still_emails(self) -> None:
        with mock.patch("tab_train.notify.notify_webhook.notify") as wh:
            with mock.patch("tab_train.notify.notify_email.notify") as em:
                notify("distill", "eval_failed", skip_webhook=True, scores={"gate": 0.5})
        wh.assert_not_called()
        em.assert_called_once()

    def test_skip_email_still_webhooks(self) -> None:
        with mock.patch("tab_train.notify.notify_webhook.notify") as wh:
            with mock.patch("tab_train.notify.notify_email.notify") as em:
                notify("seed", "promoted", skip_email=True, scores={"gate": 0.9})
        wh.assert_called_once()
        em.assert_not_called()


if __name__ == "__main__":
    unittest.main()
