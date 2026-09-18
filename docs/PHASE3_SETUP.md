# Phase 3 — one-time external setup

Everything the learning widgets need outside this repo, in order. Pair with
`docs/runbook-learning-center.md` (the vault-side detail) and `docs/PHASE2_SETUP.md` (done).
Total added cost: $0/mo.

## 1. Supabase migrations

SQL editor, in order, each idempotent:

- `0009_widget_layouts_instance_key.sql` (Phase 3A — per-instance widgets)
- `0010_notifications_learning_insert.sql` (Phase 3B — learning alerts in the bell)
- `0011_streaks.sql` (Phase 3C — streaks)

Check: `select column_name from information_schema.columns where table_name = 'widget_layouts';`
lists `instance_key`; `select * from public.streaks;` returns an empty set, not an error.

## 2. Vault token → Vercel (API project)

1. GitHub → Settings → Developer settings → Fine-grained tokens → generate: repository access
   **only `learning-center`**, permissions **Contents: Read and write**, expiry ≤ 1 year. Put the
   expiry date in your calendar (runbook step 2 has the rotation).
2. Vercel → API project (`command-center`) → Settings → Environment Variables:

   | Name                    | Value                  | Environments        |
   | ----------------------- | ---------------------- | ------------------- |
   | `GITHUB_LEARNING_REPO`  | `Auua/learning-center` | Production, Preview |
   | `GITHUB_LEARNING_TOKEN` | the PAT (Sensitive)    | Production, Preview |

3. Redeploy the API. `GET /api/v1/learning/vault-status` (with a JWT) answers
   `configured: true, state: "ok"` with the index counts.

## 3. Preview deployments (optional, for testing branches)

- API project → Settings → Deployment Protection → Vercel Authentication **off** for previews.
  Browsers cannot pass Vercel's SSO redirect on a cross-origin fetch, so a protected API
  preview shows up as a "CORS error" in every web preview. The API authenticates every route
  itself, so nothing is exposed.
- API project → `CORS_ORIGIN` in the **Preview** environment must contain
  `https://command-center-web-*-auuas-projects.vercel.app` too (Preview values are separate).

## 4. AnkiWeb sync (ADR-026 as amended by ADR-040)

1. **Allow the private action to be used from the vault repo:** command-center → Settings →
   Actions → General → Access → "Accessible from repositories owned by the user". Without this
   the vault's workflow fails at `uses:` with "repository not found".
2. **Tag the release** on `main` once `tools/anki-sync` is merged:

   ```
   git tag anki-sync-v1 && git push origin anki-sync-v1
   ```

   Later versions = moving the tag (rollback = moving it back).

3. **Vault secrets:** learning-center → Settings → Secrets and variables → Actions:
   `ANKIWEB_EMAIL`, `ANKIWEB_PASSWORD`. Consider a throwaway AnkiWeb account for the first run
   (runbook step 4).
4. **Merge the caller workflow** in the vault (branch `anki-sync`,
   `.github/workflows/anki-sync.yml`), then run it once from the Actions tab
   (`workflow_dispatch`). First run: full download of the collection (slow, normal), note type
   check — the existing `Japani (Obsidian)` must have fields `UID`, `Front`, `Back`, `Source` —
   then upserts by `UID`, then a `sync/state.json` commit.
5. **Check:** the WOTD and grammar cards' footers read "Anki synced N min ago"; AnkiWeb shows
   the notes in deck `Japani`.

## 5. Manual checklist

- [ ] Word of the day shows a word; "Learned it" commits `cc: wotd acknowledge …` to the vault
      (as `command-center[bot]`) and the streak pill appears after the next read.
- [ ] Grammar point shows the first N5 point in textbook order; "Next point" stamps `reviewed`.
- [ ] Streaks widget lists the sources you have used today.
- [ ] Bell: no `Learning …` rows (each appears only when something is actually wrong).
- [ ] Obsidian pulls the bot commits (obsidian-git auto-pull on).

## Troubleshooting

- **Widgets say "Learning vault not configured":** the env pair is missing on the deployed API,
  or set in only one environment.
- **"GitHub token expired":** rotate the PAT (runbook step 2); the bell also carries a row.
- **anki-sync red with "full UPLOAD required":** correct behaviour (ADR-026's guard); open
  desktop Anki, resolve the full-sync prompt there once, re-run the workflow.
- **anki-sync red with "lacks fields":** the existing note type's field names differ from
  `UID/Front/Back/Source`; rename them in Anki (Tools → Manage Note Types) to match the TSV
  import the vault's `sr_to_anki.py` already targets.
