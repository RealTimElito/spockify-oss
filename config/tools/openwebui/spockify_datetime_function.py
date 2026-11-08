"""
title: Spockify Date/Time
author: Spockify
version: 0.1.0
description: Return the current date/time in UTC or a named timezone (Wave 4 tool marketplace).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class Tools:
    def get_current_time(
        self,
        timezone_name: Optional[str] = None,
        __user__: Optional[dict] = None,
    ) -> str:
        """
        Return the current date and time.

        :param timezone_name: IANA timezone (e.g. Europe/Stockholm). Default UTC.
        """
        try:
            tz = ZoneInfo(timezone_name) if timezone_name else timezone.utc
        except ZoneInfoNotFoundError:
            return f"Unknown timezone: {timezone_name}. Use an IANA name like Europe/Stockholm."
        now = datetime.now(tz)
        label = timezone_name or "UTC"
        return f"{now.isoformat(timespec='seconds')} ({label})"
