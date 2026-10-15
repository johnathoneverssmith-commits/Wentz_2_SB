# Agent instructions

Read CLAUDE.md for project conventions and docs/agent-loop.md for loop policy.
Operate only on exact user-approved requirements. The product backlog starts
empty and the loop disabled; existing roadmap prose is not execution authority.
Never merge, force-push master, deploy, expose credentials or expand scope.

## Review guidelines

Check approval provenance and exact plan/base/head digests independently.
Reject changes bypassing human scope approval, stale reviews, current-head CI,
durable retries, pause, deployment authorization or credential isolation.
Review actual changed paths and acceptance tests; do not trust model summaries.
Escalate conflicting findings and new requirements to a human.
