# ADR-028: Pomodoro timer widget

- **Status:** proposed
- **Date:** 2026-07-14
- **Review:** claude-reviewed — pending product-owner approval

## Context

The README lists a Pomodoro timer under "Future Extensions"; the ARD names it in G4. Nothing is implemented — this is a planning ADR.

A Pomodoro timer looks trivial and is not. Every widget so far has been "render server state, write server state"; this is the first widget whose primary artifact is **a running clock in a browser tab**, and the browser is actively hostile to that:

- `setInterval` drifts (it guarantees "not before", never "on time"), and background tabs are throttled to ≥1 s — Chrome throttles further (and may freeze timers entirely in an occluded tab after minutes), iOS Safari suspends backgrounded tabs outright. A 25-minute countdown implemented by decrementing a counter every tick will simply be **wrong**, usually late, sometimes wildly.
- The user closes the laptop lid, switches tabs, opens the dashboard in a second tab. Which of these is "the" timer?
- The phase-end signal must actually reach the user. We have a whole push pipeline (§4.5, ADR-015) — and it is the wrong tool here, for a reason worth writing down.

Also in play: the widget SDK (§4.2), all data via `/api/v1` (ADR-004/007), Postgres/Mongo split (§4.3), the event bus (§4.1) so streaks (ADR-014) and automations (ADR-015) can react, NFR-11 (a11y — a live-updating number is a screen-reader hazard), NFR-12 (i18n), NFR-8 (cost — a server-side timer would need infrastructure this app doesn't have).

## Decision

### Timer integrity — timestamps, not tick counting

**The timer's state is a deadline, not a countdown.** A running phase is `{ phase, startedAt (epoch ms), endsAt (epoch ms), pausedAt? }`. The rendering loop computes `remaining = endsAt - Date.now()` on every frame; the interval exists **only to schedule repaints**, never to accumulate elapsed time. Consequences that fall out for free:

- Drift is structurally impossible — a throttled tab repaints less often but reads the same wall clock, so the displayed value is always correct when visible.
- A tab throttled or frozen for 20 minutes, on regaining focus, computes `remaining ≤ 0` and immediately fires the phase-end path (with a `visibilitychange` + `focus` listener re-evaluating on wake), rather than "resuming" a stale countdown.
- Repaint cadence: `requestAnimationFrame`-driven while visible (we only need ~1 Hz visual granularity, so we repaint on second boundaries), and we do **not** attempt to keep painting while hidden. Under `prefers-reduced-motion` the progress ring stops animating; the digits still update.
- **Wall-clock caveat, accepted:** `Date.now()` jumps if the system clock changes. We cross-check with `performance.now()` deltas and, if they disagree by > 2 s, trust the monotonic clock and re-anchor `endsAt`. Suspend/resume (lid close) advances both, which is what we want — a pomodoro that spanned a 2-hour sleep is over, not paused.

Phase-end firing is **client-side**: a single `setTimeout(remaining)` armed for the deadline, plus the visibility re-check as the safety net (a throttled `setTimeout` fires late, the re-check catches it). No server round trip is on the critical path.

### Notifications — local, not push

We will fire phase-end alerts with the **local `Notification` API from the page** (plus an optional short audio cue, off by default), **not** through the Web Push pipeline (ADR-015 / NotificationModule). Reasons, in order:

1. **A server round trip for a 25-minute local timer is silly.** The client already knows the deadline exactly; routing it through worker → pg-boss → VAPID → vendor push service adds three failure modes and up to a minute of latency (NFR-3 targets "within 60 s" — unacceptable for a timer whose whole value is precision) to solve a problem the browser tab is already sitting there able to solve.
2. It would require persisting every pomodoro's deadline server-side just so the worker could schedule it, and cancelling that job on every pause/skip — a distributed-state problem invented from nothing.
3. Push permission UX is expensive (ADR-015: browsers punish unsolicited prompts, iOS needs an installed PWA). A local `Notification` uses the **same** permission grant, so if the user has already enabled push for reminders we reuse it silently.

**Permission handling reuses ADR-015's rule verbatim:** never requested on load. The widget shows an inline "Notify me when the timer ends" affordance; that explicit gesture is the only call site of `Notification.requestPermission()`. If permission is `denied`, the timer degrades honestly: in-page phase-end state (title change, `role="alert"` announcement, optional sound) plus the document `title` showing the remaining time, so a backgrounded tab still signals in the tab strip. No silent failure.

**Deliberate limitation:** if the browser is closed entirely, the timer does not fire. That is correct — a pomodoro you are not present for is not a pomodoro. We are not building a background timer.

### Persistence — completed pomodoros only

**Running timer state is not server state.** It lives in the client, mirrored to `localStorage` so a refresh or an accidental navigation restores the running phase from its `endsAt` (which is exactly why the deadline representation matters — restoring a "counter" would be meaningless).

**Completed focus sessions _are_ persisted**, to Postgres, because they are the interesting data: daily counts, "focused 4 pomodoros today", and streak eligibility. On phase end (a completed **focus** phase only — breaks are not recorded), the client `POST`s the session. Interrupted/abandoned sessions are **not** recorded (see Alternatives).

### Single active timer, cross-tab

**Exactly one timer runs per user.** The mechanism is the shared `localStorage` state plus a `BroadcastChannel("pomodoro")`: every tab renders from the same `{ phase, endsAt }` record, any tab's start/pause/skip broadcasts the new record, and all tabs re-render identically. There is no "leader" tab and no election — the state is the source of truth, not the tab. Notification firing _is_ leader-gated (a `Web Locks` / `navigator.locks.request("pomodoro-notify")` holder fires; the others don't) so two open tabs produce one notification, not two. If the lock API is unavailable, we de-duplicate on `sessionKey` in `localStorage` — the same idempotency-key instinct as ADR-005's job dedupe, applied client-side.

