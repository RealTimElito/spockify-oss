"""Unit tests for video duration / length / size helpers."""

from __future__ import annotations

import unittest

from open_webui.utils.video_options import (
    VIDEO_FPS,
    frames_to_seconds,
    normalize_seconds,
    normalize_size,
    parse_size,
    resolve_video_length,
    seconds_to_frames,
)


class VideoOptionsTests(unittest.TestCase):
    def test_duration_lengths(self) -> None:
        self.assertEqual(resolve_video_length('short'), 25)
        self.assertEqual(resolve_video_length('default'), 65)
        self.assertEqual(resolve_video_length('long'), 241)
        self.assertEqual(resolve_video_length('1'), 25)
        self.assertEqual(resolve_video_length('3'), 65)
        self.assertEqual(resolve_video_length('5'), 121)
        self.assertEqual(resolve_video_length('10'), 241)

    def test_normalize_seconds(self) -> None:
        self.assertEqual(normalize_seconds(None), '3')
        self.assertEqual(normalize_seconds('short'), '1')
        self.assertEqual(normalize_seconds('10'), '10')
        self.assertEqual(normalize_seconds('15'), '15')
        self.assertEqual(normalize_seconds('nope'), '3')

    def test_size(self) -> None:
        self.assertEqual(normalize_size(None), '704x480')
        self.assertEqual(parse_size('1344x768'), (1344, 768))
        self.assertEqual(parse_size('nope'), (704, 480))
        self.assertEqual(resolve_video_length('15'), 361)

    def test_fallback_when_missing(self) -> None:
        self.assertEqual(resolve_video_length(None, fallback=65), 65)
        self.assertEqual(resolve_video_length('', fallback=41), 41)
        self.assertEqual(resolve_video_length('nope', fallback=41), 41)
        self.assertEqual(resolve_video_length('short', fallback=65), 25)

    def test_seconds_to_frames(self) -> None:
        self.assertEqual(seconds_to_frames(1), 25)
        self.assertEqual(seconds_to_frames('3'), 65)

    def test_fps_docs(self) -> None:
        self.assertEqual(VIDEO_FPS, 24)
        self.assertAlmostEqual(frames_to_seconds(65), 65 / 24)
        self.assertAlmostEqual(frames_to_seconds(25), 25 / 24)
        self.assertAlmostEqual(frames_to_seconds(241), 241 / 24)


if __name__ == '__main__':
    unittest.main()
