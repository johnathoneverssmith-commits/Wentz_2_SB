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

## Known limits (not fixed here)

* A change made and the tab closed within roughly the write time (tens of ms) can be lost: browsers
  abort IndexedDB transactions on unload (measured; synthetic `pagehide` writes did not survive a
  real navigation). Previously a synchronous `localStorage.setItem` closed that gap for small saves.
* Firefox and WebKit were not available to test; Safari's eviction of script-writable storage after
  7 days without interaction applies to IndexedDB too (as it did to localStorage).
* Two tabs of the same dynasty still last-writer-wins (as before).
* Online leagues still keep a 30 s-deferred local mirror; unchanged.
* Archive retention, `gameArchive` size and per-game traces were deliberately not trimmed — that is
  a gameplay/history decision, and the size is no longer a limit. The 10-season sizes are in the PR.