Cross-**device** concurrency (phone and laptop both running) is **not** synchronized in v1. It would require realtime state (Supabase realtime is available, §3.1) for a feature nobody asked for. Flagged as Q-C.

### Data model

Postgres, owned solely by a new `PomodoroModule`, RLS `user_id = auth.uid()` (§5.1):

```sql
pomodoro_sessions (
  id           uuid PK default gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users,
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz NOT NULL,
  duration_min int  NOT NULL CHECK (duration_min between 1 and 120),
  local_date   date NOT NULL,          -- home-tz day, 03:00 grace boundary (ADR-014)
  task_id      uuid,                   -- opaque reference, NOT a FK (§4.3 cross-module rule)
  client_key   text NOT NULL,          -- idempotency: uuid minted at phase start
  UNIQUE (user_id, client_key)
);
```

`UNIQUE (user_id, client_key)` is the idempotency net: a retried POST (offline blip, two tabs racing the lock) can never double-count a pomodoro — the same "make the duplicate unrepresentable" move as `streak_days` / `habit_marks` (ADR-014/027). `local_date` is computed server-side from the stored home timezone with the 03:00 grace boundary, so a 00:30 pomodoro credits the day that just ended and the daily count agrees with every other widget's "today". `task_id` is stored as an opaque id and composed at the API layer if the widget ever shows "what I focused on" — no cross-module FK, no cross-DB join (§4.3).

Break phases are not stored. They carry no information the focus rows don't imply.

### API contract

Under `/api/v1/pomodoro`, zod in `packages/contracts`, `.strict()` writes:

- `POST /pomodoro/sessions` `{ clientKey, startedAt, endedAt, durationMin, taskId? }` → the created session; a repeat `clientKey` returns the existing row with 200 (idempotent, not a 409).
- `GET /pomodoro/today` → `{ localDate, count, totalMinutes, sessions: [...] }`.
- `GET /pomodoro/stats?days=N` → per-day counts (N ≤ 90), server-aggregated in SQL in the home timezone — the endpoint ADR-009 said future chart widgets should have from the start, rather than shipping client-side bucketing and calling it a gap.

The **timer itself has no endpoints.** There is no `POST /pomodoro/start`. Start/pause/skip are client state; only completion crosses the wire.

### Events

Completing a focus phase emits `pomodoro.completed` (`{ userId, sessionId, localDate, durationMin }`) on the in-process event bus (§4.1). Consumers, per existing patterns:

- **Streaks (ADR-014):** one entry in `EVENT_TO_STREAK` → `pomodoro` streak key. `PomodoroModule` computes no streaks.
- **Automations (ADR-015):** `pomodoro.completed` joins `task.completed` in the event-kind automation picker, enabling "after a pomodoro, remind me to stretch" — with no changes to `AutomationModule` beyond publishing the key.

### Accessibility

A live-updating number is the classic screen-reader failure: announced every second, it renders the page unusable.

- The countdown is `role="timer"` with **`aria-live="off"`** — deliberately silent. It is _not_ a live region. The timer's value is available on demand (the element is focusable and labelled, e.g. "Focus, 12 minutes 30 seconds remaining"), and we announce only **phase transitions** via `role="status"` ("Focus complete. Break, 5 minutes.") and errors via `role="alert"`.
- Announced granularity is coarse: the accessible name updates at **minute** boundaries, not seconds, so an SR user polling the element hears "12 minutes remaining", not a digit soup. The visual digits still tick every second.
- The progress ring is `aria-hidden` decoration — position/percentage is never the only encoding; the text digits carry the value. Phase (Focus / Short break / Long break) is conveyed as **text**, never by ring color alone (WCAG 1.4.1); contrast meets AA in both themes.
- **`prefers-reduced-motion`:** the ring's sweep animation and any pulse are dropped — the ring becomes a static arc updated in discrete steps, the digits still update. **No flashing at phase end, ever** (WCAG 2.3.1): the completion cue is a static color/label change plus an optional sound, never a blink or strobe.
- Controls are real `<button>`s (Start / Pause / Skip / Reset) with ≥44×44 px targets and visible focus; no keyboard shortcut is required to operate the widget (a `Space` shortcut is offered but never the only path, and is suppressed while a text field has focus).
- Copy externalized; durations formatted via `Intl.NumberFormat`/ICU plurals (NFR-12).

