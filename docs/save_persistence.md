# Save persistence (GAP-008)

**Problem.** A real-engine solo franchise serialises to 4.6–6.6 M characters. The old save was one
JSON string in `localStorage` (5,242,875 characters per origin in Chromium), so from about season 2,
week 16 every write threw `QuotaExceededError`, the dynasty silently stopped saving, and a reload
rolled back to week 16. Evidence: PR #99, `docs/qa-longitudinal/agent-04-gaps/save-integrity-report.md`.

**Fix.** `ui-source/src/state/durableSave.ts`, wired in `store.ts` as the `persist` storage.

| Concern | Behaviour |
|---|---|
| Where | IndexedDB database `nfl-sim-ui-saves`, store `saves`. Keys `<slot>`, `<slot>#prev`, `<slot>#damaged`. Slots are the existing solo and online keys. |
| Atomic write | One readwrite transaction (`durability: strict`) copies the current record to `#prev` and puts the new one. An aborted/failed transaction changes nothing. |
| Integrity | Each record carries the JSON length and an FNV-1a checksum; a record that fails either is treated as damaged. |
| Read | Newest record; if damaged, `#prev` (the player is told, the damaged copy is kept as `#damaged`, which no autosave touches); if both are damaged the load fails loudly (existing "couldn't be read" banner) and the raw record is kept. |
| Sanity gate | A state without `teams` / `players` / `gms` is never written, so a fresh or half-built store cannot replace a save. |
| Hydration | Reading is asynchronous, so the app renders nothing until the save has been read, and writes made before then are dropped (they would be the fresh initial league). |
| Write timing | Leading-edge, no debounce: a write starts in the same call as the change; changes that arrive while one is in flight collapse into the next. `pagehide` / hidden-tab issue a best-effort plain `put`. |
| Compression | IndexedDB records are plain (measured: a plain put is faster than gzip and starts synchronously; quota is not a constraint). The **localStorage fallback** is gzip + base64 (`gz1:` prefix) — 6.5 M characters of league fit in ~0.9 M. Both forms are read anywhere. |
| Migration | If IndexedDB has no record for a slot but localStorage has the old JSON (plain or `gz1:`), it is parsed, written to IndexedDB, **read back and compared**, and only then removed from localStorage. If any step fails the old copy stays and still loads. An unreadable legacy value is copied to `#damaged` and reported. |
| No IndexedDB | If it cannot open (some private windows / locked-down profiles) the compressed localStorage backend is used, with the old eviction of the corrupted-save copy and the online mirror. |
| Failure UX | The "isn't being saved" banner is an alert that names when the last save landed and carries **Download backup / Restore from backup**; `beforeunload` asks before leaving while failing; a tiny `nfl-sim-ui.save-status` localStorage record survives reload so the next load says "some progress from your last session wasn't saved" with the last good save's time/season/week. |
| Restore | `state/saveBackup.ts`. A restore is only reported as saved once the restored league reached storage (`flushSave()`); otherwise the note says it did not. Backups over 5 MiB restore fine. |

Nothing about *what* is stored changed (same `partialize`, same compaction, same archive rules), so
gameplay, ratings, simulation output and economics are untouched. The one deliberate extra copy is
`#prev` (a second full save, ~0.5 MB–6 MB of IndexedDB), which is what makes an interrupted or
damaged write recoverable.

## Verification

* `src/state/durableSave.test.ts` — records, atomicity, fault injection (put failure, abort before
  commit, quota), damaged-record fallback, migration (plain, gz, near-quota, failing IDB, unreadable),
  localStorage fallback, hydration gate, status/prior-failure, 8 M-character round trip.
* `src/state/saveDurability.test.ts` — the real store module over a browser-shaped `window`: new
  dynasty, pre-fix save migration + continue, >5 MiB league, storage failure + reload + recovery,
  oversized backup restore while storage fails, non-backup file, damaged newest save.
* `src/state/saveSoak.test.ts` (opt-in, `SAVE_SOAK=1`, needs the adapter) — real-engine multi-season
  run; every stage asserts stored == live, every season boundary reloads and keeps playing.
* `ui-source/scripts/save_browser_regression.cjs` — real Chromium, real IndexedDB (opt-in).

Results are in the PR description.

## What "saved" means in the UI

Nothing in the UI says "saved" until the write has committed. The "isn't being saved" banner clears only
when a write lands; `flushSave()` (used by Restore, and by browser tests through `window.__nflSimFlushSave`)
resolves only after every pending and in-flight write has finished, and returns `false` if the last one
failed; Restore's note says "…and saved it" only on `true`, otherwise "could not be saved to this browser".
Pinned by `saveDurability.test.ts` ("never reports a change as saved before its write has completed",
"reports unsaved … when the write fails").

## Browser tests (`e2e/`)

Fixtures are still built headless and stored in the old single-string localStorage form, then seeded into
the browser as localStorage. The app migrates them into **real IndexedDB** on load, so every browser test
runs the migration and from then on reads/writes only IndexedDB; specs read the save through
`e2e/support/idb.ts` (which asks the page to finish pending writes first) and never bypass IndexedDB.
`e2e/fixtures/build.ts` takes its string from `leagueSnapshotJson()` in `store.ts` because under Node the
store has no `window` at import and therefore no persistence (it previously relied on a lazily-resolved
localStorage stand-in).

## Changes lost to a close or reload mid-write are detected, not silent

Each change that will be saved writes a few bytes synchronously to localStorage (`nfl-sim-ui.save-seq`,
a per-slot counter) and each stored record carries the counter it holds. If a load finds the counter ahead
of the record, the last action(s) never reached IndexedDB, and the app says "Your last action wasn't saved"
instead of presenting the older save as current. (Records migrated from localStorage carry no counter until
their first write, so that first window is not detected.)

## Known limits (not fixed here)

* **Immediate tab close.** A change made and the tab closed within roughly the write time (measured: under 60 ms
  for a 1.7 M-character league; a write starts in the same call as the change) can be lost: browsers
  abort IndexedDB transactions on unload (measured; synthetic `pagehide` writes did not survive a
  real navigation). Previously a synchronous `localStorage.setItem` closed that gap for small saves.
* Firefox and WebKit were not available to test; Safari's eviction of script-writable storage after
  7 days without interaction applies to IndexedDB too (as it did to localStorage).
* Two tabs of the same dynasty still last-writer-wins (as before).
* Online leagues still keep a 30 s-deferred local mirror; unchanged.
* Archive retention, `gameArchive` size and per-game traces were deliberately not trimmed — that is
  a gameplay/history decision, and the size is no longer a limit. The 10-season sizes are in the PR.

## Measured results (real engine, seed 4001, 10 seasons)

`SAVE_SOAK=1 SOAK_SEASONS=10` (`saveSoak.test.ts`): 371 stage writes, **28 reloads** (preseason, end of
season, offseason entry in every season) with play continuing on the reloaded store. At every write the
stored record equalled the live state exactly; no write failed; nothing was written to localStorage.
173 of the 371 states were over the 5,242,875-character localStorage limit (the old build would have
stopped saving at all of them).

Peak JSON characters per season: 2026 2.29 M · 2027 4.56 M · 2028 5.90 M · 2029 6.12 M · 2030 5.37 M ·
2031 6.45 M · 2032 6.53 M · 2033 6.54 M · 2034 5.62 M · 2035 6.58 M · 2036 4.28 M — identical to the
pre-fix measurements in PR #99, i.e. the saved content did not change, only where it lives.
