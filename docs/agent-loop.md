# Supervised development loop

The loop is **disabled** and its approved backlog is **empty**. The roadmap,
old chats, reviewer suggestions and issue labels do not authorize product work.

## Core and durable state

Run the dependency-free policy and recovery tests with Node >=22:

```sh
node --test test/agent-loop/*.test.mjs
```

`.agent-loop/approved-backlog.json` carries exact task, phase, requirement,
acceptance, dependency, allowed-file and test IDs. Every contract is closed by a
versioned JSON Schema. The controller rejects additional fields, new scope,
stale plan/review digests, unsupported diff types and excess file/line counts.
Only a human approval fetched from GitHub and bound to the exact manifest
revision can authorize selection. Keep approval evidence outside model output.

Claude selects ready approved task IDs, publishes a structured plan, revises
in response to a separate Codex plan review, and implements only the accepted
plan. Code fixes repeat CI and both code-review stages at the new exact head.
Managed Codex PR review does not automatically review plans or invoke Claude.

States: planning → plan_review → implementing → ci_pending → code_review →
fixing or ready_for_human → complete after verified human merge and acceptance.
Blocked/cancelled tasks are not complete. Dependent tasks wait for completion;
independent tasks may proceed while a PR awaits a human. There is one active
worker task. No agent or controller merges PRs or deploys.

The state branch `agent-loop-state` stores `loop.json`: append-only hash-linked
journal, replayable snapshot, controller lease and pending effect outbox. Stable
effect IDs allow publication recovery after crashes. Compare-and-swap writes
reject concurrent changes. Before reclaiming an expired lease, reconcile live
workers. Pause survives restarts; retry counters do not reset on resume. A hash
chain detects accidental edits, not a malicious administrator rewriting history.

## Limits and human escalation

Two plan correction rounds, two code-fix rounds, three infrastructure retries,
30 minutes per worker, two hours per task, and 20 minutes awaiting managed
review. Task diffs are capped at ten files and 300 changed lines. New scope,
reviewer conflicts, stale/unverifiable evidence, CI failure and exhausted limits
block with an auditable reason. Resume must reference the current state sequence.
Resolving a blocked task requires a new human scope/decision record rather than
silently resetting counters. Publish only sanitized escalation summaries.

## Enablement prerequisites

All entries in `.agent-loop/prerequisites.json` start false. Dollar and token
budgets in policy start null. These values alone do not verify external setup:
the operator must supply evidence and test it before activation. Required:

- human approval protection on master; protected state and controller revisions;
- explicit exact-SHA deployment approval and independent Render auto-deploy off;
- isolated workers with no GitHub publisher/deployment credentials and no host
  credential store; provider credentials stay behind a trusted external proxy;
- provider spending controls, approved dollar/token caps and pinned runtimes;
- a dedicated publisher App with limited permissions, verified review identity,
  and a proven GitHub event path for bot-created and updated PRs.

The current existing deployment workflow automatically deploys master pushes.
Do not merge infrastructure without first reviewing the separate deployment-gate
change and external Render settings. Approval to merge is not approval to deploy.

Repository control files, workflows, agent instructions, secrets/private data,
package/config/lock files and deployment scripts are excluded from normal task
diffs. Tests run credential-free. Prompt instructions are not security boundaries;
the publisher revalidates actual Git diffs, not the model's claimed file list.

## Acceptance evidence

Fixtures use the real validator, reducer, journal and controller with fake external
agents/GitHub storage. They cover duplicate events, concurrent controllers, missing
review, conflict, rejected scope, stale SHA, failure exhaustion and publication
recovery. Fixture evidence is not a claim that live Claude/Codex authentication,
review events, production protection or credential isolation has been verified.

A separately authorized documentation-only live test must record manifest approval,
exercise plan correction and code fix, observe managed review and CI on the current
head, inject a failure, pause/resume, prove duplicate-trigger idempotency, and close
the DO NOT MERGE test PR without merging. Test actual human merge/completion in a
separate repository after deployment settings are verified. Assert master unchanged
and zero deployment-hook calls in the no-merge production-repo test.

## References

[Codex structured automation](https://learn.chatgpt.com/docs/non-interactive-mode),
[Codex GitHub review](https://learn.chatgpt.com/docs/third-party/github),
[Claude scripted mode](https://code.claude.com/docs/en/headless), and
[GitHub token/event behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
