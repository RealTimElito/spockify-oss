"""Unit tests for image-generation and web-image intent detection."""

from __future__ import annotations

import unittest

from open_webui.utils.image_intent import (
    extract_web_image_query,
    is_image_tool_action,
    is_vague_web_image_followup,
    previous_web_image_subject,
    resolve_web_image_query,
    text_looks_like_image_agent_json,
    user_message_requests_image_generation,
    user_message_requests_web_image,
)


class ImageIntentTests(unittest.TestCase):
    def test_draw_me_red_cube(self) -> None:
        self.assertTrue(user_message_requests_image_generation('Draw me a red cube.'))
        self.assertFalse(user_message_requests_web_image('Draw me a red cube.'))

    def test_generate_image(self) -> None:
        self.assertTrue(
            user_message_requests_image_generation(
                'Generate an image of a sunset over the ocean'
            )
        )
        self.assertFalse(
            user_message_requests_web_image(
                'Generate an image of a sunset over the ocean'
            )
        )

    def test_paint_a_landscape(self) -> None:
        self.assertTrue(user_message_requests_image_generation('Paint a landscape'))

    def test_can_you_draw_me(self) -> None:
        self.assertTrue(
            user_message_requests_image_generation('Can you draw me a blue robot?')
        )

    def test_show_me_a_picture_is_web_not_gen(self) -> None:
        for prompt in (
            'Can you show me a picture of the blue sky?',
            'Show me a picture of the blue sky',
            'Show me a photo of a cat',
            'Can you show me an image of mountains?',
            'Display a picture of the ocean',
            'Send me an illustration of a robot',
            'I want a picture of the blue sky',
            "I'd like to see a photo of a sunset",
            'Find me a photo of the northern lights',
            'Show me another image of a blue sky.',
            'Can you show me another image of mountains?',
            'another image of a blue sky',
        ):
            self.assertTrue(user_message_requests_web_image(prompt), msg=prompt)
            self.assertFalse(
                user_message_requests_image_generation(prompt), msg=prompt
            )

    def test_another_one_followup_is_web(self) -> None:
        for prompt in (
            'Can you show me another one?',
            'Show me another one',
            'another one',
            'One more please',
        ):
            self.assertTrue(user_message_requests_web_image(prompt), msg=prompt)
            self.assertTrue(is_vague_web_image_followup(prompt), msg=prompt)
            self.assertFalse(
                user_message_requests_image_generation(prompt), msg=prompt
            )

    def test_extract_web_image_query(self) -> None:
        self.assertEqual(
            extract_web_image_query('Can you show me a picture of the blue sky?'),
            'the blue sky',
        )
        self.assertEqual(
            extract_web_image_query('Show me a photo of a cat'),
            'a cat',
        )
        self.assertEqual(
            extract_web_image_query('Show me another image of a blue sky.'),
            'a blue sky',
        )
        self.assertEqual(extract_web_image_query('Can you show me another one?'), '')

    def test_resolve_followup_from_history(self) -> None:
        messages = [
            {'role': 'user', 'content': 'Show me a picture of the blue sky'},
            {'role': 'assistant', 'content': "Here's a photo of the blue sky."},
            {'role': 'user', 'content': 'Can you show me another one?'},
        ]
        self.assertEqual(previous_web_image_subject(messages), 'the blue sky')
        self.assertEqual(
            resolve_web_image_query('Can you show me another one?', messages),
            'the blue sky',
        )

    def test_variation_prompts(self) -> None:
        self.assertTrue(
            user_message_requests_image_generation(
                'Generate an image variation: a red cube'
            )
        )
        self.assertTrue(
            user_message_requests_web_image('Make another like this')
        )
        self.assertFalse(
            user_message_requests_image_generation('Make another like this')
        )
        self.assertTrue(
            user_message_requests_web_image('Make another like this: a robot')
        )
        self.assertEqual(
            extract_web_image_query('Make another like this: a robot'),
            'a robot',
        )

    def test_non_image_prompts(self) -> None:
        for prompt in (
            'What is a cube?',
            'Draw a conclusion from this data',
            'Please summarize the article',
            'How do I paint a fence?',
        ):
            self.assertFalse(
                user_message_requests_image_generation(prompt),
                msg=prompt,
            )
            self.assertFalse(user_message_requests_web_image(prompt), msg=prompt)

    def test_tool_actions(self) -> None:
        self.assertTrue(is_image_tool_action('dalle.text2im'))
        self.assertTrue(is_image_tool_action('generate_image'))
        self.assertFalse(is_image_tool_action('web_search'))
        self.assertTrue(
            text_looks_like_image_agent_json(
                '{\n"action": "dalle.text2im",\n"action_input": "{",\n"thought": "x"\n}'
            )
        )


if __name__ == '__main__':
    unittest.main()
