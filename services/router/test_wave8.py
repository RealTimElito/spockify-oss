"""Wave 8 unit smoke tests (browser allowlist, cost hud, critique gate, workspace diff)."""

from __future__ import annotations

import unittest

import browser_agent as browser
import cost_hud
import critique as critique_mod
import workspace as workspace_mod


class TestBrowserAgent(unittest.TestCase):
    def test_reject_private(self) -> None:
        ok, err = browser.validate_browse_url("http://127.0.0.1/", confirm=True)
        self.assertFalse(ok)
        self.assertIn("private", err.lower())

    def test_allowlist_empty_denies(self) -> None:
        # Depends on env; with empty allowlist should deny public host.
        prev = list(browser.BROWSER_ALLOWLIST)
        try:
            browser.BROWSER_ALLOWLIST.clear()
            ok, _ = browser.validate_browse_url("https://example.com/", confirm=True)
            self.assertFalse(ok)
        finally:
            browser.BROWSER_ALLOWLIST[:] = prev

    def test_html_to_text(self) -> None:
        title, text = browser.html_to_text(
            "<html><head><title>Hi</title></head>"
            "<body><script>x</script><p>Hello world</p></body></html>"
        )
        self.assertEqual(title, "Hi")
        self.assertIn("Hello world", text)
        self.assertNotIn("script", text.lower())


class TestCostHud(unittest.TestCase):
    def test_estimate(self) -> None:
        hud = cost_hud.build_hud(
            worker="gemma4-12b",
            latency_ms=1234,
            usage={"prompt_tokens": 100, "completion_tokens": 50},
        )
        self.assertEqual(hud["latency_ms"], 1234)
        self.assertEqual(hud["total_tokens"], 150)
        self.assertIn("X-Spockify-Latency-Ms", cost_hud.hud_headers(hud))


class TestCritique(unittest.TestCase):
    def test_should_critique_long(self) -> None:
        self.assertFalse(critique_mod.should_critique("short", enabled=True))
        long = "x" * (critique_mod.CRITIQUE_AUTO_CHARS + 10)
        self.assertTrue(critique_mod.should_critique(long, enabled=True))
        self.assertTrue(critique_mod.should_critique("short", force=True, enabled=False))


class TestWorkspace(unittest.TestCase):
    def test_diff(self) -> None:
        patch = workspace_mod.content_to_unified_diff(
            filename="hello.py", content="print('hi')\n", old_content=""
        )
        self.assertIn("+++ b/hello.py", patch)
        self.assertIn("+print('hi')", patch)


if __name__ == "__main__":
    unittest.main()
