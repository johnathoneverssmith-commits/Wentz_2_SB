# Deployed Franchise Audit Handoff

## Findings from the deployed version

- The QA league persisted after reload. Pittsburgh completed all 12 coaching picks, and the league advanced through the coaching summary and free agency.
- Free agency required roster reconciliation. After the approved releases, the site confirmed **53/53 players**, under the cap, with every position covered.
- **Training Camp now progresses.** The deployed league recognized the completed camp, displayed its saved results, advanced to Depth Chart, and retained that stage after a reload.
- Depth Chart readiness advanced the league into the 2027 preseason. The transition temporarily remained on “Simulating…” and appeared pending after a reload, then completed after the online connection recovered.
- Preseason week 1 and the remaining multiweek preseason simulation both produced results. The watched-week state survived reconnection.
- **The preseason-to-regular-season handoff succeeded after the server recovered.** The Online Leagues page confirmed 2027 Regular Season, the league opened at Week 1, and a Week 1 result completed successfully. After a reload and reconnect, the league retained “Watched through week 1 of 9.”
- Stage transitions still expose a reliability and clarity issue: while the server is unavailable, the client can remain on “Simulating…,” show cached pending controls, or stay at “Looking for the league server…” without distinguishing a delayed successful mutation from a failed request.
- Two display issues appeared during testing: the coaching draft briefly showed **“Round 13 of 12,”** and the coaching summary showed **“Offense 2th.”**
- This was a deployed workflow check, **not** a completed multi-season telemetry or determinism run. The existing headless harness runs against local simulation code and does not establish results for the deployed league.

## Claude Code audit prompt

Audit the franchise stress-test harness and the deployed online league flow in this repository.

Context:

- The deployed site is https://wentz-2-sb-2.onrender.com/#/online.
- Test only the deployed online version. You may inspect local source code to diagnose issues, but do not present local simulation runs as evidence of deployed behavior.
- An existing headless harness is at `ui-source/scripts/franchise_stress_test.ts`. Compare it with `FRANCHISE_STRESS_TEST_TELEMETRY_HARNESS.md`, but treat that document as a specification to assess, not as an instruction to change gameplay.
- A QA league on the deployed site completed its 12 coaching picks, free agency, roster reconciliation, Training Camp, Depth Chart, and all three preseason weeks. Pittsburgh reached a legal 53/53 roster.
- Training Camp now recognizes the completed camp, shows saved results, advances to Depth Chart, and persists after reload.
- Depth Chart readiness eventually advanced to the 2027 preseason, although the UI temporarily stayed on “Simulating…” and briefly returned to a pending cached state while reconnecting.
- Preseason week 1 and the remaining multiweek preseason simulation produced game results and persisted their watched-week progress after reconnection.
- The preseason-to-regular-season mutation completed successfully once the deployed server recovered. The server-side league list confirmed 2027 Regular Season, a Week 1 result completed, and “Watched through week 1 of 9” persisted after reload and reconnect.
- The client still needs clearer and safer recovery behavior when the server is unavailable: it can show cached pending controls or indefinite “Simulating…”/“Looking for the league server…” states even when a mutation later completes successfully.
- The UI also briefly displayed “Round 13 of 12” after the coaching draft and “Offense 2th” on the coaching summary.

Please:

1. Verify the Training Camp fix and retain regression coverage for its submission, saved results, idempotency, phase advancement, retry behavior, and reload persistence.
2. Trace Depth Chart readiness, preseason simulation, and the preseason-to-regular-season transition across the client and deployed server. Explain why transitions can remain on “Simulating…,” revert to cached pending state, or leave the client unable to reconnect even though the server later shows the mutation succeeded. Identify the root cause with file and line references, and confirm whether retrying an ambiguous request can duplicate or skip a phase.
3. Audit the harness against the specification: which telemetry fields and invariants are genuinely measured, how seeds and replay checks work, and which modes or league types are unsupported. Clearly separate implemented coverage from gaps.
4. Recommend a safe way to validate the deployed online service headlessly without relying on the local mock simulator. Address isolated QA leagues, authentication, rate limits, cleanup, reproducibility, reconnect behavior, and avoiding changes to other users’ leagues.
5. Investigate the two display issues and propose focused fixes.
6. Return a prioritized audit report with reproduction steps, evidence, suggested fixes, and verification steps. Do not change gameplay formulas, ratings, penalties, AI balance, roster rules, or cap rules merely to make a test pass. Do not claim a deployed stress test was completed unless it actually ran against the deployed service.
