"""Tests for spockify_mcp.runner."""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

from spockify_mcp.config import Settings
from spockify_mcp.redaction import redact
from spockify_mcp.runner import (
    CommandResult,
    LogService,
    SERVICE_LABELS,
    cluster_status,
    run_command,
    tail_logs,
)


class RedactionTest(unittest.TestCase):
    def test_redacts_bearer_and_api_key(self) -> None:
        raw = "Authorization: Bearer sk-abc123xyz\napi_key=supersecret"
        out = redact(raw)
        self.assertNotIn("sk-abc123xyz", out)
        self.assertNotIn("supersecret", out)
        self.assertIn("[REDACTED]", out)

    def test_redacts_litellm_master_key(self) -> None:
        raw = "LITELLM_MASTER_KEY=sk-live-0123456789abcdef"
        out = redact(raw)
        self.assertNotIn("sk-live-0123456789abcdef", out)


class ServiceEnumTest(unittest.TestCase):
    def test_all_services_have_labels(self) -> None:
        for svc in LogService:
            self.assertIn("app=", SERVICE_LABELS[svc])

    def test_invalid_service_rejected(self) -> None:
        settings = Settings(
            agenthub_root=Path("/tmp/agentHub"),
            namespace="spockify",
            spark_host="user@your-cluster-host",
            kubectl=["microk8s", "kubectl"],
            router_health_url="http://router:4100",
            http_token=None,
        )
        with self.assertRaises(ValueError):
            tail_logs("not-a-service", settings=settings)

    @mock.patch("spockify_mcp.runner.run_command")
    def test_tail_logs_caps_lines(self, mock_run: mock.MagicMock) -> None:
        mock_run.return_value = CommandResult(stdout="log line", stderr="", returncode=0)
        settings = Settings(
            agenthub_root=Path("/tmp/agentHub"),
            namespace="spockify",
            spark_host="user@your-cluster-host",
            kubectl=["microk8s", "kubectl"],
            router_health_url="http://router:4100",
            http_token=None,
        )
        tail_logs(LogService.ROUTER, lines=9999, settings=settings)
        argv = mock_run.call_args[0][0]
        self.assertIn("--tail=500", argv)
        self.assertIn("app=spockify-router", argv)


class RunnerCommandTest(unittest.TestCase):
    @mock.patch("subprocess.run")
    def test_cluster_status_invokes_make(self, mock_run: mock.MagicMock) -> None:
        mock_run.return_value = mock.Mock(returncode=0, stdout="pods ok", stderr="")
        settings = Settings(
            agenthub_root=Path("/tmp/agentHub"),
            namespace="spockify",
            spark_host="user@your-cluster-host",
            kubectl=["microk8s", "kubectl"],
            router_health_url="http://router:4100",
            http_token=None,
        )
        with mock.patch("spockify_mcp.config.has_local_kubectl", return_value=True):
            out = cluster_status(settings=settings)
        self.assertIn("pods ok", out)
        argv = mock_run.call_args[0][0]
        self.assertEqual(argv[:2], ["make", "status"])

    def test_run_command_timeout(self) -> None:
        with mock.patch(
            "subprocess.run",
            side_effect=__import__("subprocess").TimeoutExpired(cmd=["sleep"], timeout=1),
        ):
            result = run_command(["sleep", "9"], timeout_s=1)
        self.assertTrue(result.timed_out)
        self.assertEqual(result.returncode, 124)


if __name__ == "__main__":
    unittest.main()
