# 08 · Wave 2 — verification report (pre-baseline)

Commit `3abcfff` (UI build), real browser, real engine adapter, isolated league server. **Pre-baseline:** Group 08 cleanup and the #92 harness are not merged; the highest-priority checks below should be repeated on the approved baseline. Wave-1 evidence is unchanged; everything new is in `evidence/wave2/` and `agents/agent-01-aesthetics/report-2026-11-07.md` (A1-023+).

## 1. Coverage: how each thing was examined
**Method key:** **UI** = played by a scripted real-browser driver against the real engine adapter (:8787), clicking the same buttons a player does · **FX** = game-generated fixture (`e2e/fixtures/build.ts`, Mock sim, no adapter) loaded into the real UI · **MOD** = a real save with one injected field · **RT** = rendered in a real browser with a real server (multiplayer) · **CODE** = read in source only.

| Area | Result | Method |
|---|---|---|
| Season 1 (2027): fantasy draft, coaching draft, camp, preseason, 18 weeks, trade deadline, mid-season FA, playoffs incl. Super Bowl, end of season, hot seat | complete | UI |
| Offseason 2028: retirement, rookie draft, signings, free agency, camp, preseason | complete | UI |
| Season 2 (2028): all of the above through the Super Bowl and end of season | complete | UI |
| 2029 offseason: hot seat, retirement, rookie draft, signings, free agency, **Hooded Figure (organic)** | reached; run stopped at the HF encounter | UI |
| Live Gamecast with real play-by-play | rendered, stepped, autoplayed, mobile | UI (adapter games: 149–151 plays) |
| Hooded Figure | organic (2029) + pay path | UI + MOD |
| League Developments | rendered (after paying the figure) | MOD |
| Multiplayer lobby (signed-out, create account, empty, start league, invite, join, claim) | rendered | RT |
| Multiplayer waiting state ("Waiting for other players"), draft start, pause banner, onboarding card | rendered | RT |
| Commissioner controls (Manage GMs, pause/resume, hours per turn, reset code, open seat, make commissioner) | rendered (not clicked: destructive) | RT |
| Checkpoint | seen as the "Waiting for other players" gate only | RT |
| Dialogs/overlays/notifications | confirm dialog, "Make the offer", on-the-clock, quarter-break, Methodology, Unit Grades, dossier, save-failure banner, paused banner, onboarding card, native confirm/alert | UI/RT |
| Other franchises: PIT, CIN, CHI, LV (+BAL) | hub, roster, draft, end of season, trade; contrast sweep | FX |
| 32-team stadium inventory | all 32 mastheads rendered with the real component | FX (viewer team swapped in a real save) |
| Motion | every running animation recorded by name, target and duration for draft pick, FA offer, hub navigation, with and without reduced motion | UI/FX |
| **Not covered** | coach-details modal (opener not found), Checkpoint with a stalled GM, "have X's staff take this turn" on a real stalled turn, Firefox/Safari, real mobile devices, audio, 5-franchise 390px visuals, a championship won by the human team | — |

## 2. Reproduction and root cause (Priority 4)
| Finding | Reproduced? | Component / cause | Evidence |
|---|---|---|---|
| A1-001 dark stat strips | Yes, 5 of 5 franchises, desktop and 390px, SP and MP | `decisions/decisions.css:6` `.decision-workspace .ticker` dark gradient; no override in `decisions-gameday.css`; 8 screens wrap in `DecisionFrame` | computed bg `linear-gradient(135deg, rgb(18,37,48), rgb(8,22,31))`, value colour `rgb(11,27,46)` → **1.02:1**; draft strip 1.1:1 on all teams |
| A1-001 fix validated (concept) | Yes | `.decision-workspace .ticker{background:var(--gd-card)!important;border:2px solid var(--gd-rule)!important;border-radius:0!important}` injected at runtime only | `rootcause_ticker_before_after_concept.webp` (labelled concept) |
| A1-002/025 dark summaries | Yes (fantasy, rookie, FA, trade summaries) | `FantasyDraftSummary.tsx` + `DraftSummaryOverview.tsx` + `draft-summary.css` (`.dso-*`), `DecisionFrame` | sheets A/B |
| A1-003 on-the-clock overlay | Yes, every pick | `.fs-overlay{position:absolute;inset:0}` (theme.css:1085) relative to the whole card; `overlays.css:363` pale 97% scrim, headline `clamp(40px,9vw,76px)` wraps | `draft_clock_overlay_1440.webp`, `real_run_offseason_sheet_A` |
| A1-004 floating buttons | Yes (desktop draft/FA; 390px hub, draft, Gamecast) | `app-shell.css:419` fixed bottom-right dock; `.how-tab` | `gamecast_mobile_390`, `overlays_…_390` |
| A1-012 undersized mobile controls | Yes: Methodology 118×40, Download/Restore/New-solo 40px, Skip link 40px at 390 on every route; ~105 on the draft board | shell CSS `min-height:40px` | re-run `tools/sweep.cjs` (output not archived) |
| A1-016 fonts | Yes: layout holds, identity lost | `index.html` Google Fonts `<link>` | `fonts_blocked_hub_1440.webp` |
| A1-023 save ceiling | Yes, 2 of 2 runs | single localStorage key; `store.ts` comment acknowledges ~2.5 MB/league vs ~5 MB | 5,163,796 vs 5,234,375 chars |

