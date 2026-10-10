"""Gateway image catalog must not be a wake path."""

from __future__ import annotations

import unittest

import image_models
from app import _path_needs_wake, gateway_image_models


class GatewayImageModelsColdTests(unittest.TestCase):
    def test_catalog_path_does_not_wake(self) -> None:
        self.assertFalse(_path_needs_wake("/__gateway/image-models"))
        self.assertTrue(_path_needs_wake("/object_info"))
        self.assertTrue(_path_needs_wake("/prompt"))

    def test_handler_returns_catalog_without_scaling(self) -> None:
        import asyncio

        payload = asyncio.run(gateway_image_models())
        ids = [item["id"] for item in payload["models"]]
        self.assertEqual(ids, [image_models.FLUX_ID])
        self.assertFalse(payload["qwen_image_2_1"]["included"])


if __name__ == "__main__":
    unittest.main()
