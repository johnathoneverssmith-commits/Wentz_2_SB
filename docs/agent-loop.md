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

## Worker/controller setup and present limitations

The controller workflow first runs a credential-free eligibility gate. It cannot
run privileged steps with the shipped disabled/empty manifest and missing budgets.
After explicit setup approval, the protected `agent-loop-control` environment
supplies publisher App credentials and a separate broker authentication token.
The controller never runs application code with those credentials.

The worker broker code (`broker-server.mjs`) is intended for a dedicated Linux host
behind HTTPS. It binds localhost only. Its job store deduplicates exact operation
keys across restarts; an interrupted started job requires reconciliation instead
of rerunning silently. Docker containers run unprivileged, with resource limits,
a read-only root, isolated temporary home, read-only git metadata and trusted
runtime modules. Worker output transcripts are discarded. Actual edited text is
captured, checked and committed by the publisher, which independently checks the
GitHub diff/tree before PR creation. Normal tasks support text additions/edits;
deletions, symlinks and binary changes fail closed.

`worker-runtime.example.json` deliberately cannot run until an operator supplies
a verified image digest containing Node, git, Claude Code and Codex; a restricted
Docker network named `loop-proxy-*`; an external provider proxy with server-side
USD/token limits; approved manifest digest/baseline; and private job storage.
The proxy is a required external service, **not implemented here**. Worker calls
use a non-secret dummy credential and can reach only the operator's proxy.
Image availability, proxy isolation, CLI compatibility/authentication and provider
budget enforcement have not been exercised live. These attestations must be
verified on the actual host, not merely changed from false to true.

Run the broker only after provisioning is authorized:

```sh
node scripts/agent-loop/broker-server.mjs /protected/worker-runtime.json
```

Set `.agent-loop/integration.json` to the HTTPS broker origin and merged manifest
PR/review IDs. The observer fetches human review/content/ancestry from GitHub;
it never trusts an approval passed by a webhook or model. Initialize the protected
state branch with an empty journal and `initialState(digest(manifest))`, `outbox: []`
and `lease: null`, through a separately authorized setup operation. Do not initialize
or repair state by overwriting an existing branch. Run `run.mjs status` to inspect
the shipped gates without credentials. Pause/resume are manual workflow operations
bound to the current durable sequence and authenticated human account. Emergency
pause authenticates stop authority separately, stops the broker first and appends
a pause to the existing state's hash-checked journal even if execution approval
has become invalid. Broker pause persists across restarts; only an authenticated
resume of verified execution state clears it.

Managed review observation uses the authenticated bot summary for the exact head,
current-head inline findings and a fresh no-findings reaction. This is an observed
UI convention, not a stable provider JSON contract; unknown formats, missing fresh
reaction or incomplete pages must pause instead of approving. The separate Codex
JSON reviewer supplies the stable handoff and disagreements escalate. The publisher
requests `@codex review` once per updated head using an auditable marker, rather
than assuming push re-review. Re-review after bot-published fixes and all
token-dependent triggers require a live test.

Protected production environment review rules and Render's independent automatic
deploy settings remain external setup. No App/environment/ruleset/Render settings,
broker hosting, proxy installation, credentials, activation or deployment were
performed by implementing this code.

## References

[Codex structured automation](https://learn.chatgpt.com/docs/non-interactive-mode),
[Codex GitHub review](https://learn.chatgpt.com/docs/third-party/github),
[Claude scripted mode](https://code.claude.com/docs/en/headless), and
[GitHub token/event behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
