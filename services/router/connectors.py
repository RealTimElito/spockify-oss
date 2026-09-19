"""Spockify connectors for morning briefing (Wave 9.3 / per-user).

Working paths (no interactive OAuth):
  - calendar: public/private ICS URL (token or extra.ics_url) or local ICS path
  - email: IMAP (account=address, token=app password, extra.host / extra.folder)
  - telegram: bot token + optional extra.chat_id (getUpdates / getChat)

Per-user secrets under CONNECTORS_DIR/{user_id}/{kind}.json (mode 600).
Legacy global CONNECTORS_DIR/{kind}.json files are migrated once to
CONNECTORS_BOOTSTRAP_USER_ID (or the first admin who claims them) — never
left readable by all users.

Demo mode (CONNECTORS_DEMO=1) ships sample digest only when *that user*
has nothing configured.

Env bootstrap (CALENDAR_ICS_URL, IMAP_*, TELEGRAM_*) seeds
CONNECTORS_BOOTSTRAP_USER_ID only — prefer per-user Settings UI.
"""

from __future__ import annotations

import email
import imaplib
import json
import logging
import os
import re
import shutil
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from pathlib import Path
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

LOG = logging.getLogger("spockify.router.connectors")

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/var/lib/spockify"))
CONNECTORS_DIR = Path(os.getenv("CONNECTORS_DIR", str(STORAGE_ROOT / "connectors")))
CONNECTORS_DEMO = os.getenv("CONNECTORS_DEMO", "1").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# Prefer per-user UI. Env bootstrap / legacy migrate target this user id.
CONNECTORS_BOOTSTRAP_USER_ID = (
    os.getenv("CONNECTORS_BOOTSTRAP_USER_ID") or ""
).strip()
# Opt-in only: fall back to unread migrated globals (default: never share).
CONNECTORS_INSTANCE_SHARED = os.getenv("CONNECTORS_INSTANCE_SHARED", "0").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

CONNECTOR_KINDS = ("calendar", "email", "telegram")

_ICS_SUMMARY = re.compile(r"^SUMMARY[;:](.*)$", re.MULTILINE | re.IGNORECASE)
_ICS_DTSTART = re.compile(
    r"^DTSTART(?:;[^:]*)?:([0-9TZzt+-]+)", re.MULTILINE | re.IGNORECASE
)
_ICS_DTEND = re.compile(
    r"^DTEND(?:;[^:]*)?:([0-9TZzt+-]+)", re.MULTILINE | re.IGNORECASE
)
_ICS_LOCATION = re.compile(
    r"^LOCATION[;:](.*)$", re.MULTILINE | re.IGNORECASE
)
_ICS_UID = re.compile(r"^UID[;:](.*)$", re.MULTILINE | re.IGNORECASE)
_ICS_VEVENT = re.compile(
    r"BEGIN:VEVENT(.*?)END:VEVENT", re.DOTALL | re.IGNORECASE
)


class ConnectorConfig(BaseModel):
    kind: str
    enabled: bool = False
    label: str = ""
    # Secrets — never log raw values in status.
    token: str = ""
    refresh_token: str = ""
    account: str = ""
    extra: dict[str, Any] = Field(default_factory=dict)


class ConnectorsUpdate(BaseModel):
    connectors: list[ConnectorConfig] = Field(default_factory=list)


def _safe_user_id(user_id: str) -> str:
    raw = (user_id or "").strip()
    if not raw:
        raise ValueError("user_id required for connectors")
    safe = "".join(c for c in raw if c.isalnum() or c in "-_.@")[:128]
    if not safe:
        raise ValueError("user_id invalid for connectors")
    return safe


def _ensure_dir(path: Path, *, mode: int = 0o700) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, mode)
    except OSError:
        pass
    return path


def _ensure_root() -> Path:
    return _ensure_dir(CONNECTORS_DIR)


def _user_dir(user_id: str) -> Path:
    return _ensure_dir(_ensure_root() / _safe_user_id(user_id))


def _path_for(kind: str, user_id: str) -> Path:
    safe = "".join(c for c in kind.lower() if c.isalnum() or c in "-_")[:40]
    return _user_dir(user_id) / f"{safe}.json"


def _legacy_path(kind: str) -> Path:
    safe = "".join(c for c in kind.lower() if c.isalnum() or c in "-_")[:40]
    return _ensure_root() / f"{safe}.json"


