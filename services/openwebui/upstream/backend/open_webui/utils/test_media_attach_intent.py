"""Unit tests for this-turn attach → I2V vs image-edit intent."""

from __future__ import annotations

import unittest

from open_webui.utils.media_attach_intent import (
    messages_have_this_turn_image_attach,
    resolve_attach_media_intent,
    user_message_requests_i2v_motion,
    user_message_requests_image_edit,
)


class MediaAttachIntentTests(unittest.TestCase):
    def test_i2v_motion_phrases(self) -> None:
        for prompt in (
            'make it move',
            'make her walk',
            'animate this',
            'animate this photo',
            'bring it to life',
            'add some motion',
            'camera pan across the scene',
            'turn this into a video',
            'make a video of this',
            'image-to-video',
            'generate a video of this',
        ):
            self.assertTrue(user_message_requests_i2v_motion(prompt), msg=prompt)

    def test_edit_phrases(self) -> None:
        for prompt in (
            'change the background to blue',
            'remove the hat',
            'add a red scarf',
            'restyle as watercolor',
            'make it look like a painting',
            'turn this into a sketch',
            'edit this image',
            'replace the sky',
            'img2img',
        ):
            self.assertTrue(user_message_requests_image_edit(prompt), msg=prompt)

    def test_howto_is_not_intent(self) -> None:
        self.assertFalse(user_message_requests_i2v_motion('how do I make it move'))
        self.assertFalse(user_message_requests_image_edit('how do I remove the background'))

    def test_clear_i2v_wins_without_toggle(self) -> None:
        self.assertEqual(
            resolve_attach_media_intent(
                'make it walk',
                has_this_turn_attach=True,
            ),
            'i2v',
        )

    def test_clear_edit_wins_without_toggle(self) -> None:
        self.assertEqual(
            resolve_attach_media_intent(
                'remove the background',
                has_this_turn_attach=True,
            ),
            'edit',
        )

    def test_no_attach_never_forces(self) -> None:
        self.assertEqual(
            resolve_attach_media_intent(
                'make it walk',
                has_this_turn_attach=False,
            ),
            'none',
        )
        self.assertEqual(
            resolve_attach_media_intent(
                'remove the hat',
                has_this_turn_attach=False,
                image_toggle=True,
            ),
            'none',
        )

    def test_ambiguous_honors_active_toggle(self) -> None:
        prompt = 'make it cooler'
        self.assertEqual(
            resolve_attach_media_intent(
                prompt,
                has_this_turn_attach=True,
                video_toggle=True,
            ),
            'i2v',
        )
        self.assertEqual(
            resolve_attach_media_intent(
                prompt,
                has_this_turn_attach=True,
                image_toggle=True,
            ),
            'edit',
        )
        self.assertEqual(
            resolve_attach_media_intent(
                prompt,
                has_this_turn_attach=True,
            ),
            'none',
        )

    def test_both_cues_prefer_i2v(self) -> None:
        self.assertEqual(
            resolve_attach_media_intent(
                'animate this and change the sky',
                has_this_turn_attach=True,
            ),
            'i2v',
        )

    def test_history_image_is_not_this_turn_attach(self) -> None:
        leftover = '/api/v1/files/old/content'
        messages = [
            {
                'role': 'assistant',
                'files': [{'type': 'image', 'url': leftover}],
            },
            {
                'role': 'user',
                'content': 'make it walk',
                'files': [{'type': 'image', 'url': leftover}],
            },
        ]
        self.assertFalse(messages_have_this_turn_image_attach(messages))

    def test_fresh_attach_detected(self) -> None:
        messages = [
            {
                'role': 'user',
                'content': 'make it walk',
                'files': [{'type': 'image', 'url': '/api/v1/files/new/content'}],
            }
        ]
        self.assertTrue(messages_have_this_turn_image_attach(messages))


if __name__ == '__main__':
    unittest.main()