### UX states & interaction

- **Idle:** the configured focus duration and a Start button. **Running:** digits + ring + Pause/Skip. **Paused:** digits frozen (we store `pausedAt` and re-anchor `endsAt` on resume — never keep counting). **Phase end:** notification (if permitted) + in-page `role="status"` + the next phase pre-armed but **not auto-started** (auto-start is a setting, default off — a break that starts without you is a break you miss).
- **Loading/Error:** the widget's suspense skeleton and error-boundary fallback (§4.2). A failed session `POST` is retried in the background and, if it still fails, surfaces an inline `role="alert"` — the timer itself never blocks on the network.
- `settingsSchema` (zod): `{ focusMin: 1..120 (default 25), shortBreakMin: 1..60 (default 5), longBreakMin: 1..60 (default 15), longBreakEvery: 2..12 (default 4), autoStartNext: boolean (default false), sound: boolean (default false) }` — drives the auto-generated settings panel.
- `quickActions: [{ id: "start-focus", label: t("pomodoro.start") }]`.

### Open questions for the product owner

- **Q-A:** should a pomodoro be attachable to a task (`task_id`)? The column is planned; the UI (a task picker in the widget) is not, and it drags in a `TasksModule` read. Ship the column, defer the picker?
- **Q-B:** does an abandoned pomodoro deserve a row (for honest "started 6, finished 4" stats), or is that a guilt mechanic in the ADR-014/027 sense? Current answer: don't store it.
- **Q-C:** cross-device single-timer via Supabase realtime — worth it, or is per-device the honest scope?

## Consequences

- The deadline representation makes the entire class of tick-drift/throttling bugs unrepresentable rather than mitigated — this is the load-bearing decision, and it is why the timer needs no server.
- No server involvement in the running timer means zero new infrastructure (NFR-8) and no worker jobs to cancel on pause — but it also means **the timer cannot fire with the browser closed**, permanently. If the user ever wants that, it is a different feature (a scheduled push), not a change to this one.
- Persisting only completions keeps the write path tiny (one idempotent POST per pomodoro) and the data honest, but "how many did I abandon?" is unanswerable by construction.
- `pomodoro.completed` on the bus means streaks and automations get pomodoros for one map entry each — the ADR-014 pattern paying off a third time.
- The `role="timer"` + `aria-live="off"` choice means the timer is _silent_ to screen readers between phases. This is correct but non-obvious; a reviewer expecting a live region will flag it, and this ADR is the answer.
- Cross-tab consistency depends on `BroadcastChannel` + `Web Locks`; in a browser lacking them the fallback is `storage`-event sync plus `client_key` dedupe server-side — worst case a duplicate notification, never a duplicate row.

## Alternatives considered

- **Tick-counting timer (`setInterval` decrementing a counter).** Rejected: guaranteed wrong under background throttling and tab freezing; the bug is not fixable, only papered over. Reading the wall clock against a stored deadline is both simpler and correct.
- **Server-side timer: persist the running phase, let the worker push at `endsAt` (ADR-015 pipeline).** Rejected: a 60 s delivery SLO (NFR-3) is unusable for a timer; it invents distributed state (cancel-on-pause, reschedule-on-skip) for a purely local problem; it burns push quota and adds three failure modes. The push pipeline exists for reminders that must fire when the app is closed — a pomodoro is by definition something you are present for.
- **Web Worker running the countdown.** A common suggestion, and it does dodge some main-thread throttling. Rejected as the _mechanism_: workers are also throttled/frozen in background tabs, so a worker that counts ticks is wrong in the same way. With the deadline model the worker buys nothing.
- **Service worker firing the notification.** Rejected for v1: it would let the notification fire with the tab closed (a small win), but a service worker cannot reliably schedule far-future timers either (no `showTrigger` support in practice) — it would need push to be woken, which is the rejected option above.
- **Store every pomodoro in MongoDB with the "session log" shaped freely.** Rejected by §4.3: fixed-shape rows with count/aggregate queries (daily counts, streak days) are the Postgres column of the split.
- **Auto-start the next phase by default.** Rejected: a break that starts while you're mid-sentence is a break you skip, and the technique depends on actually taking them. Offered as an opt-in setting.
- **Flashing/pulsing the card at phase end** (a very standard pomodoro cue). Rejected outright: WCAG 2.3.1, and hostile in a dashboard someone leaves open all day. Static state change + optional sound + notification.
- **A live region (`aria-live="polite"`) on the countdown.** Rejected: it announces every update, drowning the screen reader. `role="timer"` with silent updates and minute-granular labelling is the accessible pattern; phase changes get the announcement.
