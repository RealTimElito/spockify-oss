"""Unit tests for video-generation intent detection, including
non-collision with the image-generation intent (image_intent.py)."""

from __future__ import annotations

import unittest

from open_webui.utils.image_intent import user_message_requests_image_generation
from open_webui.utils.video_intent import (
    extract_video_prompt,
    user_message_requests_video_generation,
)
from open_webui.utils.videos.comfyui_video import i2v_motion_prompt


class VideoIntentTests(unittest.TestCase):
    def test_generate_a_video(self) -> None:
        self.assertTrue(user_message_requests_video_generation('generate a video of a red cube'))
        self.assertFalse(user_message_requests_image_generation('generate a video of a red cube'))

    def test_extract_video_prompt(self) -> None:
        self.assertEqual(
            extract_video_prompt('generate a video of a red cube'),
            'a red cube',
        )
        self.assertEqual(
            extract_video_prompt('Can you create a video of the ocean?'),
            'the ocean',
        )
        self.assertEqual(
            extract_video_prompt('a car jumping over a barn'),
            'a car jumping over a barn',
        )

    def test_make_a_video(self) -> None:
        self.assertTrue(
            user_message_requests_video_generation('make a video of a cat playing piano')
        )

    def test_can_you_create_a_video(self) -> None:
        self.assertTrue(
            user_message_requests_video_generation('can you create a video of the ocean')
        )

    def test_animate_this(self) -> None:
        self.assertTrue(user_message_requests_video_generation('animate this drawing'))

    def test_make_a_video_of_this(self) -> None:
        self.assertTrue(user_message_requests_video_generation('make a video of this'))

    def test_i2v_generic_prompt(self) -> None:
        self.assertEqual(
            i2v_motion_prompt('this', 'animate this'),
            'natural motion, subtle camera movement',
        )
        self.assertEqual(
            i2v_motion_prompt('a red kite in the wind', 'animate this'),
            'a red kite in the wind',
        )

    def test_text_to_video(self) -> None:
        self.assertTrue(user_message_requests_video_generation('text-to-video of a sunset'))

    def test_video_call_is_not_generation(self) -> None:
        self.assertFalse(user_message_requests_video_generation('how do I make a video call'))

    def test_video_game_is_not_generation(self) -> None:
        self.assertFalse(user_message_requests_video_generation('create a video game character'))

    def test_what_is_a_video_card(self) -> None:
        self.assertFalse(user_message_requests_video_generation('what is a video card'))

    def test_image_intent_does_not_collide_with_video(self) -> None:
        self.assertTrue(user_message_requests_image_generation('generate an image of a red cube'))
        self.assertFalse(user_message_requests_video_generation('generate an image of a red cube'))

    def test_draw_me_is_not_video(self) -> None:
        self.assertFalse(user_message_requests_video_generation('draw me a cat'))
        self.assertTrue(user_message_requests_image_generation('draw me a cat'))

    def test_show_me_a_picture_is_neither(self) -> None:
        self.assertFalse(user_message_requests_video_generation('show me a picture of a dog'))
        self.assertFalse(user_message_requests_image_generation('show me a picture of a dog'))


if __name__ == '__main__':
    unittest.main()
