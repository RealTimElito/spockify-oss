"""CyberGym action phase. Kept in sync with phase.ts.

Explore is capped so the model has to write a candidate and call
submit_poc. After a non-solving submit, a short explore window uses the
vul/fix feedback, then write_file and submit_poc are forced again.
A solve, or the submit cap, releases tool choice.
"""

from __future__ import annotations

DEFAULT_EXPLORE_BUDGET = 12
# One read: the verify text is already in the tool result. A longer
# forced-read window makes gpt-oss prose-exit before the next write.
DEFAULT_FEEDBACK_BUDGET = 1
DEFAULT_MAX_SUBMITS = 3


def phase_name(
    *,
    explore_calls: int,
    writes: int,
    submits: int,
    explore_budget: int,
    writes_at_last_submit: int = 0,
    explore_calls_at_last_submit: int = 0,
    last_solved: bool = False,
    need_new_write: bool = False,
    max_submits: int = DEFAULT_MAX_SUBMITS,
    feedback_budget: int = DEFAULT_FEEDBACK_BUDGET,
) -> str:
    if last_solved or submits >= max_submits:
        return "iterate"
    if need_new_write:
        return "write"
    if submits > 0:
        explores_since = explore_calls - explore_calls_at_last_submit
        if writes <= writes_at_last_submit:
            # Forced shell, not auto: gpt-oss prose-exits the harness on auto.
            if explores_since < feedback_budget:
                return "feedback"
            return "write"
        return "submit"
    if writes > 0:
        return "submit"
    if explore_calls >= explore_budget:
        return "write"
    return "explore"


def phase_tool_choice(
    *,
    explore_calls: int,
    writes: int,
    submits: int,
    explore_budget: int,
    writes_at_last_submit: int = 0,
    explore_calls_at_last_submit: int = 0,
    last_solved: bool = False,
    need_new_write: bool = False,
    max_submits: int = DEFAULT_MAX_SUBMITS,
    feedback_budget: int = DEFAULT_FEEDBACK_BUDGET,
) -> dict | None:
    """None means tool_choice=auto (omit / let the server default)."""
    phase = phase_name(
        explore_calls=explore_calls,
        writes=writes,
        submits=submits,
        explore_budget=explore_budget,
        writes_at_last_submit=writes_at_last_submit,
        explore_calls_at_last_submit=explore_calls_at_last_submit,
        last_solved=last_solved,
        need_new_write=need_new_write,
        max_submits=max_submits,
        feedback_budget=feedback_budget,
    )
    if phase == "feedback":
        return {"type": "function", "function": {"name": "read_file"}}
    if phase == "write":
        return {"type": "function", "function": {"name": "write_file"}}
    if phase == "submit":
        return {"type": "function", "function": {"name": "submit_poc"}}
    return None


EXPLORE_TOOLS = {
    "read_file",
    "read",
    "grep",
    "glob",
    "shell",
    "bash",
    "run",
    "exec",
    "list_dir",
    "run_shell",
}
