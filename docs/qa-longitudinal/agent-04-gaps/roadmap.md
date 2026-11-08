# Proposed roadmap for completing the unfinished systems (proposal only)

| Order | Work | TAFIs | Size | Why first |
|---|---|---|---|---|
| 0 | Warn properly when a save fails: name the backup button, state what is unsaved, keep the warning across reload, `beforeunload` prompt | 008 | S | Cheapest way to stop silent loss today |
| 1 | Persistence: IndexedDB (+ gzip), migrate old saves, budget test in CI | 008 | M | The only known data-loss path; **prerequisite of Issue #74** |
| 2 | Playoff progress: apply decided results instead of replaying rounds; reject unmatched games; per-round bracket/game assertion | 011 | M | Makes history, awards and box scores trustworthy |
| 3 | Simulator provenance: `GameResult.source`, badge, one retry before the 30 s breaker | 004 | S–M | Makes any fallback visible, with or without #74 |
| 4 | Fix or retire the Mock sim (legal scores, reconciled lines, playoff games) | 001, 002, 005 | S–M | Needed unless #74 deletes the Mock path |
| 5 | Issue #74 (needs its own approval) | 001, 002, 005 (+ plans in standalone) | L | Only after 0–3 |
| 6 | Dialogs: one `ConfirmDialog`, convert ~20 sites, guard test | 006 | M | Consistency + automatable UI |
| 7 | Label/route polish: deadline-week text, out-of-stage notice, round validation | 007, 009 | XS | Quick wins |
| 8 | Engine accounting: pass-yards difference, non-finite shifts | 003, 010 | S | Agent 2 |

## Testing still owed (not done in this pass, by environment or time)
- Live: inactive/disconnected GM, commissioner departure and transfer, vacate seat, turn-clock takeover, server restart reconnect (`online/dev/multiplayer-restart-check.mjs` exists), a GM *ahead* of another for spoiler redaction, NFL-format online playoffs.
- UI paths: free-agency bidding, trade accept/counter, Hooded Figure payment, manual extensions/restructures, depth-chart and game-plan editing, `/history` and records screens, mobile touch flows beyond the 390 px render crawl.
- Browsers: Firefox and Safari storage limits (GAP-008) and rendering.
- The save-restore path with an over-limit backup.
