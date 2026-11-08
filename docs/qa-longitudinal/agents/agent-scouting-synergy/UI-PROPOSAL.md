# UI PROPOSAL — Making realistic mechanics readable

Status: proposal and wireframes only; no production UI is changed. Design system: the existing `gameday` tokens (`GdPage`, `.ticker/.stat`, `.stbl`, `.gd-btn`, `UnitGradesDock`). Mechanics: [DESIGN.md](DESIGN.md).

## 0. Principles

1. **Four words, not a playbook.** The default vocabulary is *Good fit / Mixed / Poor fit* and a **Team Identity** name. Football terms (zone blocking, gap scheme) appear as a one-line reason, never as something to decode.
2. **Every number has a range and a reason.** A projected rating is a bar with a label ("Scouted — medium confidence"), and every fit chip opens a one-sentence explanation.
3. **Beginner by default, Advanced on a toggle** (remembered per user). Advanced shows style axes, z-scores and report details; nothing in Advanced is needed to make a good decision.
4. **Luck stays visible.** Feedback always shows the roster's contribution *and* the spread of outcomes the same inputs produce.
5. **No new gates.** Scouting lives on the existing pre-draft stages (the retired `offseasonDraftPrep` stage's slot, or a tab on the Draft Room); feedback lives on existing summary screens.

## 1. Plain-language glossary (football → on screen)

| Engine concept | On screen (default) | Advanced adds |
|---|---|---|
| Outside zone / zone run (mobile line + elusive back) | **Outside Zone** | line mobility z, back elusiveness z |
| Gap / power run (drive blockers + power back) | **Power Running** | drive z, power z |
| Vertical passing (arm + deep route runners + time to throw) | **Vertical Passing** | deep accuracy/power z, vertical speed z, protection |
| Short timing passing | **Quick Timing** | short accuracy z, route/hands z |
| Man/press coverage vs zone coverage | **Aggressive Man** / **Zone Shell** | man/zone z |
| Stout vs quick front | "Big, hard to move" / "Quick, disruptive" | front z |

## 2. Wireframes (ASCII; widths are illustrative)

### 2.1 Scouting board (pre-draft)

```
┌ SCOUTING ─────────────────────────── 2027 Draft ┐
│ Points  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░  12 / 30 left  │
│ Your picks: #14  #45  #78  #109  #142   (needs: OT, CB, ILB)     │
│ Show: [All] [Needs] [Near my picks] [Sleepers]    Sort: Value of a report ▾
├──────────────────────────────────────────────────────────────────┤
│ ★ Suggested: scouts here are most likely to change your decision │
│                                                                  │
│ J. Alvarez  OT  Public rank 31   projects 70 ▕──■━━━━■──▏ 62–78  │
│   Public information only                          [Scout 1] [Deep 3]
│ T. Brooks   CB  Public rank 48   projects 68 ▕─■━━━━━■──▏ 60–77  │
│   Scouted · medium confidence → now 71 ▕───■━━■────▏ 66–76       │
│   Strengths: ball skills · Weak: tackling · Fits: zone teams     │
│ M. Osei     ILB Public rank 92   projects 60 ▕■━━━━━━━■─▏ 49–71  │
│   Public information only · high upside, high uncertainty         │
└──────────────────────────────────────────────────────────────────┘
 Tip line: "Sleepers" ranks players just below your pick range, where one good report is most likely to change your list.
```

* The bar is the 80% range; the diamond is the best estimate. Unscouted prospects keep the wide public bar, which makes the value of a report visible.
* **"Value of a report"** is the sort key (the VOI score of Experiment C); beginners need only the ★ suggestions.
* One budget bar, two buttons. No sub-menus.

### 2.2 Prospect card (Draft Room row and detail)

```
┌ T. Brooks · CB · 21 · Zone Shell fit: GOOD ───────────────────────┐
│ Projected  71  (66–76)  ● Scouted (medium)         [Scout deeper]  │
│ Role       Zone corner (confirmed)                                  │
│ Skills     Man ▓▓▓░░  Zone ▓▓▓▓▓  Ball skills ▓▓▓▓░               │
│ Growth     Normal development · Ceiling 80–86                       │
│ Why he fits: your defence plays zone, and he reads plays better     │
│ than he covers one-on-one.                                          │
│ College production 88  (not a pro rating)                           │
└────────────────────────────────────────────────────────────────────┘
```
The college grade is demoted to the last line and labelled; the **Projected** bar leads. (Today's Draft Room sorts and labels by the college grade.)

### 2.3 Team Identity card (Hub and Game Plan)

```
┌ TEAM IDENTITY ───────────────────────────────────────────┐
│ Offence: OUTSIDE ZONE                 Coordinator: R. Hale (74)    │
│   Run   ▓▓▓▓▓▓▓░░░  fits your line (mobile) and back (elusive)    │
│   Pass  ▓▓▓▓▓░░░░░  your QB is a power-arm; timing routes need…   │
│ Defence: ZONE SHELL                   Coordinator: D. Price (61)   │
│ Roster fit  ▓▓▓▓▓▓░░░░  "Good" — 3 starters fight the scheme:     │
│   RT Kane (drive blocker), WR Moss (deep threat), CB Ruiz (man)   │
│ [Change identity ▾]  coaches execute 74% / 61% of available fit    │
└────────────────────────────────────────────────────────────────────┘
```

### 2.4 Player-to-team compatibility chips (any player list)

```
 R. Kane   RT  81   [ Poor fit ▸ ]      "Drive blocker on a zone-blocking line"
 A. Diaz   RT  76   [ Good fit ▸ ]      "Moves well in space — a zone line's tackle"
```
The chip is the same component everywhere: Draft Room, Free Agency, Trade, Depth Chart, Roster. Tapping opens the one-sentence reason and, in Advanced, the two style z-scores. A player is never hidden or blocked for poor fit.

### 2.5 "Why this player complements your roster"

```
 Adding Diaz to your line:  Run game  +0.3 yds/carry est.  (range −0.1 … +0.6)
   · He and your back are both "space" players
   · Your line now blocks as one style (Mixed → Good)
   · Cost: pass-set −1 (he is a weaker pass protector than Kane)
```
Shown in Trade, Free Agency and Draft detail. The estimate is the cheap style-axis formula, always with a range.

### 2.6 Game-plan recommendation

```
┌ WEEK 6 vs MIA · Game Plan ──────────────────────────────┐
│ Recommended lean: RUN-HEAVY (zone)         confidence ●●○ │
│  Why: MIA's front is big and slow (stretch it); your line is mobile.
│  Preview (160 sims): +1.4 pts ± 0.8 vs your standard plan  [Apply]
│ Not recommended: Vertical Passing — your protection is the 6th-best … │
│ Identity: Outside Zone   Leaning within it is free; switching costs execution. │
└──────────────────────────────────────────────────────────────┘
```

### 2.7 Post-game / season feedback (on the existing summary screens)

```
 What shaped this result
   Roster ......... your run game ranked 4th  ▮▮▮▮▮▮▮▯  (expected +3.1 pts)
   Fit ............ line/back/scheme agreed        (+1.0 pts est., 0.4–1.6)
   Plan ........... run-heavy vs a big, slow front  (+0.8 pts est.)
   Injuries ....... you played without your RT for 3 games
   Luck ........... two fumbles inside the 20 (these outcomes vary ±6 pts)
 Same roster, 100 replays: you win 61%  (this time: lost 20–24)
```
Season level: expected wins from unit ratings vs actual, closest-game record, games lost to injury.

### 2.8 Advanced view (toggle)

Adds, to any of the above: the style axes as bars (−2 … +2), the unit quality `q`, the fit term in points of margin by channel, the report tier and σ, and the coach execution factor. Default is off.

## 3. Information architecture and routing

| Existing | Change |
|---|---|
| `DraftRoom.tsx` rookie board | lead with Projected + range; add tier badge, Scout buttons and the points bar; add Fit chip |
| `UnitGradesDock` | add a "Fit" row per unit and the identity |
| `GamePlanScreen.tsx` | identity card + recommendation panel above the dials; dials unchanged |
| `RosterCapManagement.tsx` | fit chips; depth-chart inversion banner (COMP-005) |
| `RookieDraftSummary.tsx` | "projected vs revealed" per pick (the learning loop) |
| `SeasonResults`, game recap | "What shaped this result" block |
| `howItWorks.ts` | one section each for scouting, identity and fit (mandatory per CLAUDE.md) |

## 4. Accessibility and mobile

Ranges must not rely on colour (bar + text range + word badge). 44 px targets for Scout buttons. At 390 px the bar collapses to "71 (66–76) · Scouted". Fit chips carry text, not just colour.

## 5. Usability checks to run before building

1. **5-second test**: can a new player say what "Outside Zone" implies without help? (target ≥ 80%)
2. **Comprehension of ranges**: ≥ 80% correctly say that a scouted range "is more likely right than a public one".
3. **Behaviour test** on a prototype: do players spend all points, and do they prefer *Sleepers/Needs* to the top of the board? (Experiment C says the latter pays.)
4. **Overload**: tasks per offseason added by this system ≤ 2 (scouting, identity check) and zero new gates.
