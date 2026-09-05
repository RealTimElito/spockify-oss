"""Prefix-tolerant router model matcher."""

from __future__ import annotations

import unittest

from open_webui.utils.spockify_models import (
    is_spockify_router_model,
    spockify_model_suffix,
)


class SpockifyRouterModelTests(unittest.TestCase):
    def test_bare_and_prefixed_ids(self) -> None:
        self.assertTrue(is_spockify_router_model('spockify-auto'))
        self.assertTrue(is_spockify_router_model('openai.spockify-auto'))
        self.assertTrue(is_spockify_router_model('litellm/spockify-auto'))
        self.assertTrue(is_spockify_router_model('openai.spockify-agents'))
        self.assertTrue(is_spockify_router_model('spockify-heavy'))
        self.assertEqual(spockify_model_suffix('openai.spockify-auto'), 'spockify-auto')
        self.assertFalse(is_spockify_router_model('gpt-oss-20b'))
        self.assertFalse(is_spockify_router_model('llama3.2-3b'))


if __name__ == '__main__':
    unittest.main()
