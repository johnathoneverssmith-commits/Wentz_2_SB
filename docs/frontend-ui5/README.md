# UI-5: franchise journey usability

UI-5 preserves UI-1–4's visual system and game actions while making the next phase easier to understand. The branch includes merged PR #66's fictional leagues and uses its existing qualitative scouting profile in setup.

## What changed

- A compact current-phase/season/turn guide, with the real personal-step return link when browsing reference screens. Online readiness, detached sessions, viewer-relative weeks and humans-only leagues use their existing state/selectors. No raw future scores, bracket outcomes or hidden player ratings are displayed.
- Optional, short Start here explanations beside the detailed How It Works rules. Shared keyboard tabs, real labelled panels, Escape/focus return, a help drawer above mobile navigation, and actual parameterized recap/results/broadcast routes.
- Accurate solo versus online and fantasy versus inherited-roster setup instructions. Optional chosen-seed setup restart uses the existing creation action and an explicit reset confirmation. Settings stack on phones and controls have direct accessible names/descriptions.
- A transient, operation-lifetime creation signal keeps team/settings/readiness locked through asynchronous initialization and browser Back. App-level feedback offers reopening the last saved setup if initialization is slow. The observer brackets the existing promise; generation, game values and save formats are unchanged.
- Camp waits for each acknowledgement, reports refused results steps and retries opening already-completed results without rerunning camp. Old camp results are read-only and cannot replace a newer rookie-signing marker. Base coordinator bonuses are labelled before repeat-focus reductions.
- Existing disabled progression hints are visible and programmatically associated. New guidance disclosures, setup controls and camp choices retain keyboard/reduced-motion behavior and phone touch targets.

## Actual application captures

| Screen | Desktop | Mobile |
|---|---|---|
| League setup | [Desktop](setup-desktop.png) | [Mobile](setup-mobile.png) |
| Camp and next-step guidance | [Desktop](camp-desktop.png) | [Mobile](camp-mobile.png) |
| Optional help | [Desktop](help-desktop.png) | [Mobile](help-mobile.png) |

These are isolated Chromium captures of the running game, not mockups. The seed/profile and gameplay controls use real game state. Reduced motion is enabled for stable screenshots.

## Evidence and coverage

Ten added browser scenarios cover real solo creation, seeded restart, a confirmed player pick plus staff completion, all twelve coaching hires, camp results, reference-page return, depth-chart progression into preseason, reload persistence, keyboard help and mobile sizing. They also cover controlled online refusal/waiting/reconnection, delayed initialization across Back, associated help panels and retained-camp legacy marker preservation. Existing free-agency, trading, regular-season, postseason and multi-season browser oracles are preserved and run in the complete suite.

Meaningful negative controls reproduced a lost camp follow-up refusal, missing help-panel target, and an old camp-results call overwriting rookieSignings with trainingCampResults. A delayed-generation probe exposed 30 enabled team buttons after Back before operation-lifetime tracking. Pure tests additionally cover every stage, personal steps, turn ownership, disconnected/checked-in guidance, hidden-result getters, humans-only viewer-relative weeks, seed bounds and observer lifetime/error isolation.

Exact-head CI and complete test counts are recorded in the pull request. Browser and PostgreSQL results must be distinguished: the browser's online cases use intercepted HTTP responses and no real accounts/database; GitHub's standard suite separately uses ephemeral PostgreSQL. No production services or data are used.

## Remaining limits

No known P0/P1 source issue remains after focused independent review; runtime acceptance is gated by the exact-head checks reported in the PR. This is readiness for full playtesting, not a claim that every gameplay defect has been eliminated. Full live multi-user browser/server journeys and adapter-backed multi-season browser play remain beyond these focused UX tests. Existing engine/online suites supply separate rules coverage.

The retained-camp test deliberately combines a genuine browser-completed camp with a genuine offseason snapshot as a controlled legacy server view; current generated fixtures clear that old camp. It is not claimed as a newly generated current save. Automated accessibility coverage checks semantics, focus/keyboard behavior, reduced motion, sizing and overflow; no new general-purpose accessibility scanner dependency was added.

No balance, ratings, CPU decisions, contract/trade/draft rules, fictional generation, database schema, deployment or arcade changes. No merge or deployment is authorized by this workstream.
