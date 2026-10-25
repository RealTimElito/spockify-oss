"""Closed loop: plan → parallel exec → review → iterate.

Handoff protocol (lab ↔ future High mid-thought SPAWN):
  plan emits tasks → exec returns DONE digests → review merges digests
  and only opens gaps. Same ideas as chat mid-thought phases A–D:
  structured handoff, digests, cancel, no nested harness. See README.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable

from .llm import ChatResult, LabLlm
from .policy import refuse_reason
from .shell_tool import (
    apply_writes,
    extract_run_commands,
    extract_writes,
    format_observations,
    format_write_observations,
    run_shell,
    validate_command,
)

LogFn = Callable[[str], None]

# Tunable (overnight experiments). Defaults match Tim's preferred temps.
ORCH_TEMP = float(os.environ.get("SPOCKIFY_LAB_ORCH_TEMP", "0.15"))
EXEC_TEMP = float(os.environ.get("SPOCKIFY_LAB_EXEC_TEMP", "0.15"))


def _log_default(msg: str) -> None:
    print(msg, flush=True)


ORCH_SYSTEM = """\
You are the lab orchestrator (planner/reviewer) for a benign coding harness.
You only plan and review software engineering work: refactors, features, tests,
docs, bugfixes. Never plan attacks, exploits, malware, or unauthorized access.

Executors can run shell commands directly in the workspace (ls, git status, rg,
find, cat, npm/pytest/make, etc.). Prefer tasking them to use shell for
inspection and verification.

Always reply with a single JSON object (no markdown fences) of this shape:
{
  "status": "continue" | "done",
  "summary": "one short paragraph",
  "tasks": [
    {
      "id": "t1",
      "title": "short title",
      "instructions": "concrete implementer instructions"
    }
  ]
}

Output contract (critical for reasoning models):
- The JSON object MUST appear in the final assistant answer content.
- Thinking/reasoning is discarded by the harness — never put the only copy of
  the JSON there. After any private reasoning, emit the JSON and stop.
- Keep private reasoning short (≤2 brief sentences); emit JSON as soon as the
  task list is clear.
- Emit exactly ONE JSON object, then stop. Never role-play later rounds or
  emit multiple plan objects in one reply.
- No prose before or after the JSON object.

Rules:
- You cannot run shell or read files yourself — only emit JSON tasks for
  executors. Never invent ls/cat/git output in the plan summary.
- On the first turn (no prior COMPLETED WORK digests), you MUST set
  status=continue with at least one concrete executor task. Never status=done
  on the first turn, and never claim you already inspected the repo.
- On later turns, break remaining gaps into <= workers independent tasks.
- Prefer small, parallelizable coding tasks — but never assign two workers to
  edit the same file in one round; serialize edits to one path.
- For multi-file bugfixes (2+ paths must change + tests), prefer ONE sequential
  executor task that WRITEs each file then RUN: pytest — not parallel invent.
- For bugfixes that need test→edit→retest, prefer ONE sequential task (or
  ordered follow-ups), not parallel conflicting edits.
- Never invent a new class/API when RUN: cat shows existing module functions;
  preserve signatures. First task should inspect with RUN: when unsure.
- For repo inspection (list files, search, git status, read a file), write
  task instructions that START with explicit RUN: lines, e.g.
  "RUN: ls\\nRUN: cat path/to/file\\nThen summarize under FINDINGS."
  Use real JSON string escapes (\\n for newlines). Never write broken escapes
  like \\Then — that stops the harness from parsing your plan.
- For file edits, tell executors to emit WRITE: path with a fenced or ---
  body BEFORE DONE (full file contents — do not drop existing helpers).
- Only create/edit source files when implementing real code, tests, or docs.
- Never tell workers to run `spockify lab`, `spockify-lab-agents`, or to
  re-invoke this harness (no nested lab / recursive agent loops).
- Never ask workers to write install/make scripts that re-enter this harness.
- Do not invent file paths you were not given; ask implementers to inspect the repo.
- Task instructions must demand DONE / FINDINGS / ARTIFACTS from executors
  (completed work, not a methodology). Tell them to use RUN: <cmd> for
  shell inspection when needed.

Cooperative review (critical):
- Executor messages marked status=DONE / COMPLETED WORK are finished results,
  not proposals or plans for how to work. READ and USE their findings_digest
  and artifacts. Do not re-ask for analysis, inspection, or methodology already
  present in those digests.
- Treat completed tasks as closed. Only emit new tasks for real open gaps
  (missing files, failed verification, unanswered goal pieces).
- If digests already satisfy the goal, set status=done with tasks=[].
- Diffs/patches shown only under ARTIFACTS are proposals, NOT proof the file
  was edited on disk. Only treat code as applied when digests include WRITE
  OBSERVATIONS / write ok / successful sed (or equivalent) for that path.
- If the user goal requires tests to pass, only set status=done when digests
  include real pytest/test runner output showing passes (not claims without
  observation). If tests were not run or failed, emit a verify/fix follow-up.
- Never re-plan a fresh duplicate batch when follow-ups already exist; only
  fill gaps. Keep tasks empty when status=done.
