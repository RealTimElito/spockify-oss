#!/usr/bin/env python3
"""Pick one Hugging Face GGUF quant and list every shard.

Ollama 0.34.0 has no Hugging Face downloader (the v0.34.0 tree never
mentions hf.co). Split GGUF is merged in server/create.go when every
llama.cpp shard (*-00001-of-0000N.gguf) is present. `ollama create` on a
directory globs *.gguf; FROM the first shard file alone does not.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import sys
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

_SHARD_NAME = re.compile(
    r"^(?P<prefix>.+)-(?P<idx>\d{5})-of-(?P<count>\d{5})\.gguf$"
)
_MODEL_TOKEN = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")
_HOSTS = ("hf.co/", "huggingface.co/")


class NotHuggingFaceError(Exception):
    """Tag is an Ollama library name, not a Hugging Face repo."""


class PlanError(Exception):
    """The tag or listing cannot be turned into one quant."""


@dataclass
class Shard:
    index: int
    size: int
    relpath: str
    name: str
    url: str


@dataclass
class Plan:
    repo: str
    quant: str
    reason: str
    ollama_tag: str
    model_name: str
    rel: str
    host_dir: str
    from_dir: str
    modelfile: str
    shards: tuple[Shard, ...]
    total_bytes: int


@dataclass
class _Group:
    directory: str
    prefix: str
    count: int
    kind: str
    quant_id: str = ""
    files: dict[int, tuple[str, int, str]] = field(default_factory=dict)
    duplicate: bool = False

    def add(self, index: int, relpath: str, size: int, name: str) -> None:
        if index in self.files:
            self.duplicate = True
            return
        self.files[index] = (relpath, size, name)

    def complete(self) -> bool:
        if self.duplicate or self.count < 1:
            return False
        return set(self.files) == set(range(1, self.count + 1))

    def total_bytes(self) -> int:
        return sum(item[1] for item in self.files.values())


def parse_hf_tag(tag: str) -> tuple[str, str | None]:
    """Return (org/repo, quant or None). Raise if the tag is not Hugging Face."""
    raw = tag.strip()
    if not raw:
        raise NotHuggingFaceError(tag)
    if re.search(r":cloud\b", raw, re.IGNORECASE):
        raise PlanError("refusing :cloud tags; models stay on this machine")

    text = re.sub(r"^https?://", "", raw, count=1, flags=re.IGNORECASE)
    text = re.sub(r"^www\.", "", text, count=1, flags=re.IGNORECASE)
    lower = text.lower()
    host = next((item for item in _HOSTS if lower.startswith(item)), None)
    if host is None:
        raise NotHuggingFaceError(tag)
    text = text[len(host) :]
    text = text.split("?", 1)[0].split("#", 1)[0].strip("/")
    text = re.sub(r"/(?:tree|blob|resolve)/[^/]+/?", "/", text)

    quant: str | None = None
    if ":" in text:
        text, quant = text.split(":", 1)
        if quant is None or quant == "" or "/" in quant:
            raise PlanError(
                "quant must be one token after ':', for example :Q4_K_M"
            )
    parts = [part for part in text.split("/") if part]
    if not parts or any(part in (".", "..") for part in parts):
        raise PlanError(f"invalid Hugging Face path in {tag!r}")
    if len(parts) < 2:
        raise PlanError("Hugging Face tag needs org/name")
    repo = f"{parts[0]}/{parts[1]}"
    if len(parts) > 2:
        extra = "/".join(parts[2:])
        if quant:
            raise PlanError("pass the quant once (path suffix or :QUANT)")
        quant = extra.split("/")[-1]
    if quant is not None:
        quant = quant.strip()
        if not quant:
            raise PlanError("empty quant")
    return repo, quant


def _auxiliary(path: str) -> bool:
    parts = path.split("/")
    base = parts[-1].lower()
    if base.startswith(("mmproj", "mtp-", "imatrix")):
        return True
    return any(part.lower() == "mtp" for part in parts[:-1])


def load_listing_text(text: str) -> list[tuple[str, int]]:
    """Parse a JSON tree listing or `size<TAB>path` lines."""
    stripped = text.strip()
    if not stripped:
        return []
    if stripped[0] in "[{":
        data = json.loads(stripped)
        rows: list[tuple[str, int]] = []
        if isinstance(data, dict):
            data = data.get("siblings") or data.get("tree") or []
        for item in data:
            if not isinstance(item, dict):
                continue
            if item.get("type") not in (None, "file"):
                continue
            path = str(item.get("path") or item.get("rfilename") or "")
            lfs = item.get("lfs") or {}
            size = int(item.get("size") or lfs.get("size") or 0)
            if path:
                rows.append((path, size))
        return rows

    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        left, _, right = line.partition("\t")
        if not right:
            left, right = line.split(None, 1)
        if left.isdigit():
            rows.append((right, int(left)))
        elif right.isdigit():
            rows.append((left, int(right)))
        else:
            raise PlanError(f"bad listing line: {line!r}")
    return rows


def fetch_listing(repo: str) -> list[tuple[str, int]]:
    """Read the Hub tree API. Does not download weights."""
    quoted = quote(repo, safe="/")
    url = f"https://huggingface.co/api/models/{quoted}/tree/main?recursive=1"
    rows: list[tuple[str, int]] = []
    seen: set[str] = set()
    while url and url not in seen:
        seen.add(url)
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "spockify-add-model",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
                link = response.headers.get("Link")
        except urllib.error.HTTPError as exc:
            raise PlanError(
                f"Hugging Face listing failed for {repo} ({exc.code})"
            ) from exc
        except urllib.error.URLError as exc:
            raise PlanError(f"Hugging Face listing failed for {repo}: {exc}") from exc
        if not isinstance(payload, list):
            raise PlanError(f"unexpected listing payload for {repo}")
        rows.extend(load_listing_text(json.dumps(payload)))
        url = _next_link(link)
    return rows


def _next_link(header: str | None) -> str | None:
    if not header:
        return None
    for part in header.split(","):
        if 'rel="next"' not in part:
            continue
        match = re.search(r"<([^>]+)>", part)
        if match:
            return match.group(1)
    return None


def _groups_from_rows(rows: list[tuple[str, int]]) -> list[_Group]:
    grouped: dict[tuple[str, str, int], _Group] = {}
    singles: list[_Group] = []
    for relpath, size in rows:
        if size <= 0 or _auxiliary(relpath) or not relpath.lower().endswith(".gguf"):
            continue
        directory, _, name = relpath.rpartition("/")
        match = _SHARD_NAME.match(name)
        if match is None:
            stem = name[: -len(".gguf")]
            group = _Group(directory, stem, 1, "single", quant_id=stem)
            group.add(1, relpath, size, name)
            singles.append(group)
            continue
        index = int(match.group("idx"))
        count = int(match.group("count"))
        prefix = match.group("prefix")
        if index < 1 or count < 1 or index > count:
            continue
        key = (directory, prefix, count)
        group = grouped.get(key)
        if group is None:
            group = _Group(directory, prefix, count, "shard")
            grouped[key] = group
        group.add(index, relpath, size, name)

    groups = list(grouped.values()) + singles
    for group in groups:
        if group.kind == "shard" and group.directory:
            group.quant_id = group.directory.strip("/").split("/")[-1]
        else:
            group.quant_id = group.prefix
    counts = Counter(group.quant_id for group in groups)
    for group in groups:
        if counts[group.quant_id] > 1:
            group.quant_id = group.prefix
    return groups


def _labels(group: _Group) -> set[str]:
    names = {group.quant_id, group.prefix}
    for _rel, _size, name in group.files.values():
        names.add(name)
        if name.lower().endswith(".gguf"):
            names.add(name[: -len(".gguf")])
    return {item for item in names if item}


def _match_quant(request: str, groups: list[_Group]) -> _Group:
    wanted = request.strip().lower()
    exact: list[_Group] = []
    suffix: list[_Group] = []
    for group in groups:
        labels = _labels(group)
        if any(label.lower() == wanted for label in labels):
            exact.append(group)
            continue
        stems = (group.quant_id, group.prefix)
        if any(stem.lower().endswith("-" + wanted) for stem in stems):
            suffix.append(group)
    chosen = exact or suffix
    if not chosen:
        complete = sorted(
            group.quant_id for group in groups if group.complete()
        )
        listed = ", ".join(complete) if complete else "(none)"
        raise PlanError(f"no quant matching {request!r}. Complete quants: {listed}")
    if len(chosen) > 1:
        ids = ", ".join(sorted(group.quant_id for group in chosen))
        raise PlanError(f"quant {request!r} matches more than one group: {ids}")
    group = chosen[0]
    if not group.complete():
        raise PlanError(
            f"quant {group.quant_id} is incomplete "
            f"({len(group.files)} of {group.count} shards); not downloading"
        )
    return group


def _smallest_sharded(groups: list[_Group]) -> _Group:
    candidates = [
        group
        for group in groups
        if group.kind == "shard" and group.count >= 2 and group.complete()
    ]
    if not candidates:
        raise PlanError(
            "no complete sharded quant (every *-00001-of-0000N.gguf part, "
            "N>=2). Pass :QUANT to select one."
        )
    candidates.sort(key=lambda group: (group.total_bytes(), group.quant_id.lower()))
    return candidates[0]


def _ollama_names(repo: str, quant: str) -> tuple[str, str]:
    model = repo.rsplit("/", 1)[-1]
    if not _MODEL_TOKEN.fullmatch(model) or len(model) > 80:
        raise PlanError(f"repo name {model!r} is not an Ollama model name")
    if not _MODEL_TOKEN.fullmatch(quant) or len(quant) > 80:
        raise PlanError(f"quant {quant!r} is not an Ollama tag")
    ollama_tag = f"{model}:{quant}"
    model_name = ollama_tag.replace(":", "-")
    return ollama_tag, model_name


def build_plan(
    tag: str,
    rows: list[tuple[str, int]],
    storage_root: str,
    container_root: str,
) -> Plan:
    repo, quant_req = parse_hf_tag(tag)
    groups = _groups_from_rows(rows)
    if quant_req:
        group = _match_quant(quant_req, groups)
        reason = "explicit"
    else:
        group = _smallest_sharded(groups)
        reason = "smallest-complete-sharded"
    ollama_tag, model_name = _ollama_names(repo, group.quant_id)
    rel = f"{repo}/{group.quant_id}"
    root = Path(storage_root).expanduser()
    if not root.is_absolute():
        root = Path.cwd() / root
    host_dir = str((root / "ollama" / "hf-gguf" / rel).resolve())
    from_dir = f"{container_root.rstrip('/')}/{rel}"
    shards: list[Shard] = []
    quoted_repo = quote(repo, safe="/")
    for index in range(1, group.count + 1):
        relpath, size, name = group.files[index]
        url = (
            f"https://huggingface.co/{quoted_repo}/resolve/main/"
            f"{quote(relpath, safe='/')}"
        )
        shards.append(Shard(index, size, relpath, name, url))
    return Plan(
        repo=repo,
        quant=group.quant_id,
        reason=reason,
        ollama_tag=ollama_tag,
        model_name=model_name,
        rel=rel,
        host_dir=host_dir,
        from_dir=from_dir,
        modelfile=f"{from_dir}/Modelfile",
        shards=tuple(shards),
        total_bytes=group.total_bytes(),
    )


def format_text(plan: Plan) -> str:
    if plan.reason == "smallest-complete-sharded":
        choice = (
            "smallest complete sharded quant "
            "(no quant in the tag; lowest total bytes; "
            "single-file and incomplete quants are skipped)"
        )
    else:
        choice = "quant taken from the tag"
    lines = [
        "HF GGUF dry run",
        f"repo: {plan.repo}",
        f"quant: {plan.quant}",
        f"choice: {choice}",
        f"bytes: {plan.total_bytes}",
        f"ollama_tag: {plan.ollama_tag}",
        f"model_name: {plan.model_name}",
        f"host_dir: {plan.host_dir}",
        f"modelfile_from: {plan.from_dir}",
        "register: ollama create (directory of every shard; not ollama pull)",
        "shards:",
    ]
    lines.extend(shard.name for shard in plan.shards)
    return "\n".join(lines) + "\n"


def format_shell(plan: Plan) -> str:
    """Shell assignments. Values are quoted; safe to source."""
    lines = [
        "# hf-gguf plan",
        f"HF_REPO={shlex.quote(plan.repo)}",
        f"HF_QUANT={shlex.quote(plan.quant)}",
        f"HF_REASON={shlex.quote(plan.reason)}",
        f"HF_OLLAMA_TAG={shlex.quote(plan.ollama_tag)}",
        f"HF_MODEL_NAME={shlex.quote(plan.model_name)}",
        f"HF_REL={shlex.quote(plan.rel)}",
        f"HF_HOST_DIR={shlex.quote(plan.host_dir)}",
        f"HF_FROM={shlex.quote(plan.from_dir)}",
        f"HF_MODELFILE={shlex.quote(plan.modelfile)}",
        "HF_SHARD_NAMES=(",
    ]
    lines.extend(f"  {shlex.quote(shard.name)}" for shard in plan.shards)
    lines.append(")")
    lines.append("HF_SHARD_URLS=(")
    lines.extend(f"  {shlex.quote(shard.url)}" for shard in plan.shards)
    lines.append(")")
    lines.append("HF_SHARD_SIZES=(")
    lines.extend(f"  {shlex.quote(str(shard.size))}" for shard in plan.shards)
    lines.append(")")
    return "\n".join(lines) + "\n"


def listing_rows(repo: str) -> list[tuple[str, int]]:
    override = os.environ.get("HF_GGUF_LISTING", "").strip()
    if override:
        return load_listing_text(Path(override).read_text(encoding="utf-8"))
    return fetch_listing(repo)


def _storage_root() -> str:
    root = os.environ.get("STORAGE_ROOT", "").strip()
    if root:
        return root
    return "/var/lib/spockify"


def _container_root() -> str:
    return os.environ.get("HF_GGUF_CONTAINER_ROOT", "/root/.ollama/hf-gguf")


def plan_for_tag(tag: str) -> Plan:
    repo, _quant = parse_hf_tag(tag)
    return build_plan(tag, listing_rows(repo), _storage_root(), _container_root())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "dry-run", "plan"))
    parser.add_argument("--tag", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            parse_hf_tag(args.tag)
            return 0
        plan = plan_for_tag(args.tag)
    except NotHuggingFaceError:
        return 2
    except PlanError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.command == "dry-run":
        sys.stdout.write(format_text(plan))
    else:
        sys.stdout.write(format_shell(plan))
    return 0


if __name__ == "__main__":
    sys.exit(main())
