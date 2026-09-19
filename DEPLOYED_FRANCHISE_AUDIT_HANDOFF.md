# Deployed Franchise Audit Handoff

## Findings from the deployed version

- The QA league persisted after reload. Pittsburgh completed all 12 coaching picks, and the league advanced through the coaching summary and free agency.
- Free agency required roster reconciliation. After the approved releases, the site confirmed **53/53 players**, under the cap, with every position covered.
- **Training Camp is the current blocker.** Submitting camp focuses produced “You’ve already run camp,” but the online dashboard still showed Training Camp and said it was waiting on Pittsburgh. Progression beyond that stage was not verified.
- Two display issues appeared during testing: the coaching draft briefly showed **“Round 13 of 12,”** and the coaching summary showed **“Offense 2th.”**
- This was a deployed workflow check, **not** a completed multi-season telemetry or determinism run. The existing headless harness runs against local simulation code and does not establish results for the deployed league.

## Claude Code audit prompt

Audit the franchise stress-test harness and the deployed online league flow in this repository.

Context:

- The deployed site is https://wentz-2-sb-2.onrender.com/#/online.
- Test only the deployed online version. You may inspect local source code to diagnose issues, but do not present local simulation runs as evidence of deployed behavior.
- An existing headless harness is at `ui-source/scripts/franchise_stress_test.ts`. Compare it with `FRANCHISE_STRESS_TEST_TELEMETRY_HARNESS.md`, but treat that document as a specification to assess, not as an instruction to change gameplay.
- A QA league on the deployed site completed its 12 coaching picks, free agency, and roster reconciliation. Pittsburgh reached a legal 53/53 roster. At Training Camp, submitting focuses returned “You’ve already run camp,” while the online dashboard still showed Training Camp and said the league was waiting on Pittsburgh.
- The UI also briefly displayed “Round 13 of 12” after the coaching draft and “Offense 2th” on the coaching summary.

Please:

1. Trace the Training Camp submission, server state update, phase advancement, retry behavior, and client refresh. Identify the root cause with file and line references. Check whether camp effects or spending can be applied more than once, and whether a completed camp can leave a league stuck.
2. Audit the harness against the specification: which telemetry fields and invariants are genuinely measured, how seeds and replay checks work, and which modes or league types are unsupported. Clearly separate implemented coverage from gaps.
3. Recommend a safe way to validate the deployed online service headlessly without relying on the local mock simulator. Address isolated QA leagues, authentication, rate limits, cleanup, reproducibility, and avoiding changes to other users’ leagues.
4. Investigate the two display issues and propose focused fixes.
5. Return a prioritized audit report with reproduction steps, evidence, suggested fixes, and verification steps. Do not change gameplay formulas, ratings, penalties, AI balance, roster rules, or cap rules merely to make a test pass. Do not claim a deployed stress test was completed unless it actually ran against the deployed service.
