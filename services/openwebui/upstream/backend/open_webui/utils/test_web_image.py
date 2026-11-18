"""Unit tests for web image ranking helpers."""

from __future__ import annotations

import unittest

from open_webui.utils.web_image import (
    _candidate_urls,
    _host_rank,
    _looks_like_image_url,
    web_image_assistant_ack,
)


class WebImageHelperTests(unittest.TestCase):
    def test_prefer_unsplash(self) -> None:
        self.assertLess(
            _host_rank('https://images.unsplash.com/photo-123'),
            _host_rank('https://example.com/sky.jpg'),
        )

    def test_skip_svg_icons(self) -> None:
        self.assertFalse(
            _looks_like_image_url(
                'https://cdn.jsdelivr.net/npm/lucide-static/icons/bluetooth.svg'
            )
        )
        self.assertTrue(
            _looks_like_image_url('https://images.unsplash.com/photo-123?w=800')
        )

    def test_candidate_urls_prefer_img_src(self) -> None:
        urls = _candidate_urls(
            {
                'img_src': 'https://images.pexels.com/photos/1/sky.jpeg',
                'url': 'https://www.pexels.com/photo/sky/',
                'thumbnail': 'https://images.pexels.com/photos/1/thumb.jpeg',
            }
        )
        self.assertEqual(urls[0], 'https://images.pexels.com/photos/1/sky.jpeg')

    def test_ack_is_text_only_no_markdown_image(self) -> None:
        ack = web_image_assistant_ack('the blue sky', '/api/v1/files/abc/content')
        self.assertNotIn('![', ack)
        self.assertNotIn('/api/v1/files/', ack)
        self.assertEqual(ack, "Here's a photo of the blue sky.")


if __name__ == '__main__':
    unittest.main()
