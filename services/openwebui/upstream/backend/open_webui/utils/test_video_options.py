"""Unit tests for video duration / length helpers."""

from __future__ import annotations

import unittest

from open_webui.utils.video_options import (
    VIDEO_FPS,
    frames_to_seconds,
    normalize_duration,
    resolve_video_length,
)


class VideoOptionsTests(unittest.TestCase):
    def test_duration_lengths(self) -> None:
        self.assertEqual(resolve_video_length('short'), 25)
        self.assertEqual(resolve_video_length('default'), 65)
        self.assertEqual(resolve_video_length('long'), 241)
        self.assertEqual(normalize_duration(None), 'default')
        self.assertEqual(normalize_duration('nope'), 'default')

    def test_fallback_when_missing(self) -> None:
        self.assertEqual(resolve_video_length(None, fallback=65), 65)
        self.assertEqual(resolve_video_length('', fallback=41), 41)
        self.assertEqual(resolve_video_length('nope', fallback=41), 41)
        # Known chip wins over fallback.
        self.assertEqual(resolve_video_length('short', fallback=65), 25)

    def test_fps_docs(self) -> None:
        self.assertEqual(VIDEO_FPS, 24)
        self.assertAlmostEqual(frames_to_seconds(65), 65 / 24)
        self.assertAlmostEqual(frames_to_seconds(25), 25 / 24)
        self.assertAlmostEqual(frames_to_seconds(241), 241 / 24)


if __name__ == '__main__':
    unittest.main()
