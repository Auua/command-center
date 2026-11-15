"""
Unit tests for the parts of sync.py that need no AnkiWeb: card collection
through the vault's exporter (media-only cards left out), state documents,
and the note index + upsert planner against a fake collection.

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
    # A listening card in both directions, as the real exporter flattens it,
    # listed before the text card that shares its translation.
    (vault / "30 Sanasto" / "110番.md").write_text(
        "---\ntype: vocab\n---\n## Kortit\n#flashcards/vocab\n"
        "!tts_43114135cf52.m4a::Onnettomuudessa soitetaan numeroon 110.\n"
        "Onnettomuudessa soitetaan numeroon 110.::!tts_43114135cf52.m4a\n"
        "Onnettomuudessa soitetaan numeroon 110.::事故のとき、110番に電話します。\n",
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
        return {"name": name, "id": 1700000000000 + len(self.models), "flds": [], "tmpls": []}

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


class FakeDb:
    """Answers the one query index_notes makes, in anki's storage format."""

    def __init__(self, col):
        self.col = col
        self.queries = 0

    def all(self, sql, model_id):
        self.queries += 1
        return [
            [nid, "\x1f".join(note[name] for name in self.col.field_order), " " + " ".join(note.tags) + " "]
            for nid, note in self.col.notes.items()
        ]


class FakeCollection:
    def __init__(self, existing_model=None, field_order=None):
        self.models = FakeModels({existing_model["name"]: existing_model} if existing_model else None)
        self.notes: dict[int, FakeNote] = {}
        self.added: list[tuple[FakeNote, int]] = []
        self.updated: list[FakeNote] = []
        self.field_order = field_order or sync.NOTE_FIELDS
        self.db = FakeDb(self)
        self._next = 1

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
            cards, files, _ = sync.collect_cards(vault, exporter)
        self.assertEqual(files, 2)
        card = next(c for c in cards if c.source == "30 Sanasto/負ける.md")
        self.assertEqual([c.source for c in cards].count("30 Sanasto/負ける.md"), 1)
        self.assertEqual((card.front, card.back), ("負ける", "hävitä"))
        self.assertEqual(card.tags, ["flashcards::vocab"])
        self.assertEqual(card.uid, exporter.uid_for("30 Sanasto/負ける.md", "負ける"))

    def test_leaves_out_media_only_cards_and_keeps_the_text_card_behind_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = make_vault(Path(tmp))
            cards, _, media_only = sync.collect_cards(vault, sync.load_exporter(vault))
        self.assertEqual(media_only, 2)
        kept = [(c.front, c.back) for c in cards if c.source == "30 Sanasto/110番.md"]
        self.assertEqual(kept, [("Onnettomuudessa soitetaan numeroon 110.", "事故のとき、110番に電話します。")])


class StripMediaTest(unittest.TestCase):
    def test_removes_flattened_embeds_and_the_line_breaks_they_leave(self):
        self.assertEqual(sync.strip_media("!anki_MNN_110番.mp3"), "")
        self.assertEqual(sync.strip_media("!kaavio.PNG<br>駅<br>!tts_ab12.m4a"), "駅")
        self.assertEqual(sync.strip_media("駅 !tts_ab12.m4a asema"), "駅  asema")

    def test_leaves_ordinary_text_alone(self):
        for text in ("すごい!<br>Hienoa!", "tiedosto.mp3 ilman huutomerkkiä", "Hei! Katso a.mp3x"):
            self.assertEqual(sync.strip_media(text), text)


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
        index = sync.index_notes(self.col, self.model)
        self.assertEqual(index, {})
        sync.upsert(self.col, self.model, 7, self.card, self.state, index)
        self.assertEqual(self.state.counts["added"], 1)
        self.assertEqual(self.col.added[0][1], 7)
        self.assertEqual(self.col.added[0][0]["UID"], "abc")

        # the same card again in the same run, then in the next run (fresh index)
        sync.upsert(self.col, self.model, 7, self.card, self.state, index)
        index = sync.index_notes(self.col, self.model)
        sync.upsert(self.col, self.model, 7, self.card, self.state, index)
        self.assertEqual(self.state.counts["unchanged"], 2)
        self.assertEqual(self.col.updated, [])

        changed = sync.Card("abc", "負ける", "hävitä; jäädä toiseksi", self.card.source, self.card.tags)
        sync.upsert(self.col, self.model, 7, changed, self.state, index)
        self.assertEqual(self.state.counts["updated"], 1)
        self.assertEqual(self.col.updated[0]["Back"], "hävitä; jäädä toiseksi")
        self.assertEqual(self.state.counts["added"], 1)
        self.assertEqual(self.col.db.queries, 2)  # one read per index, none per card

    def test_what_anki_normalises_is_not_a_change(self):
        index = sync.index_notes(self.col, self.model)
        sync.upsert(self.col, self.model, 7, self.card, self.state, index)
        stored = self.col.notes[1]
        stored["Back"] = "ha\u0308vita\u0308"  # the same text, decomposed
        stored.tags = ["Flashcards::Vocab", "JLPT::N5"]
        sync.upsert(self.col, self.model, 7, self.card, self.state, sync.index_notes(self.col, self.model))
        self.assertEqual(self.state.counts["unchanged"], 1)
        self.assertEqual(self.col.updated, [])

    def test_reads_uid_by_field_name_when_the_note_type_orders_fields_differently(self):
        order = ["Front", "Back", "UID", "Source"]
        col = FakeCollection({"name": "Japani (Obsidian)", "id": 5, "flds": [{"name": n} for n in order]}, order)
        model = sync.ensure_model(col, "Japani (Obsidian)")
        note = col.new_note(model)
        note.update({"UID": "abc", "Front": "負ける", "Back": "hävitä", "Source": self.card.source})
        note.tags = list(self.card.tags)
        col.add_note(note, 7)
        state = sync.RunState()
        sync.upsert(col, model, 7, self.card, state, sync.index_notes(col, model))
        self.assertEqual((state.counts["unchanged"], state.counts["added"]), (1, 0))