"""

EXEC_SYSTEM = """\
You are a lab executor (implementer) for a benign coding harness.
You can run shell commands in the working directory via the harness:

Emit one or more lines:
RUN: <simple command>

Or write/replace a file (preferred for multi-line edits — safer than fragile sed):
WRITE: relative/path.py
```
full file contents here
```

(Also accepted: WRITE: path then a --- body --- block.)

Allowed RUN examples: ls, find, rg/grep, cat/head/tail, git status/diff/log,
pytest, make/npm test runners, sed for tiny one-line fixes. No pipes/chaining,
no sudo/rm/curl/spockify.

After you emit RUN/WRITE lines, the harness returns OBSERVATIONS. Then write
your DONE / FINDINGS / ARTIFACTS from those observations only.

Order matters: put every RUN: / WRITE: block BEFORE the DONE line. The harness
ignores tools listed only under ARTIFACTS after DONE.

Your reply is COMPLETED WORK for the orchestrator — not a plan for someone
else to execute later. Do the analysis / produce the guidance / draft the
patch content in this turn.

Output contract:
- Put DONE / FINDINGS / ARTIFACTS in the final answer content (not only in
  thinking/reasoning). The harness discards reasoning scratch.
- Prefer short, dense findings over long methodology.
- Only report file contents / command results from SHELL OBSERVATIONS.
  If you still need a command, emit more RUN: lines instead of inventing.

Shell-first for inspection:
- Use RUN: for ls, find, rg/grep, git status/diff/log, cat/head, and tests.
- Do NOT invent a Python (or other) script/file merely to list files or run one
  command — give the shell command instead.
- Only create or edit files when implementing real code, tests, or documentation.

Do NOT run or suggest: `spockify lab`, `spockify-lab-agents`, nested harness
calls, or scripts whose only job is to re-enter this loop.

Do not perform or describe attacks, exploits, malware, or unauthorized access.

Reply format (plain text, no JSON wrapper required):
1) Optional: RUN: commands first (if you need observations).
2) Start final answer with: DONE — <one-line outcome>
3) FINDINGS: concrete results (what you found, concluded, or implemented).
4) ARTIFACTS: commands already determined, file paths, unified diffs, tables,
   or other reusable payload the orchestrator should merge.
5) BLOCKED: only if something is missing (else omit).

