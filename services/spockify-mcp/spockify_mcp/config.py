"""Environment and host detection for Spockify MCP."""

from __future__ import annotations

import os
import shlex
import socket
import subprocess
from dataclasses import dataclass
from pathlib import Path


def find_agenthub_root() -> Path:
    """Resolve agentHub repo root from env or layout."""
    raw = os.environ.get("AGENTHUB_ROOT", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "Makefile").is_file() and (parent / "k8s").is_dir():
            return parent
    raise RuntimeError(
        "AGENTHUB_ROOT not set and repo root could not be inferred; "
        "set AGENTHUB_ROOT to the agentHub checkout path"
    )


def is_spark_host() -> bool:
    """True when running on the cluster host.

    Detection order: explicit CLUSTER_HOST match, then the on-disk data dir.
    Set CLUSTER_HOST to your cluster node's hostname (or a substring of it).
    """
    if Path("/var/lib/spockify/postgres").is_dir():
        return True
    cluster = os.getenv("CLUSTER_HOST", "").strip().lower()
    if cluster:
        try:
            hostname = (socket.getfqdn() or socket.gethostname() or "").lower()
        except OSError:
            hostname = ""
        if cluster in hostname:
            return True
    return False


def has_local_kubectl() -> bool:
    """True if microk8s kubectl or kubectl is usable locally."""
    kubectl = os.environ.get("KUBECTL", "microk8s kubectl")
    binary = shlex.split(kubectl)[0]
    if Path(binary).is_file():
        return True
    try:
        subprocess.run(
            ["which", binary],
            capture_output=True,
            check=True,
            timeout=5,
        )
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False


@dataclass(frozen=True)
class Settings:
    """Runtime configuration."""

    agenthub_root: Path
    namespace: str
    spark_host: str
    kubectl: list[str]
    router_health_url: str
    http_token: str | None
    default_timeout_s: int = 120

    @classmethod
    def load(cls) -> Settings:
        root = find_agenthub_root()
        namespace = os.environ.get("NAMESPACE", "spockify")
        spark_host = (
            os.environ.get("SPARK_HOST")
            or os.environ.get("DEST_HOST")
            or "user@your-cluster-host"
        )
        kubectl_raw = os.environ.get("KUBECTL", "microk8s kubectl")
        kubectl = shlex.split(kubectl_raw)
        router_url = os.environ.get(
            "ROUTER_HEALTH_URL",
            f"http://spockify-router.{namespace}.svc.cluster.local:4100",
        ).rstrip("/")
        token = os.environ.get("SPOCKIFY_MCP_TOKEN") or None
        timeout = int(os.environ.get("SPOCKIFY_MCP_TIMEOUT", "120"))
        return cls(
            agenthub_root=root,
            namespace=namespace,
            spark_host=spark_host,
            kubectl=kubectl,
            router_health_url=router_url,
            http_token=token,
            default_timeout_s=timeout,
        )

    def kubectl_argv(self) -> list[str]:
        """Local kubectl argv or SSH-wrapped remote kubectl."""
        if has_local_kubectl() or is_spark_host():
            return list(self.kubectl)
        return ["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", self.spark_host] + list(
            self.kubectl
        )

    def remote_shell_prefix(self) -> list[str] | None:
        """SSH prefix when neither local kubectl nor cluster host."""
        if has_local_kubectl() or is_spark_host():
            return None
        return ["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", self.spark_host]
