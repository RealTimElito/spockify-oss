"""Gateway image catalog must not be a wake path."""

from __future__ import annotations

import unittest

import image_models
from app import (
    _path_forces_pin_evac,
    _path_needs_wake,
    gateway_image_models,
    idle_scale_down_allowed,
    should_clear_pin_evac_marker,
    should_evacuate_pins,
)


class GatewayImageModelsColdTests(unittest.TestCase):
    def test_catalog_path_does_not_wake(self) -> None:
        self.assertFalse(_path_needs_wake("/__gateway/image-models"))
        self.assertFalse(_path_needs_wake("/__gateway/video-models"))
        self.assertTrue(_path_needs_wake("/object_info"))
        self.assertTrue(_path_needs_wake("/prompt"))

    def test_catalog_path_does_not_force_pin_evac(self) -> None:
        self.assertFalse(_path_forces_pin_evac("/__gateway/image-models"))
        self.assertFalse(_path_forces_pin_evac("/__gateway/video-models"))
        self.assertFalse(_path_forces_pin_evac("/history"))
        self.assertTrue(_path_forces_pin_evac("/prompt"))
        self.assertTrue(_path_forces_pin_evac("/ws"))
        self.assertTrue(_path_forces_pin_evac("/upload/image"))

    def test_handler_returns_catalog_without_scaling(self) -> None:
        import asyncio

        payload = asyncio.run(gateway_image_models())
        ids = [item["id"] for item in payload["models"]]
        self.assertEqual(ids, [image_models.FLUX_ID])
        self.assertFalse(payload["qwen_image_2_1"]["included"])

    def test_video_models_handler_is_cold(self) -> None:
        import asyncio

        from app import gateway_video_models

        payload = asyncio.run(gateway_video_models())
        self.assertEqual(
            payload["default"],
            image_models.default_video_model_id(payload["models"]),
        )
        self.assertEqual(payload["a_camera"], image_models.EPISODE_A_CAMERA_ID)
        self.assertIsInstance(payload["models"], list)

    def test_video_limits_profiles(self) -> None:
        minimax = image_models.video_limits_for("minimax-h3")
        self.assertEqual(minimax["max_seconds"], 15)
        self.assertIn(15, minimax["seconds"])
        self.assertIn("1344x768", minimax["sizes"])
        self.assertIn("1280x704", minimax["sizes"])
        self.assertIn("1920x1088", minimax["sizes"])
        self.assertNotIn("1920x1080", minimax["sizes"])
        self.assertNotIn("1280x720", minimax["sizes"])
        self.assertEqual(minimax["default_size"], "1920x1088")
        self.assertEqual(minimax["max_pixels"], 1920 * 1088)
        self.assertTrue(minimax["audio_supported"])
        self.assertEqual(minimax["series_role"], "atmos-scratch")
        self.assertTrue(minimax["extend_supported"])
        self.assertIn(24, minimax["fps"])
        self.assertNotIn(48, minimax["fps"])
        ltx = image_models.video_limits_for("ltx-video")
        self.assertEqual(ltx["max_seconds"], 10)
        self.assertEqual(ltx["seconds"], [1, 3, 5, 10])
        self.assertFalse(ltx["audio_supported"])
        self.assertTrue(ltx["extend_supported"])
        self.assertIn("768x768", ltx["sizes"])
        layout = image_models.video_limits_for("ltx-2.5-layout-to-render")
        self.assertFalse(layout["dual_input_only"])
        self.assertTrue(layout["requires_reference"])
        self.assertIn("1920x1088", layout["sizes"])
        self.assertIn("1280x704", layout["sizes"])
        self.assertIn("1280x768", layout["sizes"])
        self.assertNotIn("1280x720", layout["sizes"])
        self.assertNotIn("1920x1080", layout["sizes"])
        self.assertEqual(layout["fps"], [16, 24, 48])
        self.assertEqual(layout["default_fps"], 24)
        self.assertEqual(layout["seconds"], [1, 3, 5, 10])
        self.assertEqual(layout["default_size"], "1920x1088")
        self.assertTrue(layout["audio_ignored"])
        self.assertEqual(layout["series_role"], "a-camera")
        self.assertEqual(layout["identity_lock"], "look-still+clay+union")
        self.assertFalse(layout["extend_supported"])
        self.assertFalse(layout.get("audio_vae_wired"))
        lock = image_models.identity_lock_status(look_still=True, clay=True)
        self.assertFalse(lock["pulid"])
        self.assertIn("clay", lock["uses"])
        union = image_models.video_limits_for("ltx-2.5-union-control")
        self.assertTrue(union["requires_control"])
        self.assertFalse(union["extend_supported"])
        self.assertFalse(union["audio_supported"])
        self.assertIn("1920x1024", union["sizes"])
        self.assertIn("1280x768", union["sizes"])
        self.assertNotIn("1280x720", union["sizes"])
        self.assertEqual(union["fps"], [16, 24, 48])
        self.assertEqual(union["default_fps"], 24)
        self.assertEqual(union["default_size"], "1280x768")
        # /128-aligned only: no odd-latent sizes like the layout 1920x1088.
        self.assertNotIn("1920x1088", union["sizes"])
        wan = image_models.video_limits_for("wan2.2-t2v")
        self.assertEqual(wan["fps"], [16])
        self.assertFalse(wan["extend_supported"])


