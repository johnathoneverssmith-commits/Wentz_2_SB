# Visual & accessibility defect register

Generated 2026-11-08T17:18:53.540Z from 42 captures (0 redirected, 0 errored). Commit: `d0727fff88b9b8bf7d9e74b7df7655b4fa23d05e`.

> **NARROWED RUN.** Teams, viewports, screens or conditions were limited. This is a smoke run, not the baseline.

| Severity | Open | Total |
|---|---|---|
| S1 | 7 | 7 |
| S2 | 5 | 5 |
| S3 | 6 | 6 |
| S4 | 2 | 2 |

## S1

### V-001 — contrast: td

- **Status:** open
- **Seen:** 6× on history, season-complete; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 1.20:1, needs 4.5:1 (14px bold) fg rgb(11,27,46) on rgb(1,1,1)
- **Reproduce:**
  1. npm run audit:visual -- -g "history" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=history AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "end-of-season" stage (e2e/fixtures/build.ts --team BAL), open #/history at 1440px wide
  3. measure: contrast on td ("Baltimore Ravens"): 1.20:1, needs 4.5:1 (14px bold) fg rgb(11,27,46) on rgb(1,1,1)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/history__1440__baseline.png`, `shots/BAL/season-complete__1440__baseline.png`, `shots/BAL/history__390__baseline.png`, `shots/BAL/season-complete__390__baseline.png`

### V-002 — contrast: td.c

- **Status:** open
- **Seen:** 6× on history, season-complete; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 1.20:1, needs 4.5:1 (14px bold) fg rgb(11,27,46) on rgb(1,1,1)
- **Reproduce:**
  1. npm run audit:visual -- -g "history" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=history AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "end-of-season" stage (e2e/fixtures/build.ts --team BAL), open #/history at 1440px wide
  3. measure: contrast on td.c ("1"): 1.20:1, needs 4.5:1 (14px bold) fg rgb(11,27,46) on rgb(1,1,1)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/history__1440__baseline.png`, `shots/BAL/season-complete__1440__baseline.png`, `shots/BAL/history__390__baseline.png`, `shots/BAL/season-complete__390__baseline.png`

### V-003 — contrast: td.name

- **Status:** open
- **Seen:** 6× on history, season-complete; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 1.20:1, needs 4.5:1 (14px bold) fg rgb(11,27,46) on rgb(1,1,1)
- **Reproduce:**
  1. npm run audit:visual -- -g "history" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=history AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "end-of-season" stage (e2e/fixtures/build.ts --team BAL), open #/history at 1440px wide
  3. measure: contrast on td.name ("You"): 1.20:1, needs 4.5:1 (14px bold) fg rgb(11,27,46) on rgb(1,1,1)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/history__1440__baseline.png`, `shots/BAL/season-complete__1440__baseline.png`, `shots/BAL/history__390__baseline.png`, `shots/BAL/season-complete__390__baseline.png`

### V-004 — contrast: td.r

- **Status:** open
- **Seen:** 6× on history, season-complete; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 1.20:1, needs 4.5:1 (14px bold) fg rgb(11,27,46) on rgb(1,1,1)
- **Reproduce:**
  1. npm run audit:visual -- -g "history" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=history AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "end-of-season" stage (e2e/fixtures/build.ts --team BAL), open #/history at 1440px wide
  3. measure: contrast on td.r ("0"): 1.20:1, needs 4.5:1 (14px bold) fg rgb(11,27,46) on rgb(1,1,1)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/history__1440__baseline.png`, `shots/BAL/season-complete__1440__baseline.png`, `shots/BAL/history__390__baseline.png`, `shots/BAL/season-complete__390__baseline.png`

### V-005 — contrast: button

- **Status:** open
- **Seen:** 4× on trade-deadline; teams BAL; viewports 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 1.28:1, needs 4.5:1 (12px regular) fg rgb(11,27,46) on rgb(10,52,53)
- **Reproduce:**
  1. npm run audit:visual -- -g "trade-deadline" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=390 AUDIT_SCREENS=trade-deadline AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "trade-deadline" stage (e2e/fixtures/build.ts --team BAL), open #/trade-deadline at 390px wide
  3. measure: contrast on button ("Your assets (0)"): 1.28:1, needs 4.5:1 (12px regular) fg rgb(11,27,46) on rgb(10,52,53)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/trade-deadline__390__baseline.png`, `shots/BAL/trade-deadline__320__baseline.png`

### V-006 — contrast: span.gd-slot

- **Status:** open
- **Seen:** 3× on roster; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 2.95:1, needs 3:1 (44px bold) fg rgb(138,152,166) on rgb(255,255,255)
- **Reproduce:**
  1. npm run audit:visual -- -g "roster" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=roster AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "season-week-9" stage (e2e/fixtures/build.ts --team BAL), open #/roster at 1440px wide
  3. measure: contrast on span.gd-slot ("2"): 2.95:1, needs 3:1 (44px bold) fg rgb(138,152,166) on rgb(255,255,255)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/roster__1440__baseline.png`, `shots/BAL/roster__390__baseline.png`, `shots/BAL/roster__320__baseline.png`

