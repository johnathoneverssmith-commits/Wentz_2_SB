# TAFI inventory — adversarial / multi-season QA

Baseline `d0727ff`. Seeds/config in `REPORT.md`. Reproducibility counts are of the attempts made.

## A. New confirmed defects

### ADV-001 — "New solo dynasty" destroys the live save and the `#prev` recovery copy
- Class: bug (data loss, user-initiated) · Severity: **P2** (Medium; argue P1 if the owner treats the #101 promise "a failed/accidental write is recoverable" as covering resets) · Mode: SP
- Path: engine/mock-independent (store + `durableSave.ts`)
- Seed/config: any; reproduced on League 1 (seed 8724, 5 seasons, 6.2 MB) via a copy of its profile.
- Steps: 1) open a mid-dynasty league. 2) Click **New solo dynasty** in the global header. 3) Accept the native confirm ("Start a brand-new solo dynasty? This clears the current save."). 4) Read IndexedDB slot records at +0.3 s and +4 s (`scripts/adv-newdynasty2.mjs`).
- Observed: before: `cur=2031/offseasonHotSeat/history=5`, `prev=same`. At +0.3 s: `cur=2026/setup/history=0`, **`prev=2026/setup/history=0`**. Unchanged at +4 s. No `#damaged`/`#undo` copy. (`evidence/adv-newdynasty.out`)
- Expected: the most destructive action should leave the last dynasty recoverable at least once (the `#prev` design in `docs/save_persistence.md`), or require typing/confirming something stronger than one native `confirm()`.
- Reproducibility: 2/2.
- Root cause: suspected — reset writes the fresh league twice in quick succession (or writes it once with the `#prev` copy taken after the first reset write), so the "previous" record is the fresh league. Not traced in code.
- Evidence: `evidence/adv-newdynasty.out`; script `scripts/adv-newdynasty2.mjs`.
- Suggested fix: on reset, copy the live record to a dedicated `#undo` key that no autosave touches (cleared after N days or on the next successful *season rollover*), and make the confirm name what is lost ("5 seasons, 2031 offseason"). Offer "Download backup first".
- Regression test: yes — `durableSave.test.ts`/`saveDurability.test.ts`: after `resetToNewDynasty`, a record equal to the pre-reset save must still be readable.
- Related: TAFI-GAP-006 (native `confirm()` sites), TAFI-GAP-008/#101.

### ADV-002 — 42% of "retirements" are unsigned free agents aged ≤24
- Class: realism/UX · Severity: **P3** · Mode: SP · Path: engine adapter + store (aging step)
- Seed/config: League 2 (seed 31337), snapshot 2027 preseason → 2028 preseason (`scripts/check-transition.mjs`).
- Observed: 332 players flagged `retired` with `retirement_status:"retiring"` in the 2027→2028 transition; by age: ≤24: **140**, 25–29: 43, 30–33: 102, 34+: 47. Examples: 24-yr-old OG ovr 58 (1 yr pro), 22-yr-old WR ovr 56 (0 yrs pro); all were `FA` before. League 1 shows the same pattern (365 retired flagged 2030, 224 in 2031; older players also present).
- Expected: `howItWorks.ts` says retirement "depends on age against the position's typical retirement age and on prior injuries"; 20–24-year-olds retiring contradicts that and would read to a player as a bug in the Retirement Review. If this is pruning of unsigned free agents, label it that way and keep it out of "retirements".
- Reproducibility: always (both leagues). Root cause: unknown — likely the pool-size control reusing the `retired` flag.
- UI exposure: **unverified** whether these appear on the Retirement Review screen (only starters may be listed). Check before sizing.
- Suggested fix: separate flag/label (`released_from_pool`), or make low-ovr young FAs "go undrafted/leave the league" instead of "retire"; update How It Works if intended.
- Regression test: yes — transition test asserting no `retired` player under the position's minimum retirement age unless injury history justifies it.

## B. Existing TAFIs re-verified (not new)

| Existing | What this run added |
|---|---|
| TAFI-GAP-004 (silent mid-franchise fallback) | Adapter killed at 2029 hot seat of an engine-built dynasty; the *same save* played all of 2030 on Mock with **no banner** (the only fallback wording is a game-plan footnote: "…the standalone offline fallback does not model these tactics", `/hub`). Console shows only `ERR_CONNECTION_REFUSED`. |
| TAFI-GAP-001 (Mock impossible scores) | 3 REG games in 2030 with a team scoring exactly **1** (`NO 33–1 ATL`, `WAS 19–1 SF`, `LAR 22–1 LV`); 5 ties vs 2 on the engine season; engine leagues: 0 one-point scores in 8 seasons. |
| TAFI-GAP-005 (Mock playoffs store no games) | 13/13 playoff bracket matchups had a winner and **no stored game** on the Mock season; engine seasons 0/104. Also no `weather` (0/272) and no broadcast. |
| TAFI-GAP-003 (player lines vs team yards, engine) | 36 REG/POST games with lines: player rushing yards sum to team `rushYards` + **12.4 yd on average (min −6, max +41), never equal**; passing +1.1 avg; completions off by 1 in 3/36. Player lines exist for 21–99 of 333 games (viewer's). |
| TAFI-GAP-007 (odd URLs) | 26 routes: no crash, no state mutation. `/bracket` in preseason shows "2027 playoffs"; `/results/REG/1/99` renders "Week 1 through Week 99"; `/box/not-a-game` renders a "Box score" page rather than redirecting. |
| TAFI-GAP-006 (native confirm) | New dynasty confirm is the consequential one → ADV-001. |
| TAFI-GAP-008/#101 | No regression found; see RISK doc. |
| TAFI-GAP-011/#100 | No regression found in 8 engine seasons; see RISK doc. |

## C. Suspected / low-confidence (not claimed as defects)
- **S-1 legacy-save shadowing.** If IndexedDB already holds *any* record for the slot (even a fresh league), a later-appearing legacy `localStorage` string is not migrated and my test showed the fresh league loading. A real pre-#101 user has no IDB record so this is not the normal path; matters only if a user opens the new build in a profile that already created a new league. Unverified whether the legacy string is left in `localStorage` or surfaced to the player.
- **S-2 compensatory picks.** 2032 had 43 comp picks (rounds 3: +5, 4: +6, 5: +30, 6: +2); the NFL caps compensatory picks at 32. Design/realism call, not an integrity bug.
- **S-3 BAL roster = 18 at the hot-seat stage** after contracts expire (others 34–39); likely intended (re-sign/draft refills), but the roster is only restored by later stages, so a player quitting at hot seat would see an illegal roster.

## D. Untested hypotheses (listed so no one assumes they were checked)
H-1 trade-value exploits (pick-for-star, 2-for-1 depth dumps, deadline-turn ordering); H-2 restructure/extend loops creating negative or unbounded cap room; H-3 stale `returnTo` after reload mid-trade; H-4 mixed-engine online leagues; H-5 two tabs last-writer-wins corrupting a mid-draft; H-6 hooded-figure payment branch determinism after reload; H-7 non-32-team and `humansOnly` shape labels (GAP-009 exists); H-8 tab closed inside the IndexedDB write window (documented limit in `docs/save_persistence.md`).

## E. Counts
Confirmed new: **2** (P2 ×1, P3 ×1). Suspected: 3. Untested hypotheses: 8. Existing TAFIs re-verified: 8.
