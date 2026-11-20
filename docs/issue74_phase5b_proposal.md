# Issue #74, Phase 5b proposal: making the browser engine the default

Status: **proposal, not implemented.** Nothing here ships until the owner approves it; the default stays off (Phase 5a).

## 1. Engine versions in saves

**Problem.** A dynasty's games are seeded. Replaying a game (the viewer's play-by-play is rebuilt from seed + saved lineup) or simulating a later week must use an engine that behaves like the one that played the earlier weeks. Today nothing in a save says which engine or pool that was.

**Policy.**
- Record, once, at dynasty creation and whenever the player accepts an upgrade (below): `simEngineVersion` (the manifest's `engineVersion`, a hash of the worker + artifacts) and `poolVersion` (the reference-pool hash). Additive optional fields on `LeagueState`; no migration needed, absent = "unknown, legacy".
- Saves without the fields (every dynasty today) are treated as "current engine, as before": they keep working exactly as now, and get the fields stamped the first time they are played on the browser engine.
- Engine releases classify themselves: a **compatible** build has identical outputs for every saved seed (parity suite + goldens unchanged); an **incompatible** build changes outputs (any balance/rating/schedule change). The manifest carries `compat: <integer>`; it is bumped on incompatible builds only.

**After an engine upgrade (what a saved dynasty does).**
- Same `compat`: silent. The new files are used; nothing the player has seen can change.
- New `compat`: the dynasty **keeps the engine it was started on** where that engine can still be had (the previous worker/artifacts stay served, content-hashed, for the last N=2 incompatible versions and stay in the browser cache). The player sees one non-blocking line: "A newer game engine is available. Your dynasty keeps playing on the one it started on until you choose to move it." with an explicit "Move to the new engine" action at a season boundary (rollover), never mid-season. Moving re-stamps the fields; past results are stored results, never re-simulated, and only viewer replays of old games would differ, so the action says that.
- Old engine no longer served (older than N versions): the dynasty is moved forward at the next rollover with a notice; replays of games from before the move show the box score and "play-by-play isn't available for this game" instead of a different game. This is the one place a replay is withheld rather than risk showing a game that did not happen.
- Never silently: no incompatible engine ever replays an old seed without the player having been told.
- Online leagues are out of scope: the league server runs the engine, and its version is the server's deploy.

Cost: two optional save fields, a `compat` field in the manifest, retaining N old builds on the host, one banner. No change to the golden contract.

## 2. Supported browsers

**Policy.** Default-on only where determinism has been tested.
- **Supported (default on):** Chromium-based browsers (Chrome, Edge, Brave, Android Chrome) at the version range CI runs: verified byte-identical with Node on every route.
- **Opt-in until verified:** Firefox and Safari/iOS. The model evaluators use `Math.exp/log/pow/tanh`, whose last bits the language leaves to the engine; SpiderMonkey and JavaScriptCore are untested. They keep the adapter/Mock path unless the player opts in with the switch. Making them default requires running the parity spec on Firefox and WebKit (needs Playwright browser downloads allowed in the sandbox/CI) and a pass.
- A browser lacking Workers, Cache Storage, `crypto.subtle` or module workers, or one that fails the SHA-256 check, is "unsupported": it falls to the existing path with the existing message.
- A start-up self-test (optional, recommended): the worker evaluates one fixed game on start and compares a hash with the manifest's expected value; mismatch = unsupported for this browser. This turns "unverified" into "checked on the player's own device" and lets Firefox/Safari be default-on safely, at the cost of ~1 s once per engine version.

## 3. Existing Mock dynasties

**Policy.** They stay Mock. The engine lock (a dynasty's simulator is fixed at creation) was chosen so results never change underneath a save; flipping the default must not reopen that. 
- No auto-migration, ever.
- The Mock banner stays, reworded: "This dynasty uses the quick simulator. New dynasties use the full game engine." with a link to How It Works.
- Optional, later, and separately approved: "Start a new dynasty with this roster?" does not exist; there is no honest conversion because Mock results cannot become engine results.

## 4. User-facing copy

Change in the same PR as the flip (CLAUDE.md: How It Works stays true):
- `howItWorks.ts`: the game simulation entry says the engine runs in your browser (downloaded once, kept for next time, works offline after that), that games are seeded and replayable, and what an engine upgrade does (section 1).
- AppShell Mock banner: reworded for Mock dynasties only (above); no banner on engine dynasties.
- Remove the "no play-by-play" fallback copy in `GameDay.tsx`, `WatchGame.tsx` and `PlayByPlayLog` for engine dynasties; keep it for Mock dynasties and for the withheld-replay case in section 1.
- Remove the game-plan "preview needs the engine" disclosure (PR #69) for engine dynasties.
- First-use download: a one-time "Getting the game engine (N MB)…" progress line (already built); failure text is the existing actionable message with Retry (5a).
- Adapter text ("Start the engine (npm run server)") is shown only to developers, behind the adapter path.

## 5. Order of work if approved
1. Manifest `compat`, save fields, upgrade banner and tests (additive).
2. Self-test and browser gating.
3. Flip the default for supported browsers, copy changes, `howItWorks.ts`, e2e suite updated for default-engine (specs that assumed Mock/`vite build`-only UIs get `sim-engine/` or the adapter).
4. Phone measurement and Firefox/WebKit parity before widening "supported".

## 6. Decisions requested
(a) Approve the two optional save fields and the manifest `compat` number. (b) N=2 retained incompatible builds. (c) Chromium default-on, Firefox/Safari behind the self-test (or opt-in only). (d) Mock dynasties never migrate. (e) Copy changes as listed.
