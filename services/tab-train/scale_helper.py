#!/usr/bin/env python3
"""Scale cluster deployments around Tab training (in-cluster or kubeconfig)."""

from __future__ import annotations

import argparse
import os
import sys
import time


def _apps_v1():
    from kubernetes import client, config

    if os.getenv("KUBERNETES_SERVICE_HOST"):
        config.load_incluster_config()
    else:
        config.load_kube_config()
    return client.AppsV1Api()


def scale(name: str, replicas: int, namespace: str = "spockify") -> None:
    api = _apps_v1()
    body = {"spec": {"replicas": replicas}}
    api.patch_namespaced_deployment_scale(name, namespace, body)
    print(f"scaled {namespace}/{name} → {replicas}", flush=True)


def wait_gone(name: str, namespace: str = "spockify", timeout: float = 300.0) -> None:
    from kubernetes import client, config

    if os.getenv("KUBERNETES_SERVICE_HOST"):
        config.load_incluster_config()
    else:
        config.load_kube_config()
    core = client.CoreV1Api()
    deadline = time.time() + timeout
    while time.time() < deadline:
        pods = core.list_namespaced_pod(
            namespace, label_selector=f"app={name}"
        )
        if not pods.items:
            print(f"no pods for app={name}", flush=True)
            return
        time.sleep(2)
    raise TimeoutError(f"pods for {name} still present after {timeout}s")


def wait_ready(name: str, namespace: str = "spockify", timeout: float = 600.0) -> None:
    api = _apps_v1()
    deadline = time.time() + timeout
    while time.time() < deadline:
        dep = api.read_namespaced_deployment(name, namespace)
        desired = dep.spec.replicas or 0
        ready = dep.status.ready_replicas or 0
        if desired > 0 and ready >= desired:
            print(f"{name} ready {ready}/{desired}", flush=True)
            return
        time.sleep(3)
    raise TimeoutError(f"{name} not ready after {timeout}s")


def reload_best_adapters() -> None:
    """Hot-load champion / pointer LoRAs once vLLM is up (best-effort)."""
    if os.getenv("TAB_RELOAD_ADAPTERS", "1").strip() in ("0", "false", "no"):
        print("TAB_RELOAD_ADAPTERS=0 — skip adapter reload", flush=True)
        return
    try:
        from reload_adapters import reload_all
    except ImportError:
        # When invoked as a script from services/tab-train/.
        import importlib.util
        from pathlib import Path

        path = Path(__file__).resolve().parent / "reload_adapters.py"
        spec = importlib.util.spec_from_file_location("reload_adapters", path)
        if spec is None or spec.loader is None:
            print("reload_adapters import failed", flush=True)
            return
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        reload_all = mod.reload_all
    try:
        rc = reload_all(wait=True, timeout=float(os.getenv("TAB_RELOAD_TIMEOUT", "300")))
        print(f"reload_adapters exit={rc}", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"reload_adapters error: {exc}", flush=True)


def restore_vllm(namespace: str = "spockify", *, reload_adapters: bool = True) -> None:
    """Always bring Tab serve back — safe to call from bash trap."""
    try:
        scale("vllm-tab", 1, namespace)
        wait_ready("vllm-tab", namespace)
        if reload_adapters:
            reload_best_adapters()
    except Exception as exc:  # noqa: BLE001
        print(f"restore error: {exc}", flush=True)
        try:
            scale("vllm-tab", 1, namespace)
        except Exception as exc2:  # noqa: BLE001
            print(f"restore retry failed: {exc2}", flush=True)
            raise


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
            "action",
            choices=["free", "restore", "scale", "wait-gone", "wait-ready", "reload"],
    )
    p.add_argument("--name", default="vllm-tab")
    p.add_argument("--replicas", type=int, default=None)
    p.add_argument("--namespace", default="spockify")
    p.add_argument("--also-comfyui", action="store_true")
    p.add_argument(
            "--no-reload",
            action="store_true",
            help="On restore: skip champion LoRA reload",
    )
    args = p.parse_args()

    if args.action == "free":
        scale("vllm-tab", 0, args.namespace)
        if args.also_comfyui:
            try:
                scale("comfyui", 0, args.namespace)
            except Exception as exc:  # noqa: BLE001
                print(f"comfyui scale skipped: {exc}", flush=True)
        wait_gone("vllm-tab", args.namespace)
    elif args.action == "restore":
        restore_vllm(args.namespace, reload_adapters=not args.no_reload)
    elif args.action == "reload":
        reload_best_adapters()
    elif args.action == "scale":
        if args.replicas is None:
            print("--replicas required", file=sys.stderr)
            return 2
        scale(args.name, args.replicas, args.namespace)
    elif args.action == "wait-gone":
        wait_gone(args.name, args.namespace)
    elif args.action == "wait-ready":
        wait_ready(args.name, args.namespace)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
