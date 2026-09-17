# Phase 2 PR review — 2026-09-17

Reviewed `origin/phase2-web` at `2407482` (PR #22, which contains all of `origin/phase2-backend`,
PR #21). Build, lint, typecheck and unit tests pass on today's toolchain. Both PRs have been draft
since 2026-07-19 and have never run against a real deployment: the PR body's manual checklist
(real push receipt, iOS installed-PWA push, lock-screen copy, catch-up acceptance test) is
untouched, and migrations 0002–0007 may not be applied to the live Supabase project.

> **Applied 2026-09-17 on `phase2-web` (PR #22):** A1–A4 and B6–B10. A3 went further than the
> runbook reorder: the five Phase 2 env vars are now optional as a group, so the merge cannot
> take the deployed API down. Still open: A5 (apply migrations 0002–0008) and C11–C15.

## Verdict

The code is in good shape and matches ADR-039 closely: claim-before-send on
`UNIQUE (automation_id, slot)`, bell row as delivery of record, secret-guarded bodyless tick,
service-role client confined to one repository, SSRF closed at the contract layer, DST behaviour
pinned in tests. Merge it. The items below are ordered by what should happen before the merge,
what should ride along with it, and what can follow.

## A. Before merge

1. **Both branches now conflict with `main`.** PR #23 (ADR-040 + version baseline) touched
   `package.json` in all five packages and reflowed the §7 table in `docs/ADR.md`; the Phase 2
   branch edits the same files. Conflicts: root and four package manifests (versions), and
   `docs/ADR.md` (§4.4/§4.5/§5.1 additions and the 005/006/039 rows vs. the reflowed table plus
   row 040). Resolve once, on `phase2-web`, keeping the branch's versions (they are higher: root
   0.3.1, api 0.2.1, web 0.5.0, contracts 0.2.0, ui 0.1.0), bump root once more for the merge,
   and re-run Prettier on `docs/ADR.md`.
2. **Collapse the stack into one PR.** `phase2-web` is a strict superset of `phase2-backend`
   (10 commits ahead, 0 behind), and both conflict with `main` in the same files. Resolving twice
   is waste. Retarget #22 to `main`, close #21 as superseded, merge #22.
3. **Set the Vercel env before merging, not after.** `apps/api/src/config/env.ts` makes
   `SUPABASE_SECRET_KEY`, `TICK_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
   `VAPID_SUBJECT` required (fail-fast). `docs/PHASE2_SETUP.md` lists "branches merged and
   deployed" as a prerequisite and adds the env vars in steps 2–3. In that order the deployed API
   refuses to boot between the deploy and the env edit. Reorder the runbook: steps 2–3 first,
   then merge. (The web app needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY` the same way.) The
   alternative, making the five vars an optional all-or-nothing group like ADR-024's
   `GITHUB_LEARNING_*` pair, is more code for the same outcome; the reorder is enough.
4. **Flip ADR-039 to accepted in the same PR.** The branch implements it but leaves
   `Status: proposed`. Merging is the product owner's acceptance: set the status and date, add a
   Batch row in `REVIEW-QUEUE.md`. The full ADR-005 record in `docs/adr/foundation/` still reads
   as an active decision; it needs the same "deferred, not implemented" note the §7 row got.
5. **Apply migrations 0002–0007** in the Supabase SQL editor (runbook step 1 already has the
   check query for 0002/0003). Nothing in Phase 2 can be verified until this is done.

## B. Ride-along fixes (small, worth doing in the same PR)

6. **Event dispatch may be cut off on Vercel.** `TasksService` emits `task.completed` with
   `emit()` (not awaited) and the listener runs the full claim → bell → push tail after the
   PATCH response is sent. Vercel does not guarantee post-response execution without
   `waitUntil`. The design self-heals (the run stays `pending`, the 5-minute stale sweep retries)
   but that turns ADR-039's "faster, not slower" into "usually within 5 minutes". Either await
   the dispatch in the request (`emitAsync`, a few hundred ms on task completion) or wrap the
   listener body in `waitUntil` from `@vercel/functions`. Awaiting is simpler and honest.
7. **Retry can duplicate the bell row.** If an invocation dies between `insertNotification` and
   `updateRunStatus`, the stale sweep re-runs `dispatchRun` and inserts a second notification for
   the same slot. Push is deduped by the OS `tag`; the bell is not. Add a nullable
   `notification_id` column to `automation_runs`, write it immediately after the bell insert, and
   have `dispatchRun` skip the insert when it is already set. One migration, three lines.
8. **Cross-module import.** `automation/task-completed.listener.ts` imports the event key and
   payload type from `../tasks/`. ADR §4.1 and ADR-014 put shared event contracts in
   `packages/contracts` precisely so domain modules never import each other. Move
   `TASK_COMPLETED_EVENT` and `TaskCompletedEvent` to contracts.
9. **Client-side slot sort is redundant and wrong on DST days.** The API already returns slots
   sorted by UTC; the widget re-sorts with `localeCompare` on ISO strings that carry the user's
   offset. On the two days a year the offset changes mid-day, string order and time order
   disagree. Drop the client sort.
10. **Interval schedules are unreachable.** The contract, compiler and evaluator support
    `interval` (5 min to 12 h), templates never use it, and the builder shows it read-only. Either
    add an "every N" option to the builder (a select over `EVERY_MINUTES_OPTIONS`) or say in
    ADR-015 that interval is API-only in v1. Adding it is ~40 lines.

## C. Follow-ups (separate PRs)

11. **"Send test notification" action.** Every item on the manual checklist needs a slot to
    fire. A `POST /notifications/test` that writes a bell row and pushes to the caller's
    subscriptions, wired to a button in the permission banner or the widget's settings, makes
    the iOS/lock-screen/receipt checks a ten-second job and doubles as the runbook's smoke test.
12. **Timezone drift hint.** The profile timezone is captured once, on first load, and there is
    no UI to see or change it (Phase 4). Cheap interim: when the browser timezone differs from
    the stored one, show a one-line hint in the reminders widget with a "use this timezone"
    button that PUTs the profile.
13. **`notifications` update policy is wider than mark-read.** The RLS policy lets the user
    update any column of their own rows (title, body, source). Harmless single-user, but a
    trigger or a column-level grant that only allows `read_at` would match the intent.
14. **Tick duration on Vercel.** Pushes are sent serially inside the tick. At personal scale
    that is sub-second; if the run ever grows, `Promise.allSettled` over subscriptions is the
    knob. Also confirm `maxDuration` on the API project covers the 60-minute catch-up case.
15. **Widget SDK.** This branch closes one of the three SDK gaps from the project review:
    `WidgetCard` now renders `quickActions` through a small bus. Settings panel and layout
    editing are still open and still block per-instance widgets (ADR-013).

## Not issues, checked

- Migrations 0004–0007 are idempotent; RLS on every table; `scheduler_state` has RLS with no
  policies and is reached only through the service-role repository.
- `sw.js` has no fetch handler, `Cache-Control: no-store`, and the middleware matcher excludes
  `sw.js` and `manifest.webmanifest`. Icons and `apple-icon.png` are in place.
- The tick route is `@Public()`, secret-checked with a constant-time digest compare, 401 with
  no body, and rate-limited by IP through the global throttler.
- Push endpoints are allowlisted to known browser push hosts and logged as hash prefixes only.
- TTL on pushes (3600 s) matches the 60-minute catch-up cap.
- `luxon`, `cron-parser` v5 and `web-push` are the only new runtime dependencies; all current.
