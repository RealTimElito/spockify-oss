"""Unit tests for champion registry + reload name selection (no GPU / vLLM)."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tab_train import champion_lib
from tab_train.champion_lib import (
        champion_baseline,
        challenger_name,
        get_champion,
        list_champion_names,
        load_champions,
        record_champion,
        slot_for_adapter,
)


class ChampionLibTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.loras = self.root / "loras"
        self.loras.mkdir()
        self.env = {
                "TAB_LORAS_DIR": str(self.loras),
                "TAB_CHAMPION_PATH": str(self.loras / "champions.json"),
        }
        self._cm = mock.patch.dict(os.environ, self.env, clear=False)
        self._cm.start()

    def tearDown(self) -> None:
        self._cm.stop()
        self._tmp.cleanup()

    def test_slot_seed(self) -> None:
        self.assertEqual(slot_for_adapter("tab-seed", seed=True), "seed")
        self.assertEqual(slot_for_adapter("tab-seed"), "seed")
        self.assertEqual(slot_for_adapter("tab-abc"), "tab-abc")

    def test_record_and_baseline(self) -> None:
        self.assertEqual(champion_baseline("seed"), "tab-fim")
        record_champion("tab-seed", gate_score=0.55, source="seed", seed=True)
        self.assertEqual(champion_baseline("seed"), "tab-seed")
        entry = get_champion("seed")
        assert entry is not None
        self.assertEqual(entry["name"], "tab-seed")
        self.assertEqual(entry["gate_score"], 0.55)
        self.assertTrue((self.loras / "champions.json").is_file())
        data = load_champions()
        self.assertIn("seed", data["slots"])

    def test_list_champion_names(self) -> None:
        record_champion("tab-seed", seed=True, source="seed")
        record_champion("tab-deadbeef", source="sft")
        names = list_champion_names()
        self.assertEqual(set(names), {"tab-seed", "tab-deadbeef"})

    def test_challenger_name(self) -> None:
        self.assertEqual(challenger_name("tab-seed"), "tab-seed-challenger")

    def test_corrupt_file(self) -> None:
        path = self.loras / "champions.json"
        path.write_text("{not-json", encoding="utf-8")
        self.assertEqual(load_champions()["slots"], {})


class ReloadNamesTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.loras = Path(self._tmp.name) / "loras"
        self.loras.mkdir()
        self.env = {
                "TAB_LORAS_DIR": str(self.loras),
                "TAB_CHAMPION_PATH": str(self.loras / "champions.json"),
                "TAB_ADAPTER_POINTER": str(self.loras / "workspace_adapters.json"),
        }
        self._cm = mock.patch.dict(os.environ, self.env, clear=False)
        self._cm.start()

    def tearDown(self) -> None:
        self._cm.stop()
        self._tmp.cleanup()

    def test_names_merge_champion_and_pointer(self) -> None:
        record_champion("tab-seed", seed=True, source="seed")
        ptr = {"seed": "tab-seed", "adapters": {"ws1": "tab-aaa", "tab-aaa": "tab-aaa"}}
        (self.loras / "workspace_adapters.json").write_text(
                json.dumps(ptr), encoding="utf-8",
        )
        # Import after env so promote_lib paths resolve.
        from reload_adapters import names_to_reload

        names = names_to_reload(include_pointer=True)
        self.assertEqual(names[0], "tab-seed")
        self.assertIn("tab-aaa", names)


if __name__ == "__main__":
    unittest.main()
