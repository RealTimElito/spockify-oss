"""Send Tab training outcome emails via SMTP (best-effort, optional)."""

from __future__ import annotations

import json
import logging
import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Optional

from .status_lib import champion_snapshot

LOG = logging.getLogger("tab_train.notify_email")

_TIMEOUT_S = 30


def _recipients() -> list[str]:
    raw = os.getenv("TAB_TRAIN_NOTIFY_EMAIL", "").strip()
    if not raw:
        return []
    return [addr.strip() for addr in raw.split(",") if addr.strip()]


def _smtp_config() -> dict[str, Any]:
    host = os.getenv("TAB_TRAIN_SMTP_HOST", "").strip()
    port_raw = os.getenv("TAB_TRAIN_SMTP_PORT", "587").strip()
    try:
        port = int(port_raw)
    except ValueError:
        port = 587
    user = os.getenv("TAB_TRAIN_SMTP_USER", "").strip()
    password = os.getenv("TAB_TRAIN_SMTP_PASSWORD", "").strip()
    from_addr = os.getenv("TAB_TRAIN_SMTP_FROM", "").strip()
    if not from_addr:
        from_addr = user or f"tab-train@{os.getenv('HOSTNAME', 'localhost')}"
    use_tls = os.getenv("TAB_TRAIN_SMTP_TLS", "1").strip().lower() not in (
            "0", "false", "no", "off",
    )
    return {
            "host": host,
            "port": port,
            "user": user,
            "password": password,
            "from_addr": from_addr,
            "use_tls": use_tls,
    }


def _format_scores(scores: dict[str, Any]) -> str:
    return json.dumps(scores, indent=2, sort_keys=True, default=str)


def _format_champions(champ: dict[str, Any]) -> str:
    if "champions" in champ:
        return json.dumps(champ["champions"], indent=2, sort_keys=True, default=str)
    if "champions_error" in champ:
        return f"(unavailable: {champ['champions_error']})"
    return "(none)"


def _subject(job: str, outcome: str, *, adapter: Optional[str], detail: str) -> str:
    tail = adapter or detail or "—"
    if len(tail) > 80:
        tail = tail[:77] + "..."
    return f"[tab-train] {job} {outcome}: {tail}"


def _body(
        job: str,
        outcome: str,
        *,
        detail: str,
        adapter: Optional[str],
        scores: Optional[dict[str, Any]],
        timestamp: str,
        hostname: str,
        champ: dict[str, Any],
) -> str:
    lines = [
            f"Tab training outcome: {outcome}",
            "",
            f"Job:       {job}",
            f"Outcome:   {outcome}",
    ]
    if adapter:
        lines.append(f"Adapter:   {adapter}")
    if detail:
        lines.append(f"Detail:    {detail}")
    lines.extend([
            f"Timestamp: {timestamp}",
            f"Host:      {hostname or '(unknown)'}",
            "",
            "Gate / validation scores:",
    ])
    if scores:
        lines.append(_format_scores(scores))
    else:
        lines.append("(none)")
    lines.extend([
            "",
            "Champion snapshot:",
            _format_champions(champ),
    ])
    if champ.get("champion_updated_at"):
        lines.append(f"Updated:   {champ['champion_updated_at']}")
    return "\n".join(lines) + "\n"


def notify(
        job: str,
        outcome: str,
        *,
        detail: str = "",
        adapter: Optional[str] = None,
        scores: Optional[dict[str, Any]] = None,
) -> bool:
    """Send outcome email. Returns True on success. Never raises."""
    recipients = _recipients()
    if not recipients:
        return False

    cfg = _smtp_config()
    if not cfg["host"]:
        LOG.debug("email skipped: TAB_TRAIN_SMTP_HOST unset")
        return False

    ts = datetime.now(timezone.utc).isoformat()
    hostname = os.getenv("HOSTNAME", "")
    champ = champion_snapshot()
    msg = EmailMessage()
    msg["Subject"] = _subject(job, outcome, adapter=adapter, detail=detail)
    msg["From"] = cfg["from_addr"]
    msg["To"] = ", ".join(recipients)
    msg.set_content(
            _body(
                    job,
                    outcome,
                    detail=detail,
                    adapter=adapter,
                    scores=scores,
                    timestamp=ts,
                    hostname=hostname,
                    champ=champ,
            ),
    )

    try:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=_TIMEOUT_S) as smtp:
            if cfg["use_tls"]:
                smtp.starttls()
            if cfg["user"]:
                smtp.login(cfg["user"], cfg["password"])
            smtp.send_message(msg)
        LOG.info("email %s/%s → %s", job, outcome, recipients)
        return True
    except smtplib.SMTPException as exc:
        LOG.warning("email %s/%s SMTP error: %s", job, outcome, exc)
    except OSError as exc:
        LOG.warning("email %s/%s failed: %s", job, outcome, exc)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("email %s/%s error: %s", job, outcome, exc)
    return False