### V-007 — contrast: summary

- **Status:** open
- **Seen:** 3× on fantasy-draft; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 1.40:1, needs 4.5:1 (12px regular) fg rgb(201,220,240) on rgb(255,255,255)
- **Reproduce:**
  1. npm run audit:visual -- -g "fantasy-draft" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=fantasy-draft AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "fantasy-draft" stage (e2e/fixtures/build.ts --team BAL), open #/ at 1440px wide
  3. measure: contrast on summary ("Roster needs & unit grades"): 1.40:1, needs 4.5:1 (12px regular) fg rgb(201,220,240) on rgb(255,255,255)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/fantasy-draft__1440__baseline.png`, `shots/BAL/fantasy-draft__390__baseline.png`, `shots/BAL/fantasy-draft__320__baseline.png`

## S2

### V-008 — target-below-24: input

- **Status:** open
- **Seen:** 6× on free-agency-board, trade-deadline; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** interactive targets are at least 24x24 CSS px (WCAG 2.2 AA 2.5.8)
- **Actual:** 13x40px
- **Reproduce:**
  1. npm run audit:visual -- -g "free-agency-board" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=free-agency-board AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "midseason-fa" stage (e2e/fixtures/build.ts --team BAL), open #/free-agency-board at 1440px wide
  3. measure: target-below-24 on input ("Skip free agencyYour own turns are passe"): 13x40px
- **Proposed fix:** Add padding or `min-height:24px` (44px on touch widths) to the control, not to its label.
- **Evidence:** `shots/BAL/free-agency-board__1440__baseline.png`, `shots/BAL/trade-deadline__1440__baseline.png`, `shots/BAL/free-agency-board__390__baseline.png`, `shots/BAL/trade-deadline__390__baseline.png`

### V-009 — target-below-24: a.ui-text-link

- **Status:** open
- **Seen:** 4× on hub-week-9; teams BAL; viewports 1440; conditions baseline
- **Expected:** interactive targets are at least 24x24 CSS px (WCAG 2.2 AA 2.5.8)
- **Actual:** 85x17px
- **Reproduce:**
  1. npm run audit:visual -- -g "hub-week-9" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=hub-week-9 AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "season-week-9" stage (e2e/fixtures/build.ts --team BAL), open #/hub at 1440px wide
  3. measure: target-below-24 on a.ui-text-link ("Game history ↗"): 85x17px
- **Proposed fix:** Add padding or `min-height:24px` (44px on touch widths) to the control, not to its label.
- **Evidence:** `shots/BAL/hub-week-9__1440__baseline.png`

### V-010 — contrast: span.mval.fav

- **Status:** open
- **Seen:** 3× on hub-week-9; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 3.49:1, needs 4.5:1 (13px bold) fg rgb(15,122,69) on rgb(205,208,211)
- **Reproduce:**
  1. npm run audit:visual -- -g "hub-week-9" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=hub-week-9 AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "season-week-9" stage (e2e/fixtures/build.ts --team BAL), open #/hub at 1440px wide
  3. measure: contrast on span.mval.fav ("82"): 3.49:1, needs 4.5:1 (13px bold) fg rgb(15,122,69) on rgb(205,208,211)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/hub-week-9__1440__baseline.png`, `shots/BAL/hub-week-9__390__baseline.png`, `shots/BAL/hub-week-9__320__baseline.png`

### V-011 — contrast: span.mval.msubval.fav