## 3. Where should each problem be fixed? (Group 08 determination)
Group 08's own brief (`docs/ui-redesign/08-cleanup.md`, branch `docs/ui-redesign-prompts`, PR #83 not merged) requires **pixel-identical** output ("Prove no visual change"), deletes dead CSS, unifies tokens and the page shell, and says "if a dark page still exists anywhere, stop and report it". So:

| Item | Best home | Why |
|---|---|---|
| A1-001, 002, 025 (dark strips, dark summaries, `decisions.css`, `draft-summary.css`) | **Separate follow-up PR before Group 08** ("decision screens: finish the gameday conversion") | They are visible defects, not dead CSS; Group 08 would have to stop on them, and its pixel-diff would hide them. Deleting `decisions.css` afterwards then becomes safe. Small for the strip (3 declarations), medium for the four summary screens. |
| A1-003 overlay, A1-004 docks, A1-012/013 targets and text floor, A1-005, 015, 017, 018, 027, 028, 029, 030 | Separate small PR(s) ("quick fixes") | Visual changes by design. |
| A1-006 slim mastheads, 007 empty states, 008, 009, 010, 014, 031–037 | Feature/enhancement PRs after approval | Design decisions. |
| Dead CSS, token layer, `GdPage` shell, dev screens | **Group 08** as written | No visual change intended. Note for 08: `.decision-workspace` styles that leak (ticker, tabs, `.panel.open`, `.decision-context`) are *live*, not dead; do not delete them until the follow-up lands. |
| A1-023 save ceiling | Engineering PR (not visual) | Persistence layer. |
| A1-024 native dialogs | UX PR after approval | Needs a shared confirm component. |
| A1-016 self-hosted fonts | Build/asset PR | Touches CSP/offline/PWA. |

## 4. Motion (Priority 5): what was measured
Method: a `requestAnimationFrame` probe records every `document.getAnimations()` entry (name, target, duration, delay). Reduced-motion run: Chromium `reducedMotion: reduce`.
- **Draft pick:** confirm dialog `scrim-in` 220 ms + `lift-in` 420 ms (+ button 130 ms transitions). After Confirm: nothing for roughly 1–1.5 s; then `row-rise` 420 ms, next team's full-screen overlay (`scrim-in` 220, `lift-in` 420, headline `lift-in` 420 delay 60) and `stat-moved` 620 ms. No animation belongs to the user's own selection.
- **FA offer:** only `stat-moved` 620 ms on the strip counter ≈2.3 s later.
- **Navigation (hub ↔ roster):** link colour 130 ms; masthead photo fade 420 ms; page surface `?` 320 ms; tab underline `transform` 420 ms. Responsive and quiet (good).
- **Gamecast:** 1 play ≈ 1.4 s at 1× (≈3.5 min/game); quarter card halts autoplay (A1-031).
- **Reduced motion:** durations 0 ms (`lift-in`), 0 animations running on the hub. Correct.
- **Not measured:** trade acceptance, playoff advancement, Super Bowl/champion screens (no distinct animation was present on the pages I saw; the human team did not win a title), Hooded Figure reveal, coaching-hire confirmation, and perceived smoothness (no frame-rate measurement). Proposals in `06` are marked accordingly.

## 5. Tools
`tools/` holds the scripts used (driver, probes, contrast, quota, 32-team masthead, multiplayer). They assume the servers in the report's session header, hard-code the original scratch paths, and use a throw-away test password for the disposable local league server only.
