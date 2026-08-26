"""Tests for memory guard."""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import memory_guard as mg


class MemoryGuardTests(unittest.TestCase):
    def test_memory_pressure_critical(self) -> None:
        level = mg.memory_pressure_level(
            {"ok": True, "available_bytes": 5 * 1024**3},
            {"total_vram_bytes": 0},
        )
        self.assertEqual(level, "critical")

    def test_memory_pressure_warn_vram(self) -> None:
        level = mg.memory_pressure_level(
            {"ok": True, "available_bytes": 30 * 1024**3},
            {"total_vram_bytes": 90 * 1024**3},
        )
        self.assertEqual(level, "warn")

    def test_models_to_unload_priority(self) -> None:
        loaded = [
            {"name": "gemma4:12b", "size_vram_bytes": 8},
            {"name": "gpt-oss:120b", "size_vram_bytes": 65},
            {"name": "gpt-oss:20b", "size_vram_bytes": 13},
        ]
        order = mg._models_to_unload(loaded)
        self.assertEqual(order[0], "gpt-oss:120b")

    def test_read_meminfo_missing(self) -> None:
        out = mg.read_meminfo_bytes("/no/such/meminfo")
        self.assertFalse(out["ok"])


class HeavyModeAllowedTests(unittest.IsolatedAsyncioTestCase):
    async def test_heavy_blocked_when_critical(self) -> None:
        client = MagicMock()
        with patch.object(
            mg,
            "free_headroom",
            AsyncMock(
                return_value={
                    "level": "critical",
                    "mem": {"available_bytes": 4 * 1024**3},
                    "ollama": {"total_vram_bytes": 90 * 1024**3},
                    "unloaded": [],
                }
            ),
        ):
            allowed, reason, _ = await mg.heavy_mode_allowed(client)
        self.assertFalse(allowed)
        self.assertIn("critically low", reason)


if __name__ == "__main__":
    unittest.main()
