#!/usr/bin/env python3
"""
Anki sync for the learning-center vault (ADR-026 as amended by ADR-040).

Runs inside the vault checkout (the caller workflow lives there; this
script ships from command-center as a composite action). Steps, in order:

  1. parse every `## Kortit` card with the vault's own exporter
     (`<vault>/00 Meta/Scripts/sr_to_anki.py`) — same UID, same tags;
     cards whose front or back is nothing but a media embed are left out
     (the vault's audio is local-only, so an Action has nothing to upload);
  2. open the (cached or fresh) local collection, log in, SYNC DOWN;
  3. ensure the deck and the note type exist;
  4. upsert one note per UID (index the note type's notes once → update the
     ones that differ, add the missing ones);
  5. SYNC UP;
  6. write `sync/state.json` (the caller commits it).

Full-sync rule: a CI runner must never overwrite cards on AnkiWeb.
  - Before writing, a required full sync is always taken as a DOWNLOAD: the
    runner's collection is a cache. A cache that wants to upload (a run that
    died before syncing up) is thrown away first.
  - After writing, the only full sync performed is the UPLOAD anki asks for
    when AnkiWeb holds no cards at all — the first sync of an empty account,
    where there is nothing to overwrite. Any other full sync fails the run.

    python3 sync.py --repo . --vault-dir Japanese --state sync/state.json
    python3 sync.py --repo . --dry-run          # parse + plan only, no AnkiWeb

`ANKI_SYNC_ENDPOINT` (or --endpoint) points the sync at another server, e.g.
a local `python -m anki.syncserver` for an end-to-end rehearsal.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
import traceback
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STATE_SCHEMA_VERSION = 1
NOTE_FIELDS = ["UID", "Front", "Back", "Source"]
FIELD_SEPARATOR = "\x1f"  # how anki joins a note's fields in notes.flds
PROGRESS_EVERY = 20_000

# The exporter flattens wikilinks, so an Obsidian embed `![[tts_ab12.m4a]]`
# reaches us as the text `!tts_ab12.m4a`. The files themselves are gitignored
# in the vault (local-only audio), so they cannot be uploaded from a runner.
MEDIA_RE = re.compile(
    r"!\S+?\.(?:mp3|m4a|wav|ogg|opus|flac|aac|webm|mp4|mov|png|jpe?g|gif|webp|svg|pdf)(?![A-Za-z0-9])",
    re.IGNORECASE,
)


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


def strip_media(text: str) -> str:
    """Drop flattened media embeds; tidy the `<br>` joins they leave behind."""
    if not MEDIA_RE.search(text):
        return text
    lines = (line.strip() for line in MEDIA_RE.sub("", text).split("<br>"))
    return "<br>".join(line for line in lines if line)


def collect_cards(vault: Path, exporter) -> tuple[list[Card], int, int]:
    """Every syncable card in the vault, UID-deduplicated like the exporter does.

    Returns (cards, files with cards, cards left out as media-only). Media is
    removed before a card is identified, so a listening card never takes the
    UID of the text card that shares its other side.
    """
    seen: set[str] = set()
    cards: list[Card] = []
    files = 0
    media_only = 0
    for path in sorted(vault.rglob("*.md")):
        if any(part in exporter.SKIP_DIRS for part in path.parts):
            continue
        parsed = exporter.parse_file(path, vault)
        if parsed:
            files += 1
        for raw_front, raw_back, rel, tags in parsed:
            front, back = strip_media(raw_front), strip_media(raw_back)
            if not front or not back:
                media_only += 1
                continue
            uid = exporter.uid_for(rel, front)
            if uid in seen:
                continue
            seen.add(uid)
            cards.append(Card(uid, front, back, rel, sorted(set(tags))))
    return cards, files, media_only


# ------------------------------------------------------------------ state

@dataclass
class RunState:
    status: str = "ok"
    counts: dict[str, int] = field(default_factory=lambda: {
        "cards": 0, "files": 0, "skippedMedia": 0,
        "added": 0, "updated": 0, "unchanged": 0, "failed": 0,
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


@dataclass
class Known:
    """A note of our note type as the collection holds it right now."""
    note_id: int
    fields: dict[str, str]
    tags: list[str]


def same_text(a: str, b: str) -> bool:
    # anki stores NFC; a vault note written on macOS may not be.
    return unicodedata.normalize("NFC", a) == unicodedata.normalize("NFC", b)


def same_tags(a: list[str], b: list[str]) -> bool:
    # anki keeps the capitalisation of a tag it already knows.
    return sorted(tag.casefold() for tag in a) == sorted(tag.casefold() for tag in b)


def index_notes(col, model) -> dict[str, Known]:
    """UID -> note for every note of the note type, read in one query.

    Looking each card up with a search is a scan of the whole collection per
    card — quadratic, and the vault holds six figures of cards.
    """
    names = [f["name"] for f in model["flds"]]
    index: dict[str, Known] = {}
    for note_id, flds, tags in col.db.all("select id, flds, tags from notes where mid = ?", model["id"]):
        fields = dict(zip(names, flds.split(FIELD_SEPARATOR)))
        uid = fields.get("UID", "")
        if uid and uid not in index:
            index[uid] = Known(note_id, fields, tags.split())
    return index


def upsert(col, model, deck_id: int, card: Card, state: RunState, index: dict[str, Known]) -> None:
    fields = {"UID": card.uid, "Front": card.front, "Back": card.back, "Source": card.source}
    known = index.get(card.uid)
    if known is not None:
        if same_tags(known.tags, card.tags) and all(
            same_text(known.fields.get(key, ""), value) for key, value in fields.items()
        ):
            state.counts["unchanged"] += 1
            return
        note = col.get_note(known.note_id)
        for key, value in fields.items():
            note[key] = value
        note.tags = list(card.tags)
        col.update_note(note)
        index[card.uid] = Known(known.note_id, fields, list(card.tags))
        state.counts["updated"] += 1
        return
    note = col.new_note(model)
    for key, value in fields.items():
        note[key] = value
    note.tags = list(card.tags)
    col.add_note(note, deck_id)
    index[card.uid] = Known(note.id, fields, list(card.tags))
    state.counts["added"] += 1


def sync_required_name(out) -> str:
    """Map anki's ChangesRequired enum to a stable name across versions."""
    required = getattr(out, "required", None)
    try:
        from anki.sync_pb2 import SyncCollectionResponse  # type: ignore

        return SyncCollectionResponse.ChangesRequired.Name(required)
    except Exception:  # pragma: no cover - older/newer layouts
        return str(required)


