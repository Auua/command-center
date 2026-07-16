# Runbook: learning-center repo + Anki sync setup

One-time setup for the learning center (ADR-024) and Anki sync (ADR-026). Everything here is
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

## 5. Commit the caller workflow

`.github/workflows/anki-sync.yml` in learning-center — this file is the whole footprint of
the sync machinery in that repo:

```yaml
name: anki-sync
on:
  push:
    branches: [main]
    paths: ['cards/**']
  schedule:
    - cron: '15 5 * * *'
  workflow_dispatch:
    inputs:
      mode:
        type: choice
        options: [sync, import]
        default: sync
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
          mode: ${{ inputs.mode || 'sync' }}
```

The `paths: ['cards/**']` filter is what keeps the Action's own `sync/state.json` commits
from retriggering it. `concurrency: anki-sync` coalesces bursts of card commits into at most
one running + one queued run.

## 6. Seed the word pool

From the monorepo, against a local clone of learning-center:

```
pnpm --filter @command-center/jmdict-ingest ingest -- --out ../learning-center
```

Review the generated `pool/japanese/` (manifest pins + shards), commit, push.

## 7. Release the sync action

Tag the monorepo commit that ships `tools/anki-sync` and push the tag:

```
git tag anki-sync-v1 && git push origin anki-sync-v1
```

Releasing a new sync version later = moving the tag (rollback = moving it back). Bump the
pinned `anki` pip version deliberately; the daily scheduled run is the alarm if AnkiWeb
stops accepting the old client.

## 8. Import the existing deck

learning-center → Actions → anki-sync → Run workflow → `mode: import`. Review the commit it
produces under `cards/japanese/imported/**`. Import is read-only against Anki — it never
syncs up.

## 9. Prove a sync

Run workflow with `mode: sync` (or just save a card from the widget). Green run,
`sync/state.json` commit, the note visible in AnkiWeb and on the phone after its next sync —
deck `Japanese`, note type `CC Japanese v1`, `CardId` field filled.

## Troubleshooting

- **Red run, "full upload required":** correct behavior (ADR-026's guard) — open desktop
  Anki, resolve the full-sync prompt there once, re-run the workflow.
- **Stale "Anki synced …" in the widget:** the status reads `sync/state.json`; check the
  repo's Actions tab — a run that crashed before committing state leaves it stale until the
  next run.
- **Sync suddenly failing after months:** likely a rejected old client — bump `anki==` in
  `tools/anki-sync/requirements.txt`, test, move the `anki-sync-v1` tag.
