---
name: wentz-verify
description: Use in the NFL franchise sim repo (nfl-franchise-sim, "Wentz 2 SB") before saying a change is done, fixed, passing or ready, and before committing, pushing or opening a PR. Works out from the real diff (committed, staged, unstaged and untracked) which checks the change needs across the engine, franchise rules, online server, database, UI and CI/deploy config, runs them, and reports what passed, failed, was skipped and was not run. Also use when asked "what should I run?" or "is this verified?".
---

# wentz-verify

This supplies the project-specific **what** and **how**. The general rule (evidence before
claims) is `superpowers:verification-before-completion`: invoke it as well; it is not restated here.

Three small Node scripts in this folder do the parts that must be exact, so none of it depends on
memory or on how a result is phrased:

| Script | Job |
|---|---|
| `select-checks.mjs` | Reads the diff and prints the plan: **REQUIRED** checks, **RECOMMENDED** deeper ones, approvals needed, and limits. Runs nothing. |
| `run-checks.mjs` | Runs plan checks and records the real exit code and output, bound to the plan, the command and the exact files. It runs only the verification commands in `command-policy.mjs` and never passes on this shell's database settings. |
| `report.mjs` | Judges the records against the plan and prints the report and its verdict. Stale results (anything changed since they ran) count as not run. |

## Procedure

1. **Be in the right place.** `git branch --show-current`; if another session owns the shared
   checkout, use your own worktree (see CLAUDE.md). Keep scratch files out of the repo: write
   `plan.json` and `results.json` to your scratch directory.
2. **Plan.** `node .claude/skills/wentz-verify/select-checks.mjs --out <scratch>/plan.json` (it prints the
   readable plan and writes the JSON; do not use a shell `>` redirect, which on Windows PowerShell 5.1
   writes UTF-16). It sees commits since the merge-base, staged,
   unstaged and untracked files; renames and deletions count at both paths.
   - **PROBLEMS** (exit code 3), such as a scratch file staged or committed: fix first.
   - **Unknown source paths** make it ask for everything CI runs. Do that; then add a rule to
     `risk-map.json` (with a test) so the area is classified next time.
   - **Approval needed** items: stop and ask before pushing. See Boundaries.
3. **Run, cheapest first.** Tier 0 and 1 after a logical change, tier 2-3 before pushing a
   risky change (or leave them to CI, which is faster than this laptop):
   `node .claude/skills/wentz-verify/run-checks.mjs --plan <scratch>/plan.json --out <scratch>/results.json --tier-max 1 --level required`
   - **The runner will not run any command that is not a known verification command**, and will not
     pass on `DATABASE_URL`, `TEST_DATABASE_URL` or any Neon/Postgres variable from your shell: a
     check starts with a clean environment. A database check runs only with an explicit test
     database: start one (`npm run online:db`) and add `--test-database local-pglite` (or a URL on
     this machine that is clearly a test database: port 5433 or a name containing `test`, no query
     string). Without it those checks are not run, and the report says so. Never point it at a real
     or hosted database; it will refuse.
   - Run database files one at a time (the plan already says `--no-file-parallelism`).
   - **RECOMMENDED** checks are the deeper ones (12-league statistics, league metrics, stress
     test, transitive related-tests). Run them for engine or balance changes and before asking
     to merge a high-risk change; otherwise name them as not run.
   - Do the **manual** checks for real (diff review, How It Works text, browser look) and attest
     with `--confirm <id,...>` in step 4. Never confirm one you did not do. `--confirm` works only
     for manual checks, and the report marks them *attested*, not observed.
   - If you change a file after a check ran, that result is **stale** and the check shows as not
     run: rerun it. A rerun adds an attempt; the earlier failure stays in the report.
4. **Report.** `node .claude/skills/wentz-verify/report.mjs --plan <scratch>/plan.json --results <scratch>/results.json --confirm <ids>`
   and give its output as it is. Its exit code: 0 verified or locally verified; 1 failed or
   blocked; 4 incomplete.
5. **CI is the authority, and the tool must fetch it.** After a push the user has asked for and an open
   pull request, add `--check-ci`: the script reads GitHub's own record (read-only) of the
   `Test and deploy Render` run for the commit checked out here and accepts it only if it was a
   `pull_request` run for exactly this commit, with a clean working tree, `test` successful and
   `deploy` skipped. Only that can make the verdict **VERIFIED**. A CI result you type in
   (`--ci '{...}'`) is shown as a claim and never believed: it cannot produce VERIFIED, and a claim
   that CI failed counts as a failure. Without `--check-ci` the best is **LOCALLY VERIFIED**.

## Reporting rules

- Report every check in the plan with one status: **PASSED, FAILED, SKIPPED, NOT RUN, PENDING CI,
  CONFIRMED**. Never write "tests pass" without that table.
- One failed check, required or recommended, makes the verdict **FAILED**. Quote the real error and
  the failing test names; do not summarise them away. Rerun a failure **once** to see whether it
  repeats, and report both runs; do not average them or keep only the green one.
- **SKIPPED is not passed.** A database suite that ran without a database returns early and a
  runner counts that as a pass; `report.mjs` marks it SKIPPED unless the output shows the database
  was used. In CI (`CI=true`) such a suite fails instead, which is what you want.
- Counts come from the output (`17 passed`), never from memory. A check you did not run is NOT RUN,
  with the reason and who will run it (you later, or CI).
- Always list **unverified risks**: required checks that did not run, the PGlite limits below,
  anything the selector flagged as conservative.
- End with what needs the user's approval and the next step. Do not claim more than the verdict.

## Local versus CI

Everything this skill runs is **local**. It is not the CI result. CI runs the three suites against a
real PostgreSQL 16 on a clean checkout; that, with `deploy` skipped on a PR, is what counts. A local
PGlite is one session (version 18): it cannot show locks, deadlocks or true concurrency, and
parallel database runs fail for reasons that are not real. Say "concurrency unverified until CI"
for any change touching `db.ts`, the schema, `globalSetup` or the test helpers, and suggest re-running
CI (>= 3 times) for intermittent-risk changes.

## Cost guide

| Tier | What | Typical |
|---|---|---|
| T0 | scope check, typechecks (engine / online / UI) | about 20 s together |
| T1 | tests that import the changed files; the guards for the area | seconds to a minute |
| T2 | transitive `related` run | 1-2.5 min |
| T3 | full suites | 3-6 min each locally; 1.5 min each in CI |
| T4 | deep: 12-league statistics, league metrics, franchise stress | minutes; on request or pre-merge |

Never run T2 and above after every edit.

## Boundaries (do not cross these on your own)

- **Never** push, merge, force-push, dispatch a workflow or deploy. The runner cannot, and neither
  may you from this skill. Pushing a branch or opening a PR happens only when the user asks.
- These need explicit approval each time: simulation formulas, ratings or balance; production code
  behaviour; the schema or migrations; CI or deploy configuration; dependencies. The plan lists them.
- Local checks do not change what branch protection requires: `master` takes PRs whose `test` check
  passes, and a human approves each merge.
- No production data, Neon data or live service is touched by any check here.
- Leave other sessions' branches, worktrees and untracked files alone.

## Keeping it true

`risk-map.json` is the single place that maps paths to checks. A new area of the repo, a renamed
script or a new database suite is a change to that file, with a case in `test/verify-selector.test.ts`;
the tests fail if a tracked source file has no rule or a check names something that no longer exists.
`test/verify-verdict.test.ts` pins the rule that a failure, a skip or a missing run cannot read as a pass.
