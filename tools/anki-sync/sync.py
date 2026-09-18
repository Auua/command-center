#!/usr/bin/env python3
"""
Anki sync for the learning-center vault (ADR-026 as amended by ADR-040).

Runs inside the vault checkout (the caller workflow lives there; this
script ships from command-center as a composite action). Steps, in order:

  1. parse every `## Kortit` card with the vault's own exporter
     (`<vault>/00 Meta/Scripts/sr_to_anki.py`) — same UID, same tags;
  2. open the (cached or fresh) local collection, log in, SYNC DOWN;
  3. ensure the deck and the note type exist;
  4. upsert one note per UID (find by the `UID` field → update, else add);
  5. SYNC UP;
  6. write `sync/state.json` (the caller commits it).

Full-sync rule: a required full DOWNLOAD is accepted (we only lose the
cache); a required full UPLOAD fails the run red — a CI runner must never
overwrite the user's real collection.

    python3 sync.py --repo . --vault-dir Japanese --state sync/state.json
    python3 sync.py --repo . --dry-run          # parse + plan only, no AnkiWeb
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STATE_SCHEMA_VERSION = 1
NOTE_FIELDS = ["UID", "Front", "Back", "Source"]


# ---------------------------------------------------------------- parsing

def load_exporter(vault: Path):
    """Import the vault's sr_to_anki.py as a module (its parser is the truth)."""
    script = vault / "00 Meta" / "Scripts" / "sr_to_anki.py"
    if not script.is_file():
        raise FileNotFoundError(f"exporter not found: {script}")
    spec = importlib.util.spec_from_file_location("sr_to_anki", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["sr_to_anki"] = module
    spec.loader.exec_module(module)
    return module


@dataclass
class Card:
    uid: str
    front: str
    back: str
    source: str
    tags: list[str]


def collect_cards(vault: Path, exporter) -> tuple[list[Card], int]:
    """Every card in the vault, UID-deduplicated like the exporter does."""
    seen: set[str] = set()
    cards: list[Card] = []
    files = 0
    for path in sorted(vault.rglob("*.md")):
        if any(part in exporter.SKIP_DIRS for part in path.parts):
            continue
        parsed = exporter.parse_file(path, vault)
        if parsed:
            files += 1
        for front, back, rel, tags in parsed:
            uid = exporter.uid_for(rel, front)
            if uid in seen:
                continue
            seen.add(uid)
            cards.append(Card(uid, front, back, rel, sorted(set(tags))))
    return cards, files


# ------------------------------------------------------------------ state

@dataclass
class RunState:
    status: str = "ok"
    counts: dict[str, int] = field(default_factory=lambda: {
        "cards": 0, "files": 0, "added": 0, "updated": 0, "unchanged": 0, "failed": 0,
    })
    decks: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def state_document(state: RunState, synced: bool) -> dict[str, Any]:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    repo = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    return {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "lastSyncAt": now if synced else None,
        "lastRun": {
            "at": now,
            "status": state.status,
            "runId": run_id,
            "url": f"{server}/{repo}/actions/runs/{run_id}" if repo and run_id else None,
        },
        "counts": state.counts,
        "decks": state.decks,
        "errors": state.errors,
    }


def write_state(path: Path, document: dict[str, Any], previous: dict[str, Any] | None) -> None:
    # A failed run keeps the last successful lastSyncAt so the widget's
    # "synced N ago" stays honest.
    if document["lastSyncAt"] is None and previous:
        document["lastSyncAt"] = previous.get("lastSyncAt")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_previous(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# ------------------------------------------------------------------- anki

def ensure_model(col, name: str):
    model = col.models.by_name(name)
    if model is not None:
        names = [f["name"] for f in model["flds"]]
        missing = [f for f in NOTE_FIELDS if f not in names]
        if missing:
            raise RuntimeError(
                f"note type '{name}' exists but lacks fields {missing}; expected {NOTE_FIELDS}"
            )
        return model
    model = col.models.new(name)
    for field_name in NOTE_FIELDS:
        col.models.add_field(model, col.models.new_field(field_name))
    template = col.models.new_template("Kortti")
    template["qfmt"] = "{{Front}}"
    template["afmt"] = '{{FrontSide}}<hr id="answer">{{Back}}<br><small>{{Source}}</small>'
    col.models.add_template(model, template)
    col.models.add(model)
    return col.models.by_name(name)


def upsert(col, model, deck_id: int, card: Card, state: RunState) -> None:
    uid_query = f'"UID:{card.uid}"'
    note_ids = col.find_notes(uid_query)
    fields = {"UID": card.uid, "Front": card.front, "Back": card.back, "Source": card.source}
    if note_ids:
        note = col.get_note(note_ids[0])
        changed = False
        for key, value in fields.items():
            if note[key] != value:
                note[key] = value
                changed = True
        if sorted(note.tags) != card.tags:
            note.tags = list(card.tags)
            changed = True
        if changed:
            col.update_note(note)
            state.counts["updated"] += 1
        else:
            state.counts["unchanged"] += 1
        return
    note = col.new_note(model)
    for key, value in fields.items():
        note[key] = value
    note.tags = list(card.tags)
    col.add_note(note, deck_id)
    state.counts["added"] += 1


def sync_required_name(out) -> str:
    """Map anki's ChangesRequired enum to a stable name across versions."""
    required = getattr(out, "required", None)
    try:
        from anki.sync_pb2 import SyncCollectionResponse  # type: ignore

        return SyncCollectionResponse.ChangesRequired.Name(required)
    except Exception:  # pragma: no cover - older/newer layouts
        return str(required)


def run_sync(args, cards: list[Card], state: RunState) -> None:
    from anki.collection import Collection  # heavy import, only when syncing

    email = os.environ.get("ANKIWEB_EMAIL", "")
    password = os.environ.get("ANKIWEB_PASSWORD", "")
    if not email or not password:
        raise RuntimeError("ANKIWEB_EMAIL / ANKIWEB_PASSWORD are not set")

    collection_path = Path(args.collection).expanduser()
    collection_path.parent.mkdir(parents=True, exist_ok=True)
    col = Collection(str(collection_path))
    try:
        auth = col.sync_login(username=email, password=password, endpoint=None)

        # 2. sync down first — never write before the collection is current.
        out = col.sync_collection(auth, False)
        required = sync_required_name(out)
        if required in ("FULL_DOWNLOAD", "FULL_SYNC"):
            print(f"sync: {required} → full download")
            col.full_upload_or_download(auth=auth, server_usn=out.server_usn, upload=False)
        elif required == "FULL_UPLOAD":
            raise RuntimeError("AnkiWeb requires a full UPLOAD; refusing (resolve once in desktop Anki)")

        # 3. deck + note type
        model = ensure_model(col, args.note_type)
        deck_id = col.decks.id(args.deck)

        # 4. upsert every card; one bad card never fails the run
        for card in cards:
            try:
                upsert(col, model, deck_id, card, state)
            except Exception as error:  # noqa: BLE001
                state.counts["failed"] += 1
                state.errors.append(f"{card.source}: {card.front[:40]}: {error}")

        # 5. sync up
        out = col.sync_collection(auth, False)
        required = sync_required_name(out)
        if required in ("FULL_UPLOAD", "FULL_SYNC", "FULL_DOWNLOAD"):
            raise RuntimeError(f"AnkiWeb requires {required} after writing; refusing — re-run after resolving in desktop Anki")

        # per-deck stats for the widget
        deck_id_int = int(deck_id)
        state.decks = [{
            "name": args.deck,
            "notes": len(col.find_notes(f'"deck:{args.deck}"')),
            "dueToday": len(col.find_cards(f'"deck:{args.deck}" is:due')),
            "new": len(col.find_cards(f'"deck:{args.deck}" is:new')),
        }]
        print(f"sync: deck {args.deck} (id {deck_id_int}) {state.decks[0]}")
    finally:
        col.close()


# ------------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--vault-dir", default="Japanese")
    parser.add_argument("--state", default="sync/state.json")
    parser.add_argument("--deck", default="Japani")
    parser.add_argument("--note-type", default="Japani (Obsidian)")
    parser.add_argument("--collection", default="~/.anki-sync/collection.anki2")
    parser.add_argument("--dry-run", action="store_true", help="parse and report only; no AnkiWeb")
    args = parser.parse_args()

    repo = args.repo.resolve()
    vault = repo / args.vault_dir
    state_path = repo / args.state
    previous = read_previous(state_path)
    state = RunState()

    try:
        exporter = load_exporter(vault)
        cards, files = collect_cards(vault, exporter)
        state.counts["cards"] = len(cards)
        state.counts["files"] = files
        print(f"parsed {len(cards)} cards from {files} files")
        if args.dry_run:
            print(json.dumps(state_document(state, synced=False), ensure_ascii=False, indent=2))
            return 0
        run_sync(args, cards, state)
        if state.counts["failed"]:
            state.status = "ok"  # partial per-card failures are recorded, not fatal
        write_state(state_path, state_document(state, synced=True), previous)
        print(f"done: {state.counts}")
        return 0
    except Exception as error:  # noqa: BLE001
        traceback.print_exc()
        state.status = "failed"
        state.errors.append(str(error))
        write_state(state_path, state_document(state, synced=False), previous)
        return 1


if __name__ == "__main__":
    sys.exit(main())
