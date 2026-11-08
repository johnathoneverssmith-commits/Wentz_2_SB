# Reproduction scripts

Local only; isolated browser profiles under `/tmp/pw-profile-*` — never your real data. Need: `npm ci` at the root and in `ui-source/`, a Chromium (`CHROMIUM_PATH`, default `/opt/pw-browsers/chromium`).

```bash
npx tsx server/index.ts &                      # real engine adapter :8787  (kill it for the #74 scenario)
npm --prefix ui-source exec vite -- --port 5173 &
cd docs/qa-longitudinal/agent-06-adversarial/scripts
PROFILE=/tmp/pw-profile-a OUT=/tmp/drive-a node drive.mjs 8724 BAL 5 off     # play N seasons through the real UI
PROFILE=/tmp/pw-profile-a RESUME=1 node drive.mjs 8724 BAL 3 off              # resume the same profile (browser restart)
PROFILE=/tmp/pw-profile-a node dump.mjs /tmp/final.json                       # export the saved league
node check-state.mjs /tmp/final.json            # invariants (players, rosters, depth, games, bracket, history, picks)
node check-boxscores.mjs /tmp/final.json        # box-score consistency
node check-cap.mjs /tmp/final.json
node check-transition.mjs before.json after.json
npx tsx check-standings.ts /tmp/final.json      # engine computeStandings vs stored (run from repo root)
node adv-persistence.mjs /tmp/pw-profile-a L1   # tamper newest / both records (works on a COPY)
node adv-gameplay.mjs snapshot.json             # legacy migration, odd URLs, rapid clicks
node adv-playoff-interrupt.mjs snapshot.json 100,600,2500
node adv-newdynasty2.mjs /tmp/pw-profile-a      # ADV-001 (works on a COPY)
node ui-vs-state.mjs /tmp/pw-profile-a          # /bracket, /history, /box pages vs saved state
```
`drive.mjs` writes `$OUT-snap-<season>-<stage>.json` snapshots at season boundaries for `check-*` and `adv-*`.
The driver is a priority-ordered button clicker (it delegates coaching/FA/deadline to "staff" and takes the first row in the rookie draft); it does not make manual trades or bids.
