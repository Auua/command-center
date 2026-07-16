# Architecture Decision Records

One folder per product domain; the ADR **number is the record's identity** and is global across
folders — files sort chronologically within a domain. New ADRs: copy [template.md](template.md)
into the fitting domain folder, take the next free number, add a row here and a summary row in
`docs/ARD.md` §7. Review state for unapproved ADRs is tracked in
[REVIEW-QUEUE.md](REVIEW-QUEUE.md).

**ADRs 001–007** (foundation: monorepo, NestJS modular monolith, dual-DB ownership split,
API-only data access, pg-boss jobs, hosting, REST + OpenAPI) predate this folder and live as
summary rows in [`docs/ARD.md` §7](../ARD.md) only.

## Index

| ADR | Title                                                                                                                              | Domain        | Status   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| 008 | [Tasks (todo) widget](productivity/008-tasks-widget.md)                                                                            | productivity  | accepted |
| 009 | [Mood check-in + 7-day trend widget](reflection/009-mood-widget.md)                                                                | reflection    | accepted |
| 010 | [Braindump widget](productivity/010-braindump-widget.md)                                                                           | productivity  | accepted |
| 011 | [Japanese Word-of-the-Day widget (incl. "Add to Anki")](learning/011-japanese-wotd-widget.md)                                      | learning      | proposed |
| 012 | [Japanese Grammar-point widget](learning/012-japanese-grammar-widget.md)                                                           | learning      | proposed |
| 013 | [Tech "X of the day" micro-lesson widget](learning/013-tech-lesson-widget.md)                                                      | learning      | proposed |
| 014 | [Streaks widget](learning/014-streaks-widget.md)                                                                                   | learning      | proposed |
| 015 | [Reminders / Automations widget](productivity/015-reminders-widget.md)                                                             | productivity  | accepted |
| 016 | [Journal widget — editor choice, data model, and editing surface](reflection/016-journal-widget.md)                                | reflection    | accepted |
| 017 | [Appreciation Tracker Widget](reflection/017-appreciation-widget.md)                                                               | reflection    | accepted |
| 018 | [Calendar Widget (daily/weekly/monthly views)](productivity/018-calendar-widget.md)                                                | productivity  | accepted |
| 019 | [System-design micro-lesson widget](learning/019-system-design-widget.md)                                                          | learning      | proposed |
| 020 | [RSS feed widget (headlines + excerpts, link out)](external-data/020-post-reader-widget.md)                                        | external-data | accepted |
| 021 | [Stock & FX watchlist widget](external-data/021-stocks-widget.md)                                                                  | external-data | accepted |
| 022 | [Weather forecast widget](external-data/022-weather-widget.md)                                                                     | external-data | accepted |
| 023 | [Work tracker widget (wins, impact, review evidence)](reflection/023-work-tracker-widget.md)                                       | reflection    | accepted |
| 024 | [GitHub learning-center repo — the store for learning content and cards](learning/024-github-learning-vault.md)                    | learning      | proposed |
| 025 | [Spaced-repetition review widget](learning/025-review-widget.md)                                                                   | learning      | proposed |
| 026 | [Anki two-deck sync (Japanese + Tech) — learning-repo GitHub Action → AnkiWeb](learning/026-anki-deck-sync.md)                     | learning      | proposed |
| 027 | [Habit tracking widget](productivity/027-habit-widget.md)                                                                          | productivity  | proposed |
| 028 | [Pomodoro timer widget](productivity/028-pomodoro-widget.md)                                                                       | productivity  | proposed |
| 029 | [Fitness & health widget](lifestyle/029-fitness-widget.md)                                                                         | lifestyle     | accepted |
| 030 | [Finance dashboard widget](lifestyle/030-finance-widget.md)                                                                        | lifestyle     | proposed |
| 031 | [Home Assistant integration widget](lifestyle/031-home-assistant-widget.md)                                                        | lifestyle     | proposed |
| 032 | [Content sourcing & licensing for the learning widgets](learning/032-learning-content-sourcing.md)                                 | learning      | proposed |
| 033 | [Public holidays in the calendar (and why name days are seeded, not called)](productivity/033-calendar-reference-data.md)          | productivity  | accepted |
| 034 | [FX from central-bank reference rates (Frankfurter), not from the metered quote provider](external-data/034-fx-reference-rates.md) | external-data | rejected |
| 035 | [Transit departures widget (HSL / Digitransit)](external-data/035-transit-departures-widget.md)                                    | external-data | proposed |
| 036 | [Recurring tasks (and their projection onto the calendar)](productivity/036-recurring-tasks.md)                                    | productivity  | accepted |
| 037 | [Google Calendar sync (per-calendar read-only and read-write)](productivity/037-google-calendar-sync.md)                           | productivity  | accepted |
| 038 | [Nutrition widget (food log, personal food library, calorie tracking)](lifestyle/038-nutrition-widget.md)                          | lifestyle     | accepted |
