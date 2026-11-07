# 03 · TAFI Register — Agent 1 (Aesthetics & UI/UX)

Evidence for every entry: **commit `3abcfff`** (master after PRs #84, #87, #90 merged), production build (`vite build` + `vite preview`), Chromium (Playwright, headless), team **BAL** (the only franchise rendered, see README limitations), viewport as stated. Images are in `evidence/`.

**Confirmed** = observed in a rendered screenshot or measured in the browser. **Recommendation** = subjective design judgement. Nothing here was implemented.

Severity scale: Critical (blocks play) · High (a main screen looks broken or unreadable) · Medium (clear quality gap) · Low (polish).

---

## UI-TAFI-001 — Leftover dark stat strips with unreadable values
- **Screens:** `/free-agency-board` (`FreeAgencyBoardTurns.tsx`), `/free-agency`, `/trade-deadline` (`TradeDeadlineRoom.tsx`), `/draft` (`DraftRoom.tsx`).
- **Class:** Visual defect + consistency issue. **Severity: High. Confirmed.**
- **Current:** Every other screen opens with a white bordered stat strip (e.g. Coaching Draft "0 / 12"). These four open with a near-black navy strip whose numbers ("1 / 5", "319", "On the clock · Baltimore") are navy/purple on navy and effectively invisible; labels are ~30% opacity. At 390px the strip is the same.
- **Why it matters:** The strip is the "where am I in this event" readout for the most tense turn-based moments (draft, free agency, deadline). The player sees an empty dark box.
- **Evidence:** `midseason_fa_strip_1440.webp`, `sheet_A…` (free agency), `sheet_B…` (deadline), `sheet_C…` (draft), `mobile_contact_390.webp`.
- **Proposed:** Reuse the light `gd-stats` strip used by Coaching Draft/Box Score; keep one accent cell (e.g. "On the clock") in team colour. Delete the dark variant's CSS.
- **Alternative:** Keep dark strip as an intentional "live event" band but set values to white at ≥4.5:1.
- **Benefit:** Turn state readable at a glance; four screens match the rest.
- **Complexity:** Small.
- **Regression check:** Axe/contrast probe on the four routes; the e2e specs that select these screens by role/name still pass; screenshot at 1440/390.

## UI-TAFI-002 — Fantasy Draft Summary is still on the old dark design
- **Screen:** `/fantasy-draft-summary` (`FantasyDraftSummary.tsx`, `DraftSummaryOverview.tsx`).
- **Class:** Consistency issue. **Severity: High. Confirmed.**
- **Current:** No stadium masthead, a dark page, dark stat cards with faint labels, a "BAL" chip title bar. It is the first thing a player sees after the 5-minute draft and looks like a different product.
- **Why:** The draft grade is a marquee moment ("A+"); it is delivered in the least polished screen.
- **Evidence:** `sheet_B…` (bottom right).
- **Proposed:** Convert to `GdPage` + `GameDayMasthead`; present the grade as a large stamped letter with the three ranks beside it (see Top-10 #3 and the animation proposal).
- **Complexity:** Medium. **Regression:** e2e `draft.spec.ts`, `FantasyDraftSummary` unit tests, no change to `grade()`.

## UI-TAFI-003 — "On the clock" interstitial: headline clipped, page bleeds through
- **Screen:** `/draft` interstitial ("The Baltimore Ravens are on the clock", `TurnClock.tsx` / `PickMoments.tsx`).
- **Class:** Visual defect. **Severity: High. Confirmed once; cause not diagnosed.**
- **Current:** Headline wraps to two lines at 1440px and, when the board has been scrolled, sits against the top edge with its top clipped; the underlying table shows through at ~85% white so ghosted rows collide with the text. Footer "Tap or click anywhere" sits at the bottom of the same ghost layer.
- **Evidence:** `draft_clock_overlay_1440.webp` (captured while the page was scrolled; the first capture at scroll 0 was mid-fade).
- **Proposed:** Fix overlay to the viewport (`position: fixed; inset: 0`), centre vertically, clamp headline to one line (`clamp(2rem,5vw,4rem)`, "Baltimore is on the clock"), use an opaque or blurred scrim, and show the player's pick number.
- **Complexity:** Small. **Regression:** open at scroll 0 and scrolled, 1440/390, reduced motion.

## UI-TAFI-004 — Two floating buttons cover content
- **Screens:** all. `HowItWorksDock.tsx` ("Methodology" tab) and `UnitGradesDock.tsx` ("Unit Grades" button, draft/FA/trade/deadline).
- **Class:** Usability issue. **Severity: Medium. Confirmed.**
- **Current:** On 390px the Methodology tab becomes a dark button bottom-left over page content (it covers "Simulate Regular Season" in the hub screenshot); Unit Grades sits bottom-right over row actions. On desktop Unit Grades overlaps the Player Comparison card.
- **Proposed:** Move both into the sidebar / mobile nav row; or collapse into one "Tools" FAB with a menu; add bottom padding equal to the FAB height so nothing is permanently covered.
- **Complexity:** Small–Medium. **Regression:** 390/320 screenshots, `howItWorks.test.ts`, keyboard reachability.

## UI-TAFI-005 — Default browser-blue link in setup notice
- **Screen:** `/setup`, solo notice ("…start a league from **Online Leagues** instead").
- **Class:** Visual defect. **Severity: Low. Confirmed.** `setup_full_1440.webp`.
- **Proposed:** Style notice links with the gameday link token (navy, underline offset, orange hover).
- **Complexity:** Small.

## UI-TAFI-006 — One stadium photo is the masthead on every screen
- **Screens:** all with `GameDayMasthead`.
- **Class:** Enhancement proposal. **Severity: Medium. Subjective.**
- **Current:** Baltimore's photo repeats on ~30 routes, including empty-state pages. The masthead costs 250–350px of every screen and its credit line wraps to two lines.
- **Proposed:** Full photo only on "moment" screens (hub, draft, season complete, bracket); other screens get a 96px slim masthead (title + stage) with a cropped strip of the same photo. Shorten credit to "Photo: Q. Soloviev · CC BY 4.0" with the full text in a tooltip/credits page (licence text must remain reachable).
- **Complexity:** Medium. **Regression:** attribution still reachable for every CC BY/BY-SA photo.

## UI-TAFI-007 — Empty states are blank pages
- **Screens:** `/game-day` (nothing pending), `/training-camp-results`, `/hot-seat`, `/online` (while loading).
- **Class:** Usability / visual. **Severity: Medium. Confirmed.**
- **Current:** A masthead, one dashed box with one sentence, and ~600px of empty grey. `game_day_empty_1440.webp`.
- **Proposed:** Give each an illustrated empty state with the next useful action ("Next game: Week 9 vs CHI — Go to hub"), or redirect Game Day to the hub when nothing is pending.
- **Complexity:** Small.

## UI-TAFI-008 — Command Center is 4,190px long and leads with dashes
- **Screen:** `/hub` (`WeeklyTeamHub.tsx`).
- **Class:** Usability. **Severity: Medium. Confirmed (height measured 4,192px at 1440).**
- **Current:** After the readiness card come eight panels; the matchup table in week 1 is mostly "—" rows; Game Plan has a dashed "Prepare your next game" box beside the sliders.
- **Proposed:** Keep above the fold: readiness + next opponent + win probability + one "needs attention" list. Collapse the matchup table to the five lines that have data (hide "—" rows). Move Game Plan to a one-line summary (already exists on bracket).
- **Complexity:** Medium. **Regression:** e2e `frontend-dashboard.spec.ts`.

## UI-TAFI-009 — Mid-season free agency page is 10,464px tall
- **Screen:** `/free-agency-board`. **Class:** Usability. **Severity: Medium. Confirmed (measured).**
- **Proposed:** Paginate or virtualise the 319-player board (50 rows + "show more"), keep Build-Offer panel sticky.
- **Complexity:** Medium.

## UI-TAFI-010 — Season Complete: champion buried, theme breaks
- **Screen:** `/season-complete`. **Class:** Consistency + enhancement. **Severity: High (emotional impact). Confirmed layout; judgement on impact.**
- **Current:** Masthead is teal (not the team colour) with the generic skyline, then a dark "YOUR BALTIMORE RAVENS" card. The champion ("Philadelphia Eagles took the title") is a 12px subtitle.
- **Proposed:** Champion banner as the hero (team colours, trophy mark, record, score of the final); the viewer's season below it. Use the team masthead.
- **Complexity:** Medium.

## UI-TAFI-011 — End-of-season awards page hides the next step behind "tap anywhere"
- **Screen:** `/end-of-season` (`EndOfSeason.tsx`). **Class:** Usability. **Severity: Low–Medium. Confirmed.**
- **Current:** Awards list plus the sentence "Tap or click anywhere to see how the season graded out" while an orange *Continue* button is also present — two ways to do the same thing; the hint is text, not an affordance.
- **Proposed:** Keep Continue; drop the global click-anywhere or make it a visible "Next ›".

## UI-TAFI-012 — Shell controls are 40px, draft board has ~100 undersized controls
- **Screens:** chrome on all (Methodology 118×40, Download/Restore/New solo 40px, Skip link 40px); `/draft` has ~105 sub-44px targets at 390px.
- **Class:** Accessibility. **Severity: Medium. Confirmed (measured at 320/390/768/1024).**
- **Proposed:** `min-height: 44px` on shell buttons at ≤768px; give draft-board row actions a 44px hit area (padding, not visual size).
- **Complexity:** Small. **Regression:** target-size probe across the sweep routes.

## UI-TAFI-013 — Text below 11px on dense screens
- **Screens (count of elements <11px at 1440→320):** `/free-agency` 240, `/draft` 100, `/free-agency-board` 80, `/rookie-draft-summary` 73, `/league-rosters` 53, `/schedule` 32, `/hub` 15.
- **Class:** Accessibility/readability. **Severity: Medium. Confirmed (computed font-size).**
- **Proposed:** Floor body/table text at 12px (13px on touch); keep caps labels ≥11px.

## UI-TAFI-014 — Bracket leaves most of the card empty until games are played
- **Screen:** `/bracket`. **Class:** Enhancement. **Severity: Low–Medium. Subjective.**
- **Current:** Wild Card column full; Divisional / Conference columns are a single "TBD" with ~700px of white; "Missed" is the whole story when the viewer is out.
- **Proposed:** Draw the full bracket skeleton with connectors; if the viewer missed, show "Out — final record 4-11-2" and make "Follow the title run" the CTA.
- **Complexity:** Medium.

## UI-TAFI-015 — Box score header details
- **Screen:** `/box/:id`. **Class:** Visual defect. **Severity: Low. Confirmed.**
- Total-yards tile wraps ("BAL 288 – 245 / KC"); the W/L marks ("KC W / BAL L") are 10px between the scores. Use "288 – 245" with team chips; enlarge result marks.

## UI-TAFI-016 — Fonts come from Google's CDN
- **Class:** Accessibility/resilience. **Severity: Medium. Confirmed.**
- **Current:** `index.html` loads Oswald, Inter, Big Shoulders Display and Hanken Grotesk from fonts.googleapis.com. Blocked: layout holds (no overflow), but the condensed display type collapses to a wide system sans; "BALTIMORE RAVENS" becomes ~1.4× wider and the brand feel disappears. `fonts_blocked_hub_1440.webp`.
- **Proposed:** Self-host WOFF2 subsets (only Big Shoulders 800/900 and Hanken 400–700 appear to be used), add size-adjusted fallbacks.
- **Complexity:** Small–Medium. Also helps privacy and offline/PWA.

## UI-TAFI-017 — Primary button colour is not consistent
- **Screens:** `/retirement` ("Advance to the Draft"), `/rookie-signings` use purple/navy primary buttons; elsewhere primary = orange. **Severity: Low. Confirmed.** `sheet_B…`.
- **Proposed:** One primary (orange) per screen; secondary = outline.

## UI-TAFI-018 — Stray full stop in free-agency "You're up" notice
- **Screen:** `/free-agency-board`. A lone "." renders between "Pass this round" and "Let my staff take this turn". **Severity: Low. Confirmed.** `midseason_fa_strip_1440.webp`.

## UI-TAFI-019 — 15 franchises have no stadium photo; one photo is an extreme crop
- See `04-stadium-inventory.md`. **Class:** Missing asset. **Severity: Medium.** ARI.webp is 1600×593 (2.7:1), narrower than every other photo; only the drawn skyline backs the other 15.

## UI-TAFI-020 — Online lobby has no visible failure/timeout state when the server is unreachable
- **Screen:** `/online` (`OnlineLobby.tsx`). **Class:** Usability. **Severity: Medium. Confirmed in this environment (no league server was running).**
- **Current:** "Looking for the league server… / One moment." was still showing after 9 seconds. `online_waiting_1440.webp`.
- **Proposed:** After ~6s show "Can't reach the league server" with Retry and "Play solo" actions. *Refer to the multiplayer/reliability specialist; the commissioner screens were not examined (limitation).*

## UI-TAFI-021 — Left rail clips its footer controls at 900px height
- **Screens:** all at 1440×900. Motion buttons and backup buttons fall below the fold (the rail shows "Motion" cut off in many captures). **Class:** Usability. **Severity: Low. Confirmed visually; whether the rail scrolls internally was not tested.**
- **Proposed:** Pin sound/motion in a footer row; move backup/restore/new dynasty under "League settings".

## UI-TAFI-022 — Full-page captures show the rail ending mid-page
- Not a defect (the rail is `sticky`); recorded so the coordinator does not double-count it.

---

### Referrals (not scored here)
- **Realism agent:** Week 1 BAL–ARI finished **2–2** in the fixture league (`GAME HISTORY`: "T 2–2 vs Arizona"). May be a fixture-mode artefact (headless mock sim), but worth checking in the real engine.
- **Audio agent:** Sound is off by default; nothing audible was evaluated.
- **Multiplayer/cybersecurity:** commissioner and take-turn UI not rendered here.

### What works well (keep)
Keyboard focus is strong everywhere probed (2–3px white ring + shadow on rail items; "Skip to content" first). Reduced motion stops all running animations (0 running `document.getAnimations()`). No horizontal page overflow on any of 23 routes at 1024/768/390/320. The roster/cap "yards to the cap line" panel is the model of the design system.