Be concise. Methodology-only replies (how one might analyze, with no findings)
are a failure for this role.
"""

_JSON_RE = re.compile(r"\{[\s\S]*\}")

# Prefer completed-work markers when building digests for orch review.
_DONE_LINE_RE = re.compile(
    r"(?im)^\s*(?:DONE|COMPLETED(?:\s+WORK)?)\s*[-—:]\s*(.+)$"
)
_FINDINGS_RE = re.compile(
    r"(?is)(?:^|\n)\s*FINDINGS\s*:\s*(.*?)(?=(?:^|\n)\s*(?:ARTIFACTS|BLOCKED)\s*:|\Z)"
)
_ARTIFACTS_RE = re.compile(
    r"(?is)(?:^|\n)\s*ARTIFACTS\s*:\s*(.*?)(?=(?:^|\n)\s*(?:BLOCKED|FINDINGS)\s*:|\Z)"
)


def _repair_json_escapes(text: str) -> str:
    """Fix common model typos: \\Then → \\nThen (invalid JSON escapes)."""
    return re.sub(
        r'\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})',
        r"\\n",
        text or "",
    )


def _extract_json_blob_once(raw: str) -> str:
    dec = json.JSONDecoder()
    fallback = ""
    for i, ch in enumerate(raw):
        if ch != "{":
            continue
        try:
            data, end = dec.raw_decode(raw, i)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        blob = raw[i:end]
        if "status" in data:
            return blob
        if not fallback:
            fallback = blob
    return fallback


def _extract_json_blob(text: str) -> str:
    """Best-effort JSON object extraction (plan-shaped preferred)."""
    raw = text or ""
    if not raw.strip():
        return ""
    blob = _extract_json_blob_once(raw)
    if blob:
        return blob
    repaired = _repair_json_escapes(raw)
    if repaired != raw:
        return _extract_json_blob_once(repaired)
    return ""


def usable_reply(content: str, reasoning: str = "") -> str:
    """Prefer answer content; salvage reasoning when models leave content empty.

    Reasoning models (e.g. DeepSeek-R1 via lab-orchestrator) often stream the
    only useful payload into reasoning_content. The harness must still parse
    plans / DONE digests from that text.
    """
    content = (content or "").strip()
    reasoning = (reasoning or "").strip()
    if content:
        return content
    if not reasoning:
        return ""
    blob = _extract_json_blob(reasoning)
    if blob:
        return blob
    if _DONE_LINE_RE.search(reasoning):
        return reasoning
    return reasoning


def _section(text: str, pattern: re.Pattern[str]) -> str:
    m = pattern.search(text or "")
    return (m.group(1).strip() if m else "")


@dataclass
class Task:
    id: str
    title: str
    instructions: str


@dataclass
class Plan:
    status: str
    summary: str
    tasks: list[Task] = field(default_factory=list)


@dataclass
class ExecResult:
    task: Task
    worker: int
    output: str
    reasoning: str = ""
    error: str | None = None
    elapsed_s: float = 0.0
    # Harness-authoritative tool trace (not model claims).
    writes_ok: list[str] = field(default_factory=list)
    shell_ok: list[str] = field(default_factory=list)
    pytest_passed: bool = False


def enrich_task_instructions(instructions: str) -> str:
    """Normalize 'run ls/cat…' prose into explicit RUN: lines when missing."""
    text = (instructions or "").strip()
    if not text:
        return text
    if extract_run_commands(text):
        return text
    # Common orch phrasings: Run 'ls' / run cat hello.py / execute: git status
    found: list[str] = []
    patterns = [
        r"(?i)\brun\s+['\"]?(ls(?:\s+[-\w]*)?)['\"]?",
        r"(?i)\brun\s+['\"]?(cat\s+\S+)['\"]?",
        r"(?i)\brun\s+['\"]?(head(?:\s+-n?\s*\d+)?\s+\S+)['\"]?",
        r"(?i)\brun\s+['\"]?(rg\s+\S+(?:\s+\S+)?)['\"]?",
        r"(?i)\brun\s+['\"]?(git\s+(?:status|diff|log|show|branch)(?:\s+\S+)*)['\"]?",
        r"(?i)\brun\s+['\"]?(find\s+\S+(?:\s+\S+)*)['\"]?",
        r"(?i)\b(?:execute|use)\s+['\"]?(ls(?:\s+[-\w]*)?)['\"]?",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text):
            cmd = " ".join(m.group(1).split())
            if validate_command(cmd) is None and cmd not in found:
                found.append(cmd)
    if not found:
        # Inspect-ish tasks without a concrete command → seed ls.
        low = text.lower()
        if any(
            k in low
            for k in (
                "list file",
                "list the file",
                "inspect",
                "look at",
                "read the",
                "what files",
                "workspace",
            )
        ):
            found.append("ls")
    if not found:
        return text
    run_block = "\n".join(f"RUN: {c}" for c in found)
    return (
        f"{run_block}\n"
        "After SHELL OBSERVATIONS, complete the task.\n"
        f"{text}"
    )


def preseed_shell_observations(instructions: str, cwd: str) -> str:
    """Run obvious inspect commands once so the first LLM turn has real data."""
    cmds = extract_run_commands(instructions)
    if not cmds:
        return ""
    # Cap preseed — keep first 3 allowlisted commands.
    results = []
    for c in cmds[:3]:
        results.append(run_shell(c, cwd=cwd))
    if not results:
        return ""
    return format_observations(results)


def coerce_empty_continue(plan: Plan, goal: str) -> Plan:
    """If status=continue but tasks=[], recover a verify task (parse glitches)."""
    if plan.status != "continue" or plan.tasks:
        return plan
    g = (goal or "").lower()
    if "pytest" not in g and "test" not in g:
        return plan
    return Plan(
        status="continue",
        summary=plan.summary or "forced verify after empty continue",
        tasks=[
            Task(
                id="t_verify",
                title="verify tests",
                instructions=(
                    "RUN: pytest -q\n"
                    "Summarize under FINDINGS from SHELL OBSERVATIONS only."
                ),
            )
        ],
    )


def history_has_pytest_pass(history: list[dict[str, Any]]) -> bool:
    """True when harness tool traces show a successful pytest run."""
    for rec in history:
        for item in rec.get("completed_work") or []:
            if item.get("pytest_passed"):
                return True
            for cmd in item.get("shell_ok") or []:
                if "pytest" in str(cmd).lower():
                    return True
    return False


def gate_done_requires_pytest(
    plan: Plan, goal: str, history: list[dict[str, Any]]
) -> Plan:
    """Block status=done when the goal needs tests but no pytest pass was harnessed."""
    if plan.status != "done":
        return plan
    g = (goal or "").lower()
    if "pytest" not in g and "test" not in g:
        return plan
    if history_has_pytest_pass(history):
        return plan
    return Plan(
        status="continue",
        summary=(
            (plan.summary or "review claimed done")
            + " — harness: no pytest pass observed yet"
        ),
        tasks=[
            Task(
                id="t_verify",
                title="verify with pytest",
                instructions=(
                    "If code still wrong, WRITE: the needed files (full contents) "
                    "BEFORE DONE, then RUN: pytest -q. "
                    "FINDINGS must quote SHELL OBSERVATIONS only."
                ),
            )
        ],
    )


def force_first_turn_plan(plan: Plan, *, has_history: bool) -> Plan:
    """If orch claims done before any executor digests, force an inspect task."""
    if has_history:
        return plan
    if plan.status != "done" or plan.tasks:
        return plan
    return Plan(
        status="continue",
        summary=plan.summary or "forced continue: need executor inspection",
        tasks=[
            Task(
                id="t1",
                title="inspect workspace",
                instructions=(
                    "RUN: ls\n"
                    "After SHELL OBSERVATIONS, inspect further with RUN: cat/head "
                    "as needed. Return DONE with FINDINGS answering the user "
                    "goal where possible, and ARTIFACTS for any draft snippets. "
                    "Do not invent file contents."
                ),
            )
        ],
    )


def parse_plan(text: str) -> Plan:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    # Prefer first well-formed plan object (models sometimes emit several).
    blob = _extract_json_blob(raw)
    if not blob:
        return Plan(status="continue", summary=raw[:500], tasks=[])
    try:
        data = json.loads(blob)
    except json.JSONDecodeError:
        return Plan(status="continue", summary=raw[:500], tasks=[])
    if not isinstance(data, dict):
        return Plan(status="continue", summary=raw[:500], tasks=[])
    status = str(data.get("status") or "continue").lower().strip()
    if status not in ("continue", "done"):
        status = "continue"
    summary = str(data.get("summary") or "").strip()
    tasks: list[Task] = []
    for i, item in enumerate(data.get("tasks") or []):
        if not isinstance(item, dict):
            continue
        tid = str(item.get("id") or f"t{i+1}").strip()
        title = str(item.get("title") or tid).strip()
        instructions = str(item.get("instructions") or "").strip()
        if instructions:
            tasks.append(Task(id=tid, title=title, instructions=instructions))
    if status == "done":
        tasks = []
    return Plan(status=status, summary=summary, tasks=tasks)


def _truncate(s: str, n: int = 6000) -> str:
    s = s or ""
    return s if len(s) <= n else s[: n - 20] + "\n…[truncated]"


def _ts() -> str:
    return time.strftime("%H:%M:%S")


def _one_line(s: str, n: int = 160) -> str:
    line = " ".join((s or "").split())
    return line if len(line) <= n else line[: n - 1] + "…"


def build_exec_digest(r: ExecResult) -> dict[str, Any]:
    """Structured handoff for orch review: DONE work, not a proposed plan."""
    base: dict[str, Any] = {
        "task_id": r.task.id,
        "title": r.task.title,
        "worker": r.worker,
        "elapsed_s": round(r.elapsed_s, 2),
    }
    if r.error:
        base["status"] = "FAILED"
        base["error"] = r.error
        if r.output:
            base["partial_output"] = _truncate(r.output, 2000)
        return base

    reasoning = (r.reasoning or "").strip()
    output = usable_reply(r.output or "", reasoning)
    done_m = _DONE_LINE_RE.search(output)
    outcome = done_m.group(1).strip() if done_m else _one_line(output, 200)
    findings_sec = _section(output, _FINDINGS_RE)
    artifacts_sec = _section(output, _ARTIFACTS_RE)
    # Prefer structured FINDINGS; fall back to full reply body.
    if findings_sec:
        findings = _truncate(findings_sec, 6000)
        if artifacts_sec:
            findings = (
                findings
                + "\n\nARTIFACTS:\n"
                + _truncate(artifacts_sec, 3000)
            )
    else:
        findings = _truncate(output, 8000) if output else "(empty executor content)"
    base.update(
        {
            "status": "DONE",
            "label": "COMPLETED WORK — use these findings; do not re-plan this task",
            "outcome": outcome or "(no outcome line)",
            "findings_digest": findings,
            "artifacts_note": (
                "Treat findings_digest as the executor's deliverable "
                "(commands, diffs, analysis). Not a methodology proposal."
            ),
        }
    )
    if artifacts_sec:
        base["artifacts"] = _truncate(artifacts_sec, 4000)
    # Only keep reasoning scratch when we had real answer content already
    # (otherwise reasoning was promoted into findings_digest).
    if reasoning and (r.output or "").strip():
        base["reasoning_scratch"] = _truncate(reasoning, 1200)
    if r.writes_ok:
        base["writes_ok"] = list(r.writes_ok)
    if r.shell_ok:
        base["shell_ok"] = list(r.shell_ok)
    if r.pytest_passed:
        base["pytest_passed"] = True
    base["harness_note"] = (
        "writes_ok / shell_ok / pytest_passed are harness-observed facts. "
        "Ignore model claims that contradict them."
    )
    return base


def format_digest_banner(digest: dict[str, Any]) -> str:
    """Human-readable one-block digest for CLI before review."""
    tid = digest.get("task_id", "?")
    title = digest.get("title", "")
    status = digest.get("status", "?")
    if status == "FAILED":
        return (
            f"  ✗ DONE handoff FAILED · [{tid}] {title}\n"
            f"    error: {digest.get('error')}"
        )
    outcome = digest.get("outcome") or ""
    body = digest.get("findings_digest") or ""
    preview = _truncate(body, 2400)
    lines = [
        f"  ✓ DONE / OUTPUT · [{tid}] {title}",
        f"    outcome: {outcome}",
        "    --- findings ---",
    ]
    for line in preview.splitlines() or ["(empty)"]:
        lines.append(f"    {line}")
    if body and len(body) > 2400:
        lines.append("    …[digest truncated for display; full text sent to orch]")
    return "\n".join(lines)


class ClosedLoop:
    def __init__(
        self,
        llm: LabLlm,
        *,
        orch: str,
        exec_model: str,
        workers: int = 4,
        max_rounds: int = 5,
        cwd: str = ".",
        dry_run: bool = False,
        log: LogFn | None = None,
        cancel: threading.Event | None = None,
    ) -> None:
        self.llm = llm
        self.orch = orch
        self.exec_model = exec_model
        self.workers = max(1, min(16, int(workers)))
        self.max_rounds = max(1, min(20, int(max_rounds)))
        self.cwd = cwd
        self.dry_run = dry_run
        self.log = log or _log_default
        self._print_lock = threading.Lock()
        self._cancel = cancel or threading.Event()
        # Let in-flight HTTP streams observe the same cancel event.
        if hasattr(self.llm, "_cancel"):
            self.llm._cancel = self._cancel

    def request_cancel(self) -> None:
        self._cancel.set()
        if hasattr(self.llm, "_cancel"):
            self.llm._cancel = self._cancel

    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def _check_cancel(self) -> None:
        if self._cancel.is_set():
            raise KeyboardInterrupt

    def _banner(self, title: str) -> None:
        self.log(f"\n══ {title} ══  {_ts()}")

    def _stream_chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        role: str,
        temperature: float,
        wait_label: str,
    ) -> ChatResult:
        """Stream model output with live reasoning + content sections."""
        thinking_open = False
        content_open = False

        def on_reasoning(piece: str) -> None:
            nonlocal thinking_open, content_open
            with self._print_lock:
                if content_open:
                    sys.stdout.write("\n")
                    sys.stdout.flush()
                    content_open = False
                if not thinking_open:
                    sys.stdout.write(f"  [{role} thinking]\n")
                    thinking_open = True
                sys.stdout.write(piece)
                sys.stdout.flush()

        def on_content(piece: str) -> None:
            nonlocal thinking_open, content_open
            with self._print_lock:
                if thinking_open:
                    sys.stdout.write("\n")
                    sys.stdout.flush()
                    thinking_open = False
                if not content_open:
                    sys.stdout.write(f"  [{role}]\n")
                    content_open = True
                sys.stdout.write(piece)
                sys.stdout.flush()

        result = self.llm.chat_result(
            model,
            messages,
            temperature=temperature,
            on_content=on_content,
            on_reasoning=on_reasoning,
            wait_label=wait_label,
        )
        with self._print_lock:
            if thinking_open or content_open:
                sys.stdout.write("\n")
                sys.stdout.flush()
        return result

    def run(self, goal: str) -> int:
        reason = refuse_reason(goal)
        if reason:
            self.log(f"error: {reason}")
            return 2

        self.log(
            f"lab-agents  orch={self.orch}  exec={self.exec_model}  "
            f"workers={self.workers}  max_rounds={self.max_rounds}  cwd={self.cwd}"
        )
        self.log(
            f"started {_ts()} · closed-loop plan → parallel exec → review "
            "(DONE digests → orch)"
        )
        if self.dry_run:
            self.log("dry-run: would plan → parallel exec → review (no API calls)")
            return 0

        history: list[dict[str, Any]] = []
        user_blob = (
            f"Working directory: {self.cwd}\n"
            f"Max parallel workers this round: {self.workers}\n\n"
            f"Goal:\n{goal.strip()}"
        )
        # Review follow-ups run next round as-is (skip re-plan) to avoid
        # orch inventing a fresh duplicate task batch every round.
        pending_followups: list[Task] | None = None

        for round_i in range(1, self.max_rounds + 1):
            self._check_cancel()
            if pending_followups is not None:
                plan = Plan(
                    status="continue",
                    summary="follow-ups from prior review (skip re-plan)",
                    tasks=pending_followups,
                )
                pending_followups = None
                self._banner(f"Round {round_i}/{self.max_rounds} · plan")
                self.log(
                    f"  plan skipped · using {len(plan.tasks)} review follow-up(s)"
                )
                self.log(f"  orch summary: {plan.summary}")
            else:
                self._banner(f"Round {round_i}/{self.max_rounds} · plan")
                self.log(f"  plan started · model={self.orch}")
                plan_msgs = [
                    {"role": "system", "content": ORCH_SYSTEM},
                    {"role": "user", "content": user_blob},
                ]
                if history:
                    plan_msgs.append(
                        {
                            "role": "user",
                            "content": (
                                "Prior rounds — COMPLETED WORK digests (JSON):\n"
                                + _truncate(json.dumps(history, indent=2), 14000)
                                + "\n\nThese digests are finished executor results. "
                                "Do not re-request work already covered. "
                                "Finish (status=done, tasks=[]) or emit only "
                                "gap-filling tasks."
                            ),
                        }
                    )
                t0 = time.monotonic()
                plan_res = self._stream_chat(
                    self.orch,
                    plan_msgs,
                    role="orch/plan",
                    temperature=ORCH_TEMP,
                    wait_label=f"orch plan loading ({self.orch})",
                )
                self._check_cancel()
                plan = parse_plan(
                    usable_reply(plan_res.content, plan_res.reasoning)
                )
                if not history and plan.status == "done" and not plan.tasks:
                    self.log(
                        "  note: orch returned done with no prior digests — "
                        "forcing continue + default inspect task"
                    )
                plan = force_first_turn_plan(plan, has_history=bool(history))
                plan = coerce_empty_continue(plan, goal)
                plan = gate_done_requires_pytest(plan, goal, history)
                # Normalize inspect prose → RUN: lines before exec.
                plan.tasks = [
                    Task(
                        id=t.id,
                        title=t.title,
                        instructions=enrich_task_instructions(t.instructions),
                    )
                    for t in plan.tasks
                ]
                self.log(
                    f"  plan finished · {time.monotonic() - t0:0.1f}s · "
                    f"status={plan.status}"
                )
                if plan.summary:
                    self.log(f"  orch summary: {plan.summary}")
            if plan.status == "done" or not plan.tasks:
                self.log(f"  decision: stop (done) · Round {round_i}/{self.max_rounds}")
                self.log("done.")
                return 0

            batch = plan.tasks[: self.workers]
            # Multi-file edits in parallel often race / skip a WRITE — serialize.
            editish = [
                t
                for t in batch
                if re.search(
                    r"(?i)\bWRITE:|\bfix\b|\bimplement\b|\bedit\b",
                    f"{t.title}\n{t.instructions}",
                )
            ]
            if len(editish) >= 2:
                self.log(
                    "  note: serializing ≥2 edit tasks (multi-file safety)"
                )
                batch = [editish[0]]
            if len(plan.tasks) > self.workers:
                self.log(
                    f"  note: orch proposed {len(plan.tasks)} tasks; "
                    f"running first {self.workers}"
                )
            n = len(batch)
            self._banner(f"Round {round_i}/{self.max_rounds} · exec ({n} workers)")
            self.log(f"  {n} worker(s) started · model={self.exec_model}")
            for i, task in enumerate(batch, start=1):
                self.log(f"  → worker {i}/{n} started · [{task.id}] {task.title}")

            results = self._run_parallel(batch, goal)
            self._check_cancel()
            done_ok = sum(1 for r in results if not r.error)
            self.log(
                f"  exec finished · {done_ok}/{n} ok · "
                f"{sum(r.elapsed_s for r in results):0.1f}s wall-ish"
            )

            digests = [build_exec_digest(r) for r in results]
            self._banner(
                f"Round {round_i}/{self.max_rounds} · handoff (DONE digests)"
            )
            for d in digests:
                self.log(format_digest_banner(d))

            round_rec: dict[str, Any] = {
                "round": round_i,
                "phase": "exec_complete",
                "plan_summary": plan.summary,
                "note": (
                    "Each item with status=DONE is completed executor work. "
                    "Review must consume findings_digest; do not treat as a plan."
                ),
                "completed_work": digests,
            }
            history.append(round_rec)

            self._banner(f"Round {round_i}/{self.max_rounds} · review")
            self.log(f"  review started · model={self.orch}")
            review_msgs = [
                {"role": "system", "content": ORCH_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Goal:\n{goal.strip()}\n\n"
                        f"=== ROUND {round_i} COMPLETED WORK (executor digests) ===\n"
                        "The following JSON is DONE output from executors — "
                        "findings and artifacts already produced, NOT a proposal "
                        "for how to analyze later.\n\n"
                        f"{_truncate(json.dumps(round_rec, indent=2), 16000)}\n\n"
                        "Instructions for this review:\n"
                        "1) Read every findings_digest / artifacts. Summarize what "
                        "was accomplished in summary.\n"
                        "2) Do NOT re-assign analysis/inspection already present.\n"
                        "3) Default to status=done + tasks=[] when digests answer "
                        "the goal (including draft artifacts). Only continue for "
                        "real missing substance or failed verification.\n"
                        "4) Otherwise emit ONLY open-gap follow-up tasks (no "
                        "duplicates of completed work)."
                    ),
                },
            ]
            t1 = time.monotonic()
            review_res = self._stream_chat(
                self.orch,
                review_msgs,
                role="orch/review",
                temperature=ORCH_TEMP,
                wait_label=f"orch review loading ({self.orch})",
            )
            self._check_cancel()
            review = parse_plan(
                usable_reply(review_res.content, review_res.reasoning)
            )
            review = coerce_empty_continue(review, goal)
            gated = gate_done_requires_pytest(review, goal, history)
            if gated is not review and gated.status == "continue":
                self.log(
                    "  note: review done blocked — no harness pytest_passed yet"
                )
            review = gated
            self.log(
                f"  review finished · {time.monotonic() - t1:0.1f}s · "
                f"status={review.status}"
            )
            if review.summary:
                self.log(f"  orch review: {review.summary}")
            if review.status == "done" or not review.tasks:
                self.log(
                    f"  decision: stop (done) · Round {round_i}/{self.max_rounds}"
                )
                self.log("done.")
                return 0
            self.log(
                f"  decision: continue · "
                f"{len(review.tasks)} gap follow-up(s) · "
                f"Round {round_i}/{self.max_rounds}"
            )
            history.append(
                {
                    "round": round_i,
                    "phase": "review_followups",
                    "followups": [
                        {
                            "id": t.id,
                            "title": t.title,
                            "instructions": t.instructions,
                        }
                        for t in review.tasks
                    ],
                }
            )
            pending_followups = [
                Task(
                    id=t.id,
                    title=t.title,
                    instructions=enrich_task_instructions(t.instructions),
                )
                for t in review.tasks[: self.workers]
            ]

        self.log(f"stopped after {self.max_rounds} rounds (max reached).")
        return 0

    def _run_parallel(self, tasks: list[Task], goal: str) -> list[ExecResult]:
        results: list[ExecResult] = []
        n = len(tasks)

        def _one(idx: int, task: Task) -> ExecResult:
            if self._cancel.is_set():
                return ExecResult(
                    task=task,
                    worker=idx,
                    output="",
                    error="cancelled",
                    elapsed_s=0.0,
                )
            t0 = time.monotonic()
            try:
                instructions = enrich_task_instructions(task.instructions)
                msgs: list[dict[str, str]] = [
                    {"role": "system", "content": EXEC_SYSTEM},
                    {
                        "role": "user",
                        "content": (
                            f"Overall goal:\n{goal.strip()}\n\n"
                            f"Working directory: {self.cwd}\n"
                            f"Your subtask id={task.id} title={task.title}\n\n"
                            f"{instructions}\n\n"
                            "If you need more inspection, emit RUN: commands. "
                            "Then return DONE findings/artifacts — not a plan "
                            "for a later agent."
                        ),
                    },
                ]
                preseed = preseed_shell_observations(instructions, self.cwd)
                if preseed:
                    with self._print_lock:
                        self.log(
                            f"  ↳ worker {idx}/{n} preseed shell · [{task.id}]"
                        )
                    msgs.append(
                        {
                            "role": "user",
                            "content": preseed,
                        }
                    )
                role = f"exec w{idx}/{n} {task.id}"
                max_tool_rounds = 4
                final_c = ""
                final_r = ""
                writes_ok: list[str] = []
                shell_ok: list[str] = []
                pytest_passed = False
                for tool_i in range(max_tool_rounds + 1):
                    if self._cancel.is_set():
                        return ExecResult(
                            task=task,
                            worker=idx,
                            output=final_c,
                            reasoning=final_r,
                            error="cancelled",
                            elapsed_s=time.monotonic() - t0,
                        )
                    buf_c: list[str] = []
                    buf_r: list[str] = []
                    thinking_open = False
                    content_open = False

                    def on_reasoning(piece: str) -> None:
                        nonlocal thinking_open, content_open
                        if self._cancel.is_set():
                            return
                        buf_r.append(piece)
                        with self._print_lock:
                            if content_open:
                                sys.stdout.write("\n")
                                content_open = False
                            if not thinking_open:
                                sys.stdout.write(f"  [{role} thinking]\n")
                                thinking_open = True
                            sys.stdout.write(piece)
                            sys.stdout.flush()

                    def on_content(piece: str) -> None:
                        nonlocal thinking_open, content_open
                        if self._cancel.is_set():
                            return
                        buf_c.append(piece)
                        with self._print_lock:
                            if thinking_open:
                                sys.stdout.write("\n")
                                thinking_open = False
                            if not content_open:
                                sys.stdout.write(f"  [{role}]\n")
                                content_open = True
                            sys.stdout.write(piece)
                            sys.stdout.flush()

                    self.llm.chat_result(
                        self.exec_model,
                        msgs,
                        temperature=EXEC_TEMP,
                        on_content=on_content,
                        on_reasoning=on_reasoning,
                        wait_label=None,
                        show_spinner=False,
                    )
                    with self._print_lock:
                        if thinking_open or content_open:
                            sys.stdout.write("\n")
                            sys.stdout.flush()
                    raw_c = "".join(buf_c).strip()
                    raw_r = "".join(buf_r).strip()
                    reply = usable_reply(raw_c, raw_r) if not raw_c else raw_c
                    final_c, final_r = reply, (raw_r if raw_c else "")
                    writes = extract_writes(reply)
                    cmds = extract_run_commands(reply)
                    # Skip re-running commands we already preseeded.
                    if preseed and tool_i == 0:
                        already = set(extract_run_commands(instructions))
                        cmds = [c for c in cmds if c not in already]
                    has_done = bool(
                        re.search(
                            r"(?im)^\s*(?:DONE|COMPLETED(?:\s+WORK)?)\s*[-—:]",
                            reply,
                        )
                    )
                    # Nudge once if WRITE/RUN only appear after DONE (common miss).
                    if (
                        has_done
                        and not writes
                        and not cmds
                        and tool_i < max_tool_rounds
                        and (
                            re.search(r"(?im)^\s*WRITE:\s*\S+", reply)
                            or re.search(r"(?im)^\s*RUN:\s*\S+", reply)
                        )
                    ):
                        with self._print_lock:
                            self.log(
                                f"  ↳ worker {idx}/{n} nudge · [{task.id}] "
                                "tools after DONE — reorder"
                            )
                        msgs.append({"role": "assistant", "content": reply})
                        msgs.append(
                            {
                                "role": "user",
                                "content": (
                                    "Harness note: RUN:/WRITE: must appear "
                                    "BEFORE the DONE line or they are ignored. "
                                    "Re-emit WRITE/RUN first, apply edits, RUN "
                                    "pytest if needed, then DONE."
                                ),
                            }
                        )
                        continue
                    # Nudge: models sometimes write "RUN: WRITE: path" (invalid).
                    if (
                        not writes
                        and tool_i < max_tool_rounds
                        and re.search(r"(?im)^\s*RUN:\s*WRITE:\s*\S+", reply)
                    ):
                        with self._print_lock:
                            self.log(
                                f"  ↳ worker {idx}/{n} nudge · [{task.id}] "
                                "RUN:WRITE malformed"
                            )
                        msgs.append({"role": "assistant", "content": reply})
                        msgs.append(
                            {
                                "role": "user",
                                "content": (
                                    "Harness note: WRITE is not a shell command. "
                                    "Emit:\nWRITE: relative/path.py\n---\n"
                                    "full file\n---\n"
                                    "Then optionally RUN: pytest -q\n"
                                    "Then DONE. Do not write RUN: WRITE:."
                                ),
                            }
                        )
                        continue
                    if writes or cmds:
                        if tool_i >= max_tool_rounds:
                            break
                        obs_parts: list[str] = []
                        if writes:
                            with self._print_lock:
                                self.log(
                                    f"  ↳ worker {idx}/{n} write · [{task.id}] "
                                    f"{len(writes)} file(s)"
                                )
                            wres = apply_writes(writes, cwd=self.cwd)
                            for wr in wres:
                                with self._print_lock:
                                    flag = "ok" if wr.ok else "fail"
                                    self.log(
                                        f"    WRITE {wr.path} → {flag}"
                                        + (f" ({wr.error})" if wr.error else "")
                                    )
                                if wr.ok:
                                    writes_ok.append(wr.path)
                            obs_parts.append(format_write_observations(wres))
                        if cmds:
                            with self._print_lock:
                                self.log(
                                    f"  ↳ worker {idx}/{n} shell · [{task.id}] "
                                    f"{len(cmds)} command(s)"
                                )
                            results_sh = [
                                run_shell(c, cwd=self.cwd) for c in cmds[:6]
                            ]
                            for rs in results_sh:
                                with self._print_lock:
                                    flag = "ok" if rs.ok else "fail"
                                    self.log(
                                        f"    $ {rs.command} → {flag}"
                                        + (f" ({rs.error})" if rs.error else "")
                                    )
                                    # Surface pytest summary in the log (eval metrics).
                                    out_line = " ".join(
                                        (rs.output or "").split()
                                    )
                                    if out_line and (
                                        "pytest" in rs.command
                                        or "passed" in out_line
                                        or "failed" in out_line
                                    ):
                                        self.log(
                                            f"      out: {_one_line(out_line, 200)}"
                                        )
                                if rs.ok:
                                    shell_ok.append(rs.command)
                                    if "pytest" in rs.command.lower():
                                        pytest_passed = True
                            obs_parts.append(format_observations(results_sh))
                        msgs.append({"role": "assistant", "content": reply})
                        msgs.append(
                            {"role": "user", "content": "\n\n".join(obs_parts)}
                        )
                        continue
                    # No pending tools — stop on DONE or empty tool turn.
                    if has_done or tool_i >= max_tool_rounds:
                        break
                    break

                with self._print_lock:
                    self.log(
                        f"  ✓ worker {idx}/{n} stream done · [{task.id}] "
                        f"({time.monotonic() - t0:0.1f}s)"
                    )
                return ExecResult(
                    task=task,
                    worker=idx,
                    output=final_c,
                    reasoning=final_r,
                    elapsed_s=time.monotonic() - t0,
                    writes_ok=writes_ok,
                    shell_ok=shell_ok,
                    pytest_passed=pytest_passed,
                )
            except Exception as e:  # noqa: BLE001 — surface per-worker errors
                with self._print_lock:
                    self.log(f"  ✗ worker {idx}/{n} error · [{task.id}]: {e}")
                return ExecResult(
                    task=task,
                    worker=idx,
                    output="",
                    error=str(e),
                    elapsed_s=time.monotonic() - t0,
                )

        with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
            futs = {
                pool.submit(_one, i + 1, t): t for i, t in enumerate(tasks)
            }
            stop_hb = threading.Event()

            def _heartbeat() -> None:
                while not stop_hb.wait(15.0):
                    if self._cancel.is_set():
                        return
                    pending = sum(1 for f in futs if not f.done())
                    if pending:
                        with self._print_lock:
                            self.log(
                                f"  … {_ts()} still running · "
                                f"{pending}/{n} worker(s) in flight"
                            )

            hb = threading.Thread(target=_heartbeat, daemon=True)
            hb.start()
            try:
                for fut in as_completed(futs):
                    if self._cancel.is_set():
                        for f in futs:
                            f.cancel()
                        break
                    results.append(fut.result())
            finally:
                stop_hb.set()
                hb.join(timeout=1.0)
        by_id = {r.task.id: r for r in results}
        return [by_id[t.id] for t in tasks if t.id in by_id]
