"""Ghost Tab fate telemetry — Postgres tab_events store (training substrate).

Rows are inserted at suggest time (fire-and-forget; the completion response is
never blocked on the DB) and updated by POST /spockify/ghost/fate. All DB
errors are fail-soft: logged, never raised to the caller.

Uses asyncpg against DATABASE_URL (same secret the rest of the stack uses).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, Literal, Optional

from pydantic import BaseModel

try:
    import asyncpg
except ImportError:  # pragma: no cover - dependency present in the image
    asyncpg = None  # type: ignore[assignment]

LOG = logging.getLogger("spockify.router.ghost.telemetry")

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
_POOL_RETRY_SECONDS = 30.0

# "trigger" is quoted everywhere: it is a SQL keyword.
_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tab_events (
    id bigserial PRIMARY KEY,
    request_id uuid UNIQUE NOT NULL,
    ts timestamptz NOT NULL DEFAULT now(),
    workspace_id text,
    rel_path text,
    language text,
    "trigger" text,
    model text,
    prefix text,
    suffix text,
    diff_history jsonb,
    context_items jsonb,
    suggestion text,
    mode text,
    edit jsonb,
    latency_ms int,
    suppress_reason text,
    seen bool,
    fate text,
    fate_ts timestamptz,
    partial_accept_chars int,
    settled_text text
)
"""

_INSERT_SQL = """
INSERT INTO tab_events (
    request_id, workspace_id, rel_path, language, "trigger", model,
    prefix, suffix, diff_history, context_items, suggestion, mode,
    edit, latency_ms, suppress_reason
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12,
    $13::jsonb, $14, $15
) ON CONFLICT (request_id) DO NOTHING
"""

_FATE_SQL = """
UPDATE tab_events
SET fate = $2, fate_ts = now(), seen = $3,
    partial_accept_chars = $4, settled_text = $5
WHERE request_id = $1
"""


class GhostFateRequest(BaseModel):
    """POST /spockify/ghost/fate body."""

    request_id: str
    fate: Literal["accepted", "rejected", "partial", "ignored"]
    seen: bool = False
    partial_accept_chars: Optional[int] = None
    settled_text: Optional[str] = None
    client_ts: Optional[int] = None


_pool: Optional["asyncpg.Pool"] = None
_last_pool_attempt = 0.0


async def init() -> bool:
    """Create the pool and the tab_events table. Fail-soft; returns success."""
    global _pool, _last_pool_attempt
    if asyncpg is None:
        LOG.warning("ghost telemetry disabled: asyncpg not installed")
        return False
    if not DATABASE_URL:
        LOG.warning("ghost telemetry disabled: DATABASE_URL not set")
        return False
    _last_pool_attempt = time.monotonic()
    try:
        _pool = await asyncpg.create_pool(
            dsn=DATABASE_URL, min_size=0, max_size=4, command_timeout=10
        )
        async with _pool.acquire() as conn:
            await conn.execute(_CREATE_TABLE_SQL)
        LOG.info("ghost telemetry ready (tab_events)")
        return True
    except Exception as exc:  # noqa: BLE001 - fail-soft by design
        LOG.warning("ghost telemetry init failed (will retry lazily): %s", exc)
        _pool = None
        return False


async def close() -> None:
    global _pool
    if _pool is not None:
        try:
            await _pool.close()
        except Exception:  # noqa: BLE001
            pass
        _pool = None


async def _ensure_pool() -> Optional["asyncpg.Pool"]:
    """Return the pool, lazily retrying init at most every 30s."""
    global _last_pool_attempt
    if _pool is not None:
        return _pool
    if asyncpg is None or not DATABASE_URL:
        return None
    if time.monotonic() - _last_pool_attempt < _POOL_RETRY_SECONDS:
        return None
    await init()
    return _pool


def _as_uuid(request_id: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(request_id))
    except (ValueError, AttributeError, TypeError):
        return None


async def _insert_row(row: dict[str, Any]) -> None:
    pool = await _ensure_pool()
    if pool is None:
        return
    rid = _as_uuid(row.get("request_id", ""))
    if rid is None:
        LOG.debug("tab_events insert skipped: bad request_id %r",
                  row.get("request_id"))
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                _INSERT_SQL,
                rid,
                row.get("workspace_id"),
                row.get("rel_path"),
                row.get("language"),
                row.get("trigger"),
                row.get("model"),
                row.get("prefix"),
                row.get("suffix"),
                json.dumps(row.get("diff_history") or []),
                json.dumps(row.get("context_items") or []),
                row.get("suggestion"),
                row.get("mode"),
                json.dumps(row["edit"]) if row.get("edit") else None,
                row.get("latency_ms"),
                row.get("suppress_reason"),
            )
    except Exception as exc:  # noqa: BLE001 - never break completions on DB
        LOG.warning("tab_events insert failed: %s", exc)


def record_suggest(row: dict[str, Any]) -> None:
    """Schedule the tab_events insert without blocking the response."""
    try:
        asyncio.get_running_loop().create_task(_insert_row(row))
    except RuntimeError:  # no running loop (sync tests) — skip silently
        pass


async def record_fate(req: GhostFateRequest) -> bool:
    """Apply a fate update; returns True when a row was updated."""
    pool = await _ensure_pool()
    if pool is None:
        return False
    rid = _as_uuid(req.request_id)
    if rid is None:
        return False
    try:
        async with pool.acquire() as conn:
            status = await conn.execute(
                _FATE_SQL,
                rid,
                req.fate,
                req.seen,
                req.partial_accept_chars,
                req.settled_text,
            )
        return status.endswith("1")
    except Exception as exc:  # noqa: BLE001
        LOG.warning("tab_events fate update failed: %s", exc)
        return False
