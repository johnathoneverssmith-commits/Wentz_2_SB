# Agent 1 — Presentation, Audio & Immersion Audit

Baseline: `master` `d0727ff` (merge of PR #103, Group 08). QA-only PR, no production change.
Local results, not CI.

## What was actually tested vs only inspected

| Area | Status |
|---|---|
| Visual capture, BAL only, 1440/390/320, 14 screens (setup, fantasy-draft, coaching-draft-hub, hub-week-9, roster, free-agency-board, trade-deadline, game-plan, game-day-week-9, bracket, end-of-season, season-complete, offseason-fa, history), via the existing `e2e-audit` harness (42 captures) | **Tested** (real production build, Chromium, fixture saves, not hand-played) |
| Screenshots viewed by me | **5 viewed**: history 1440, game-day 390, trade-deadline 390, hub 390 (too small to read detail), plus harness data for the rest. Findings marked "probe-only" were **not** visually confirmed |
| Contrast / target size / overflow / heading probes | Harness-measured. Several contrast readings are **probe artefacts** (see Discarded) |
| Audio | **Source inspected only.** Nothing was listened to (no audio device, no playback test). Behavior claims below come from reading `ui-source/src/audio/*` and its call sites |
| Keyboard navigation, focus visibility, reduced motion | **Not run.** Source shows `:focus-visible` rules in 10 CSS files and a `prefers-reduced-motion` + 3-level Motion switch (`motion/level.ts`), but I did not exercise them. Group 08 reports `visual-accessibility.spec.ts` passing |
| Other teams' palettes, 768/1280 widths, online screens, hand-played journey, new-vs-fifth-season feel | **Not tested** |
| BAL badge contrast (2.34:1), stat-strip stray left rule | Carried from Group 08 report; **not re-verified** (the `fantasy-draft-summary` screen was not in my subset) |

Because the journey used fixture saves, "first-time" and "fifth-season" judgments below are inferences
from the screens and source, not play experience.

## Audio: what exists

All synthesised at runtime, no files, no copyrighted material. Off by default; toggle in the left rail
(`SoundControl`), music/effects sliders, a "shouted chants" checkbox, preference persisted. A generative
score has 8 moods by route/stage (lobby, draft, free agency, front office, game day, playoffs, champion).
12 cues exist: onTheClock, pickMade, touchdown, fieldGoal, turnover, injury, tradeOffer, signed, newJob,
gameWon, gameLost, champion. Design rule in the code: no sound for something the player just clicked.

Wired: onTheClock, pickMade (your picks), tradeOffer (incoming), gameWon/Lost, champion (you won),
touchdown/fieldGoal/turnover/injury (gamecast), newJob (hot seat). Not audio-capable surfaces: muting is
a master switch only (no per-category mute besides the chants box).

## New findings

IDs `PA-###`. All "New" (not in the Master register); none is a regression (no earlier baseline compared).
Frequency is for BAL in this run.

| ID | Pri | Finding | Evidence | Basis |
|---|---|---|---|---|
| PA-001 | P1 | **Trade Deadline: "Your assets (0)" button unreadable at phone width.** Dark text on the dark teal card-header band (harness 1.28:1; visibly illegible). Hides the control that opens the player's own assets. 390 and 320 | `evidence/trade-deadline__390__baseline.png` | Viewed + measured |
| PA-002 | P2 | **Game Day empty state scrolls sideways** at 390 (scrollWidth 394 > 390) and 320; header chips clip at the edge | `game-day-week-9__390__baseline.png` | Viewed + measured |
| PA-003 | P2 | **Fantasy draft "Roster needs & unit grades" summary label is pale blue on white** (1.40:1, 12px) at all three widths | `fantasy-draft__390__baseline.png` | Probe-only; confirm by eye |
| PA-004 | P3 | Hub: favourite-percent green on grey is 3.49:1 (13px bold); small caption 4.25:1 (10px bold) | harness register V-010/011/017 | Probe-only; background may be a gradient |
| PA-005 | P3 | Heading level skips h1 -> h3 on game plan, offseason FA, bracket rounds | register V-019/020 | Probe-only |
| PA-006 | P3 | Roster pitch graphic clips 4px at 390/320 (334 in a 330 box) | register V-018 | Probe-only |
| PA-007 | P2 | Free-agency/trade-deadline "Skip" checkbox target is 13x40px (below WCAG 2.5.8's 24px) | register V-008 | Probe-only |
| PA-008 | P2 | **`signed` audio cue is defined but never fired.** Free-agent signings and re-signings are silent, though the code comments say they should sound | `audio/cues.ts`; no `cue("signed")` call site (grep) | Source only |
| PA-009 | P3 | **No sack cue** in the gamecast (TD, FG, turnover, injury only), though sacks are tagged key plays in the log | `Gamecast.tsx:324-327` | Source only |
| PA-010 | P2 | **Draft atmosphere stops at your own pick.** `pickMade` fires only for the viewer's team; other teams' picks, trades-completed and offseason-stage transitions have no cue or announcement. Draft day is the biggest missed atmosphere moment | `useGameAudio.ts:93-98` | Source only |

Totals: 10 new (P1: 1, P2: 5, P3: 4; no P0). 3 are source-only, 5 probe-only, 2 visually confirmed.

### Discarded (probe artefacts, not reported as defects)
- Harness V-001..V-004 (history/season-complete `td`, 1.20:1 "on rgb(1,1,1)"): the screenshot shows dark navy
  text on a light salmon row, clearly legible. The probe misreads the background (same limitation Group 08 noted
  for gradients). **Recommend the harness treat near-black background readings as unknown.**
- V-006 roster slot numerals 2.95:1 vs 3:1 at 44px: decorative, within rounding.

## Existing TAFIs seen again (not new)
- **UI-TAFI-004** (floating buttons cover content): confirmed at 390 on trade deadline, where the Methodology and
  Unit Grades tabs sit on top of the "You're on the clock" explanation, and on the hub where Methodology overlaps the
  readiness card. This is the Methodology-tab overlap named in the brief; still open, and the worst phone-width defect I saw (P1).
- **UI-TAFI-012/013** touch targets: harness counts 200 `span[role=button]` (110x25) on fantasy draft at touch widths
  plus 28 each of Skip/how-tab/reset buttons at 40px (below 44px).
- **UI-TAFI-008/009** page length: hub at 390 is 5,696px tall.
- **UI-TAFI-021/022**: rail footer buttons clipped ("Download backup" cut off) and rail ending mid-page in full-page shots (likely a capture artefact).
- Dark header band (Group 08 "left by owner decision") is what makes PA-001 happen.

## Player experience (inferred, not played by hand)
- Strong: the broadcast-style masthead, hub "Game Day Readiness" card, and "What the fans are saying" give the hub
  a clear next action ("Ready for Game Day"). Audio is opt-in and sensibly designed.
- Weak: History after one season reads sparsely ("Leader points 0", "Quality -1", empty cells), the same stadium
  photo recurs as masthead on every screen (UI-TAFI-006), and phone layouts are very long.
- Repetition over seasons: untested. Audio is the main variation lever and is currently thin outside games and your own pick.

## Audio and atmosphere opportunities (not implemented)

| Moment | Today | Opportunity | Effort |
|---|---|---|---|
| FA signing | cue exists, unwired (PA-008) | call `cue("signed")` on your signing | Tiny |
| Draft, other teams' picks | silent | soft tick + chants line per pick, louder for top-5 / trades | Small |
| Your pick | `pickMade` | a short "selection announced" stinger with the player name via existing speech chants | Small |
| Sacks / big plays | none | a `sack` cue, crowd swell on 25+ yd plays | Small |
| Trade completed | only incoming offer sounds | a resolve cue (distinct from `signed`) | Tiny |
| Playoff win / elimination | gameWon/Lost only | longer playoff variants, a hush on elimination | Small |
| Offseason transition | mood change only | a stage-change sting on Season Complete -> Draft | Small |
| Mixing/accessibility | master toggle, two sliders, chant box | per-category mute, a captions-style "sound cue" toast for deaf/HoH players, volume memory is fine | Medium |

## Prioritised roadmap (impact / effort)
1. Fix phone-width floating Methodology / Unit Grades tabs (UI-TAFI-004): move into the header or a menu. P1, small.
2. Fix the unreadable "Your assets" button (PA-001) and the dark header band's text tokens. P1, small.
3. Wire `signed`, add trade-complete and other-team draft-pick cues (PA-008, PA-010). P2, small.
4. Fix Game Day sideways scroll and the 40px / 25px touch targets (PA-002, PA-007, UI-TAFI-012). P2, small-medium.
5. Season Complete / History: lead with the champion and a story of the season (UI-TAFI-010, History empty values). P2, medium.
6. Per-photo variety for mastheads (UI-TAFI-006/019), heading hierarchy (PA-005). P3, medium (asset work).

## Top five changes most likely to improve perceived quality
1. Stop floating tabs covering content on phones.
2. Fix the unreadable dark-band controls (Your assets, and the whole class of dark header text).
3. Give the draft a voice: other-team picks, announcements, trades.
4. Make season ends feel like a payoff: champion-first Season Complete and a richer History.
5. Wire the unfired `signed` cue plus a sack and trade-complete cue, so every major action has feedback.

## Unresolved uncertainties
- No audio was heard; cue loudness, mix and whether the generative score is pleasant are unknown.
- Keyboard and reduced-motion behavior not exercised by me.
- Only BAL was captured; other team palettes can fail contrast differently (the harness probe found it did before).
- PA-003..PA-007 rest on the probe alone; PA-004's background may be a gradient.
- The fixture league, not a hand-played one, so 4-11-2 and sparse History values may be fixture artefacts.

Reproduce: `AUDIT_CHROMIUM_PATH=/opt/pw-browsers/chromium AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440,390,320 AUDIT_SCREENS=<ids> npm run audit:visual -- specs/capture.spec.ts` then `npm run audit:register`.
