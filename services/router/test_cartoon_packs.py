"""C-005 character and style pack schema. CPU only, no live cartoon route."""

from __future__ import annotations

import json
import unittest

import jsonschema
from jsonschema import Draft202012Validator

import cartoon_packs
import cartoon_pipeline


def _sha(seed: int) -> str:
    return f"{seed:064x}"


def _crop() -> dict:
    return {"x": 1, "y": 2, "width": 8, "height": 6}


class SchemaTests(unittest.TestCase):
    def test_schemas_are_draft_2020_12(self) -> None:
        for schema in cartoon_packs.SCHEMAS.values():
            Draft202012Validator.check_schema(schema)

    def test_store_documents_round_trip_and_match_jsonschema(self) -> None:
        store = cartoon_packs.PackStore()
        style = store.create_style(
            owner="creator",
            name="cel",
            line_weight="crisp",
            palette=["#112233"],
            shading="flat",
            background_language="plain wall",
            frame_composition="medium shot",
            negative_constraints=["no text"],
        )
        ref = store.create_reference(
            owner="creator",
            sha256=_sha(1),
            mime="image/png",
            width=32,
            height=32,
            role="front",
        )
        approved = store.approve_reference(ref["id"], crop_safe=_crop())
        character = store.create_character(
            owner="creator",
            name="fox",
            style_pack_revision_id=style["id"],
            consent="unknown",
            ip_statement="",
        )
        for doc, schema in (
            (style, cartoon_packs.STYLE_PACK_SCHEMA),
            (approved, cartoon_packs.REFERENCE_ASSET_SCHEMA),
            (character, cartoon_packs.CHARACTER_PACK_SCHEMA),
        ):
            jsonschema.validate(doc, schema)
            text = cartoon_packs.dump_document(doc, schema)
            loaded = cartoon_packs.load_document(text, schema, expect_owner="creator")
            self.assertEqual(loaded, json.loads(text))
            self.assertEqual(json.loads(text), doc)

    def test_jsonschema_rejects_signed_clearance_and_extra_fields(self) -> None:
        store = cartoon_packs.PackStore()
        character = store.create_character(
            owner="creator",
            name="fox",
            style_pack_revision_id=store.create_style(
                owner="creator",
                name="cel",
                line_weight="crisp",
                palette=["#abcdef"],
                shading="flat",
                background_language="plain",
                frame_composition="medium",
            )["id"],
        )
        signed = json.loads(json.dumps(character))
        signed["provenance"]["counsel_signed"] = True
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(signed, cartoon_packs.CHARACTER_PACK_SCHEMA)
        extra = json.loads(json.dumps(character))
        extra["secret_path"] = "/tmp/ref"
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(extra, cartoon_packs.CHARACTER_PACK_SCHEMA)
        self.assertTrue(
            cartoon_packs.validate_instance(signed, cartoon_packs.CHARACTER_PACK_SCHEMA)
        )
        self.assertTrue(
            cartoon_packs.validate_instance(extra, cartoon_packs.CHARACTER_PACK_SCHEMA)
        )

    def test_load_rejects_other_owner(self) -> None:
        store = cartoon_packs.PackStore()
        style = store.create_style(
            owner="creator",
            name="cel",
            line_weight="crisp",
            palette=["#000000"],
            shading="flat",
            background_language="plain",
            frame_composition="medium",
        )
        text = cartoon_packs.dump_document(style, cartoon_packs.STYLE_PACK_SCHEMA)
        with self.assertRaises(cartoon_packs.PackError) as ctx:
            cartoon_packs.load_document(
                text,
                cartoon_packs.STYLE_PACK_SCHEMA,
                expect_owner="someone-else",
            )
        self.assertEqual(ctx.exception.code, "ownership")