class PinEvacDecisionTests(unittest.TestCase):
    def test_force_evacuates_once(self) -> None:
        self.assertTrue(
            should_evacuate_pins(
                enabled=True,
                marker_present=False,
                force=True,
                mem_available_kib=80_000_000,
                min_avail_kib=20_971_520,
            )
        )
        self.assertFalse(
            should_evacuate_pins(
                enabled=True,
                marker_present=True,
                force=True,
                mem_available_kib=1,
                min_avail_kib=20_971_520,
            )
        )

    def test_low_mem_without_force(self) -> None:
        self.assertTrue(
            should_evacuate_pins(
                enabled=True,
                marker_present=False,
                force=False,
                mem_available_kib=10_000_000,
                min_avail_kib=20_971_520,
            )
        )
        self.assertFalse(
            should_evacuate_pins(
                enabled=True,
                marker_present=False,
                force=False,
                mem_available_kib=40_000_000,
                min_avail_kib=20_971_520,
            )
        )

    def test_disabled_never_evacuates(self) -> None:
        self.assertFalse(
            should_evacuate_pins(
                enabled=False,
                marker_present=False,
                force=True,
                mem_available_kib=1,
                min_avail_kib=20_971_520,
            )
        )

    def test_clear_marker_after_grace_when_idle(self) -> None:
        self.assertTrue(
            should_clear_pin_evac_marker(
                marker_present=True,
                inflight=0,
                wake_locked=False,
                idle_for_s=60,
                grace_s=45,
                queue_busy=False,
            )
        )
        self.assertFalse(
            should_clear_pin_evac_marker(
                marker_present=True,
                inflight=0,
                wake_locked=False,
                idle_for_s=60,
                grace_s=45,
                queue_busy=True,
            )
        )
        self.assertFalse(
            should_clear_pin_evac_marker(
                marker_present=True,
                inflight=1,
                wake_locked=False,
                idle_for_s=120,
                grace_s=45,
                queue_busy=False,
            )
        )


class IdleScaleDownTests(unittest.TestCase):
    def test_wake_in_progress_is_not_idle(self) -> None:
        self.assertFalse(
            idle_scale_down_allowed(
                wake_locked=True,
                inflight=0,
                idle_for_s=900,
                idle_limit_s=900,
                replicas=1,
            )
        )

    def test_open_prompt_is_not_idle(self) -> None:
        self.assertFalse(
            idle_scale_down_allowed(
                wake_locked=False,
                inflight=1,
                idle_for_s=1200,
                idle_limit_s=900,
                replicas=1,
            )
        )

    def test_quiet_replica_scales_down(self) -> None:
        self.assertTrue(
            idle_scale_down_allowed(
                wake_locked=False,
                inflight=0,
                idle_for_s=900,
                idle_limit_s=900,
                replicas=1,
            )
        )

    def test_already_zero_stays_down(self) -> None:
        self.assertFalse(
            idle_scale_down_allowed(
                wake_locked=False,
                inflight=0,
                idle_for_s=900,
                idle_limit_s=900,
                replicas=0,
            )
        )

    def test_always_on_never_scales_down(self) -> None:
        self.assertFalse(
            idle_scale_down_allowed(
                wake_locked=False,
                inflight=0,
                idle_for_s=900,
                idle_limit_s=900,
                replicas=1,
                always_on=True,
            )
        )


if __name__ == "__main__":
    unittest.main()
