"""Comfy /prompt 400 bodies and workflow node mapping."""

from __future__ import annotations

import json
import unittest
from types import SimpleNamespace

from open_webui.utils.images.comfyui import (
    ComfyUINodeInput,
    _apply_workflow_nodes,
    _comfy_reject_detail,
)


class ComfyRejectDetailTests(unittest.TestCase):
    def test_names_ksampler_steps_none(self) -> None:
        raw = json.dumps(
            {
                'error': {
                    'type': 'prompt_outputs_failed_validation',
                    'message': 'Prompt outputs failed validation',
                    'details': '',
                    'extra_info': {},
                },
                'node_errors': {
                    '3': {
                        'class_type': 'KSampler',
                        'errors': [
                            {
                                'type': 'invalid_input_type',
                                'message': (
                                    'Failed to convert an input value to a INT value'
                                ),
                                'details': (
                                    'steps, None, int() argument must be a string, '
                                    'a bytes-like object or a real number, not '
                                    "'NoneType'"
                                ),
                            }
                        ],
                    }
                },
            }
        )
        detail = _comfy_reject_detail(400, 'Bad Request', raw)
        self.assertIn('400', detail)
        self.assertIn('KSampler 3', detail)
        self.assertIn('steps, None', detail)


class ApplyWorkflowNodesTests(unittest.TestCase):
    def test_none_steps_keeps_workflow_default(self) -> None:
        workflow = {
            '3': {'inputs': {'steps': 4, 'seed': 0}, 'class_type': 'KSampler'},
        }
        payload = SimpleNamespace(steps=None, seed=None)
        nodes = [ComfyUINodeInput(type='steps', node_ids=['3'], key='steps')]
        _apply_workflow_nodes(workflow, nodes, 'flux1-schnell-fp8.safetensors', payload)
        self.assertEqual(workflow['3']['inputs']['steps'], 4)

    def test_explicit_steps_overwrite(self) -> None:
        workflow = {
            '3': {'inputs': {'steps': 4}, 'class_type': 'KSampler'},
        }
        payload = SimpleNamespace(steps=6)
        nodes = [ComfyUINodeInput(type='steps', node_ids=['3'], key='steps')]
        _apply_workflow_nodes(workflow, nodes, 'flux1-schnell-fp8.safetensors', payload)
        self.assertEqual(workflow['3']['inputs']['steps'], 6)

    def test_string_steps_written_as_int(self) -> None:
        workflow = {
            '3': {'inputs': {'steps': 4}, 'class_type': 'KSampler'},
        }
        payload = SimpleNamespace(steps='5')
        nodes = [ComfyUINodeInput(type='steps', node_ids=['3'], key='steps')]
        _apply_workflow_nodes(workflow, nodes, 'flux1-schnell-fp8.safetensors', payload)
        self.assertEqual(workflow['3']['inputs']['steps'], 5)
        self.assertIsInstance(workflow['3']['inputs']['steps'], int)


if __name__ == '__main__':
    unittest.main()
