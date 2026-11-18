"""CLI entry: spockify-lab-agents."""

from __future__ import annotations

import argparse
import os
import signal
import sys
import threading
from pathlib import Path

from . import __version__
from .llm import (
    DEFAULT_EXEC,
    DEFAULT_ORCH,
    LabLlm,
    LabLlmError,
    resolve_api_key,
    resolve_base_url,
)
from .loop import ClosedLoop
from .policy import refuse_reason


LAB_ALIASES = (
    "lab-orchestrator",
    "lab-executor",
    "lab-plan",
    "lab-code",
)

# Soft peach accent (matches Spockify CLI).
_ACCENT = "\033[38;5;216m"
_DIM = "\033[2m"
_CYAN = "\033[36m"
_MAGENTA = "\033[35m"
_RESET = "\033[0m"
_BOLD = "\033[1m"
_BORDER = "\033[38;5;240m"


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="spockify-lab-agents",
        description=(
            "Lab-twin closed-loop coding harness "
            "(orchestrator + parallel executors). Benign coding only. "
            "No task → interactive lab-mode REPL."
        ),
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    p.add_argument(
        "task",
        nargs="?",
        default=None,
        help='Coding goal, subcommand "models", or omit for interactive lab mode',
    )
    p.add_argument(
        "--orch",
        default=os.environ.get("SPOCKIFY_LAB_ORCH", DEFAULT_ORCH),
        help=f"Orchestrator/planner model id (default: {DEFAULT_ORCH})",
    )
    p.add_argument(
        "--exec",
        dest="exec_model",
        default=os.environ.get("SPOCKIFY_LAB_EXEC", DEFAULT_EXEC),
        help=f"Executor/implementer model id (default: {DEFAULT_EXEC})",
    )
    p.add_argument(
        "--workers",
        type=int,
        default=int(os.environ.get("SPOCKIFY_LAB_WORKERS", "4")),
        help="Max parallel executor workers per round (default: 4)",
    )
    p.add_argument(
        "--max-rounds",
        "--rounds",
        dest="max_rounds",
        type=int,
        default=int(os.environ.get("SPOCKIFY_LAB_MAX_ROUNDS", "5")),
        help="Max plan→exec→review rounds (default: 5); --rounds is an alias",
    )
    p.add_argument(
        "--cwd",
        default=os.getcwd(),
        help="Working directory context passed to models",
    )
    p.add_argument(
        "--base-url",
        default=None,
        help="OpenAI-compatible base (default: twin LiteLLM NodePort)",
    )
    p.add_argument(
        "--api-key",
        default=None,
        help="API key (or LITELLM_MASTER_KEY / SPOCKIFY_API_KEY)",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=float(os.environ.get("SPOCKIFY_LAB_TIMEOUT", "300")),
        help="HTTP timeout seconds (default: 300)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate args / refuse policy; no model calls",
    )
    return p


def _print_models(llm: LabLlm | None, orch: str, exec_model: str) -> int:
    print("spockify-lab-agents · dual-role mapping")
    print(f"  orchestrator (--orch): {orch}")
    print(f"  executor     (--exec): {exec_model}")
    print()
    print("Remap LiteLLM backends on the twin:")
    print("  ~/agentHub/scripts/lab-set-dual-roles.sh ORCH=<tag> EXEC=<tag>")
    print("  ~/agentHub/scripts/lab-set-dual-roles.sh   # show current")
    print()
    for cand in (
        Path.home() / "agentHub/scripts/lab-set-dual-roles.sh",
        Path(__file__).resolve().parents[3] / "scripts/lab-set-dual-roles.sh",
    ):
        if cand.is_file():
            print(f"script: {cand}")
            break
    if llm is None:
        print("\n(live /v1/models skipped — no API key or --dry-run)")
        return 0
    try:
        ids = llm.list_models()
    except LabLlmError as e:
        print(f"\nwarning: could not list models: {e}", file=sys.stderr)
        return 1
    print(f"\nlive catalog ({len(ids)} models) — lab aliases:")
    for a in LAB_ALIASES:
        mark = "●" if a in ids else "○"
        print(f"  {mark} {a}")
    extras = [i for i in ids if i.startswith("lab-") and i not in LAB_ALIASES]
    for e in extras:
        print(f"  ● {e}")
    missing = [a for a in LAB_ALIASES if a not in ids]
    if missing:
        print(
            "\nmissing on this endpoint: "
            + ", ".join(missing)
            + "\n  → run lab-wire-benign-models.sh / lab-set-dual-roles.sh on twin"
        )
    return 0


