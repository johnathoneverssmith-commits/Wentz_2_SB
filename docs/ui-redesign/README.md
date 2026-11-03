# UI redesign: what is left and how to run it

16 screens are converted and merged (the roster, hub, coaching, five office screens, and the draft, free
agency and trade screens). Everything below is still on the old dark design. Each group below is one
agent's job. Groups 01 to 07 are independent and can run **at the same time**; group 08 runs **last**.

| # | Group | Screens | Risk | Notes |
|---|---|---|---|---|
| 01 | Setup and turn-based stages | League Setup, coaching draft room and summary, training camp and results, Hooded Figure, league developments, checkpoint | medium | League Setup has no team yet; heavy e2e selectors |
| 02 | Game days and results | Game Day, Game Plan, box score, game history, season results, playoff round results, recap | high (spoilers) | read only revealed results |
| 03 | Watch a game | `WatchGame`, `gamecast/*`, key moments, narrated, play-by-play log | medium | broadcast look; audio and tests |
| 04 | Postseason bracket | `PostseasonBracket` | high (spoilers, formats) | draw it as a bracket |
| 05 | Season end and offseason review | end of season, season complete, hot seat, retirements, rookie draft summary, rookie signings | low-medium | `offseason.spec` walks all |
| 06 | Online lobby | `OnlineLobby` (1,393 lines) | high (little test coverage) | small PRs by section |
| 07 | Overlays and chrome | player card, contract negotiation, coach details, drawers and docks, notices, loading and error states | medium (global) | owns `src/design/overlays.css` |
| 08 | Cleanup | dead CSS, one token layer, `GdPage` everywhere, docs | medium | **after all of 01 to 07 merge** |

## Paste-in prompt (one agent per group)

Replace `NN` and `<file>` with the group's number and file name. The files live in the repo at
`docs/ui-redesign/`. Until the PR that adds them has merged, give the agent the full path of a checkout that
has them (the docs worktree on this machine is
`C:\Users\evers\OneDrive\Desktop\Projects\nfl-franchise-sim-docs\docs\ui-redesign\`) in place of the relative path.

```
You are converting part of the Wentz 2 SB franchise UI to the gameday design system. Read, in this order:
1. docs/ui-redesign/00-brief.md
2. docs/ui-redesign/<file>
3. CLAUDE.md at the repo root.
Your job is group NN, exactly as that file describes. Before you edit anything: fetch, list the open and
recent PRs and branches, list other sessions, and make sure no one has claimed your screens; then create
your worktree and branch off origin/master, push the branch, and open a DRAFT PR to claim it. Do the work in
the brief's process, run its verification matrix, and report what you could not verify. Do not edit
src/design/ unless your group file says you own it. Do not merge the PR; the user will.
```

| Group | `<file>` |
|---|---|
| 01 | `01-setup-and-turn-events.md` |
| 02 | `02-game-days.md` |
| 03 | `03-gamecast.md` |
| 04 | `04-postseason-bracket.md` |
| 05 | `05-season-end.md` |
| 06 | `06-online-lobby.md` |
| 07 | `07-overlays-and-chrome.md` |
| 08 | `08-cleanup.md` |

## Order and merging

- Run 01 to 07 in parallel. They touch different screens and different new CSS files, so they should merge in
  any order. The only shared-file editor is 07 (overlays); if two PRs conflict, the later one rebases.
- After each PR merges, the next agent to open a PR rebases on master first.
- Run 08 only when 01 to 07 are all merged and master's CI is green.
- The in-app preview and e2e browser suite are advisory in CI. Read their failures; do not assume a
  cancelled run is a failure (a 15-minute cap has cancelled it before, with the required `test` job green).
