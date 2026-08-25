"""Punch FIM holes in source trees for synthetic Tab completion data."""

from __future__ import annotations

import hashlib
import random
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator, Optional, Sequence

# Extensions we treat as code completion fodder.
DEFAULT_EXTS: frozenset[str] = frozenset({
        ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".kt",
        ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".swift", ".scala",
        ".sh", ".bash", ".zsh", ".sql", ".svelte", ".vue",
})

DEFAULT_SKIP_DIRS: frozenset[str] = frozenset({
        ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
        "dist", "build", ".next", ".turbo", "target", "vendor", ".tox",
        ".mypy_cache", ".pytest_cache", "coverage", "htmlcov",
        "upstream",  # open-webui vendored tree is huge / noisy for Tab
})

_MAX_FILE_BYTES = 200_000
_MIN_FILE_LINES = 8
_MIN_MIDDLE_CHARS = 8
_MAX_MIDDLE_CHARS = 400
_MAX_PREFIX_CHARS = 6000
_MAX_SUFFIX_CHARS = 3000


@dataclass(frozen=True)
class FimHole:
    """One FIM span punched from a source file."""

    id: str
    path: str
    language: str
    prefix: str
    suffix: str
    middle: str
    strategy: str
    source: str = "synth_repo"

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


def _lang_for(path: Path) -> str:
    ext = path.suffix.lower()
    return {
            ".py": "python",
            ".ts": "typescript",
            ".tsx": "typescript",
            ".js": "javascript",
            ".jsx": "javascript",
            ".go": "go",
            ".rs": "rust",
            ".java": "java",
            ".kt": "kotlin",
            ".c": "c",
            ".h": "c",
            ".cc": "cpp",
            ".cpp": "cpp",
            ".hpp": "cpp",
            ".cs": "csharp",
            ".rb": "ruby",
            ".swift": "swift",
            ".scala": "scala",
            ".sh": "shell",
            ".bash": "shell",
            ".zsh": "shell",
            ".sql": "sql",
            ".svelte": "svelte",
            ".vue": "vue",
    }.get(ext, ext.lstrip(".") or "text")


def iter_source_files(
        roots: Sequence[Path],
        *,
        exts: Optional[frozenset[str]] = None,
        skip_dirs: Optional[frozenset[str]] = None,
) -> Iterator[Path]:
    allow = exts or DEFAULT_EXTS
    skip = skip_dirs or DEFAULT_SKIP_DIRS
    for root in roots:
        root = root.resolve()
        if root.is_file():
            if root.suffix.lower() in allow:
                yield root
            continue
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part in skip for part in path.parts):
                continue
            if path.suffix.lower() not in allow:
                continue
            try:
                if path.stat().st_size > _MAX_FILE_BYTES:
                    continue
            except OSError:
                continue
            yield path


def _stable_id(rel: str, start: int, end: int, middle: str) -> str:
    h = hashlib.sha256(f"{rel}:{start}:{end}:{middle}".encode()).hexdigest()[:16]
    return f"synth-{h}"


def _hole_line_span(lines: list[str], rng: random.Random) -> Optional[tuple[int, int]]:
    """Pick a contiguous interior line span as the middle."""
    n = len(lines)
    if n < _MIN_FILE_LINES:
        return None
    # Keep at least 2 lines of prefix and 1 of suffix context.
    max_start = n - 3
    if max_start < 2:
        return None
    start = rng.randint(2, max_start)
    max_span = min(8, n - start - 1)
    if max_span < 1:
        return None
    span = rng.randint(1, max_span)
    end = start + span
    return start, end


def _hole_after_signature(lines: list[str], rng: random.Random) -> Optional[tuple[int, int]]:
    """Prefer middles that start right after a def/function/fn signature."""
    sig = re.compile(
            r"^\s*(def |async def |function |export function |fn |func |"
            r"public |private |protected ).*[\{\(:]\s*$"
    )
    candidates: list[int] = []
    for i, line in enumerate(lines[:-2]):
        if sig.match(line):
            candidates.append(i + 1)
    if not candidates:
        return None
    start = rng.choice(candidates)
    end = min(start + rng.randint(1, 4), len(lines) - 1)
    if end <= start:
        return None
    return start, end


