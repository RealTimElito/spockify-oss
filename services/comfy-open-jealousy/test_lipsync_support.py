"""Face carry-forward and error lines. No GPU, no Comfy."""

from __future__ import annotations

import unittest

from lipsync_support import EVEN_YUV420_SCALE, failure_detail, fill_missed_faces


class FaceCarryTests(unittest.TestCase):
    def test_middle_miss_reuses_the_previous_face(self) -> None:
        filled, hits, carried = fill_missed_faces(["a", None, "c"])
        self.assertEqual(filled, ["a", "a", "c"])
        self.assertEqual(hits, 2)
        self.assertEqual(carried, 1)

    def test_leading_miss_reuses_the_first_detection(self) -> None:
        filled, hits, carried = fill_missed_faces([None, None, "face"])
        self.assertEqual(filled, ["face", "face", "face"])
        self.assertEqual(hits, 1)
        self.assertEqual(carried, 2)

    def test_no_face_does_not_mention_the_checkpoint(self) -> None:
        with self.assertRaises(RuntimeError) as caught:
            fill_missed_faces([None, None])
        message = str(caught.exception)
        self.assertIn("Face not detected", message)
        self.assertIn("checkpoint loaded", message)
        self.assertNotIn("latentsync_unet", message)
        self.assertIn("no detectable face", message)


class FailureDetailTests(unittest.TestCase):
    def test_face_line_wins_over_the_ckpt_argv(self) -> None:
        stderr = (
            "Command --inference_ckpt_path checkpoints/latentsync_unet.pt\n"
            "RuntimeError: Face not detected\n"
        )
        detail = failure_detail(stderr, "", 1, prefix="LatentSync failed")
        self.assertIn("Face not detected", detail)
        self.assertNotIn("latentsync_unet.pt", detail)

    def test_odd_dimension_ffmpeg_is_kept(self) -> None:
        stderr = "width not divisible by 2 (1085x1450)\n"
        detail = failure_detail(stderr, "", 1, prefix="ffmpeg failed")
        self.assertIn("not divisible by 2", detail)
        self.assertIn("1085", detail)

    def test_even_scale_floors_odd_sides(self) -> None:
        self.assertIn("trunc(iw/2)*2", EVEN_YUV420_SCALE)
        self.assertIn("trunc(ih/2)*2", EVEN_YUV420_SCALE)


if __name__ == "__main__":
    unittest.main()