def _legacy_kinds_present() -> list[str]:
    return [k for k in CONNECTOR_KINDS if _legacy_path(k).is_file()]


def migrate_legacy_connectors(
    target_user_id: str, *, force: bool = False
) -> dict[str, Any]:
    """Move CONNECTORS_DIR/{kind}.json → CONNECTORS_DIR/{user_id}/{kind}.json.

    Runs once (marker `.migrated_legacy`). Prefer CONNECTORS_BOOTSTRAP_USER_ID
    or the first admin who claims. Does not leave globals readable by all.
    """
    marker = _ensure_root() / ".migrated_legacy"
    present = _legacy_kinds_present()
    if not present:
        return {
            "ok": True,
            "migrated": False,
            "reason": "no_legacy",
            "target": _safe_user_id(target_user_id),
        }
    if marker.is_file() and not force:
        return {
            "ok": True,
            "migrated": False,
            "reason": "already_migrated",
            "target": marker.read_text(encoding="utf-8").strip() or None,
            "leftover": present,
        }

    bootstrap = CONNECTORS_BOOTSTRAP_USER_ID
    safe_target = _safe_user_id(target_user_id)
    if bootstrap and bootstrap != safe_target and not force:
        return {
            "ok": False,
            "migrated": False,
            "reason": "bootstrap_user_mismatch",
            "expected": bootstrap,
            "got": safe_target,
        }

    dest_dir = _user_dir(safe_target)
    moved: list[str] = []
    for kind in present:
        src = _legacy_path(kind)
        dest = dest_dir / src.name
        if dest.is_file() and not force:
            # Keep user file; quarantine legacy away from shared read.
            quarantine = _ensure_root() / ".legacy_quarantine" / safe_target
            _ensure_dir(quarantine)
            shutil.move(str(src), str(quarantine / src.name))
            moved.append(f"{kind}->quarantine")
            continue
        shutil.move(str(src), str(dest))
        try:
            os.chmod(dest, 0o600)
        except OSError:
            pass
        moved.append(kind)

    try:
        marker.write_text(safe_target, encoding="utf-8")
        os.chmod(marker, 0o600)
    except OSError:
        pass
    LOG.info("migrated legacy connectors %s → user %s", moved, safe_target)
    return {
        "ok": True,
        "migrated": True,
        "kinds": moved,
        "target": safe_target,
    }


def _maybe_auto_migrate(user_id: str) -> None:
    """If CONNECTORS_BOOTSTRAP_USER_ID matches, migrate legacy on access.

    Otherwise leave globals unused (load_connector ignores them unless
    CONNECTORS_INSTANCE_SHARED=1). Admin claims via migrate_legacy_connectors.
    """
    if not _legacy_kinds_present():
        return
    bootstrap = CONNECTORS_BOOTSTRAP_USER_ID
    safe = _safe_user_id(user_id)
    if bootstrap and bootstrap == safe:
        migrate_legacy_connectors(safe)


def load_connector(kind: str, user_id: str) -> ConnectorConfig:
    path = _path_for(kind, user_id)
    if not path.is_file() and CONNECTORS_INSTANCE_SHARED:
        # Explicit opt-in only — never the default privacy model.
        legacy = _legacy_path(kind)
        if legacy.is_file():
            path = legacy
    if not path.is_file():
        return ConnectorConfig(kind=kind, label=kind.title())
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data["kind"] = kind
        return ConnectorConfig.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("connector load %s/%s failed: %s", user_id, kind, exc)
        return ConnectorConfig(kind=kind, label=kind.title())