- **Status:** open
- **Seen:** 3× on hub-week-9; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 3.49:1, needs 4.5:1 (13px bold) fg rgb(15,122,69) on rgb(205,208,211)
- **Reproduce:**
  1. npm run audit:visual -- -g "hub-week-9" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=hub-week-9 AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "season-week-9" stage (e2e/fixtures/build.ts --team BAL), open #/hub at 1440px wide
  3. measure: contrast on span.mval.msubval.fav ("24.37th"): 3.49:1, needs 4.5:1 (13px bold) fg rgb(15,122,69) on rgb(205,208,211)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/hub-week-9__1440__baseline.png`, `shots/BAL/hub-week-9__390__baseline.png`, `shots/BAL/hub-week-9__320__baseline.png`

### V-012 — overflow-x-document: html

- **Status:** open
- **Seen:** 2× on game-day-week-9; teams BAL; viewports 390, 320; conditions baseline
- **Expected:** no sideways page scroll at any width from 320
- **Actual:** page scrolls sideways: scrollWidth 394 > clientWidth 390
- **Reproduce:**
  1. npm run audit:visual -- -g "game-day-week-9" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=390 AUDIT_SCREENS=game-day-week-9 AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "season-week-9" stage (e2e/fixtures/build.ts --team BAL), open #/game-day at 390px wide
  3. measure: overflow-x-document on html: page scrolls sideways: scrollWidth 394 > clientWidth 390
- **Proposed fix:** Find the widest child (see the overflow-x-element groups): give it `min-width:0`, `max-width:100%`, `overflow-wrap:anywhere`, or move wide tables into their own `overflow-x:auto` scroller.
- **Evidence:** `shots/BAL/game-day-week-9__390__baseline.png`, `shots/BAL/game-day-week-9__320__baseline.png`

## S3

### V-013 — target-below-44-touch: span[role=button]

- **Status:** open
- **Seen:** 200× on fantasy-draft; teams BAL; viewports 390, 320; conditions baseline
- **Expected:** touch targets are at least 44x44 CSS px at touch widths (the product bar)
- **Actual:** 110x25px at a touch width
- **Reproduce:**
  1. npm run audit:visual -- -g "fantasy-draft" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=390 AUDIT_SCREENS=fantasy-draft AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "fantasy-draft" stage (e2e/fixtures/build.ts --team BAL), open #/ at 390px wide
  3. measure: target-below-44-touch on span[role=button] ("Trevor Whitett"): 110x25px at a touch width
- **Proposed fix:** Raise `min-height`/`min-width` to 44px under the touch breakpoint, or enlarge the hit area with padding.
- **Evidence:** `shots/BAL/fantasy-draft__390__baseline.png`, `shots/BAL/fantasy-draft__320__baseline.png`

### V-014 — target-below-44-touch: button.reset

- **Status:** open
- **Seen:** 84× on setup, fantasy-draft, coaching-draft-hub, hub-week-9, roster, free-agency-board, trade-deadline, history, game-plan, game-day-week-9, bracket, end-of-season, season-complete, offseason-fa; teams BAL; viewports 390, 320; conditions baseline
- **Expected:** touch targets are at least 44x44 CSS px at touch widths (the product bar)
- **Actual:** 147x40px at a touch width
- **Reproduce:**
  1. npm run audit:visual -- -g "setup" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=390 AUDIT_SCREENS=setup AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "no league" stage (e2e/fixtures/build.ts --team BAL), open #/setup at 390px wide
  3. measure: target-below-44-touch on button.reset ("Download backup"): 147x40px at a touch width
- **Proposed fix:** Raise `min-height`/`min-width` to 44px under the touch breakpoint, or enlarge the hit area with padding.
- **Evidence:** `shots/BAL/setup__390__baseline.png`, `shots/BAL/fantasy-draft__390__baseline.png`, `shots/BAL/coaching-draft-hub__390__baseline.png`, `shots/BAL/hub-week-9__390__baseline.png`

### V-015 — target-below-44-touch: button.how-tab

- **Status:** open
- **Seen:** 28× on setup, fantasy-draft, coaching-draft-hub, hub-week-9, roster, free-agency-board, trade-deadline, history, game-plan, game-day-week-9, bracket, end-of-season, season-complete, offseason-fa; teams BAL; viewports 390, 320; conditions baseline
- **Expected:** touch targets are at least 44x44 CSS px at touch widths (the product bar)
- **Actual:** 118x40px at a touch width
- **Reproduce:**
  1. npm run audit:visual -- -g "setup" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=390 AUDIT_SCREENS=setup AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "no league" stage (e2e/fixtures/build.ts --team BAL), open #/setup at 390px wide
  3. measure: target-below-44-touch on button.how-tab ("Methodology"): 118x40px at a touch width
- **Proposed fix:** Raise `min-height`/`min-width` to 44px under the touch breakpoint, or enlarge the hit area with padding.
- **Evidence:** `shots/BAL/setup__390__baseline.png`, `shots/BAL/fantasy-draft__390__baseline.png`, `shots/BAL/coaching-draft-hub__390__baseline.png`, `shots/BAL/hub-week-9__390__baseline.png`

### V-016 — target-below-44-touch: button.ui-skip

- **Status:** open
- **Seen:** 28× on setup, fantasy-draft, coaching-draft-hub, hub-week-9, roster, free-agency-board, trade-deadline, history, game-plan, game-day-week-9, bracket, end-of-season, season-complete, offseason-fa; teams BAL; viewports 390, 320; conditions baseline
- **Expected:** touch targets are at least 44x44 CSS px at touch widths (the product bar)
- **Actual:** 144x40px at a touch width
- **Reproduce:**
  1. npm run audit:visual -- -g "setup" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=390 AUDIT_SCREENS=setup AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "no league" stage (e2e/fixtures/build.ts --team BAL), open #/setup at 390px wide
  3. measure: target-below-44-touch on button.ui-skip ("Skip to content"): 144x40px at a touch width
- **Proposed fix:** Raise `min-height`/`min-width` to 44px under the touch breakpoint, or enlarge the hit area with padding.
- **Evidence:** `shots/BAL/setup__390__baseline.png`, `shots/BAL/fantasy-draft__390__baseline.png`, `shots/BAL/coaching-draft-hub__390__baseline.png`, `shots/BAL/hub-week-9__390__baseline.png`

### V-017 — contrast: small

- **Status:** open
- **Seen:** 3× on hub-week-9; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** text meets 4.5:1 (3:1 for large text) against its actual background
- **Actual:** 4.25:1, needs 4.5:1 (10px bold) fg rgb(78,95,112) on rgb(205,208,211)
- **Reproduce:**
  1. npm run audit:visual -- -g "hub-week-9" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=hub-week-9 AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "season-week-9" stage (e2e/fixtures/build.ts --team BAL), open #/hub at 1440px wide
  3. measure: contrast on small ("7th"): 4.25:1, needs 4.5:1 (10px bold) fg rgb(78,95,112) on rgb(205,208,211)
- **Proposed fix:** Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed.
- **Evidence:** `shots/BAL/hub-week-9__1440__baseline.png`, `shots/BAL/hub-week-9__390__baseline.png`, `shots/BAL/hub-week-9__320__baseline.png`

### V-018 — text-clipped: div[role=img].gd-pitch

- **Status:** open
- **Seen:** 2× on roster; teams BAL; viewports 390, 320; conditions baseline
- **Expected:** text is never cut silently
- **Actual:** content 334px in a 330px box (clipped)
- **Reproduce:**
  1. npm run audit:visual -- -g "roster" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=390 AUDIT_SCREENS=roster AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "season-week-9" stage (e2e/fixtures/build.ts --team BAL), open #/roster at 390px wide
  3. measure: text-clipped on div[role=img].gd-pitch ("$239.0M used"): content 334px in a 330px box (clipped)
- **Proposed fix:** Allow wrapping (`overflow-wrap:anywhere`) or use an ellipsis with the full text in `title`/`aria-label`.
- **Evidence:** `shots/BAL/roster__390__baseline.png`, `shots/BAL/roster__320__baseline.png`

## S4

### V-019 — heading-skip: h3

- **Status:** open
- **Seen:** 6× on game-plan, offseason-fa; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** heading levels descend one at a time
- **Actual:** h1 followed by h3
- **Reproduce:**
  1. npm run audit:visual -- -g "game-plan" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=game-plan AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "season-week-9" stage (e2e/fixtures/build.ts --team BAL), open #/game-plan at 1440px wide
  3. measure: heading-skip on h3 ("Pass or run"): h1 followed by h3
- **Proposed fix:** Use the right level for outline, and style it with a class instead.
- **Evidence:** `shots/BAL/game-plan__1440__baseline.png`, `shots/BAL/offseason-fa__1440__baseline.png`, `shots/BAL/game-plan__390__baseline.png`, `shots/BAL/offseason-fa__390__baseline.png`

### V-020 — heading-skip: h3.bx-round

- **Status:** open
- **Seen:** 3× on bracket; teams BAL; viewports 1440, 390, 320; conditions baseline
- **Expected:** heading levels descend one at a time
- **Actual:** h1 followed by h3
- **Reproduce:**
  1. npm run audit:visual -- -g "bracket" with AUDIT_TEAMS=BAL AUDIT_VIEWPORTS=1440 AUDIT_SCREENS=bracket AUDIT_CONDITIONS=baseline
  2. or by hand: play a league as BAL to the "playoffs-wild-card" stage (e2e/fixtures/build.ts --team BAL), open #/bracket at 1440px wide
  3. measure: heading-skip on h3.bx-round ("Wild Card"): h1 followed by h3
- **Proposed fix:** Use the right level for outline, and style it with a class instead.
- **Evidence:** `shots/BAL/bracket__1440__baseline.png`, `shots/BAL/bracket__390__baseline.png`, `shots/BAL/bracket__320__baseline.png`
