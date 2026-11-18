#!/usr/bin/env python3
"""Launch mini-extra swebench with Spockify Docker image wiring.

mini-swe-agent 1.14 only sets the SWE Docker image when
environment_class is exactly \"docker\". Our SpockifyDockerEnvironment
needs the same image assignment.
"""

from __future__ import annotations

import sys


def _patch_image_wiring() -> None:
    import minisweagent.run.extra.swebench as sb
    from jinja2 import StrictUndefined, Template
    from minisweagent.environments import get_environment

    def get_sb_environment(config: dict, instance: dict):
        env_config = config.setdefault("environment", {})
        env_config["environment_class"] = env_config.get(
            "environment_class", "docker"
        )
        image_name = sb.get_swebench_docker_image_name(instance)
        cls = str(env_config["environment_class"])
        if cls == "singularity" or cls.endswith("SingularityEnvironment"):
            env_config["image"] = "docker://" + image_name
        else:
            # docker + SpockifyDockerEnvironment (and any custom docker-like)
            env_config["image"] = image_name
        env = get_environment(env_config)
        if startup_command := config.get("run", {}).get("env_startup_command"):
            startup_command = Template(
                startup_command, undefined=StrictUndefined
            ).render(**instance)
            out = env.execute(startup_command)
            if out["returncode"] != 0:
                raise RuntimeError(f"Error executing startup command: {out}")
        return env

    sb.get_sb_environment = get_sb_environment


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    _patch_image_wiring()
    from minisweagent.run.mini_extra import main as mini_extra_main

    # mini_extra.main expects sys.argv style via typer; re-exec as module path.
    sys.argv = ["mini-extra", *argv]
    try:
        mini_extra_main()
    except SystemExit as e:
        return int(e.code or 0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