def full_transfer(col, auth, upload: bool) -> None:
    """One full upload or download, framed the way the desktop client does it."""
    col.close_for_full_sync()
    try:
        # server_usn=None: no background media sync — this collection has no media.
        col.full_upload_or_download(auth=auth, server_usn=None, upload=upload)
    finally:
        col.reopen(after_full_sync=True)  # the backend reopens whatever the outcome


def sync_down(col, auth, start_over):
    """Step 2: make the local collection current. Returns the collection to use."""
    required = sync_required_name(col.sync_collection(auth, False))
    if required == "FULL_UPLOAD":
        # Only a local collection holding cards the server never received asks
        # for this — here, the cache of a run that died before syncing up.
        print("sync: the cached collection was never synced up — starting from an empty one")
        col = start_over(col)
        required = sync_required_name(col.sync_collection(auth, False))
    if required in ("FULL_DOWNLOAD", "FULL_SYNC"):
        print(f"sync: {required} → full download")
        full_transfer(col, auth, upload=False)
    elif required == "FULL_UPLOAD":
        raise RuntimeError("AnkiWeb asks an empty collection for a full UPLOAD; refusing")
    return col


def sync_up(col, auth) -> None:
    """Step 5: send what was written."""
    required = sync_required_name(col.sync_collection(auth, False))
    if required == "FULL_UPLOAD":
        # anki reports FULL_UPLOAD (upload possible, download not) only when the
        # server holds no cards and the local collection does: the first sync of
        # an empty account. Nothing on AnkiWeb can be overwritten.
        print("sync: AnkiWeb holds no cards — first sync of this account, uploading the collection")
        full_transfer(col, auth, upload=True)
    elif required in ("FULL_SYNC", "FULL_DOWNLOAD"):
        raise RuntimeError(
            f"AnkiWeb requires {required} after writing; refusing — its collection holds cards and "
            "changed underneath this run. Sync desktop Anki, then re-run"
        )


def run_sync(args, cards: list[Card], state: RunState) -> None:
    from anki.collection import Collection  # heavy import, only when syncing

    email = os.environ.get("ANKIWEB_EMAIL", "")
    password = os.environ.get("ANKIWEB_PASSWORD", "")
    if not email or not password:
        raise RuntimeError("ANKIWEB_EMAIL / ANKIWEB_PASSWORD are not set")

    collection_path = Path(args.collection).expanduser()
    collection_path.parent.mkdir(parents=True, exist_ok=True)

    def start_over(stale):
        stale.close()
        for suffix in ("", "-wal", "-shm"):
            Path(f"{collection_path}{suffix}").unlink(missing_ok=True)
        return Collection(str(collection_path))

    col = Collection(str(collection_path))
    try:
        endpoint = args.endpoint or None
        auth = col.sync_login(username=email, password=password, endpoint=endpoint)
        if endpoint and not auth.endpoint:
            auth.endpoint = endpoint

        # 2. sync down first — never write before the collection is current.
        col = sync_down(col, auth, start_over)

        # 3. deck + note type
        model = ensure_model(col, args.note_type)
        deck_id = col.decks.id(args.deck)

        # 4. upsert every card; one bad card never fails the run
        index = index_notes(col, model)
        print(f"sync: {len(index)} notes of '{args.note_type}' already in the collection")
        for done, card in enumerate(cards, start=1):
            try:
                upsert(col, model, deck_id, card, state, index)
            except Exception as error:  # noqa: BLE001
                state.counts["failed"] += 1
                state.errors.append(f"{card.source}: {card.front[:40]}: {error}")
            if done % PROGRESS_EVERY == 0:
                print(f"sync: {done}/{len(cards)} cards", flush=True)

        # 5. sync up
        sync_up(col, auth)

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
    parser.add_argument("--endpoint", default=os.environ.get("ANKI_SYNC_ENDPOINT", ""),
                        help="sync server other than AnkiWeb (testing / self-hosted)")
    parser.add_argument("--dry-run", action="store_true", help="parse and report only; no AnkiWeb")
    args = parser.parse_args()

    repo = args.repo.resolve()
    vault = repo / args.vault_dir
    state_path = repo / args.state
    previous = read_previous(state_path)
    state = RunState()

    try:
        exporter = load_exporter(vault)
        cards, files, media_only = collect_cards(vault, exporter)
        state.counts["cards"] = len(cards)
        state.counts["files"] = files
        state.counts["skippedMedia"] = media_only
        print(f"parsed {len(cards)} cards from {files} files ({media_only} media-only cards left out)")
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
