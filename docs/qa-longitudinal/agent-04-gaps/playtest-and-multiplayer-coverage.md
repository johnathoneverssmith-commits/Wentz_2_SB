# Playtest coverage (what was actually done, how)

Baseline: master `d9af7c4` merged into branch `claude/friendly-bohr-sy85qm` (earlier interim work was on `3abcfff`). Chromium 153 (Playwright), Node 22, Linux. Production data, accounts and leagues were never touched; everything ran on loopback against a PGlite database or the browser's own storage.

**Legend.** `UI` = driven through the real built UI (vite preview of `ui-source/dist`) by Playwright clicks and nothing else. `UI+fixture` = the browser opened a save the game itself produced headless. `Headless` = the real stage machine/store driven in Node. `API` = HTTP calls with a real session cookie. `Untested` = said so.

## Single player

| Run | Path | Seed | Sim path | What it covered |
|---|---|---|---|---|
| **S-A "fresh"** | UI from league creation | `47547` (config: default; 3 GM slots, fantasy, amplified, standard) | **real engine** (adapter :8787 reachable; 29 games carry play-by-play) | Setup → fantasy draft → coaching draft → training camp → depth chart → preseason → every regular-season week → trade deadline → mid-season FA → playoffs → end of season → hot seat → retirement → rookie draft → rookie signings → FA → training camp. **Seasons 2027, 2028, 2029 complete (champions recorded: BAL, DEN, TEN) and the run was still going in 2031 when stopped.** One uninterrupted browser session after season 2's save failure (see GAP-008). 50 deliberate reloads at stage boundaries before the save broke: all 50 came back on the same screen. |
| **S-B "resumed"** | UI+fixture, then UI | `4001` | real engine | The headless fixture (2027 end of season) opened in the browser, then 2027 offseason → 2030 preseason by UI. Independent reproduction of the save failure. |
| Headless 4 seasons, Mock | Headless | 4001 | **Mock fallback** | Integrity checks (see `rules-and-scoring-integrity.md`) |
| Headless 2 seasons, engine | Headless | 4001 | real engine | same checks |
| Headless 10 seasons, engine | Headless | 4001 | real engine | save size per stage (`evidence/save-size-by-stage-10-seasons.txt`) |
| Route/stage crawl | UI+fixture | 4001 | real engine | every stage route of a 2027 save at 1280 px and 390 px: no console errors, no horizontal overflow, no native dialog on load |

**Stages never driven by UI in these runs, or only partly:** free-agency bidding/offers (I only passed or used the staff), trade *acceptance/countering* (I declined every offer), paying the Hooded Figure (I declined), manual contract extensions and restructures, manual depth-chart edits, the game-plan screen edits, hand-picked training-camp results screens, league history/records/Hall-of-Fame screens (`/history`), player dossier modals, search/filters. These are **Untested**, not "passed".

### Is the "53-round fantasy draft" a blocker?
No. The draft room only asks the human to pick the first rounds by hand (`config.draftSimulateAfterPicks`, default 5; the room says "After them, your staff makes your remaining picks"). The thing that stalled the first driver was two UI gates, not volume: a per-pick **"On the clock" full-screen overlay** (click to dismiss) and a **"Confirm pick" modal**. With those handled the whole draft takes about ten interactions. `Draft complete` is also an overlay that must be dismissed.

### Real dialogs met while playing (feeds GAP-006)
`Continue to Rookie Signings? You can't return to this summary.` (native `confirm`, `FantasyDraftSummary.tsx:239`) and `Pass on this turn? You don't get it back.` (native `confirm`, `TradeDeadlineRoom.tsx:247`) fired in the real UI. The Hooded Figure encounter, roster fix (`Let my staff fix the roster` → `Fix the roster` / `No thanks`), roster legality gate (`Roster not legal` blocked advance at 59/53 until fixed) and holdout notices (`Pay him`, `Extend on Roster & Cap`) were all met and worked as designed.

## Multiplayer (live, isolated)
Setup: `npm run online:db` (PGlite, :5433) + `npm run online:local -- --client-origin http://localhost:4173` (league server :8788, loopback only), UI served from the production build. Two accounts in two independent browser contexts (separate cookie jars) plus a third, non-member account for permission checks. League `QA4 521970`, format `humansOnly`, 2 human GMs (padded to 4 teams), defaults otherwise.

| Area | Result | Grounding |
|---|---|---|
| Register, create league, invite code, join by code, claim teams, reload shows own team | worked | UI |
| Fantasy draft, coaching draft, summaries, training camp, preseason, 18 regular-season weeks, trade deadline, mid-season FA, playoffs, season-end, hot seat, retirement, rookie draft, signings, free agency, second season preseason + into its regular season | worked, both GMs advanced together (2 full seasons complete, 3rd started when stopped) | UI |
| Waiting states | `Waiting for other players` shown to the GM who finished first (Bob while Alice watched the Final) | UI |
| Commissioner permissions | outsider: GET league/feed and POST ready → **403**; non-commissioner pause/advance → **403**; commissioner pause **200**, GM check-in while paused **423**, resume **200**. Commissioner-transfer attempt returned **400** (my payload used an invalid GM id), so transfer was **not** validated live. | API |
| Spoiler protection | 88 polls of both GMs' league view during preseason→regular season: the server sent only revealed weeks (`regPlayed` = 2 games × revealed weeks, never the 36 simulated). 0 leaks. Limitation: my two drivers advanced in lockstep, so a GM *ahead* of another was not exercised live (the DB suite `result-visibility.test.ts` covers it; passed 6/6 files locally). | API |
| Inactive/disconnected GM, commissioner departure, vacate seat, turn-clock takeover | **Untested live** (automated suites `commissioner-away`, `vacate-seat` passed locally against PGlite, which is not CI's PostgreSQL) | none live |
| Reconnect after server restart | **Untested** (an existing script `online/dev/multiplayer-restart-check.mjs` exists; not run) | none |
| Block simulation latency | The league view stayed on `Simulating…` for minutes while three other browser jobs and the engine adapter ran on the same 2-core box; an API login timed out at 30 s once. Likely environment contention; **not** a verified defect. | UI/API |
| Server log | `engine: non-finite M04 shift on SACK; ignoring it` and `…M09 shift on COMPLETE; ignoring it` appeared in a 4-team league (GAP-010) | log |