def _short_path(p: str, max_len: int = 36) -> str:
    home = str(Path.home())
    s = f"~{p[len(home):]}" if p.startswith(home) else p
    if len(s) <= max_len:
        return s
    parts = [x for x in s.replace("\\", "/").split("/") if x]
    if len(parts) >= 2:
        return f"…/{parts[-2]}/{parts[-1]}"
    return f"…{s[-(max_len - 1):]}"


def _print_banner(cwd: str) -> None:
    cols = 80
    try:
        cols = os.get_terminal_size().columns
    except OSError:
        pass
    word = "SPOCKIFY"
    artwork = [
        "███████╗██████╗  ██████╗  ██████╗██╗  ██╗██╗███████╗██╗   ██╗",
        "██╔════╝██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██║██╔════╝╚██╗ ██╔╝",
        "███████╗██████╔╝██║   ██║██║     █████╔╝ ██║█████╗   ╚████╔╝",
        "╚════██║██╔═══╝ ██║   ██║██║     ██╔═██╗ ██║██╔══╝    ╚██╔╝",
        "███████║██║     ╚██████╔╝╚██████╗██║  ██╗██║██║        ██║",
        "╚══════╝╚═╝      ╚═════╝  ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝",
    ]
    max_len = max(len(l) for l in artwork)
    print()
    if cols < max_len:
        pad = max(0, (cols - len(word)) // 2)
        print(f"{' ' * pad}{_ACCENT}{_BOLD}{word}{_RESET}")
    else:
        pad = max(0, (cols - max_len) // 2)
        for line in artwork:
            print(f"{' ' * pad}{_ACCENT}{line}{_RESET}")
    print(
        f"  {_DIM}coding agent{_RESET}  ·  {_MAGENTA}lab{_RESET}"
        f"  ·  {_DIM}{_short_path(cwd, max(20, cols - 28))}{_RESET}"
    )
    print(
        f"  {_DIM}/help · /rounds · /orch · /exec · /models · Ctrl+C to quit{_RESET}"
    )
    print()
    print(
        f"  {_DIM}Tip: /help explains the loop · /rounds picks max "
        f"plan→exec→review rounds{_RESET}"
    )
    print()


def _read_prompt(orch: str, exec_model: str, *, max_rounds: int, workers: int) -> str:
    """Prompt close to Spockify CLI; full boxed raw mode is in Node `spockify lab`."""
    status = (
        f"  {_CYAN}{orch}{_RESET}{_DIM} → {_RESET}{_CYAN}{exec_model}{_RESET}"
        f"{_DIM} · {_RESET}{_MAGENTA}lab{_RESET}"
        f"{_DIM} · rounds {max_rounds} · ×{workers}{_RESET}"
    )
    hints = f"  {_DIM}/help · /rounds · /orch · /exec · /models{_RESET}"
    print(status)
    print(hints)
    return input(f"{_BORDER}│{_RESET} {_ACCENT}❯{_RESET} ").strip()


_ROUND_PRESETS = (1, 3, 5, 8, 10, 15, 20)


def _pick_rounds(current: int) -> int:
    """Numbered-by-value selector for max rounds (1–20)."""
    print(f"\n  {_BOLD}Max rounds{_RESET} {_DIM}(plan → exec → review){_RESET}")
    presets = list(_ROUND_PRESETS)
    if current not in presets:
        presets = [current, *presets]
    hints = {
        1: "single pass",
        3: "short loop",
        5: "default",
        8: "deeper",
        10: "long",
        15: "thorough",
        20: "max",
    }
    for n in presets:
        mark = f" {_ACCENT}●{_RESET}" if n == current else ""
        hint = hints.get(n, "current" if n == current else "")
        suffix = f"{_DIM} — {hint}{_RESET}" if hint else ""
        print(f"  {n}){mark}{suffix}")
    print(f"  {_DIM}type a number 1–20 · enter keeps {current}{_RESET}")
    try:
        raw = input(f"{_ACCENT}❯{_RESET} ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return current
    if not raw:
        return current
    try:
        n = int(raw)
    except ValueError:
        print("usage: /rounds <1-20>")
        return current
    if 1 <= n <= 20:
        return n
    print("usage: /rounds <1-20>")
    return current


def _print_repl_help() -> None:
    print(
        f"""
  {_BOLD}Lab mode{_RESET}
  Each prompt runs a closed loop: orch plans → parallel exec workers
  implement → orch reviews → continue or stop. Repeats up to max rounds.

  {_BOLD}Rounds{_RESET}
  One round = plan + exec batch + DONE digests + review. Max rounds caps
  how many loops run before the harness stops (orch can stop earlier if done).
  Set with /rounds, --max-rounds / --rounds, or SPOCKIFY_LAB_MAX_ROUNDS.

  {_BOLD}Roles{_RESET}
  orch     — planner + reviewer (lab-orchestrator)
  exec     — implementer model used by each worker (lab-executor)
  workers  — max parallel exec tasks per round (×N in status)

  {_BOLD}Progress{_RESET}
  Live round banners (Round k/N · plan|exec|handoff|review), streamed
  orch/exec, DONE/OUTPUT digests after exec, plus continue/stop.

  {_BOLD}Keys{_RESET}
  Ctrl+C exits immediately (cancels an in-flight harness).

  {_BOLD}Commands{_RESET}
  /help              Show this help
  /rounds [n]        Pick or set max rounds (1–20)
  /workers [n]       Show or set parallel workers
  /orch [id]         Show or set orchestrator
  /exec [id]         Show or set executor
  /model             Same as /status (orch + exec)
  /status            Session details
  /models            Dual-role mapping + live lab aliases
  /clear             Reset turn counter
  /exit  /quit       Leave lab mode (or Ctrl+C)

  Any other line is a coding goal for the harness.
  Prefer shell for inspection — executors should not invent throwaway .py for ls/rg.
""".rstrip()
    )


def _run_repl(
    *,
    orch: str,
    exec_model: str,
    workers: int,
    max_rounds: int,
    cwd: str,
    base: str,
    api_key: str | None,
    dry_run: bool,
    timeout: float,
) -> int:
    """Interactive lab mode: one closed-loop harness run per user prompt."""
    cwd = str(Path(cwd).resolve())
    turns = 0
    cancel = threading.Event()
    active_loop: list[ClosedLoop | None] = [None]

    def _on_sigint(_signum: int, _frame: object) -> None:
        cancel.set()
        loop = active_loop[0]
        if loop is not None:
            loop.request_cancel()
        # Raise so input()/HTTP aborts; outer handlers exit the process.
        raise KeyboardInterrupt

    prev = signal.signal(signal.SIGINT, _on_sigint)

    _print_banner(cwd)
    print(
        f"  {_DIM}orch={orch}  exec={exec_model}  "
        f"workers={workers}  max_rounds={max_rounds}"
        f"{'  dry-run' if dry_run else ''}{_RESET}"
    )
    print(f"  {_DIM}endpoint={base}{_RESET}")
    print()

    llm: LabLlm | None = None
    if not dry_run and api_key:
        llm = LabLlm(base, api_key, timeout=timeout, cancel=cancel)
    elif not dry_run and not api_key:
        print(
            "warning: no API key yet — set LITELLM_MASTER_KEY or --api-key "
            "before sending a task",
            file=sys.stderr,
        )

    def make_loop() -> ClosedLoop:
        nonlocal llm
        key = api_key
        if not dry_run:
            key = resolve_api_key(api_key)
            if not key:
                raise LabLlmError(
                    "need LITELLM_MASTER_KEY / SPOCKIFY_API_KEY / --api-key"
                )
            if llm is None or llm.api_key != key:
                llm = LabLlm(base, key, timeout=timeout, cancel=cancel)
            else:
                llm._cancel = cancel
        assert llm is not None or dry_run
        return ClosedLoop(
            llm or LabLlm(base, "dry-run", timeout=timeout, cancel=cancel),
            orch=orch,
            exec_model=exec_model,
            workers=workers,
            max_rounds=max_rounds,
            cwd=cwd,
            dry_run=dry_run,
            cancel=cancel,
        )

    exit_code = 0
    try:
        while True:
            if cancel.is_set():
                exit_code = 130
                break
            try:
                line = _read_prompt(
                    orch, exec_model, max_rounds=max_rounds, workers=workers
                )
            except EOFError:
                print()
                break
            except KeyboardInterrupt:
                print("\ninterrupted", file=sys.stderr)
                exit_code = 130
                break

            if not line:
                continue
            if line in ("/exit", "/quit", "exit", "quit"):
                break
            if line in ("/help", "help", "?"):
                _print_repl_help()
                continue
            if line.startswith("/orch"):
                arg = line[len("/orch") :].strip()
                if arg:
                    orch = arg
                    print(f"orch → {orch}")
                else:
                    print(f"orch = {orch}")
                continue
            if line.startswith("/exec"):
                arg = line[len("/exec") :].strip()
                if arg:
                    exec_model = arg
                    print(f"exec → {exec_model}")
                else:
                    print(f"exec = {exec_model}")
                continue
            if line.startswith("/workers"):
                arg = line[len("/workers") :].strip()
                if arg:
                    try:
                        workers = max(1, min(16, int(arg)))
                    except ValueError:
                        print("usage: /workers <1-16>")
                        continue
                    print(f"workers → {workers}")
                else:
                    print(f"workers = {workers}")
                continue
            if line.startswith("/rounds"):
                arg = line[len("/rounds") :].strip()
                if arg:
                    try:
                        max_rounds = max(1, min(20, int(arg)))
                    except ValueError:
                        print("usage: /rounds <1-20>  (or bare /rounds for selector)")
                        continue
                    print(f"max rounds → {max_rounds}")
                else:
                    max_rounds = _pick_rounds(max_rounds)
                    print(f"max rounds → {max_rounds}")
                continue
            if line in ("/status", "/model"):
                print(f"lab mode — orch={orch}  exec={exec_model}")
                print(
                    f"  workers={workers}  max_rounds={max_rounds}  "
                    f"turns={turns}  cwd={cwd}"
                )
                print(f"  endpoint={base}")
                continue
            if line in ("/models", "/model ls", "/model list"):
                live = llm if (llm and not dry_run) else None
                if live is None and api_key and not dry_run:
                    live = LabLlm(base, api_key, timeout=timeout)
                    llm = live
                _print_models(live, orch, exec_model)
                continue
            if line == "/clear":
                turns = 0
                print("turn counter cleared (each task is still an independent run).")
                continue
            if line.startswith("/"):
                print(f"unknown command {line.split()[0]!r} — try /help")
                continue

            reason = refuse_reason(line)
            if reason:
                print(f"error: {reason}", file=sys.stderr)
                continue

            cancel.clear()
            try:
                loop = make_loop()
                active_loop[0] = loop
                code = loop.run(line)
                turns += 1
                if code not in (0, None):
                    print(f"(exit {code})", file=sys.stderr)
            except LabLlmError as e:
                print(f"error: {e}", file=sys.stderr)
            except KeyboardInterrupt:
                cancel.set()
                if active_loop[0] is not None:
                    active_loop[0].request_cancel()
                print("\ninterrupted", file=sys.stderr)
                exit_code = 130
                break
            finally:
                active_loop[0] = None
    finally:
        signal.signal(signal.SIGINT, prev)

    print(f"\n  {_DIM}bye · lab{_RESET}\n")
    return exit_code


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    task = (args.task or "").strip()

    if task.lower() in ("models", "model", "ls", "list"):
        base = resolve_base_url(args.base_url)
        key = resolve_api_key(args.api_key)
        llm = None
        if key and not args.dry_run:
            llm = LabLlm(base, key, timeout=args.timeout)
        elif not args.dry_run and not key:
            print(
                "note: no API key; showing static mapping only "
                "(set LITELLM_MASTER_KEY)",
                file=sys.stderr,
            )
        return _print_models(llm, args.orch, args.exec_model)

    if task.lower() in ("help", "-h", "--help"):
        _build_parser().print_help()
        return 0

    base = resolve_base_url(args.base_url)
    key = resolve_api_key(args.api_key)

    # No task → interactive lab-mode REPL (not a dead "models" dump).
    if not task:
        return _run_repl(
            orch=args.orch,
            exec_model=args.exec_model,
            workers=args.workers,
            max_rounds=args.max_rounds,
            cwd=args.cwd,
            base=base,
            api_key=key or None,
            dry_run=args.dry_run,
            timeout=args.timeout,
        )

    reason = refuse_reason(task)
    if reason:
        print(f"error: {reason}", file=sys.stderr)
        return 2

    if not args.dry_run and not key:
        print(
            "error: need LITELLM_MASTER_KEY / SPOCKIFY_API_KEY / --api-key",
            file=sys.stderr,
        )
        return 1

    cancel = threading.Event()

    def _on_sigint(_signum: int, _frame: object) -> None:
        cancel.set()
        raise KeyboardInterrupt

    prev = signal.signal(signal.SIGINT, _on_sigint)
    llm = LabLlm(base, key or "dry-run", timeout=args.timeout, cancel=cancel)
    loop = ClosedLoop(
        llm,
        orch=args.orch,
        exec_model=args.exec_model,
        workers=args.workers,
        max_rounds=args.max_rounds,
        cwd=str(Path(args.cwd).resolve()),
        dry_run=args.dry_run,
        cancel=cancel,
    )
    try:
        return loop.run(task)
    except LabLlmError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        cancel.set()
        loop.request_cancel()
        print("\ninterrupted", file=sys.stderr)
        return 130
    finally:
        signal.signal(signal.SIGINT, prev)


if __name__ == "__main__":
    raise SystemExit(main())
