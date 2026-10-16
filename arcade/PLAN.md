# Arcade movement sandbox

Approved scope: standalone local 5-on-5 movement sandbox. No franchise imports,
networking, storage, additional dependencies, shared CI edits or deployment.

Implementation: execute in this session on `feat/arcade-movement-sandbox`.

1. Write and run failing headless tests for simultaneous controls, equal diagonal
   speed, yard-based boundaries, reproducibility, AI pursuit/formation, pause,
   restart and fixed-step accumulation at different display rates.
2. Implement explicit roster/input/snapshot contracts and a pure 60 Hz core.
   Keep render timing separate; cap long wall-clock gaps rather than fast-forward
   a background tab. Pausing and restarting discard accumulated time.
3. Write browser acceptance tests before the UI. Exercise actual key events,
   simultaneous controls, pause/restart, blur and hidden-page cleanup. Observe
   player coordinates through the same accessible roster display players can open.
4. Implement Canvas field/players and a small React HUD. Clear input on blur,
   visibility loss and pause; require fresh key presses after resuming. Remove
   listeners and the animation callback on unmount. No module-global state.
5. Add isolated Vite/Vitest/Playwright/typecheck/build commands and README. Reuse
   the locked root/UI installations; do not change either dependency manifest.
6. Run all arcade checks and existing repository verification appropriate to the
   diff. Inspect canvas rendering in an actual browser. Run `wentz-verify` and
   report its conservative classification separately from explicit arcade checks.
7. Inspect the final diff, commit, push the new branch normally, create the PR and
   inspect exact-head CI. Stop for independent review; no merge/deploy.

Review focus: sticky keys after blur; double loops on restart; diagonal advantage;
non-finite timing/input; frame-rate drift; accidental franchise storage/network;
keyboard navigation swallowed by gameplay controls; canvas not matching state.

Milestone exclusions: tackles, passes, scoring, player-to-player collision,
possession changes, franchise import and online authority. Player overlap is
permitted in this movement drill. Boundary collisions remain mandatory.

Review ledger: the independent reviewer found arrow-key capture on the roster
summary. A real-browser regression reproduced orange #1 moving from x=72 to
x=73.4 while the summary held focus. Exclude summary/contenteditable targets.
Add hidden-page and full-roster pause checks. Initial browser observation used
collapsed cells; corrected to require visible numeric coordinates. No gameplay
assertion was weakened. Shared verifier reports stale evidence if files change
during a run; regenerate and rerun after the final edits.

Approved scope addition: standard CI's tracked-source coverage guard rejected
arcade/**. The user approved a separate risk-map correction and regression tests.
The arcade check remains a required manual attestation; no command allowlist or
GitHub workflow is changed. Six focused regressions first failed on the missing
mapping; preserve the engine requirements on combined arcade/engine changes.