def _build_hole_from_lines(
        lines: list[str],
        start: int,
        end: int,
        *,
        rel: str,
        language: str,
        strategy: str,
) -> Optional[FimHole]:
    middle = "".join(lines[start:end])
    # Drop trailing newline from middle so completions match Tab style.
    if middle.endswith("\n"):
        middle = middle[:-1]
    if len(middle) < _MIN_MIDDLE_CHARS or len(middle) > _MAX_MIDDLE_CHARS:
        return None
    if not middle.strip():
        return None
    prefix = "".join(lines[:start])[-_MAX_PREFIX_CHARS:]
    suffix = "".join(lines[end:])[:_MAX_SUFFIX_CHARS]
    if not prefix.strip():
        return None
    return FimHole(
            id=_stable_id(rel, start, end, middle),
            path=rel,
            language=language,
            prefix=prefix,
            suffix=suffix,
            middle=middle,
            strategy=strategy,
    )


def _build_hole_partial_line(
        lines: list[str],
        line_idx: int,
        col0: int,
        col1: int,
        *,
        rel: str,
        language: str,
) -> Optional[FimHole]:
    line = lines[line_idx]
    middle = line[col0:col1]
    if len(middle) < _MIN_MIDDLE_CHARS or not middle.strip():
        return None
    prefix = "".join(lines[:line_idx]) + line[:col0]
    prefix = prefix[-_MAX_PREFIX_CHARS:]
    suffix = line[col1:] + "".join(lines[line_idx + 1 :])
    suffix = suffix[:_MAX_SUFFIX_CHARS]
    return FimHole(
            id=_stable_id(rel, line_idx, col0, middle),
            path=rel,
            language=language,
            prefix=prefix,
            suffix=suffix,
            middle=middle,
            strategy="assignment_rhs",
    )


def punch_file(
        path: Path,
        *,
        root: Path,
        rng: random.Random,
        holes_per_file: int = 2,
) -> list[FimHole]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    if "\x00" in text:
        return []
    lines = text.splitlines(keepends=True)
    if len(lines) < _MIN_FILE_LINES:
        return []
    try:
        rel = str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        rel = str(path)
    language = _lang_for(path)
    out: list[FimHole] = []
    strategies = (
            ("after_signature", _hole_after_signature),
            ("line_span", _hole_line_span),
    )
    attempts = max(holes_per_file * 4, 4)
    seen: set[str] = set()
    for _ in range(attempts):
        if len(out) >= holes_per_file:
            break
        # ~25% assignment RHS when possible.
        if rng.random() < 0.25:
            pat = re.compile(
                    r"^(\s*(?:return |(?:const|let|var|val) \w+\s*=\s*|[^=]+=\s*))(.+)$"
            )
            cands: list[tuple[int, int, int]] = []
            for i, line in enumerate(lines):
                m = pat.match(line.rstrip("\n"))
                if not m:
                    continue
                left, right = m.group(1), m.group(2).rstrip()
                if _MIN_MIDDLE_CHARS <= len(right) <= _MAX_MIDDLE_CHARS:
                    cands.append((i, len(left), len(left) + len(right)))
            if cands:
                i, c0, c1 = rng.choice(cands)
                hole = _build_hole_partial_line(
                        lines, i, c0, c1, rel=rel, language=language,
                )
                if hole and hole.id not in seen:
                    seen.add(hole.id)
                    out.append(hole)
                continue
        name, fn = rng.choice(strategies)
        span = fn(lines, rng)
        if not span:
            continue
        start, end = span
        hole = _build_hole_from_lines(
                lines, start, end, rel=rel, language=language, strategy=name,
        )
        if hole and hole.id not in seen:
            seen.add(hole.id)
            out.append(hole)
    return out


def generate_holes(
        roots: Sequence[Path],
        *,
        max_holes: int = 5000,
        holes_per_file: int = 2,
        seed: int = 7,
        exts: Optional[frozenset[str]] = None,
        skip_dirs: Optional[frozenset[str]] = None,
) -> list[FimHole]:
    rng = random.Random(seed)
    files = list(iter_source_files(roots, exts=exts, skip_dirs=skip_dirs))
    rng.shuffle(files)
    holes: list[FimHole] = []
    for path in files:
        # Choose nearest root for relative paths.
        root = roots[0]
        for r in roots:
            try:
                path.resolve().relative_to(r.resolve())
                root = r
                break
            except ValueError:
                continue
        for hole in punch_file(
                path, root=root, rng=rng, holes_per_file=holes_per_file,
        ):
            holes.append(hole)
            if len(holes) >= max_holes:
                return holes
    return holes
