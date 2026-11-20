# Alpha readiness audit and smoke-test report

Audit of `origin/master` **`6461f4b69c16440d85048f248a3581f13779e27b`** (merge of #128, 2026-11-20). Everything below is a
**local result from a Linux container, not CI**. CI on the pull request is the authority. Where a number comes from
another document, it says so.

## 1. Verdict

| | |
|---|---|
| **Online leagues, real engine** | Playable end to end up to the postseason. **One blocker (B1):** a league whose human teams are all out of the playoffs stalls with no way forward in the UI. |
| **Solo dynasty on the deployed site** | Plays whole seasons without a crash, but on the **Mock simulator**, not the engine. Whether that is acceptable is an **owner decision (B2)**, not a bug. |
| **Browser engine (#74 Phase 4b)** | Built, served and verified, but **nothing in the app calls it**. Phase 5 is what would change solo play. |
| **Phone layout** | No horizontal overflow and no target under 32 px on 16 routes at 390 and 320 px (emulated viewport, not a device). |

## 2. Alpha blockers

### B1. Online playoffs stall when no human team is still alive (High, reproduced twice; issue #132)
**Where:** `online/src/blockJobs.ts` `readyEliminated`, `online/src/phases.ts` `clearReadinessOnline` / `readyUp`,
`ui-source/src/screens/Checkpoint.tsx`.
**What happens:** on entering `playoffs`, and again after every round, a human GM whose team is not alive is marked ready.
The stage gate only opens when a GM *presses* ready, so if every human is already ready nothing opens it. The Checkpoint
screen then reads "Waiting for other players" for every GM, and the commissioner's "move the league on" button only renders
when `waitingNames.length > 0`, which is empty here.
**Reproduce (2 GMs, defaults):** create a league, join with the invite code, claim any two teams, play through the
fantasy draft, coaching draft, camp, preseason, both regular-season blocks and the trade deadline (the steps are in
section 5). If neither team made the 14-team bracket, both GMs land on the waiting screen at `Playoffs · 2027`.
**Evidence (league `Alpha Audit 99442`, 6461f4b):** `GET /leagues/:id` gave `stage: "playoffs"`,
`readiness: {gm_1: true, gm_you: true}`, `waitingOn: []`, `bracket.currentRound: "WC"`, `roundsPlayed: 0`; both human teams
were absent from every bracket matchup; version unchanged for more than 8 minutes. `league_state.phase_ends_at` was
48 h out at the default 12 h turn setting. An earlier league stalled the same way at the Divisional round: both GMs checked in, `waitingOn: []`, no button.
**Why it matters:** with 2 GMs the chance that both miss or are knocked out before the Super Bowl is high, so most small
alpha leagues would hit it. It repeats after each round (up to three times).
**Workaround found (dev only):** re-sending `POST /leagues/:id/actions/ready {"ready":true,"stage":"playoffs"}` as a GM
played the next round (version 100 to 102, `roundsPlayed` 2 to 3). The deadline sweep should also move it after
`phase_ends_at`, but I did **not** wait it out, so that is unverified.
**Test gap:** PR #125's harness (per its session) drives `phases.ts` in-process with CPU sweeps and scripted seats, with no readiness gating between humans, no database or UI, and never built a league with every human out, so it does not cover this gate either. `full-circuit`, `humans-only-circuit`, `annual-circuit` and `playoff-resume-clock` pass (13 tests, PGlite) and
do not cover an all-eliminated postseason.
**Suggested direction (owner of the files decides):** after `readyEliminated`, if `humanGate(state)` already holds, play the
round or leave the stage in the same transaction; and show the commissioner control when the league is idle with nobody
listed as waiting.

### B2. Solo play on the deployed site is the Mock simulator (decision required)
See section 4. For an alpha meant to test the franchise game against the real engine, either solo must ship on Phase 5, or
the alpha must be scoped to online leagues and say so. Nothing is wrong with the lock itself: the hub states "Mock
simulation (not the real engine)" and the dynasty never switches.

## 3. Lower-priority defects

| ID | Defect | Severity | Notes |
|---|---|---|---|
| D1 (#133) | **Reload during an online draft lands on League Setup.** `#/draft` becomes `#/setup` and stays there. The sidebar still shows "Fantasy Draft · Your turn" and the clock; clicking the current-stage link recovers. | Medium | Reproduced each of the 3 times it was tried. Reload on `#/hub` stays on the hub. Not checked at other stages. |
| D2 (#134) | **The league server does not serve `/art/*`.** Stadium photos 404 (`/art/stadiums/BAL.webp`, `/art/franchise/stadium-city.webp`) and one request has an empty code (`/art/stadiums/.webp`). The static dist serves them. | Low-Medium | `online/src/http.ts` serves only the UI page and an allowlist of `/sim-engine/*`. Mastheads fall back to the skyline, so nothing breaks. Confirm on production. |
| D3 | Mock output is visibly wrong in places: scores such as 1-22 and 12-1, 13 playoff matchups with a winner and no stored game, player lines that disagree (receiving vs passing). | Known | Already tracked under #74 and the TAFI register. Only the Mock does this. |
| D4 | `engine: non-finite M04 shift on SACK / M09 shift on COMPLETE; ignoring it` in the online server log. | Low | Tracked as GAP-010. |
| D5 | Phone setup header strip shows its first chip clipped at the left edge ("Setup · 2027"). | Cosmetic | Looks like a scrolled strip. Not investigated. |
| D6 | `docs/qa-longitudinal/DEVELOPMENT-BACKLOG.md` is stale: it lists #109 and #110 as unmerged drafts; both are on master. | Docs | |

## 4. Engine selected by each entry path

| Entry path | Engine | How it is chosen |
|---|---|---|
| Static UI, solo dynasty, no adapter (what a deployed tester gets) | **Mock** | `HybridSimulationService.viaAdapter` tries `http://localhost:8787` (`HttpSimulationService`), falls back to Mock on failure with a cooldown; the choice is saved with the dynasty and never changes. |
| Solo with `npm run server` running | Real engine (adapter) | Same code path; the dynasty is locked to `engine`. If the adapter later disappears, play stops with a Retry notice. |
| Online league | **Real engine, on the server** | `online/src/simPool.ts` worker thread runs the blocks; broadcasts are replayed from the seed. The client never simulates. |
| Browser worker (`ui-source/src/sim/engineWorker/`) | Real engine, **not wired in** | No file outside that folder imports it; the Playwright spec "loading the real app downloads no engine files" passes. `EngineLoadError` is not yet mapped to the Retry flow. |

**Is Phase 5 required?** Only if the alpha includes solo play as a way to evaluate the game. It is not required for an
online-only alpha. Gates from `docs/qa-longitudinal/ISSUE-74-PLAN.md` that are still open: the parity matrix across
Node / adapter / online / worker, replay with a version check, a real-engine e2e suite, legacy-save fixtures, and Firefox
and Safari checks (Math determinism). The `/schedule` parity gap was fixed by #129, merged at 932a52e (2026-11-20 17:15 UTC, after this audit's commit).

Note on #129: on this machine (Node v22.23.5, Chrome for Testing 153.0.8010.12) master's expected-failure spec "KNOWN ISSUE:
/schedule differs" reports as failed because the schedules **agree**. The mismatch depends on the Node and Chrome versions,
which is the argument for #129.

**Update from the #74 session (reported, not verified by me):** Phase 5a is PR #131: the app can play on the browser engine only
when opted in (`?engine=browser` or localStorage `nfl-sim.browser-engine=1`), default off, with `EngineLoadError` mapped to the
Retry flow. It was unmerged and had no CI result when last reported. Phase 5b (browser engine as the default for new solo
dynasties) is **not approved**; it waits on the owner's decision in `docs/issue74_phase5b_proposal.md` on the #131 branch. So
deployed solo testers still get the Mock. **Open gap:** nobody has diffed the worker's output against the online server's for
the same request. Firefox/Safari Math determinism, a phone measurement and Python sections 22/23 also remain open.

## 5. Smoke-test record

**Build:** `6461f4b`, UI built with `npm --prefix ui-source run build`. **Browser:** Google Chrome for Testing
153.0.8010.12 via Playwright 1.64.0, headless, Linux x64, `--no-sandbox`. **Runtime:** Node v22.23.5, PGlite (PostgreSQL 18,
not CI's 16). **Hosts:** static UI on `localhost:5173` with nothing on `:8787` (the deployed solo topology); league server
serving the same-origin UI on `localhost:8789` (built with `VITE_LEAGUE_API=""`, as Render does). The deployed site could
not be reached from this container (proxy 403).

| # | Path | Fixture and steps | Outcome |
|---|---|---|---|
| 1 | Fresh solo league | `#/setup`, seed 8724, BAL, fantasy draft off, difficulty standard, talent Amplified (default). A scripted button-clicker drove setup to the end. | PASS |
| 2 | Season progression | Two full seasons (2027, 2028): coaching draft, camp, preseason, regular season, trade deadline, playoffs through "Simulate the Super Bowl", offseason, rookie draft, into the 2029 hub. About 8 minutes. | PASS on Mock |
| 3 | Save and reload | Browser closed and reopened on the same profile. | PASS: 3,107,287-character save restored, `#prev` copy present. Save grew about 0.5 MB per season (2.0 MB at the first preseason). |
| 4 | Invariants on the restored save | 2,372 players, 320 games, 2 history rows. Cap check: 0 teams over the cap. State check: 15 findings, all Mock (D3). | PASS with D3 |
| 5 | Entry into season two | Reached the 2028 preseason and played it. | PASS |
| 6 | Layout | 16 routes at 1440, 390 and 320 px. | PASS: no page-level horizontal overflow, 0 targets under 32 px at phone widths |
| 7 | Online, two users | Accounts, league (2 GMs), invite code, join, claim BAL and KC, ready, fantasy draft, coaching draft, camp, preseason, regular season, trade deadline, free-agency skip, playoffs. | PASS up to the postseason, then B1 |
| 8 | Reload during progression | GM B reloaded at the hub (regular season): stayed on the hub. GM B reloaded in the draft: D1. | Mixed |
| 9 | Disconnect during progression | GM B offline for about 17 s while GM A advanced four weeks, then back online. | PASS: B's page stayed usable and still offered its own next week. No offline banner seen. |
| 10 | Reopen the tab | GM A closed the context and reopened with the same cookies. | PASS: "Online leagues", then Open, returned to the stage screen. |
| 11 | Repo e2e (`npm run e2e`) | 137 specs, Chromium 153. | 128 passed, 5 failed and 5 did not run, on a machine that was also running my browser drivers; rerun alone: 3 passed, 2 remain (the `sim-engine-worker` KNOWN ISSUE above, and `cleanup.spec.ts:141` "process is still running", likely a container artifact). |
| 12 | Server circuits | `full-circuit`, `humans-only-circuit`, `annual-circuit`, `playoff-resume-clock` on PGlite. | PASS (13 tests). Not CI. |

The scripts were the button-clicker and checkers from the draft PR #106 (`docs/qa-longitudinal/agent-06-adversarial/scripts`,
patched only to pass `--no-sandbox` and a Chromium path) plus ad hoc Playwright scripts. They are not committed here.

## 6. Browser-worker assets (issue #74 Phase 4b)

- **Version consistency: PASS.** The static build and the same-origin build produce byte-identical `manifest.json` and
  files, `engineVersion 297c6dcf5cf0…`: worker 114 KB, artifacts 4.0 MB, pool 1.08 MB (27 artifact files, 1,987 players).
- **Serving: PASS.** The league server returns the manifest and the three hashed files (gzip), and 404 for a traversal
  (`--path-as-is /sim-engine/../../package.json`). `node scripts/verify-sim-engine-dist.mjs ui-source/dist` passes in Chromium.
- **Loading, caching, retry (existing Playwright spec, passing here):** lazy first use, one download then cache, offline start
  from the saved engine, upgrade across a reload that drops old files, a failed download reported with advice and Retry
  without re-downloading what arrived, an engine that will not initialise leaves the cache clean. Timings at 4x CPU throttle
  (a stand-in, not a phone): cold 0.65 s, warm 0.31 s, 16-game week 0.74 s.
- **Not exercised by a user path:** the app never requests these files today (see section 4).

## 7. Unverified

- The **deployed** site and API (container proxy blocks them); Render cold start from the free tier's spin-down.
- **Local Network Access:** the deployed HTTPS page probes `http://localhost:8787`. Recent Chrome may show a permission prompt
  to every solo tester on first load. Check in real Chrome on the deployed site.
- **Firefox and Safari** (only Chromium here), including Math determinism and third-party cookie behaviour for the two-origin
  deployment; real phones and touch; pull-to-refresh and background-tab behaviour.
- **Season two and beyond in an online league through the UI** (blocked by B1; the server circuits cover it).
- Solo seasons 3 and beyond, and the save-size soak (`SAVE_SOAK=1`).
- Manual trades, bids and contracts, the Hooded Figure, a 16-GM league, commissioner tools (pause, vacate), password reset,
  push notifications, multiple tabs, and online scouting (#130, off by default).
- Deadline-sweep recovery from B1 after `phase_ends_at`.

## 8. Alpha checklist

- [ ] B1 fixed and an all-eliminated postseason test added
- [ ] Owner decision on solo (B2): Phase 5 first, or online-only alpha with solo labelled
- [x] #129 merged (schedule identical across Node and Chrome), per the #129 session; its container showed the old solver differing for 18/18 years
- [ ] Production smoke: deployed UI and API serve the same commit and the same `engineVersion`; `/art` served on the league origin (D2)
- [ ] Real Chrome on the deployed site: no permission prompt from the `localhost:8787` probe
- [ ] Firefox and Safari: sign in stays signed in; one solo season
- [ ] A real phone: setup, a game week, the draft
- [ ] Reload mid-draft returns to the draft (D1)
- [ ] Turn length chosen for the alpha (`1h` and `4h` shorten any deadline wait)
- [ ] Tester guide (`docs/alpha/TESTER_GUIDE.md`) reviewed by the owner
