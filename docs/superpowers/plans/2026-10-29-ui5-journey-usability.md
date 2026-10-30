# UI-5 Journey Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** First-time players understand each phase and move through a season without developer assistance.
**Architecture:** Pure public-state presentation model plus a shared compact guide and optional help. Preserve actions/guards; fix only their feedback and successful navigation. Reuse existing frontend worktree on a dedicated latest-master branch.
**Tech Stack:** Existing TypeScript, React, CSS, Framer Motion, Vitest, Playwright; no dependencies.
**Spec:** docs/frontend-ui5/audit-and-plan.md and user UI-5 brief.

## Global Constraints
No simulation balance, player development, CPU/rating, draft/contract/trade rules, generation, backend/database or arcade changes. No force push, merge or deploy. Keep PR #66 compatible and normally merge master if it lands. Preserve UI-1–4 visual system and all existing journey assertions.

## Review Focus
- Hidden scores, bracket winners and private development data must never enter guidance.
- Readiness and disconnected sessions must not be called an actionable turn.
- Fantasy and inherited-roster starts have different paths after coaching.
- A successful camp followed by failed navigation must remain recoverable without running camp twice.
- Legacy saves, per-GM steps and humans-only season lengths must have accurate labels.

### Task 1: Phase guidance and concise help
Files: components/journey/{guidance.ts,guidance.test.ts,JourneyGuide.tsx,journey.css}; AppShell, HowItWorksDock, state/howItWorks (text/routes only).
- [ ] Write failing stage/privacy/turn/step tests; observe red.
- [ ] Implement public-state view model, compact guide, optional route quick tips and accessible shared help tabs.
- [ ] Browser test navigation, keyboard help, mobile overflow, waiting and recovery; no new gameplay action.

### Task 2: Setup and truthful action feedback
Files: LeagueSetup, components/journey/SetupSeed.tsx, TrainingCamp, ReadinessGate.
- [ ] Write failing setup/camp refusal and retry browser regressions.
- [ ] Correct immediate-next copy, optional existing-action seed control, native setting labels, phone layout.
- [ ] Await/check camp follow-up; single-flight and recoverable errors; preserve request payloads.
- [ ] Show existing disabled reasons as described text without altering eligibility.

### Task 3: Journey proof and handoff
Files: e2e/specs/journey-usability.spec.ts; e2e fixtures genuine camp snapshot; docs/frontend-ui5/.
- [ ] Exercise real setup -> draft -> coaching -> camp plus existing full-season/postseason/next-year browser coverage.
- [ ] Verify controlled multiplayer waiting, refused actions, disconnect/recovery separately from real PostgreSQL CI.
- [ ] Capture actual desktop/mobile screenshots; audit focused tests and meaningful negative controls.
- [ ] Fresh whole-branch internal review; resolve important findings.
- [ ] Run required typechecks/build/UI/regression/Chromium and wentz-verify; push and open one requested-title PR.
- [ ] Inspect exact-head CI once completed with available workflow wait mechanisms; record limitations and stop unmerged.
