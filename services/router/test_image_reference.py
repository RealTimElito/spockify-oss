"""Reference-image wiring for Qwen-Image, without calling ComfyUI."""

import base64
import unittest

from image_gen import ImageGenError, attach_reference_image, decode_reference_image


def _qwen_workflow():
    return {
        "3": {"inputs": {"vae_name": "vae"}, "class_type": "VAELoader"},
        "4": {
            "inputs": {
                "prompt": "p",
                "negative_prompt": "",
                "resolution": 1024,
                "clip": ["2", 0],
            },
            "class_type": "TextEncodeQwenImage21",
        },
        "5": {
            "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
            "class_type": "EmptyQwenImage21Latent",
        },
        "6": {
            "inputs": {"latent_image": ["5", 0], "positive": ["4", 0]},
            "class_type": "KSampler",
        },
    }


class ReferenceImageTests(unittest.TestCase):
    def test_decode_data_url(self):
        raw = base64.b64encode(b"png-bytes").decode("ascii")
        data, mime = decode_reference_image(f"data:image/png;base64,{raw}")
        self.assertEqual(data, b"png-bytes")
        self.assertEqual(mime, "image/png")

    def test_decode_rejects_unknown_mime(self):
        raw = base64.b64encode(b"x").decode("ascii")
        with self.assertRaises(ImageGenError) as caught:
            decode_reference_image(f"data:image/bmp;base64,{raw}")
        self.assertEqual(caught.exception.status_code, 400)

    def test_attach_uses_encoder_latent(self):
        workflow = _qwen_workflow()
        attach_reference_image(workflow, "ref.png", resolution=512)
        encode = workflow["4"]["inputs"]
        self.assertEqual(encode["vae"], ["3", 0])
        self.assertEqual(encode["resolution"], 512)
        load_id = encode["images.image_1"][0]
        self.assertEqual(workflow[load_id]["class_type"], "LoadImage")
        self.assertEqual(workflow[load_id]["inputs"]["image"], "ref.png")
        self.assertEqual(workflow["6"]["inputs"]["latent_image"], ["4", 2])

    def test_attach_rejects_flux_graph(self):
        workflow = {
            "3": {"inputs": {"latent_image": ["5", 0]}, "class_type": "KSampler"},
        }
        with self.assertRaises(ImageGenError) as caught:
            attach_reference_image(workflow, "ref.png", resolution=512)
        self.assertEqual(caught.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
