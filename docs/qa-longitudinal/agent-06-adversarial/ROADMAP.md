# Prioritised remediation roadmap

Ordered by player impact × cheapness. "Existing" items are already in the master register; they are listed because this run raised their priority.

| # | Item | ID | Sev | Size | Why now | Verify |
|---|---|---|---|---|---|---|
| 1 | Make **adapter loss visible** and refuse to mix engines inside one save (banner + block simulate, or a per-save "engine: real/mock" flag) | existing GAP-004 / #74 | P1 | M | Strongest evidence this run: a 5-season engine dynasty silently continued on Mock with 1-point scores and no stored playoff games | re-run `scripts` adapter-kill scenario; banner present, no games simulated |
| 2 | **Keep an undo copy across "New solo dynasty"** (`#undo` untouched by autosave) and name what is lost in the confirm | ADV-001 | P2 | S | The one data-loss path #101 does not cover | `durableSave` test: pre-reset record readable after reset |
| 3 | Fix Mock's impossible scores and add stored playoff games (or retire Mock for the franchise path) | existing GAP-001/005 | P1/P2 | M | Same root as #1; only matters while Mock can run | `check-state.mjs` on a Mock season → 0 findings |
| 4 | Stop labelling unsigned young free agents as **retirements** (separate flag/label) | ADV-002 | P3 | S | Reads as a bug on the Retirement Review; contradicts How It Works | transition test: no `retired` under minimum retirement age without injury cause |
| 5 | Reconcile **player lines with team totals** (rush yards +12 avg; completions off by 1 in ~8%) | existing GAP-003 | P3 | S–M | Visible on the box score the player reads | `check-boxscores.mjs` → 0 `PL-*` |
| 6 | Add the bracket/standings/cap invariants to the multi-season playthrough test so they run in CI at stage boundaries | (regression) | — | S | #100's guard currently lives in one targeted test | CI red when a bracket winner has no game |
| 7 | Redirect or empty-state for out-of-stage URLs and nonsense params (`/results/REG/1/99`, `/box/<bad>`, `/results/round/ZZ`) | existing GAP-007 | P3 | XS | cheap polish | route crawl |
| 8 | Close the test gaps: manual trades/contracts adversarial pass, online mode, `humansOnly`, two tabs | H-1…H-8 | — | L | Not covered here at all | a second adversarial pass with a driver that makes manual transactions |

## Five highest-priority fixes (for the completion report)
1. Make adapter loss visible / block cross-engine continuation (#74, GAP-004).
2. Preserve an undo copy on "New solo dynasty" (ADV-001).
3. Remove or fix Mock-path score/playoff integrity (GAP-001/005) if Mock stays reachable.
4. Relabel pool pruning as non-retirement (ADV-002).
5. Add bracket/standings/cap invariants to CI multi-season playthrough (#100 guard breadth).
