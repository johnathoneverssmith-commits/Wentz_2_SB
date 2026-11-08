# Engine-to-UI capability matrix and feature inventory

Status vocabulary from the brief. **Evidence** says how I know: `played` (UI), `crawl` (opened in browser), `headless`, `api`, `code` (source only), `test` (existing automated suite, local run).

| Feature | Engine/state | UI | SP | MP | Status | Evidence / what is missing |
|---|---|---|---|---|---|---|
| League creation, team choice | `newLeague`, seeded | `/setup` | yes | yes (`/online`) | Complete and verified | played SP; played MP |
| Fantasy draft | `startDraft`, hand rounds then staff | `/draft` | yes | yes | Complete and verified | played; gates: on-the-clock overlay + Confirm modal |
| Coaching draft | `coachingDraft.ts` | `/coaching-draft` | yes | yes | Complete and verified | played (`Hire X`, `Delegate Remaining Picks to Staff`) |
| Training camp focus | `trainingCamp.ts` | `/training-camp` | yes | yes | Complete and verified (selection) | played; the *results* screen is passed through by design (`campResultsPassThrough`) |
| Depth chart | `setDepthOrder` | `/roster` | yes | yes | Implemented but unverified | stage advanced; no edits made. Mock sim path: not checked whether it reads depth |
| Game plan (15 dials) | `gamePlan.ts` → adapter/engine | `/game-plan`, hub strip | yes | yes | **Partially implemented in standalone SP** | real engine receives plans; **Mock ignores plans, staffs, weather, depth** (code: no reference in `simGame`). Only the projection panel says so. Effect size not measured |
| Coaching staff effects | `staff*.ts`, engine | `/coaching`, modals | yes | yes | Complete (engine) / ignored by Mock | code |
| Regular season, results, box score, play-by-play | engine + adapter | hub, `/game-day`, `/box`, `/watch` | yes | yes | Complete with real engine; **Defective on Mock** (GAP-001/002/005) | played / headless |
| Which simulator ran | — | **no indicator** | — | n/a | **Missing** | GAP-004 |
| Trade deadline AI offers | `tradeDeadline.ts` | `/trade-deadline` | yes | yes | Partially verified | played: Turn It Down / Pass; **Accept/Counter not exercised** |
| Free agency (5 rounds) | `freeAgencyEvent.ts` | `/free-agency-board`, summary | yes | yes | Partially verified | played: pass + staff fix; **bidding not exercised** |
| Mid-season FA, depth re-order | stage machine | same screens | yes | yes | Complete and verified (advance) | played |
| Roster legality gate / staff fix | `rosterRepair.ts` | free-agency summary | yes | yes | Complete and verified | played: 59/53 → `Roster not legal` → fix |
| Cap, contracts, dead money, extend, restructure, tender | `contracts.ts`, `deadMoney.ts` | `/roster`, finances | yes | yes (`contractMove`) | Implemented but unverified | code; holdout notices + `Pay him` seen in hub |
| Contract expiry prompts | `ExpiringContracts` | `/bracket`, hub | yes | yes | Implemented but unverified | seen ("9 contracts expire…"; `Extend at his ask`); not used |
| Playoffs / Super Bowl | engine bracket | `/bracket`, results | yes | yes | Complete and verified | played |
| Season-end, awards, hot seat, retirement review | `seasonAwards`, `hotSeat` | `/end-of-season`, `/hot-seat`, `/retirement` | yes | yes | Complete and verified (flow) | played; contents not audited |
| Rookie draft + signings | `draft*`, `signRookie` | `/draft`, `/rookie-signings` | yes | yes | Complete and verified | played (incl. `Sign all remaining`) |
| Hooded Figure | `hoodedFigure.ts` | `/hooded-figure` | yes | yes | Partially verified | encountered; declined only |
| Awards / records / Hall of Fame / history | `seasonAwards`, `records` | `/history`, `LeagueMemory` | yes | yes | Implemented but unverified | `/history` not opened; HoF list was empty after 3 seasons headless (unverified why) |
| Game history archive | `gameArchive` | `/games` | yes | yes (redacted) | Implemented but unverified | code + existing tests |
| Injuries | engine → `injuries` | hub tab | yes | yes | Implemented but unverified | tab present on hub |
| League formats (nfl / humansOnly), talent impact, difficulty | `leagueFormat`, config | setup/lobby | yes | yes | Complete (humansOnly played online) | played MP; deadline label bug GAP-009 |
| Save, reload, backup/restore | `store.ts` persist, `SaveBackup` | rail buttons | yes | local copy | **Defective** (GAP-008) | reproduced |
| Commissioner tools | `online/src` admin routes | lobby / readiness gate | n/a | yes | Complete for pause/resume/permissions; transfer, vacate, force-advance **untested live** | api + existing tests |
| Spoiler protection | `reveal.ts`, `redactedGames` | all views | n/a | yes | Complete and verified (lockstep case) | api polling; ahead/behind case via existing test only |
| Dev screens `/gallery`, `/visual-lab` | — | DEV only | — | — | Missing by design in prod | crawl: redirect to hub |

### Controls that look functional but do not affect the sim
Under the standalone (Mock) path: game-plan dials, coaching staff, weather and talent-impact have no effect on game results (code inspection of `MockSimulationService.simGame`, which uses only team overall and a random draw). Not measured; flagged as **confirmed by code, effect untested**. Under the real engine they are wired (`HybridSimulationService.simulateWeek` passes plans, staffs, depth chart, talent scale).

### Engine capabilities with no player-facing surface (suspected omissions, not confirmed intent)
None confirmed. Checked by grep that `talentImpact`, difficulty, dead money, practice squad, weather, penalties, hall of fame, career records, All-Pro, roster repairs and hot seat each appear in at least one screen/component. Not found in any component: `recentReleases` (server-only by design), and no franchise-tag concept exists anywhere (not an omission: the rules have none).
