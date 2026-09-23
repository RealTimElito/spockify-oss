"""Unit tests for video TTS script shaping (no network / ffmpeg)."""

from __future__ import annotations

import unittest

from open_webui.utils.videos.video_audio import spoken_narration


class SpokenNarrationTests(unittest.TestCase):
    def test_strips_generate_a_video_boilerplate(self) -> None:
        # Before: "Generate a video of a red cube spinning"
        # After: short scene caption.
        out = spoken_narration('generate a video of a red cube spinning', 2.7)
        self.assertEqual(out, 'A red cube spinning')
        self.assertNotIn('generate', out.lower())
        self.assertNotIn('video of', out.lower())

    def test_explicit_say_directive(self) -> None:
        out = spoken_narration(
            'generate a video of a robot. say: Systems online',
            3.0,
        )
        self.assertEqual(out, 'Systems online')

    def test_with_narration(self) -> None:
        out = spoken_narration(
            'make a clip of ocean waves with narration: Welcome to the shore',
            3.0,
        )
        self.assertEqual(out, 'Welcome to the shore')

    def test_saying_quoted(self) -> None:
        out = spoken_narration(
            'generate a video of a cat saying "meow means hello"',
            3.0,
        )
        self.assertEqual(out, 'meow means hello')

    def test_animate_this_is_silent(self) -> None:
        self.assertEqual(spoken_narration('animate this', 2.7), '')
        self.assertEqual(spoken_narration('make a video of this photo', 2.7), '')

    def test_length_chip_noise_stripped(self) -> None:
        out = spoken_narration(
            'generate a video of a fox in snow (short)',
            2.0,
        )
        self.assertEqual(out, 'A fox in snow')
        self.assertNotIn('short', out.lower())

    def test_truncates_to_duration_budget(self) -> None:
        long_prompt = (
            'generate a video of a bright red fox carefully trotting through '
            'deep powdery snow under a pale winter sun near the forest edge'
        )
        out = spoken_narration(long_prompt, 1.5)
        self.assertLessEqual(len(out.split()), 6)
        self.assertTrue(out.startswith('A bright red fox'))


if __name__ == '__main__':
    unittest.main()
