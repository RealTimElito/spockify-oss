"""Unified Tab training notifications (webhook + email)."""

from __future__ import annotations

from typing import Any, Optional

from . import notify_email, notify_webhook

_SCORE_OUTCOMES = frozenset({"promoted", "eval_failed"})


def should_email(outcome: str, scores: Optional[dict[str, Any]]) -> bool:
    """True when an email should be sent for this outcome."""
    if outcome in _SCORE_OUTCOMES:
        return True
    return outcome == "ok" and bool(scores)


def notify(
        job: str,
        outcome: str,
        *,
        detail: str = "",
        adapter: Optional[str] = None,
        scores: Optional[dict[str, Any]] = None,
        extra: Optional[dict[str, Any]] = None,
        skip_webhook: bool = False,
        skip_email: bool = False,
) -> None:
    """Send webhook and/or email. Never raises."""
    wh_extra = extra
    if not skip_webhook:
        notify_webhook.notify(
                job,
                outcome,
                detail=detail,
                adapter=adapter,
                scores=scores,
                extra=wh_extra,
        )
    if not skip_email and should_email(outcome, scores):
        notify_email.notify(
                job,
                outcome,
                detail=detail,
                adapter=adapter,
                scores=scores,
        )
