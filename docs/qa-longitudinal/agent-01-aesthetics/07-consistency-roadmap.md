# 07 · Visual consistency roadmap

Direction stays as designed (light paper body, hard borders, condensed display type, team-coloured stadium masthead, orange primary). Nothing here changes that direction.

**Phase 1 — Finish the conversion (Small, 1–2 days):** TAFI-001, 002 (the page), 003, 005, 015, 017, 018. Outcome: no dark-theme leftovers, one primary colour, no clipped overlay. Gate: grep for the old dark classes; contrast probe on the changed routes.

**Phase 2 — Chrome (Small–Medium):** 004, 012, 013, 021. One tools affordance, 44px shell targets, 12px text floor, rail footer pinned. Gate: the sweep in this audit (overflow / target / font-size) re-run at four widths.

**Phase 3 — Rhythm (Medium):** 006 (slim vs hero masthead), 007 (empty states), 008, 009. Define two masthead sizes and one empty-state component in `src/design/` and use them everywhere.

**Phase 4 — Moments (Medium):** 010, 014, the draft-grade stamp (002), and the animation set in 06. One shared "moment" component (hero + stat + CTA) used by draft grade, season complete, champion, retirement.

**Phase 5 — Assets & resilience:** self-host fonts (016), 15 missing stadium photos (04, TAFI-019), the online lobby failure state (020, with the multiplayer specialist).

**Guard rails:** keep a visual-regression baseline per route at 1440/390 for BAL plus four other palettes (PIT, CIN, CHI, LV — not yet verified in-app); extend the existing e2e visual-accessibility spec with the target-size and font-floor checks; remove dead CSS in the planned cleanup group (`docs/ui-redesign/08` in open PR #83).
