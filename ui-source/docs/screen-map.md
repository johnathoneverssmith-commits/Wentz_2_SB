# Screen map

Each screen → spec section → route → state it reads/writes. Spec = `../../franchise-sim-spec.md`.

| Screen (file) | Route | Spec | Reads | Writes |
|---|---|---|---|---|
| `LeagueSetup` | `/setup` | §3.1#1, §4.1 | `config`, `gms`, `teams` | `config`, `pickTeam`, readiness |
| `DraftRoom` | `/draft` | §3.1#2, §4.2, §4.9.3 | `draft`, `players`, `draftClass` | `startDraft`, `makePick`, `autopickRemaining`, `toggleDraftTarget` |
| `FantasyDraftSummary` | `/fantasy-draft-summary` | §3.2 (new) | `teams` ratings | readiness (gates → coaching) |
| `CoachingStaffHub` | `/coaching` | §3.1#3, §3.2, §4.3 | `coaches`, roster | `hireCoach`; readiness disabled until HC+OC+DC signed (initial variant) |
| `RosterCapManagement` | `/roster` | §3.1#4 | `players`, `teams` | local depth order + auto-reorder; links to trade / FA / league-rosters |
| `LeagueRosters` | `/league-rosters` | §3.2 (new) | `players`, `teams` | — (read-only) |
| `TradeProposal` | `/trade` | §3.1#5, §4.6 | rosters, `players` | `proposeTrade`, `castTradeVote`, `resolveTrade`; 90+ ovr + human GM ⇒ vote, tie blocks |
| `FreeAgencyBoard` | `/free-agency` | §3.1#6, §4.4 | `freeAgency`, `players` | `startFreeAgencyMain`, `placeBid`, `advanceFreeAgencyDay`, `dismissInterstitial`; main (5 in-game days, 12 min/day, "Day N" interstitial, no hub link) vs standing |
| `WeeklyTeamHub` | `/hub` | §3.1#7, §4.5 | `teams`, `schedule`, `games`, `players` | readiness ("Ready for Game Day?"); explicit Preseason state |
| `FullBoxScore` | `/box/:gameId` | §3.1#8, §6.9 | one `GameResult` | — |
| `FullSchedule` | `/schedule` | §3.1#9, §6.7 | `schedule`, `games`, `teams` | — |
| `LeagueStatsRankings` | `/league-stats` | §3.1#10, §6.9 | `games` totals, `players` | — |
| `PlayerStatistics` | `/player-stats` | §3.1#11, §6.9 | `players.season_stats`, `teams` | — |
| `PostseasonBracket` | `/bracket` | §3.1#12, §4.7 | `bracket` | readiness (per round); base screen during `playoffs` |
| `RetirementReview` | `/retirement` | §3.1#13, §4.9.1 | `players`, retirement outcomes | readiness (→ free agency) |
| `RookieSignings` | `/rookie-signings` | §3.1#14, §4.9.4 | `draft.results`, `draftClass` | `signRookie`; true overall hidden until signed |
| `DraftPreview` | `/draft-preview` | §3.2 (new), §4.9.3 | `draftClass`, roster | `toggleDraftTarget` (private per GM) |
| `SuperBowlCongratulations` | `/super-bowl` | §3.2 (new), §4.8 | `bracket.champion`, `gms` | readiness (→ offseason) |
| `FurthestAdvancedConsolation` | `/consolation` | §3.2 (new), §4.8 | `bracket`, `gms` | readiness (→ offseason) |
| `LeagueHistory` | `/history` | §3.2 (new), §5 | `history` + `scoreSeason()` | — |
| `ScreenGallery` | `/gallery` | dev only (excluded from the machine) | — | — |

## Domain ↔ engine mapping

`domain/player.ts` is a field-for-field mirror of
`../../nfl-franchise-sim/src/schema/player.ts`. Identical: `id`, `name`, `position`,
`age`, `nfl_team`, `years_pro`, `overall`, `attributes`, `scheme_tags`,
`dev_age_threshold`, `decline_age_threshold`, `injury_history`, `contract`,
`free_agent`, `injury_status`, `retired`. UI-only additions (spec §6.3, not yet in
the engine schema): `draft_info`, `retirement_status`, `college`, `season_stats`,
`scheme_fit`. When the engine grows these, collapse `domain/player.ts` to a
re-export of the engine type plus a `PlayerSeason` extension.
