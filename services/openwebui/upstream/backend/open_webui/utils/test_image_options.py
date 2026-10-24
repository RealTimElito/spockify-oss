"""Unit tests for image aspect/style helpers."""

from __future__ import annotations

import unittest

from open_webui.utils.image_options import (
    apply_style_to_prompt,
    normalize_aspect,
    normalize_style,
    resolve_image_size,
)


class ImageOptionsTests(unittest.TestCase):
    def test_aspect_sizes(self) -> None:
        self.assertEqual(resolve_image_size('square'), '1024x1024')
        self.assertEqual(resolve_image_size('wide'), '1344x768')
        self.assertEqual(resolve_image_size('tall'), '768x1344')
        self.assertEqual(resolve_image_size('nope'), '1024x1024')
        self.assertEqual(normalize_aspect(None), 'square')

    def test_style_suffix(self) -> None:
        out = apply_style_to_prompt('a red cube', 'photo')
        self.assertIn('photorealistic', out)
        self.assertTrue(out.startswith('a red cube'))
        # Idempotent
        self.assertEqual(apply_style_to_prompt(out, 'photo'), out)
        self.assertEqual(apply_style_to_prompt('x', None), 'x')
        self.assertEqual(normalize_style('illustration'), 'illustration')
        self.assertEqual(normalize_style('none'), '')


if __name__ == '__main__':
    unittest.main()
