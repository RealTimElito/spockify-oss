"""Character and style pack schema (C-005).

In-memory revisions and ownership checks only. This module does not store
image bytes, does not call Comfy, and is not a live ``/v1/cartoon`` route.
Sealing a pack is a schema gate, not a creative approval and not a license.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Optional

SCHEMA_VERSION = "1.0"

REF_ROLES: tuple[str, ...] = (
    "front",
    "side",
    "three_quarter",
    "expression",
    "silhouette",
    "mask",
    "crop_safe",
    "camera_example",
    "variation",
)
REQUIRED_SEAL_ROLES: tuple[str, ...] = ("front", "side", "three_quarter")
SLOT_ROLES: tuple[str, ...] = ("front", "side", "three_quarter", "expression", "crop_safe")
CONSENT_VALUES: tuple[str, ...] = ("unknown", "granted", "refused")

_CROP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["x", "y", "width", "height"],
    "properties": {
        "x": {"type": "integer", "minimum": 0},
        "y": {"type": "integer", "minimum": 0},
        "width": {"type": "integer", "minimum": 1},
        "height": {"type": "integer", "minimum": 1},
    },
}

REFERENCE_ASSET_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://example.com/spockify/cartoon/reference-asset-1.0.json",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schema_version",
        "id",
        "owner",
        "sha256",
        "mime",
        "width",
        "height",
        "role",
        "approved",
    ],
    "properties": {
        "schema_version": {"const": SCHEMA_VERSION},
        "id": {"type": "string", "minLength": 1},
        "owner": {"type": "string", "minLength": 1},
        "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "mime": {"type": "string", "enum": ["image/png", "image/webp", "image/jpeg"]},
        "width": {"type": "integer", "minimum": 1},
        "height": {"type": "integer", "minimum": 1},
        "role": {"type": "string", "enum": list(REF_ROLES)},
        "approved": {"type": "boolean"},
        "crop_safe": _CROP_SCHEMA,
    },
}

STYLE_PACK_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://example.com/spockify/cartoon/style-pack-1.0.json",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schema_version",
        "id",
        "lineage_id",
        "owner",
        "version",
        "name",
        "line_weight",
        "palette",
        "shading",
        "background_language",
        "frame_composition",
        "negative_constraints",
        "sealed",
        "commercial_use",
    ],
    "properties": {
        "schema_version": {"const": SCHEMA_VERSION},
        "id": {"type": "string", "minLength": 1},
        "lineage_id": {"type": "string", "minLength": 1},
        "owner": {"type": "string", "minLength": 1},
        "version": {"type": "integer", "minimum": 1},
        "name": {"type": "string", "minLength": 1},
        "line_weight": {"type": "string", "minLength": 1},
        "palette": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"},
        },
        "shading": {"type": "string", "minLength": 1},
        "background_language": {"type": "string", "minLength": 1},
        "frame_composition": {"type": "string", "minLength": 1},
        "negative_constraints": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
        },
        "sealed": {"type": "boolean"},
        "commercial_use": {"const": False},
    },
}

CHARACTER_PACK_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://example.com/spockify/cartoon/character-pack-1.0.json",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schema_version",
        "id",
        "lineage_id",
        "owner",
        "version",
        "name",
        "style_pack_revision_id",
        "provenance",
        "refs",
        "expressions",
        "constraints",
        "palette",
        "outfit",
        "sealed",
        "commercial_use",
    ],
    "properties": {
        "schema_version": {"const": SCHEMA_VERSION},
        "id": {"type": "string", "minLength": 1},
        "lineage_id": {"type": "string", "minLength": 1},
        "owner": {"type": "string", "minLength": 1},
        "version": {"type": "integer", "minimum": 1},
        "name": {"type": "string", "minLength": 1},
        "style_pack_revision_id": {"type": "string", "minLength": 1},
        "provenance": {
            "type": "object",
            "additionalProperties": False,
            "required": ["consent", "ip_statement", "counsel_signed"],
            "properties": {
                "consent": {"type": "string", "enum": list(CONSENT_VALUES)},
                "ip_statement": {"type": "string"},
                "counsel_signed": {"const": False},
            },
        },
        "refs": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "front": {"type": "string", "minLength": 1},
                "side": {"type": "string", "minLength": 1},
                "three_quarter": {"type": "string", "minLength": 1},
            },
        },
        "expressions": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
        },
        "constraints": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
        },
        "palette": {
            "type": "array",
            "items": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"},
        },
        "outfit": {"type": "string"},
        "crop_safe_ref": {"type": "string", "minLength": 1},
        "sealed": {"type": "boolean"},
        "commercial_use": {"const": False},
    },
}

SCHEMAS: dict[str, dict[str, Any]] = {
    "reference_asset": REFERENCE_ASSET_SCHEMA,
    "style_pack": STYLE_PACK_SCHEMA,
    "character_pack": CHARACTER_PACK_SCHEMA,
}


class PackError(Exception):
    def __init__(self, message: str, code: str = "validation") -> None:
        super().__init__(message)
        self.code = code


def packs_policy_block() -> dict[str, Any]:
    """Legacy POST /v1/cartoon still runs when pack ids are omitted."""
    return {
        "schema_version": SCHEMA_VERSION,
        "storage": "sqlite",
        "live_route": False,
        "director_routes": True,
        "character_class_default": "cel_human",
        "objects": ["character_pack", "style_pack", "reference_asset"],
        "note": (
            "Pack ids are optional on POST /v1/cartoon and do not contain pixels. "
            "Omit them and a prompt-only sprite route still runs, with "
            "identity_lock=edit-only. Attach character_plate and background "
            "images to condition the Qwen step. Director render dispatches that "
            "sprite path per pending shot. counsel_signed cannot be true. "
            "The cel_human class is a reversible engineering default, not a "
            "creative sign-off. Hobby/family use only."
        ),
    }


def validate_instance(instance: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    """Subset checker for the pack schemas. Returns a list of error strings."""
    if "anyOf" in schema:
        if any(not validate_instance(instance, option) for option in schema["anyOf"]):
            return []
        return [f"{path} anyOf"]
    if "const" in schema and instance != schema["const"]:
        return [f"{path} const"]
    if "enum" in schema and instance not in schema["enum"]:
        return [f"{path} enum"]
    expected = schema.get("type")
    if expected is None:
        return []
    if expected == "object":
        if not isinstance(instance, dict):
            return [f"{path} type"]
        errors: list[str] = []
        for key in schema.get("required") or []:
            if key not in instance:
                errors.append(f"{path}.{key} required")
        properties = schema.get("properties") or {}
        if schema.get("additionalProperties") is False:
            for key in instance:
                if key not in properties:
                    errors.append(f"{path}.{key} additional")
        for key, value in instance.items():
            if key in properties:
                errors.extend(validate_instance(value, properties[key], f"{path}.{key}"))
        return errors
    if expected == "string":
        if not isinstance(instance, str):
            return [f"{path} type"]
        errors = []
        if "minLength" in schema and len(instance) < int(schema["minLength"]):
            errors.append(f"{path} minLength")
        if "maxLength" in schema and len(instance) > int(schema["maxLength"]):
            errors.append(f"{path} maxLength")
        if "pattern" in schema and re.fullmatch(schema["pattern"], instance) is None:
            errors.append(f"{path} pattern")
        return errors
    if expected == "integer":
        if isinstance(instance, bool) or not isinstance(instance, int):
            return [f"{path} type"]
        errors = []
        if "minimum" in schema and instance < int(schema["minimum"]):
            errors.append(f"{path} minimum")
        if "maximum" in schema and instance > int(schema["maximum"]):
            errors.append(f"{path} maximum")
        return errors
    if expected == "boolean":
        if not isinstance(instance, bool):
            return [f"{path} type"]
        return []
    if expected == "array":
        if not isinstance(instance, list):
            return [f"{path} type"]
        errors = []
        if "minItems" in schema and len(instance) < int(schema["minItems"]):
            errors.append(f"{path} minItems")
        if "maxItems" in schema and len(instance) > int(schema["maxItems"]):
            errors.append(f"{path} maxItems")
        if "items" in schema:
            for index, item in enumerate(instance):
                errors.extend(
                    validate_instance(item, schema["items"], f"{path}[{index}]")
                )
        return errors
    return [f"{path} schema"]


def dump_document(doc: dict[str, Any], schema: dict[str, Any]) -> str:
    errors = validate_instance(doc, schema)
    if errors:
        raise PackError("document does not match schema: " + "; ".join(errors), "schema")
    return json.dumps(doc, sort_keys=True, separators=(",", ":"))


def load_document(
    text: str,
    schema: dict[str, Any],
    *,
    expect_owner: Optional[str] = None,
) -> dict[str, Any]:
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PackError("document is not JSON", "schema") from exc
    errors = validate_instance(doc, schema)
    if errors:
        raise PackError("document does not match schema: " + "; ".join(errors), "schema")
    if expect_owner is not None and doc.get("owner") != expect_owner:
        raise PackError("document owner does not match the caller", "ownership")
    return doc


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _public(doc: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(doc))


def _require_schema(doc: dict[str, Any], schema: dict[str, Any]) -> None:
    errors = validate_instance(doc, schema)
    if errors:
        raise PackError("document does not match schema: " + "; ".join(errors), "schema")


def _check_crop(ref: dict[str, Any], crop: dict[str, Any]) -> None:
    errors = validate_instance(crop, _CROP_SCHEMA, path="$.crop_safe")
    if errors:
        raise PackError("crop_safe is invalid: " + "; ".join(errors), "validation")
    if crop["x"] + crop["width"] > int(ref["width"]) or crop["y"] + crop["height"] > int(
        ref["height"]
    ):
        raise PackError("crop_safe is outside the reference", "validation")


class PackStore:
    """Single-process pack revisions. A restart drops them."""

    def __init__(self) -> None:
        self._refs: dict[str, dict[str, Any]] = {}
        self._styles: dict[str, dict[str, Any]] = {}
        self._characters: dict[str, dict[str, Any]] = {}

    def create_reference(
        self,
        *,
        owner: str,
        sha256: str,
        mime: str,
        width: int,
        height: int,
        role: str,
    ) -> dict[str, Any]:
        doc = {
            "schema_version": SCHEMA_VERSION,
            "id": _new_id("ref"),
            "owner": owner.strip(),
            "sha256": sha256.strip().lower(),
            "mime": mime,
            "width": int(width),
            "height": int(height),
            "role": role,
            "approved": False,
        }
        _require_schema(doc, REFERENCE_ASSET_SCHEMA)
        self._refs[doc["id"]] = doc
        return _public(doc)

    def update_reference(self, ref_id: str, **fields: Any) -> dict[str, Any]:
        ref = self._refs.get(ref_id)
        if ref is None:
            raise PackError("unknown reference", "not_found")
        if ref["approved"]:
            raise PackError("approved reference is immutable", "immutable")
        allowed = {"sha256", "mime", "width", "height", "role", "crop_safe"}
        unknown = set(fields) - allowed
        if unknown:
            raise PackError("field cannot be updated", "validation")
        for key, value in fields.items():
            if key == "sha256":
                ref[key] = str(value).strip().lower()
            elif key == "crop_safe":
                _check_crop(ref, value)
                ref[key] = dict(value)
            else:
                ref[key] = value
        if "crop_safe" in ref:
            _check_crop(ref, ref["crop_safe"])
        _require_schema(ref, REFERENCE_ASSET_SCHEMA)
        return _public(ref)

    def approve_reference(
        self,
        ref_id: str,
        *,
        crop_safe: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        ref = self._refs.get(ref_id)
        if ref is None:
            raise PackError("unknown reference", "not_found")
        if ref["approved"]:
            raise PackError("approved reference is immutable", "immutable")
        if crop_safe is not None:
            _check_crop(ref, crop_safe)
            ref["crop_safe"] = {
                "x": int(crop_safe["x"]),
                "y": int(crop_safe["y"]),
                "width": int(crop_safe["width"]),
                "height": int(crop_safe["height"]),
            }
        ref["approved"] = True
        _require_schema(ref, REFERENCE_ASSET_SCHEMA)
        return _public(ref)

    def create_style(
        self,
        *,
        owner: str,
        name: str,
        line_weight: str,
        palette: list[str],
        shading: str,
        background_language: str,
        frame_composition: str,
        negative_constraints: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        doc = {
            "schema_version": SCHEMA_VERSION,
            "id": _new_id("sty"),
            "lineage_id": _new_id("styline"),
            "owner": owner.strip(),
            "version": 1,
            "name": name.strip(),
            "line_weight": line_weight,
            "palette": list(palette),
            "shading": shading,
            "background_language": background_language,
            "frame_composition": frame_composition,
            "negative_constraints": list(negative_constraints or []),
            "sealed": False,
            "commercial_use": False,
        }
        _require_schema(doc, STYLE_PACK_SCHEMA)
        self._styles[doc["id"]] = doc
        return _public(doc)

    def seal_style(self, style_id: str) -> dict[str, Any]:
        style = self._styles.get(style_id)
        if style is None:
            raise PackError("unknown style pack", "not_found")
        _require_schema(style, STYLE_PACK_SCHEMA)
        style["sealed"] = True
        return _public(style)

    def update_style(self, style_id: str, **fields: Any) -> dict[str, Any]:
        style = self._styles.get(style_id)
        if style is None:
            raise PackError("unknown style pack", "not_found")
        if style["sealed"]:
            raise PackError("sealed style pack is immutable", "immutable")
        locked = {
            "id",
            "lineage_id",
            "owner",
            "version",
            "schema_version",
            "commercial_use",
            "sealed",
        }
        if set(fields) & locked:
            raise PackError("field cannot be updated", "validation")
        for key, value in fields.items():
            style[key] = list(value) if isinstance(value, list) else value
        _require_schema(style, STYLE_PACK_SCHEMA)
        return _public(style)

    def revise_style(self, style_id: str, **fields: Any) -> dict[str, Any]:
        old = self._styles.get(style_id)
        if old is None:
            raise PackError("unknown style pack", "not_found")
        revised = json.loads(json.dumps(old))
        revised["id"] = _new_id("sty")
        revised["version"] = int(old["version"]) + 1
        revised["sealed"] = False
        revised["commercial_use"] = False
        locked = {
            "id",
            "lineage_id",
            "owner",
            "version",
            "schema_version",
            "commercial_use",
            "sealed",
        }
        if set(fields) & locked:
            raise PackError("field cannot be revised", "validation")
        for key, value in fields.items():
            revised[key] = list(value) if isinstance(value, list) else value
        _require_schema(revised, STYLE_PACK_SCHEMA)
        self._styles[revised["id"]] = revised
        return _public(revised)

    def create_character(
        self,
        *,
        owner: str,
        name: str,
        style_pack_revision_id: str,
        consent: str = "unknown",
        ip_statement: str = "",
    ) -> dict[str, Any]:
        style = self._styles.get(style_pack_revision_id)
        if style is None:
            raise PackError("unknown style pack", "not_found")
        if style["owner"] != owner.strip():
            raise PackError("style pack owner does not match", "ownership")
        doc = {
            "schema_version": SCHEMA_VERSION,
            "id": _new_id("chr"),
            "lineage_id": _new_id("chrline"),
            "owner": owner.strip(),
            "version": 1,
            "name": name.strip(),
            "style_pack_revision_id": style_pack_revision_id,
            "provenance": {
                "consent": consent,
                "ip_statement": ip_statement,
                "counsel_signed": False,
            },
            "refs": {},
            "expressions": [],
            "constraints": [],
            "palette": [],
            "outfit": "",
            "sealed": False,
            "commercial_use": False,
        }
        _require_schema(doc, CHARACTER_PACK_SCHEMA)
        self._characters[doc["id"]] = doc
        return _public(doc)

    def set_provenance(
        self,
        character_id: str,
        *,
        consent: str,
        ip_statement: str,
    ) -> dict[str, Any]:
        char = self._characters.get(character_id)
        if char is None:
            raise PackError("unknown character pack", "not_found")
        if char["sealed"]:
            raise PackError("sealed character pack is immutable", "immutable")
        char["provenance"] = {
            "consent": consent,
            "ip_statement": ip_statement,
            "counsel_signed": False,
        }
        _require_schema(char, CHARACTER_PACK_SCHEMA)
        return _public(char)

    def attach_ref(self, character_id: str, *, role: str, ref_id: str) -> dict[str, Any]:
        if role not in SLOT_ROLES:
            raise PackError("unsupported reference slot", "validation")
        char = self._characters.get(character_id)
        if char is None:
            raise PackError("unknown character pack", "not_found")
        if char["sealed"]:
            raise PackError("sealed character pack is immutable", "immutable")
        ref = self._refs.get(ref_id)
        if ref is None:
            raise PackError("unknown reference", "not_found")
        if ref["owner"] != char["owner"]:
            raise PackError("reference owner does not match the pack", "ownership")
        if ref["role"] != role:
            raise PackError("reference role does not match the slot", "role")
        if role in {"front", "side", "three_quarter"}:
            char["refs"][role] = ref_id
        elif role == "expression":
            if ref_id not in char["expressions"]:
                char["expressions"].append(ref_id)
        else:
            char["crop_safe_ref"] = ref_id
        _require_schema(char, CHARACTER_PACK_SCHEMA)
        return _public(char)

    def seal_character(self, character_id: str) -> dict[str, Any]:
        char = self._characters.get(character_id)
        if char is None:
            raise PackError("unknown character pack", "not_found")
        if char["sealed"]:
            return _public(char)
        style = self._styles.get(char["style_pack_revision_id"])
        if style is None or not style["sealed"]:
            raise PackError("style revision is not sealed", "seal")
        if style["owner"] != char["owner"]:
            raise PackError("style pack owner does not match", "ownership")
        if char["provenance"]["consent"] != "granted":
            raise PackError("consent is not granted", "seal")
        if not str(char["provenance"]["ip_statement"]).strip():
            raise PackError("ip_statement is required to seal", "seal")
        if char["provenance"]["counsel_signed"] is not False:
            raise PackError("counsel_signed cannot be claimed here", "seal")
        for role in REQUIRED_SEAL_ROLES:
            ref_id = char["refs"].get(role)
            if not ref_id:
                raise PackError(f"missing approved {role} reference", "seal")
            ref = self._refs.get(ref_id)
            if ref is None or ref["owner"] != char["owner"]:
                raise PackError("reference owner does not match the pack", "ownership")
            if not ref["approved"]:
                raise PackError(f"{role} reference is not approved", "seal")
            if ref["role"] != role:
                raise PackError("reference role does not match the slot", "role")
        char["sealed"] = True
        _require_schema(char, CHARACTER_PACK_SCHEMA)
        return _public(char)

    def revise_character(self, character_id: str) -> dict[str, Any]:
        old = self._characters.get(character_id)
        if old is None:
            raise PackError("unknown character pack", "not_found")
        revised = json.loads(json.dumps(old))
        revised["id"] = _new_id("chr")
        revised["version"] = int(old["version"]) + 1
        revised["sealed"] = False
        revised["commercial_use"] = False
        revised["provenance"]["counsel_signed"] = False
        _require_schema(revised, CHARACTER_PACK_SCHEMA)
        self._characters[revised["id"]] = revised
        return _public(revised)

    def get_reference(self, ref_id: str) -> dict[str, Any]:
        return _public(self._refs[ref_id])

    def get_style(self, style_id: str) -> dict[str, Any]:
        return _public(self._styles[style_id])

    def get_character(self, character_id: str) -> dict[str, Any]:
        return _public(self._characters[character_id])
