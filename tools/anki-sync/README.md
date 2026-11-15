# tools/anki-sync

Composite GitHub Action that syncs the learning-center vault's `## Kortit` cards to AnkiWeb
(ADR-026 as amended by ADR-040). The vault carries only a thin caller workflow; this folder is
the machinery, released by moving the `anki-sync-v1` tag.

- `sync.py` — parse (with the vault's own `sr_to_anki.py`), sync down, upsert by `UID`, sync
  up, write `sync/state.json`. Never full-uploads.
  - **Media-only cards are left out.** A card whose front or back is nothing but an embed
    (`![[tts_….m4a]]`, flattened by the exporter to `!tts_….m4a`) cannot work in Anki: the
    vault's audio folders are gitignored, so a runner has no file to upload. They are counted
    in `counts.skippedMedia`; the text card on the other side of the same sentence still syncs.
  - **One index read, no search per card.** The note type's notes are read once
    (`UID` → note); only cards that differ are loaded and written. A search per card scans the
    collection each time — at the vault's size (six figures of cards) that is the difference
    between seconds and half an hour on every push.
- `action.yml` — the composite steps: Python, collection cache, pinned `anki`, sync, commit state.
- `requirements.txt` — the pinned `anki` version (bump deliberately; see the runbook).
- `test_sync.py` — unit tests against a fake collection: `python3 -m unittest tools/anki-sync/test_sync.py`.

Local dry run against a vault clone (no AnkiWeb):

```
python3 tools/anki-sync/sync.py --repo /path/to/learning-center --dry-run
```

Caller workflow (in the vault), secrets `ANKIWEB_EMAIL` / `ANKIWEB_PASSWORD`, and the
one-time GitHub setting that lets a private repo use this action while it is private, are in
`docs/runbook-learning-center.md` steps 7–9 and `docs/PHASE3_SETUP.md`.
