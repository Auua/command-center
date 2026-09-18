"""
Unit tests for the parts of sync.py that need no AnkiWeb: card collection
through the vault's exporter, state documents, and the upsert planner
against a fake collection.

    python3 -m unittest tools/anki-sync/test_sync.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("sync", HERE / "sync.py")
sync = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules["sync"] = sync  # dataclasses resolve annotations through sys.modules
spec.loader.exec_module(sync)

EXPORTER = '''
import hashlib, re
from pathlib import Path
SKIP_DIRS = {".obsidian", ".trash", ".git", "Templates"}
def uid_for(relpath, front):
    return hashlib.sha1(f"{relpath}|{front}".encode("utf-8")).hexdigest()[:16]
def parse_file(path, vault):
    rel = str(path.relative_to(vault))
    cards = []
    tag = None
    for line in path.read_text(encoding="utf-8").split("\\n"):
        m = re.search(r"#flashcards(?:/[\\w/-]+)?", line)
        if m:
            tag = m.group(0).lstrip("#").replace("/", "::")
            continue
        if tag and "::" in line:
            front, back = line.split("::", 1)
            cards.append((front.strip(), back.strip(), rel, [tag]))
    return cards
'''


def make_vault(root: Path) -> Path:
    vault = root / "Japanese"
    (vault / "00 Meta" / "Scripts").mkdir(parents=True)
    (vault / "00 Meta" / "Scripts" / "sr_to_anki.py").write_text(EXPORTER, encoding="utf-8")
    (vault / "30 Sanasto").mkdir()
    (vault / "30 Sanasto" / "負ける.md").write_text(
        "---\ntype: vocab\n---\n## Kortit\n#flashcards/vocab\n負ける::hävitä\n負ける::hävitä\n",
        encoding="utf-8",
    )
    (vault / "Templates").mkdir()
    (vault / "Templates" / "t.md").write_text("#flashcards/x\na::b\n", encoding="utf-8")
    return vault


class FakeNote(dict):
    def __init__(self, nid: int):
        super().__init__()
        self.id = nid
        self.tags: list[str] = []


class FakeModels:
    def __init__(self, existing=None):
        self.models = existing or {}
        self.added = []

    def by_name(self, name):
        return self.models.get(name)

    def new(self, name):
        return {"name": name, "flds": [], "tmpls": []}

    def new_field(self, name):
        return {"name": name}

    def add_field(self, model, fld):
        model["flds"].append(fld)

    def new_template(self, name):
        return {"name": name}

    def add_template(self, model, tmpl):
        model["tmpls"].append(tmpl)

    def add(self, model):
        self.models[model["name"]] = model
        self.added.append(model["name"])


class FakeCollection:
    def __init__(self, existing_model=None):
        self.models = FakeModels({existing_model["name"]: existing_model} if existing_model else None)
        self.notes: dict[int, FakeNote] = {}
        self.added: list[tuple[FakeNote, int]] = []
        self.updated: list[FakeNote] = []
        self._next = 1

    def find_notes(self, query):
        uid = query.split(":", 1)[1].strip('"')
        return [nid for nid, note in self.notes.items() if note.get("UID") == uid]

    def get_note(self, nid):
        return self.notes[nid]

    def new_note(self, model):
        note = FakeNote(self._next)
        self._next += 1
        return note

    def add_note(self, note, deck_id):
        self.notes[note.id] = note
        self.added.append((note, deck_id))

    def update_note(self, note):
        self.updated.append(note)


class CollectCardsTest(unittest.TestCase):
    def test_dedupes_by_uid_and_skips_templates(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = make_vault(Path(tmp))
            exporter = sync.load_exporter(vault)
            cards, files = sync.collect_cards(vault, exporter)
        self.assertEqual(files, 1)
        self.assertEqual(len(cards), 1)
        card = cards[0]
        self.assertEqual((card.front, card.back, card.source), ("負ける", "hävitä", "30 Sanasto/負ける.md"))
        self.assertEqual(card.tags, ["flashcards::vocab"])
        self.assertEqual(card.uid, exporter.uid_for("30 Sanasto/負ける.md", "負ける"))


class EnsureModelTest(unittest.TestCase):
    def test_creates_the_note_type_with_the_four_fields(self):
        col = FakeCollection()
        model = sync.ensure_model(col, "Japani (Obsidian)")
        self.assertEqual([f["name"] for f in model["flds"]], sync.NOTE_FIELDS)
        self.assertEqual(col.models.added, ["Japani (Obsidian)"])

    def test_refuses_an_existing_note_type_with_other_fields(self):
        col = FakeCollection({"name": "Japani (Obsidian)", "flds": [{"name": "Front"}]})
        with self.assertRaisesRegex(RuntimeError, "lacks fields"):
            sync.ensure_model(col, "Japani (Obsidian)")


class UpsertTest(unittest.TestCase):
    def setUp(self):
        self.col = FakeCollection()
        self.model = sync.ensure_model(self.col, "Japani (Obsidian)")
        self.state = sync.RunState()
        self.card = sync.Card("abc", "負ける", "hävitä", "30 Sanasto/負ける.md", ["flashcards::vocab", "jlpt::n5"])

    def test_adds_then_leaves_unchanged_then_updates(self):
        sync.upsert(self.col, self.model, 7, self.card, self.state)
        self.assertEqual(self.state.counts["added"], 1)
        self.assertEqual(self.col.added[0][1], 7)
        self.assertEqual(self.col.added[0][0]["UID"], "abc")

        sync.upsert(self.col, self.model, 7, self.card, self.state)
        self.assertEqual(self.state.counts["unchanged"], 1)
        self.assertEqual(self.col.updated, [])

        changed = sync.Card("abc", "負ける", "hävitä; jäädä toiseksi", self.card.source, self.card.tags)
        sync.upsert(self.col, self.model, 7, changed, self.state)
        self.assertEqual(self.state.counts["updated"], 1)
        self.assertEqual(self.col.updated[0]["Back"], "hävitä; jäädä toiseksi")


class StateDocumentTest(unittest.TestCase):
    def test_failed_run_keeps_the_previous_lastSyncAt(self):
        os.environ["GITHUB_REPOSITORY"] = "Auua/learning-center"
        os.environ["GITHUB_RUN_ID"] = "123"
        state = sync.RunState(status="failed", errors=["boom"])
        doc = sync.state_document(state, synced=False)
        self.assertIsNone(doc["lastSyncAt"])
        self.assertEqual(doc["lastRun"]["url"], "https://github.com/Auua/learning-center/actions/runs/123")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sync" / "state.json"
            sync.write_state(path, doc, {"lastSyncAt": "2026-09-18T10:00:00Z"})
            written = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(written["lastSyncAt"], "2026-09-18T10:00:00Z")
        self.assertEqual(written["lastRun"]["status"], "failed")
        self.assertEqual(written["errors"], ["boom"])


if __name__ == "__main__":
    unittest.main()