class Out:
    def __init__(self, required):
        self.required = required


class SyncingCollection:
    """Scripts what the server answers; records what the action did about it."""

    def __init__(self, answers, log=None):
        self.answers = list(answers)
        self.log = log if log is not None else []

    def sync_collection(self, auth, sync_media):
        self.log.append("sync")
        return Out(self.answers.pop(0))

    def close_for_full_sync(self):
        self.log.append("close")

    def full_upload_or_download(self, *, auth, server_usn, upload):
        self.log.append("upload" if upload else "download")
        self.log.append(f"usn={server_usn}")

    def reopen(self, after_full_sync=False):
        self.log.append("reopen")


class FullSyncRuleTest(unittest.TestCase):
    """ADR-026: a runner downloads freely and uploads only to an account with no cards."""

    def never(self, col):
        self.fail("the collection must not be discarded")

    def test_sync_down_takes_any_full_sync_as_a_download(self):
        for required in ("FULL_DOWNLOAD", "FULL_SYNC"):
            col = SyncingCollection([required])
            self.assertIs(sync.sync_down(col, "auth", self.never), col)
            self.assertEqual(col.log, ["sync", "close", "download", "usn=None", "reopen"])

    def test_sync_down_leaves_a_current_collection_alone(self):
        for required in ("NO_CHANGES", "NORMAL_SYNC"):
            col = SyncingCollection([required])
            sync.sync_down(col, "auth", self.never)
            self.assertEqual(col.log, ["sync"])

    def test_sync_down_discards_a_cache_that_asks_to_upload(self):
        log: list[str] = []
        stale = SyncingCollection(["FULL_UPLOAD"], log)
        fresh = SyncingCollection(["FULL_SYNC"], log)

        def start_over(col):
            self.assertIs(col, stale)
            log.append("start-over")
            return fresh

        self.assertIs(sync.sync_down(stale, "auth", start_over), fresh)
        self.assertEqual(log, ["sync", "start-over", "sync", "close", "download", "usn=None", "reopen"])

    def test_sync_down_never_uploads_even_if_asked_twice(self):
        stale = SyncingCollection(["FULL_UPLOAD"])
        with self.assertRaisesRegex(RuntimeError, "refusing"):
            sync.sync_down(stale, "auth", lambda col: SyncingCollection(["FULL_UPLOAD"]))
        self.assertNotIn("upload", stale.log)

    def test_sync_up_uploads_only_when_the_server_holds_no_cards(self):
        col = SyncingCollection(["FULL_UPLOAD"])
        sync.sync_up(col, "auth")
        self.assertEqual(col.log, ["sync", "close", "upload", "usn=None", "reopen"])

    def test_sync_up_refuses_a_full_sync_over_existing_cards(self):
        for required in ("FULL_SYNC", "FULL_DOWNLOAD"):
            col = SyncingCollection([required])
            with self.assertRaisesRegex(RuntimeError, f"requires {required} after writing; refusing"):
                sync.sync_up(col, "auth")
            self.assertEqual(col.log, ["sync"])

    def test_sync_up_after_an_ordinary_sync_does_nothing_more(self):
        col = SyncingCollection(["NO_CHANGES"])
        sync.sync_up(col, "auth")
        self.assertEqual(col.log, ["sync"])

    def test_a_failed_transfer_still_reopens_the_collection(self):
        col = SyncingCollection([])

        def boom(**kwargs):
            raise RuntimeError("network")

        col.full_upload_or_download = boom
        with self.assertRaisesRegex(RuntimeError, "network"):
            sync.full_transfer(col, "auth", upload=False)
        self.assertEqual(col.log, ["close", "reopen"])


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