class PackStoreTests(unittest.TestCase):
    def _style(self, store: cartoon_packs.PackStore, owner: str = "creator") -> dict:
        return store.create_style(
            owner=owner,
            name="cel",
            line_weight="crisp",
            palette=["#c47a3a", "#111111"],
            shading="flat",
            background_language="simple interior",
            frame_composition="headroom, medium shot",
            negative_constraints=["no text", "no photoreal skin"],
        )

    def _approved(
        self,
        store: cartoon_packs.PackStore,
        *,
        role: str,
        seed: int,
        owner: str = "creator",
    ) -> dict:
        ref = store.create_reference(
            owner=owner,
            sha256=_sha(seed),
            mime="image/png",
            width=64,
            height=48,
            role=role,
        )
        return store.approve_reference(ref["id"], crop_safe=_crop())

    def test_approved_reference_is_immutable(self) -> None:
        store = cartoon_packs.PackStore()
        ref = store.create_reference(
            owner="creator",
            sha256=_sha(4),
            mime="image/png",
            width=20,
            height=20,
            role="front",
        )
        store.update_reference(ref["id"], width=24)
        approved = store.approve_reference(ref["id"])
        self.assertTrue(approved["approved"])
        self.assertEqual(approved["width"], 24)
        with self.assertRaises(cartoon_packs.PackError) as ctx:
            store.update_reference(ref["id"], sha256=_sha(5))
        self.assertEqual(ctx.exception.code, "immutable")
        with self.assertRaises(cartoon_packs.PackError):
            store.approve_reference(ref["id"])
        self.assertEqual(store.get_reference(ref["id"])["sha256"], _sha(4))

    def test_crop_safe_must_sit_inside_the_reference(self) -> None:
        store = cartoon_packs.PackStore()
        ref = store.create_reference(
            owner="creator",
            sha256=_sha(6),
            mime="image/png",
            width=10,
            height=10,
            role="front",
        )
        with self.assertRaises(cartoon_packs.PackError) as ctx:
            store.approve_reference(
                ref["id"],
                crop_safe={"x": 8, "y": 0, "width": 4, "height": 2},
            )
        self.assertEqual(ctx.exception.code, "validation")
        self.assertFalse(store.get_reference(ref["id"])["approved"])

    def test_other_owner_cannot_attach_a_reference(self) -> None:
        store = cartoon_packs.PackStore()
        style = self._style(store, owner="creator")
        character = store.create_character(
            owner="creator",
            name="fox",
            style_pack_revision_id=style["id"],
        )
        foreign = self._approved(store, role="front", seed=7, owner="other")
        with self.assertRaises(cartoon_packs.PackError) as ctx:
            store.attach_ref(character["id"], role="front", ref_id=foreign["id"])
        self.assertEqual(ctx.exception.code, "ownership")
        self.assertEqual(store.get_character(character["id"])["refs"], {})

    def test_role_slot_must_match(self) -> None:
        store = cartoon_packs.PackStore()
        style = self._style(store)
        character = store.create_character(
            owner="creator",
            name="fox",
            style_pack_revision_id=style["id"],
        )
        side = self._approved(store, role="side", seed=8)
        with self.assertRaises(cartoon_packs.PackError) as ctx:
            store.attach_ref(character["id"], role="front", ref_id=side["id"])
        self.assertEqual(ctx.exception.code, "role")

    def test_seal_requires_style_consent_and_three_approved_views(self) -> None:
        store = cartoon_packs.PackStore()
        style = self._style(store)
        character = store.create_character(
            owner="creator",
            name="fox",
            style_pack_revision_id=style["id"],
        )
        for index, role in enumerate(("front", "side", "three_quarter"), start=10):
            ref = self._approved(store, role=role, seed=index)
            store.attach_ref(character["id"], role=role, ref_id=ref["id"])
        with self.assertRaises(cartoon_packs.PackError) as unsealed_style:
            store.seal_character(character["id"])
        self.assertEqual(unsealed_style.exception.code, "seal")
        store.seal_style(style["id"])
        with self.assertRaises(cartoon_packs.PackError):
            store.seal_character(character["id"])
        store.set_provenance(
            character["id"],
            consent="granted",
            ip_statement="original character, research use only",
        )
        sealed = store.seal_character(character["id"])
        self.assertTrue(sealed["sealed"])
        self.assertFalse(sealed["commercial_use"])
        self.assertFalse(sealed["provenance"]["counsel_signed"])
        jsonschema.validate(sealed, cartoon_packs.CHARACTER_PACK_SCHEMA)
        with self.assertRaises(cartoon_packs.PackError) as frozen:
            store.attach_ref(character["id"], role="front", ref_id=sealed["refs"]["front"])
        self.assertEqual(frozen.exception.code, "immutable")
        with self.assertRaises(cartoon_packs.PackError):
            store.update_style(style["id"], name="renamed")

    def test_revise_leaves_the_previous_revision_unchanged(self) -> None:
        store = cartoon_packs.PackStore()
        style = self._style(store)
        store.seal_style(style["id"])
        before = store.get_style(style["id"])
        revised = store.revise_style(style["id"], name="cel-ink", line_weight="heavy")
        self.assertEqual(store.get_style(style["id"]), before)
        self.assertEqual(revised["lineage_id"], before["lineage_id"])
        self.assertEqual(revised["version"], 2)
        self.assertFalse(revised["sealed"])
        self.assertEqual(revised["name"], "cel-ink")
        character = store.create_character(
            owner="creator",
            name="fox",
            style_pack_revision_id=style["id"],
            consent="granted",
            ip_statement="original",
        )
        for index, role in enumerate(("front", "side", "three_quarter"), start=20):
            ref = self._approved(store, role=role, seed=index)
            store.attach_ref(character["id"], role=role, ref_id=ref["id"])
        sealed = store.seal_character(character["id"])
        before_char = store.get_character(character["id"])
        next_rev = store.revise_character(character["id"])
        self.assertEqual(store.get_character(character["id"]), before_char)
        self.assertEqual(next_rev["version"], sealed["version"] + 1)
        self.assertFalse(next_rev["sealed"])
        self.assertEqual(next_rev["refs"], sealed["refs"])
        self.assertEqual(next_rev["lineage_id"], sealed["lineage_id"])

    def test_unapproved_view_cannot_seal(self) -> None:
        store = cartoon_packs.PackStore()
        style = self._style(store)
        store.seal_style(style["id"])
        character = store.create_character(
            owner="creator",
            name="fox",
            style_pack_revision_id=style["id"],
            consent="granted",
            ip_statement="original",
        )
        draft = store.create_reference(
            owner="creator",
            sha256=_sha(30),
            mime="image/png",
            width=16,
            height=16,
            role="front",
        )
        store.attach_ref(character["id"], role="front", ref_id=draft["id"])
        for index, role in enumerate(("side", "three_quarter"), start=31):
            ref = self._approved(store, role=role, seed=index)
            store.attach_ref(character["id"], role=role, ref_id=ref["id"])
        with self.assertRaises(cartoon_packs.PackError) as ctx:
            store.seal_character(character["id"])
        self.assertEqual(ctx.exception.code, "seal")
        self.assertFalse(store.get_character(character["id"])["sealed"])

    def test_policy_exposes_packs_without_taking_the_live_route(self) -> None:
        policy = cartoon_pipeline.catalog_policy()
        self.assertEqual(
            [stage["id"] for stage in policy["pipeline"]],
            ["sprite_grid", "slice", "flf", "video_edit"],
        )
        self.assertFalse(policy["commercial_export"])
        self.assertFalse(policy["packs"]["live_route"])
        self.assertTrue(policy["packs"]["director_routes"])
        self.assertEqual(policy["packs"]["storage"], "sqlite")
        self.assertEqual(policy["packs"]["character_class_default"], "cel_human")
        self.assertEqual(policy["packs"]["schema_version"], "1.0")


if __name__ == "__main__":
    unittest.main()
