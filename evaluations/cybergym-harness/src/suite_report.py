"""Write suite-report.json for one CyberGym suite directory.

Lab card only. The resolved count is how many task dirs in this directory
had resolved=true. It is not a subset percentage and not a readiness claim.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def build_report(root: Path) -> dict:
    rows = []
    for path in sorted(root.glob("*/result.json")):
        data = json.loads(path.read_text())
        rows.append(
            {
                "task_id": data.get("task_id"),
                "model": data.get("model"),
                "driver": data.get("driver"),
                "submit_count": data.get("submit_count"),
                "resolved": data.get("resolved"),
                "reason": data.get("reason"),
                "stop_reason": data.get("stop_reason"),
                "output": str(path.parent),
            }
        )
    return {
        "suite": "subset10",
        "model": rows[0]["model"] if rows else None,
        "tasks": rows,
        "n": len(rows),
        "submit_invoked": sum(1 for row in rows if (row.get("submit_count") or 0) > 0),
        "resolved_count": sum(1 for row in rows if row.get("resolved") is True),
        "note": "Lab suite card only. Not an enterprise-readiness claim (no RBAC/SSO/G1-09 evidence).",
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: suite_report.py SUITE_DIR", file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f"suite dir missing: {root}", file=sys.stderr)
        return 2
    report = build_report(root)
    out = root / "suite-report.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(
        "wrote",
        out,
        "submit_invoked",
        report["submit_invoked"],
        "resolved",
        str(report["resolved_count"]) + "/" + str(report["n"]),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
