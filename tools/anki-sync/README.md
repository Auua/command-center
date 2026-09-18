# tools/anki-sync

Composite GitHub Action that syncs the learning-center vault's `## Kortit` cards to AnkiWeb
(ADR-026 as amended by ADR-040). The vault carries only a thin caller workflow; this folder is
the machinery, released by moving the `anki-sync-v1` tag.

- `sync.py` — parse (with the vault's own `sr_to_anki.py`), sync down, upsert by `UID`, sync
  up, write `sync/state.json`. Never full-uploads.
- `action.yml` — the composite steps: Python, collection cache, pinned `anki`, sync, commit state.
- `requirements.txt` — the pinned `anki` version (bump deliberately; see the runbook).
- `test_sync.py` — unit tests against a fake collection: `python3 -m unittest tools/anki-sync/test_sync.py`.

Local dry run against a vault clone (no AnkiWeb):

```
python3 tools/anki-sync/sync.py --repo /path/to/learning-center --dry-run
```

Caller workflow (in the vault), secrets `ANKIWEB_EMAIL` / `ANKIWEB_PASSWORD`, and the
one-time GitHub setting that lets a private repo use this private action, are in
`docs/runbook-learning-center.md` steps 7–9 and `docs/PHASE3_SETUP.md`.
