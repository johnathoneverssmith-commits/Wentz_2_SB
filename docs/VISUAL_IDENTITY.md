# Visual identity, atmosphere and setup (Agent 3)

## What was built
- `ui-source/src/visual/` — the shared stadium system. `StadiumScene` draws a team's scene as SVG from a
  per-team spec (`stadiumSpec.ts`: roof architecture, tiers, two city landmarks, terrain, skyline density)
  and the team's colours. `AtmosphereBackdrop` mounts it once in `AppShell` behind every screen except
  `/roster`, which already has its own stadium header and was deliberately left as designed.
- `atmosphere.ts` — `level` in 0..1 → lighting. 1 = heavenly (bright sky, light shafts, motes), 0.5 =
  neutral dusk, 0 = infernal (dark sky, horizon fire, smoke, embers). Smooth and monotonic (tested).
- `state/humanRank.ts` — ranks only **human-controlled** teams, from `visibleGames` (so it never reveals an
  unwatched result). Winning percentage, ties = half a win, equal records share a rank ("T-2"), no
  invented tiebreaker. Not meaningful (neutral atmosphere, no chip) when there are fewer than two human GMs
  or any human team has no visible regular-season game. In a solo league the rival seats are AI, so it stays
  neutral — by design.
- `RankChip` — "Human-GM rank N of M" with the atmosphere name; shown in the rail whenever meaningful.
- `GameTitle` / `state/gameTitle.ts` — "Road to the Super Bowl" → "The Browns' Road to the Super Bowl"
  (plural-s possessive), with a title swap + team-colour sweep on team select.
- `UniversePicker` / `state/universe.ts` — three universes (legacy, fictional, era-conditioned), manual and
  random seed. A universe is fixed at league creation, so choosing one creates a fresh solo setup (rules
  kept, team picks cleared). Solo only; the online server does not accept it.
- `PlayerDossier` + `state/dossier.ts` — replaces the fantasy-draft comparison panel. Every attribute the
  player has, against the live same-position league average, numeric +/−. Hidden `potential` is never read.
- `DraftSummaryOverview` + `state/draftSummaryView.ts` — summary front page. Grade and ranks still come from
  the existing `grade()`/`ratings` in `FantasyDraftSummary`; nothing in grading changed.
- `UnitGrades` — scorecards (rating, letter grade, league rank, expandable starters + depth), no bars.
- "How It Works" → "Methodology" in all user-facing labels; routes/identifiers unchanged.

## Era-conditioned generation (what is and is not true)
`drawLeagueDna(seed, eraAxes)` adds the documented era axes (`sim/leagueDna/eras.ts`: passing, ground,
front, coverage) to the seeded position-group draw (`ERA_PULL = 1.4` group units), then the existing scoring
neutralisation still applies. Same seed + era = same league; no era = the old league byte-for-byte; the era
changes the league for the same seed; a 2011 league is measurably stronger passing than a 2024 league and
weaker on the front (tests in `leagueDna.test.ts`). **It is an emphasis, not a reproduction**: no real
players, no historical ratings. Draft classes are generated per year as before. `LeagueConfig.leagueEra` and
`LeagueDnaRecord.eraTarget` are optional, so old saves load unchanged. Contracts and phases are untouched.

## Art limitation
No generative-image service was used or required. The stadium scenes are procedural vector art with
per-team roofs/landmarks/colours, so no two teams share a composition (tested), but they are stylised
silhouettes *inspired by* each home — **not hand-illustrated portraits of real stadiums**, and not original
commissioned artwork. Replacing a team's scene with bespoke art only means swapping its `StadiumScene` output.

## No Fantasy Draft option
Kept. It is implemented end to end (`stageMachine`, `applyDraftSetting`, many tests, a full playthrough), so
removing it would delete working behaviour. (Humans-only leagues already force it on.)

## Integration notes for the portrait agent
Render `<PortraitSlot player={p} size={n} />` (`visual/PortraitSlot.tsx`). Pass `children` (an image/SVG) or
replace `DefaultPortrait`'s body with a lookup by `player.id`. The dossier already mounts it. The slot has a
fixed 3:4 box, so nothing shifts when an image loads.

## Dev tools
`/#/visual-lab` (dev only) shows any team at the three atmosphere extremes: `/#/visual-lab?team=SEA`.