def save_connector(cfg: ConnectorConfig, user_id: str) -> ConnectorConfig:
    if cfg.kind not in CONNECTOR_KINDS:
        raise ValueError(f"unsupported connector kind: {cfg.kind}")
    path = _path_for(cfg.kind, user_id)
    path.write_text(cfg.model_dump_json(indent=2), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return cfg


def _is_redacted(value: str) -> bool:
    v = (value or "").strip()
    return v in ("", "***") or v.endswith("…***")


def list_connectors(user_id: str) -> list[dict[str, Any]]:
    _maybe_auto_migrate(user_id)
    bootstrap_from_env(user_id)
    out: list[dict[str, Any]] = []
    for kind in CONNECTOR_KINDS:
        cfg = load_connector(kind, user_id)
        public = cfg.model_dump()
        if public.get("token"):
            public["token"] = "***" if len(cfg.token) < 8 else f"{cfg.token[:4]}…***"
        if public.get("refresh_token"):
            public["refresh_token"] = "***"
        extra = dict(cfg.extra or {})
        public["extra"] = {
            k: ("***" if k in ("password", "secret", "bot_token") else v)
            for k, v in extra.items()
        }
        configured = bool(
            cfg.token
            or cfg.account
            or extra.get("ics_url")
            or extra.get("ics_path")
            or extra.get("cache_path")
        )
        public["configured"] = configured
        public["hints"] = _hints_for(kind)
        out.append(public)
    return out


def _hints_for(kind: str) -> dict[str, str]:
    if kind == "calendar":
        return {
            "token": "ICS URL (Google calendar secret address, or any .ics feed)",
            "account": "Optional label (e.g. personal)",
        }
    if kind == "email":
        return {
            "account": "IMAP email address",
            "token": "App password (Gmail/Outlook app password — not login password)",
            "extra.host": "IMAP host (default imap.gmail.com)",
            "extra.folder": "Folder (default INBOX)",
        }
    return {
        "token": "Telegram bot token from @BotFather",
        "account": "Optional bot username",
        "extra.chat_id": "Chat id to filter (optional; empty = recent getUpdates)",
    }


def update_connectors(body: ConnectorsUpdate, user_id: str) -> list[dict[str, Any]]:
    for cfg in body.connectors:
        existing = load_connector(cfg.kind, user_id)
        token = cfg.token
        if _is_redacted(token):
            token = existing.token
        refresh = cfg.refresh_token
        if _is_redacted(refresh):
            refresh = existing.refresh_token
        merged_extra = {**(existing.extra or {}), **(cfg.extra or {})}
        for key in ("password", "secret", "bot_token"):
            if merged_extra.get(key) in ("", "***"):
                merged_extra[key] = (existing.extra or {}).get(key, "")
        merged = ConnectorConfig(
            kind=cfg.kind,
            enabled=cfg.enabled,
            label=cfg.label or existing.label or cfg.kind.title(),
            token=token,
            refresh_token=refresh,
            account=cfg.account or existing.account,
            extra=merged_extra,
        )
        save_connector(merged, user_id)
    return list_connectors(user_id)


def bootstrap_from_env(user_id: str, *, force: bool = False) -> None:
    """One-shot seed from env into CONNECTORS_BOOTSTRAP_USER_ID only.

    Instance-legacy: prefer Settings → Your connectors. Without a bootstrap
    user id, env secrets are ignored (not written to a shared path).
    """
    bootstrap = CONNECTORS_BOOTSTRAP_USER_ID
    if not bootstrap:
        return
    if _safe_user_id(user_id) != bootstrap:
        return

    marker = _user_dir(user_id) / ".bootstrapped_env"
    if marker.is_file() and not force:
        return

    cal = load_connector("calendar", user_id)
    ics = (
        os.getenv("CALENDAR_ICS_URL")
        or os.getenv("GOOGLE_CALENDAR_ICS_URL")
        or ""
    ).strip()
    if ics and (force or not cal.token):
        save_connector(
            ConnectorConfig(
                kind="calendar",
                enabled=True,
                label="Calendar",
                token=ics,
                account=cal.account or "env",
                extra={**(cal.extra or {}), "source": "env"},
            ),
            user_id,
        )

    mail = load_connector("email", user_id)
    imap_user = (os.getenv("IMAP_USER") or os.getenv("EMAIL_USER") or "").strip()
    imap_pass = (
        os.getenv("IMAP_PASSWORD")
        or os.getenv("IMAP_APP_PASSWORD")
        or os.getenv("EMAIL_APP_PASSWORD")
        or ""
    ).strip()
    imap_host = (os.getenv("IMAP_HOST") or "imap.gmail.com").strip()
    if imap_user and imap_pass and (force or not mail.token):
        save_connector(
            ConnectorConfig(
                kind="email",
                enabled=True,
                label="Email",
                account=imap_user,
                token=imap_pass,
                extra={
                    **(mail.extra or {}),
                    "host": imap_host,
                    "folder": os.getenv("IMAP_FOLDER") or "INBOX",
                    "source": "env",
                },
            ),
            user_id,
        )

    tg = load_connector("telegram", user_id)
    bot = (
        os.getenv("TELEGRAM_BOT_TOKEN")
        or os.getenv("TELEGRAM_TOKEN")
        or ""
    ).strip()
    chat_id = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()
    if bot and (force or not tg.token):
        save_connector(
            ConnectorConfig(
                kind="telegram",
                enabled=True,
                label="Telegram",
                token=bot,
                account=tg.account or "@bot",
                extra={
                    **(tg.extra or {}),
                    **({"chat_id": chat_id} if chat_id else {}),
                    "source": "env",
                },
            ),
            user_id,
        )

    try:
        marker.write_text(
            datetime.now(tz=timezone.utc).isoformat(), encoding="utf-8"
        )
        os.chmod(marker, 0o600)
    except OSError:
        pass


def _unescape_ics(value: str) -> str:
    return (
        (value or "")
        .replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
        .strip()
    )


def _parse_ics_dt(value: str) -> Optional[datetime]:
    """Parse ICS DATE or DATE-TIME into aware UTC datetime when possible."""
    raw = (value or "").strip()
    if not raw:
        return None
    tz_utc = raw.endswith("Z") or raw.endswith("z")
    body = raw[:-1] if tz_utc else raw
    # DATE only (YYYYMMDD)
    if re.fullmatch(r"\d{8}", body):
        try:
            return datetime.strptime(body, "%Y%m%d").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    # DATE-TIME basic (YYYYMMDDTHHMMSS)
    m = re.fullmatch(r"(\d{8}T\d{6})(?:\.\d+)?", body)
    if m:
        try:
            dt = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S")
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    # ISO-ish with dashes
    try:
        iso = body
        if "T" in body and "-" not in body[:8]:
            iso = (
                f"{body[:4]}-{body[4:6]}-{body[6:8]}"
                f"T{body[9:11]}:{body[11:13]}:{body[13:15]}"
            )
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _parse_ics_events(
    raw: str,
    *,
    limit: int = 5,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """Parse VEVENT blocks; optional inclusive start / exclusive end window."""
    events: list[dict[str, Any]] = []
    for block in _ICS_VEVENT.findall(raw or ""):
        unfolded = re.sub(r"\r?\n[ \t]", "", block)
        sm = _ICS_SUMMARY.search(unfolded)
        dm = _ICS_DTSTART.search(unfolded)
        em = _ICS_DTEND.search(unfolded)
        lm = _ICS_LOCATION.search(unfolded)
        um = _ICS_UID.search(unfolded)
        title = _unescape_ics(sm.group(1) if sm else "Event")
        when_raw = (dm.group(1).strip() if dm else "")
        end_raw = (em.group(1).strip() if em else "")
        location = _unescape_ics(lm.group(1) if lm else "")
        uid = _unescape_ics(um.group(1) if um else "")
        start_dt = _parse_ics_dt(when_raw)
        end_dt = _parse_ics_dt(end_raw) if end_raw else None
        if end_dt is None and start_dt is not None:
            # All-day DATE or missing DTEND → 1 hour default for timed events
            if when_raw and "T" not in when_raw:
                end_dt = start_dt + timedelta(days=1)
            else:
                end_dt = start_dt + timedelta(hours=1)

        if start is not None and end_dt is not None and end_dt < start:
            continue
        if end is not None and start_dt is not None and start_dt >= end:
            continue

        item: dict[str, Any] = {
            "title": title,
            "when": when_raw,
            "source": "ics",
        }
        if end_raw:
            item["end"] = end_raw
        if location:
            item["location"] = location
        if uid:
            item["uid"] = uid
        if start_dt is not None:
            item["start_at"] = start_dt.isoformat()
        if end_dt is not None:
            item["end_at"] = end_dt.isoformat()
        events.append(item)

    def _sort_key(ev: dict[str, Any]) -> str:
        return str(ev.get("start_at") or ev.get("when") or "")

    events.sort(key=_sort_key)
    return events[:limit]


async def _fetch_ics_text(url_or_path: str) -> str:
    raw = (url_or_path or "").strip()
    if not raw:
        return ""
    if raw.startswith("/") or raw.startswith("file:"):
        path = raw.replace("file://", "")
        p = Path(path)
        if p.is_file():
            return p.read_text(encoding="utf-8", errors="replace")
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(raw)
            resp.raise_for_status()
            return resp.text or ""
    if "://" not in raw and "." in raw:
        return await _fetch_ics_text("https://" + raw)
    return ""


async def fetch_calendar_items(
    cfg: ConnectorConfig,
    *,
    limit: int = 5,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    if not cfg.enabled:
        return []
    cache = (cfg.extra or {}).get("cache_path")
    if cache and Path(cache).is_file():
        try:
            data = json.loads(Path(cache).read_text(encoding="utf-8"))
            items = data if isinstance(data, list) else data.get("events") or []
            return list(items)[:limit]
        except Exception as exc:  # noqa: BLE001
            LOG.warning("calendar cache read failed: %s", exc)

    ics_target = (
        (cfg.extra or {}).get("ics_url")
        or (cfg.extra or {}).get("ics_path")
        or cfg.token
        or ""
    ).strip()
    if not ics_target:
        return []
    try:
        raw = await _fetch_ics_text(ics_target)
        if not raw:
            # Empty/unreadable feed — return [] so UI can show an empty grid.
            return []
        return _parse_ics_events(raw, limit=limit, start=start, end=end)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("calendar ICS fetch failed: %s", exc)
        return [{"title": f"(calendar error: {exc})", "when": "", "note": "error"}]


def _parse_optional_iso(value: Optional[str]) -> Optional[datetime]:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


async def calendar_events(
    user_id: str,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 200,
) -> dict[str, Any]:
    """Upcoming ICS events for the requesting user only (Calendar page)."""
    _maybe_auto_migrate(user_id)
    bootstrap_from_env(user_id)
    safe = _safe_user_id(user_id)
    cal = load_connector("calendar", safe)
    configured = bool(
        cal.token
        or (cal.extra or {}).get("ics_url")
        or (cal.extra or {}).get("ics_path")
    )
    start_dt = _parse_optional_iso(start)
    end_dt = _parse_optional_iso(end)
    if start_dt is None:
        start_dt = datetime.now(tz=timezone.utc) - timedelta(days=1)
    if end_dt is None:
        end_dt = start_dt + timedelta(days=62)
    lim = max(1, min(int(limit or 200), 500))

    if not cal.enabled or not configured:
        return {
            "ok": True,
            "user_id": safe,
            "enabled": cal.enabled,
            "configured": configured,
            "events": [],
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "note": (
                "Add an ICS URL in Settings → Your connectors to view your calendar."
                if not configured
                else "Calendar connector is disabled."
            ),
        }

    items = await fetch_calendar_items(
        cal, limit=lim, start=start_dt, end=end_dt
    )
    # Drop soft-error placeholders from the calendar UI list when possible.
    clean = [
        e
        for e in items
        if e.get("source") == "ics" or e.get("start_at") or e.get("when")
    ]
    # Hard fetch failures still report an error, but with an empty event list
    # so the calendar chrome (month/week grid) can still render.
    if not clean and items and items[0].get("note") == "error":
        return {
            "ok": False,
            "user_id": safe,
            "enabled": True,
            "configured": True,
            "events": [],
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "error": items[0].get("title") or "calendar fetch failed",
        }

    events_out = clean or items
    payload: dict[str, Any] = {
        "ok": True,
        "user_id": safe,
        "enabled": True,
        "configured": True,
        "events": events_out,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "count": len(events_out),
    }
    if not events_out:
        payload["note"] = "No events in this calendar yet"
    return payload


def _decode_mime_header(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:  # noqa: BLE001
        return value


async def fetch_email_items(cfg: ConnectorConfig, *, limit: int = 5) -> list[dict[str, Any]]:
    if not cfg.enabled or not cfg.token or not cfg.account:
        if cfg.enabled and cfg.token and not cfg.account:
            return [
                {
                    "subject": "(email needs account=address + token=app password)",
                    "from": "",
                    "note": "config",
                }
            ]
        return []

    cache = (cfg.extra or {}).get("cache_path")
    if cache and Path(cache).is_file():
        try:
            data = json.loads(Path(cache).read_text(encoding="utf-8"))
            items = data if isinstance(data, list) else data.get("messages") or []
            return list(items)[:limit]
        except Exception as exc:  # noqa: BLE001
            LOG.warning("email cache read failed: %s", exc)

    host = (cfg.extra or {}).get("host") or "imap.gmail.com"
    folder = (cfg.extra or {}).get("folder") or "INBOX"
    port = int((cfg.extra or {}).get("port") or 993)

    def _imap_pull() -> list[dict[str, Any]]:
        mail = imaplib.IMAP4_SSL(host, port)
        try:
            mail.login(cfg.account, cfg.token)
            mail.select(folder, readonly=True)
            typ, data = mail.search(None, "ALL")
            if typ != "OK" or not data or not data[0]:
                return [{"subject": "(inbox empty)", "from": cfg.account, "note": "empty"}]
            ids = data[0].split()
            recent = ids[-limit:]
            out: list[dict[str, Any]] = []
            for msg_id in reversed(recent):
                typ2, msg_data = mail.fetch(msg_id, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
                if typ2 != "OK" or not msg_data or not msg_data[0]:
                    continue
                raw_hdr = msg_data[0][1]
                if isinstance(raw_hdr, bytes):
                    msg = email.message_from_bytes(raw_hdr)
                else:
                    continue
                out.append(
                    {
                        "subject": _decode_mime_header(msg.get("Subject")) or "(no subject)",
                        "from": _decode_mime_header(msg.get("From")),
                        "when": msg.get("Date") or "",
                        "note": "imap",
                    }
                )
            return out or [{"subject": "(no headers)", "from": cfg.account, "note": "empty"}]
        finally:
            try:
                mail.logout()
            except Exception:  # noqa: BLE001
                pass

    try:
        import asyncio

        return await asyncio.get_event_loop().run_in_executor(None, _imap_pull)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("IMAP fetch failed: %s", exc)
        return [{"subject": f"(email error: {exc})", "from": cfg.account, "note": "error"}]


async def fetch_telegram_items(cfg: ConnectorConfig, *, limit: int = 5) -> list[dict[str, Any]]:
    if not cfg.enabled or not cfg.token:
        return []
    chat_id = str((cfg.extra or {}).get("chat_id") or "").strip()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            params: dict[str, Any] = {"limit": limit}
            if not chat_id:
                params["offset"] = -limit
            resp = await client.get(
                f"https://api.telegram.org/bot{cfg.token}/getUpdates",
                params=params,
            )
            if resp.status_code >= 400:
                return [
                    {
                        "text": f"(telegram token set but API HTTP {resp.status_code})",
                        "note": "check bot token",
                    }
                ]
            payload = resp.json()
            results = []
            for upd in (payload.get("result") or [])[-limit:]:
                msg = upd.get("message") or upd.get("channel_post") or {}
                text = (msg.get("text") or "")[:200]
                chat = msg.get("chat") or {}
                cid = str(chat.get("id") or "")
                if chat_id and cid and chat_id not in (cid, str(chat.get("username") or "")):
                    continue
                title = chat.get("title") or chat.get("username") or "chat"
                if text:
                    results.append({"chat": title, "text": text, "chat_id": cid})
            return results or [
                {"text": "(telegram connected — no recent messages)", "note": "empty"}
            ]
    except Exception as exc:  # noqa: BLE001
        LOG.warning("telegram fetch failed: %s", exc)
        return [{"text": f"(telegram error: {exc})", "note": "error"}]


def _demo_digest() -> dict[str, Any]:
    now = datetime.now(tz=timezone.utc)
    events = [
        {
            "title": "Demo standup",
            "when": (now + timedelta(hours=2)).strftime("%Y%m%dT%H%M%SZ"),
            "source": "demo",
        },
        {
            "title": "Demo focus block",
            "when": (now + timedelta(hours=5)).strftime("%Y%m%dT%H%M%SZ"),
            "source": "demo",
        },
    ]
    messages = [
        {
            "subject": "Demo: weekly digest",
            "from": "noreply@spockify.local",
            "note": "demo",
        }
    ]
    tmsgs = [
        {
            "chat": "demo",
            "text": "Demo Telegram ping — paste real bot token in Settings → Your connectors.",
            "note": "demo",
        }
    ]
    text = (
        "Calendar (demo):\n"
        + "\n".join(f"- {e['title']} ({e['when']})" for e in events)
        + "\n\nEmail (demo):\n"
        + "\n".join(f"- {m['subject']} from {m['from']}" for m in messages)
        + "\n\nTelegram (demo):\n"
        + "\n".join(f"- [{m['chat']}] {m['text']}" for m in tmsgs)
        + "\n\n(Demo mode — Settings → Your connectors to paste ICS URL / "
        "IMAP app password / Telegram bot token. Per-user only.)"
    )
    return {
        "ok": True,
        "checked_at": now.isoformat(),
        "text": text,
        "details": {
            "calendar": {"enabled": True, "configured": False, "items": events, "demo": True},
            "email": {"enabled": True, "configured": False, "items": messages, "demo": True},
            "telegram": {"enabled": True, "configured": False, "items": tmsgs, "demo": True},
        },
        "note": "Wave 9b demo mode — set CONNECTORS_DEMO=0 after real creds",
        "demo": True,
    }


def _user_has_configured(user_id: str) -> bool:
    for kind in CONNECTOR_KINDS:
        cfg = load_connector(kind, user_id)
        extra = cfg.extra or {}
        if (
            cfg.token
            or cfg.account
            or extra.get("ics_url")
            or extra.get("ics_path")
            or extra.get("cache_path")
        ):
            return True
    return False


async def briefing_context(user_id: str, *, limit: int = 5) -> dict[str, Any]:
    """Assemble connector digest for the requesting user only."""
    _maybe_auto_migrate(user_id)
    bootstrap_from_env(user_id)
    sections: list[str] = []
    details: dict[str, Any] = {}
    any_configured = False

    cal = load_connector("calendar", user_id)
    events = await fetch_calendar_items(cal, limit=limit)
    configured_cal = bool(
        cal.token or (cal.extra or {}).get("ics_url") or (cal.extra or {}).get("ics_path")
    )
    any_configured = any_configured or (cal.enabled and configured_cal)
    details["calendar"] = {
        "enabled": cal.enabled,
        "configured": configured_cal,
        "items": events,
    }
    if events:
        lines = [
            f"- {e.get('title') or e.get('summary') or e} ({e.get('when') or ''})"
            for e in events
        ]
        sections.append("Calendar:\n" + "\n".join(lines))
    elif cal.enabled and configured_cal:
        sections.append("Calendar: configured but no events (empty feed).")

    mail = load_connector("email", user_id)
    messages = await fetch_email_items(mail, limit=limit)
    configured_mail = bool(mail.token and mail.account)
    any_configured = any_configured or (mail.enabled and configured_mail)
    details["email"] = {
        "enabled": mail.enabled,
        "configured": configured_mail,
        "items": messages,
    }
    if messages:
        lines = [
            f"- {m.get('subject') or m.get('text') or m} from {m.get('from') or '?'}"
            for m in messages
        ]
        sections.append("Email:\n" + "\n".join(lines))
    elif mail.enabled and configured_mail:
        sections.append("Email: configured but no messages.")

    tg = load_connector("telegram", user_id)
    tmsgs = await fetch_telegram_items(tg, limit=limit)
    configured_tg = bool(tg.token)
    any_configured = any_configured or (tg.enabled and configured_tg)
    details["telegram"] = {
        "enabled": tg.enabled,
        "configured": configured_tg,
        "items": tmsgs,
    }
    if tmsgs:
        lines = [f"- [{m.get('chat') or 'tg'}] {m.get('text') or m}" for m in tmsgs]
        sections.append("Telegram:\n" + "\n".join(lines))
    elif tg.enabled and configured_tg:
        sections.append("Telegram: configured but no recent messages.")

    # Demo only when *this* user has no connectors configured.
    if not sections and CONNECTORS_DEMO and not any_configured and not _user_has_configured(
        user_id
    ):
        return _demo_digest()

    if not sections:
        text = (
            "Connectors: none configured for your account. "
            "Settings → Your connectors — paste ICS URL, IMAP app password, "
            "or Telegram bot token (+ optional chat id). "
            "Saved privately to your account."
        )
    else:
        text = "\n\n".join(sections)

    return {
        "ok": True,
        "checked_at": datetime.now(tz=timezone.utc).isoformat(),
        "text": text,
        "details": details,
        "user_id": _safe_user_id(user_id),
        "note": "Wave 9b — per-user ICS / IMAP / Telegram (no OAuth)",
        "demo": False,
    }


def connectors_status() -> dict[str, Any]:
    """Aggregate status only — never list other users' secrets or tokens."""
    root = _ensure_root()
    user_dirs = [
        p.name
        for p in root.iterdir()
        if p.is_dir() and not p.name.startswith(".")
    ]
    return {
        "dir": str(CONNECTORS_DIR),
        "layout": "per-user",
        "demo": CONNECTORS_DEMO,
        "instance_shared": CONNECTORS_INSTANCE_SHARED,
        "bootstrap_user_set": bool(CONNECTORS_BOOTSTRAP_USER_ID),
        "user_folders": len(user_dirs),
        "legacy_pending": bool(_legacy_kinds_present()),
        "connectors": [
            {"kind": k, "scope": "per-user"} for k in CONNECTOR_KINDS
        ],
    }


def _soft_error(msg: str) -> str:
    """User-facing error without stack traces or filesystem paths."""
    text = str(msg or "Something went wrong").strip()
    # Drop absolute paths and long exception class prefixes.
    text = re.sub(r"(?i)(/[\w./-]+)+", "[path]", text)
    text = re.sub(r"(?i)[A-Za-z_]+Error:\s*", "", text)
    if len(text) > 160:
        text = text[:157] + "…"
    return text or "Connection failed"


async def test_connector(kind: str, user_id: str) -> dict[str, Any]:
    """Probe one connector; return clear OK/fail (no secrets, no paths)."""
    _maybe_auto_migrate(user_id)
    bootstrap_from_env(user_id)
    safe = _safe_user_id(user_id)
    k = (kind or "").strip().lower()
    if k not in CONNECTOR_KINDS:
        return {
            "ok": False,
            "kind": k,
            "status": "fail",
            "message": "Unknown connector type",
        }

    cfg = load_connector(k, safe)
    configured = bool(
        cfg.token
        or (cfg.extra or {}).get("ics_url")
        or (cfg.extra or {}).get("ics_path")
        or (k == "email" and cfg.account)
    )
    if not configured:
        return {
            "ok": False,
            "kind": k,
            "status": "fail",
            "message": "Not configured — add credentials and Save first",
        }
    if not cfg.enabled:
        return {
            "ok": False,
            "kind": k,
            "status": "fail",
            "message": "Disabled — enable the connector, then test again",
        }

    try:
        if k == "calendar":
            items = await fetch_calendar_items(cfg, limit=3)
            if items and any((i or {}).get("note") == "error" for i in items):
                raw = (items[0] or {}).get("title") or "Calendar feed failed"
                return {
                    "ok": False,
                    "kind": k,
                    "status": "fail",
                    "message": _soft_error(str(raw)),
                }
            n = len(items)
            return {
                "ok": True,
                "kind": k,
                "status": "ok",
                "message": f"OK — calendar reachable ({n} upcoming event{'s' if n != 1 else ''})",
                "count": n,
            }
        if k == "email":
            items = await fetch_email_items(cfg, limit=3)
            if items and any((i or {}).get("note") == "error" for i in items):
                raw = (items[0] or {}).get("subject") or "Email check failed"
                return {
                    "ok": False,
                    "kind": k,
                    "status": "fail",
                    "message": _soft_error(str(raw)),
                }
            n = len(items)
            return {
                "ok": True,
                "kind": k,
                "status": "ok",
                "message": f"OK — mailbox reachable ({n} recent message{'s' if n != 1 else ''})",
                "count": n,
            }
        # telegram
        items = await fetch_telegram_items(cfg, limit=3)
        if items and any((i or {}).get("note") == "error" for i in items):
            raw = (items[0] or {}).get("text") or "Telegram check failed"
            return {
                "ok": False,
                "kind": k,
                "status": "fail",
                "message": _soft_error(str(raw)),
            }
        if items and "HTTP" in str((items[0] or {}).get("text") or ""):
            return {
                "ok": False,
                "kind": k,
                "status": "fail",
                "message": "Telegram bot token rejected — check the token and try again",
            }
        n = len(
            [
                i
                for i in items
                if (i or {}).get("note") not in ("empty",)
                and (i or {}).get("text")
                and "no recent" not in str((i or {}).get("text") or "").lower()
            ]
        )
        return {
            "ok": True,
            "kind": k,
            "status": "ok",
            "message": (
                f"OK — Telegram bot reachable"
                + (f" ({n} recent update{'s' if n != 1 else ''})" if n else " (no recent messages)")
            ),
            "count": n,
        }
    except Exception as exc:  # noqa: BLE001
        LOG.warning("connector test %s failed: %s", k, exc)
        return {
            "ok": False,
            "kind": k,
            "status": "fail",
            "message": _soft_error(str(exc)),
        }
