# Runbook: learning-center repo + Anki sync setup

One-time setup for the learning center (ADR-024 as amended by ADR-040) and Anki sync (ADR-026). Everything here is
manual on purpose — see ADR-026's alternatives for why the app doesn't provision the other
repo itself.

## 1. Create the repo

Private repo `learning-center` (default branch `main`), empty apart from a README.

## 2. PAT for the API

GitHub → Settings → Developer settings → Fine-grained tokens: repository access =
**only `learning-center`**, permissions = **Contents: read and write**, nothing else.
Expiry is forced ≤ 1 year — put the renewal date in your calendar; rotation is: mint a new
token, swap `GITHUB_LEARNING_TOKEN`, revoke the old one.

Set in `apps/api/.env` (and the deploy host env):

```
GITHUB_LEARNING_REPO=<owner>/learning-center
GITHUB_LEARNING_TOKEN=github_pat_…
```

Both or neither — the API refuses to boot on a half-configured pair; with neither, the
Japanese widget shows "not configured".

## 3. Share the sync action across repos

command-center repo → Settings → Actions → General → Access: **"Accessible from repositories
owned by <owner>"**. This lets the learning repo's workflow use the composite action at
`tools/anki-sync` without a token.

## 4. AnkiWeb secrets

learning-center → Settings → Secrets and variables → Actions:

- `ANKIWEB_EMAIL`
- `ANKIWEB_PASSWORD`

Consider proving the pipeline against a **throwaway AnkiWeb account** first (ADR-026 open
question 3), then switching the secrets to the real one.

## 5. Vault hygiene + `obsidian-git` settings (ADR-040)

Before the first Action runs in the vault:

- Untrack the PDF-extraction intermediates and editor state, and purge them from history
  (they are copyrighted textbook pages and ~480 MB): add `Japanese/60 Lahteet/.mnn-rebuild/`,
  `Japanese/60 Lahteet/.kic-rebuild/`, `.DS_Store`, `.obsidian/workspace.json` to `.gitignore`,
  `git rm -r --cached` them, then rewrite history (`git filter-repo`) and force-push once.
- In the `obsidian-git` plugin settings turn on **pull before push** (auto-pull), so a backup push
  after an API commit is never rejected. API commits arrive as `command-center[bot]` with a
  `cc: <kind> <action> <path>` message and touch only the acted-on note's front-matter,
  `.cc/`, and (via the sync Action) `sync/`.
- Note identity is the vault path: renaming a note resets its day pin and re-creates its Anki
  card (review history lost) — the same cost as editing a card's front.

## 6. Commit the index workflow

`00 Meta/Scripts/cc_index.py` (next to `check_vault.py`, reusing its parser) emits
`.cc/index/{vocab,verb,kanji,grammar}.jsonl` + `.cc/index/manifest.json`. Run it once locally
(`python3 "Japanese/00 Meta/Scripts/cc_index.py"` from the repo root — the script resolves the
repo from its own location), commit the output, then commit the thin caller:

```yaml
name: cc-index
on:
  push:
    branches: [main]
    paths: ['Japanese/**/*.md']
  workflow_dispatch:
concurrency:
  group: cc-index
permissions:
  contents: write
jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: python3 "Japanese/00 Meta/Scripts/cc_index.py"
      - run: |
          git config user.name "command-center[bot]"
          git config user.email "command-center[bot]@users.noreply.github.com"
          git add .cc/index
          git diff --cached --quiet || git commit -m "cc: index rebuild"
          git pull --rebase origin main
          git push
```

The `pull --rebase` before the push absorbs an `obsidian-git` backup that landed during the run.
The `paths` filter excludes `.cc/**` by construction (only `Japanese/**/*.md` triggers), so an
index commit never re-triggers the indexer. The API reads only `.cc/index/**`.

## 7. Commit the sync caller workflow

`.github/workflows/anki-sync.yml` in learning-center — the whole footprint of the sync machinery
in that repo. The push trigger is the **content folders**, not `cards/**` (ADR-040):

```yaml
name: anki-sync
on:
  push:
    branches: [main]
    paths: ['Japanese/**/*.md', '!.cc/**', '!sync/**']
  schedule:
    - cron: '15 5 * * *'
  workflow_dispatch:
concurrency:
  group: anki-sync
permissions:
  contents: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: <owner>/command-center/tools/anki-sync@anki-sync-v1
        with:
          ankiweb-email: ${{ secrets.ANKIWEB_EMAIL }}
          ankiweb-password: ${{ secrets.ANKIWEB_PASSWORD }}
```

`concurrency: anki-sync` coalesces bursts of note commits into at most one running + one queued
run. There is no `mode: import` any more — the vault is the deck's source, and the sync parses
every `## Kortit` section the way `00 Meta/Scripts/sr_to_anki.py` does (UID = sha1 of
`<path>|<front>`, note type `Japani (Obsidian)`).

## 8. Release the sync action

Tag the monorepo commit that ships `tools/anki-sync` and push the tag:

```
git tag anki-sync-v1 && git push origin anki-sync-v1
```

Releasing a new sync version later = moving the tag (rollback = moving it back). Bump the
pinned `anki` pip version deliberately; the daily scheduled run is the alarm if AnkiWeb
stops accepting the old client.

## 9. Prove a sync

Acknowledge a word from the widget (or run the workflow by hand). Green run, `sync/state.json`
commit, the note visible in AnkiWeb and on the phone after its next sync — deck `Japani`, note
type `Japani (Obsidian)`, `UID` field filled.

## Troubleshooting

- **Red run, "full upload required":** correct behavior (ADR-026's guard) — open desktop
  Anki, resolve the full-sync prompt there once, re-run the workflow.
- **Stale "Anki synced …" in the widget:** the status reads `sync/state.json`; check the
  repo's Actions tab — a run that crashed before committing state leaves it stale until the
  next run.
- **Index stale in the widget's about panel:** check the vault's Actions tab for the last
  `cc-index` run; a schema change in the vault without a matching `cc_index.py` change shows as
  "vault schema changed" via `manifest.json`'s `schemaVersion`.
- **Sync suddenly failing after months:** likely a rejected old client — bump `anki==` in
  `tools/anki-sync/requirements.txt`, test, move the `anki-sync-v1` tag.
