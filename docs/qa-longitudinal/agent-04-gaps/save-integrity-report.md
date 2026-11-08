# Save-state and progression integrity (GAP-008 and related)

**Verdict: reproducible loss of player progress, classified Critical / release blocker for any solo build that uses the real engine** (the local adapter today; the browser engine proposed in Issue #74). The standalone Mock path does not reach the limit within 10 seasons.

## 1. Which storage holds the franchise
`ui-source/src/state/store.ts`: zustand `persist` → `window.localStorage`, one JSON string under **`nfl-sim-ui.league`** (version + the whole league minus functions), rewritten on **every** store change for solo. Side keys: `nfl-sim-ui.online-league` (online copy, deferred ≤30 s), `nfl-sim-ui.league.corrupted-backup`. No IndexedDB, no compression, no sharding. `saveCompaction.ts` trims retired players/box scores at rollover only.

## 2. Effective limit (measured, not assumed)
`harness/limit.cjs`, Chromium 153: a single key **and** the origin total top out at **5,242,875 UTF-16 characters** (5 MiB). A write over the limit throws `QuotaExceededError` and **the previous value is left intact** (verified). Firefox and WebKit were **not available** in this environment; their documented ~5 MB localStorage limits are **unverified here**.

## 3. How big the save gets
Persisted-JSON length (characters) of the league at every stage, 10 seasons, seed 4001 (`evidence/save-size-by-stage-10-seasons*.txt`):

| Season | Real-engine path, peak | Mock path, peak |
|---|---|---|
| 2026 (setup) | 2.29 M | 2.29 M |
| 2027 | 4.56 M | 3.09 M |
| 2028 | **5.90 M** | 3.44 M |
| 2029 | **6.12 M** | 3.63 M |
| 2030 | 5.37 M | 3.76 M |
| 2031 | **6.45 M** | 3.84 M |
| 2032 | **6.53 M** | 3.94 M |
| 2033–2036 | 6.56 / 5.61 / 6.63 / 6.61 M | 3.93 / 3.93 / 3.97 / 4.00 M |

Engine path: from 2028 the save exceeds the limit from about the second half of every regular season through the whole offseason (e.g. 2028 `regularSeason` 5.42 M) and falls back to 3–4 M only after the rollover prunes; it **plateaus around 6.5 M** rather than growing without bound. Mock path: slow growth (~+0.05–0.15 M per season), 4.0 M after 10 seasons, **limit not reached in 10 seasons** (not extrapolated further).
What fills it (2028 end of season, engine): `players` 2.07 M (2,400 records, 399 retired still kept), `games` 1.96 M (of which 20 play-by-play traces ≈ 0.9–1.1 M), `gameArchive` 1.07 M (grows to 1.4 M by 2031), `trainingCamp` 0.14 M, `draftClass` 0.11 M. Gzip would shrink these by ≈8× (5.57 M → 0.67 M; base64-wrapped 0.90 M).

## 4. What happens when a write fails (reproduced in a real browser)
Evidence: `evidence/save-failure-repro-chromium153.txt`, `evidence/save-failed-banner.png`, `evidence/save-failure-after-reload.png`, harness `savefail.cjs`, `quota_play.cjs`.

- **Detected: yes.** `store.ts` catches the exception, first deletes the corrupted-save backup, then (solo) the online copy, retries, then sets `saveBroken`; `AppShell` shows **"This dynasty isn't being saved… closing this tab will lose everything since the last successful save."** The banner appeared in every run at the first failing write.
- **Clear to the player: partly.** It does not say how much is unsaved, does not mention **Download backup** (which works and produced a 5.5 MB file during the failure), and it is a passive notice with no blocking confirmation.
- **Window of loss (seeds 4001 and 47547, both reproduced; windows observed in 2028 in both runs, 2029 in seed 4001, 2030 and 2031 in seed 47547):** the first failure came at **week 16 of season 2**; the stored save stayed at that week while the player kept going through **weeks 17–18, the playoffs, the Super Bowl, season-end awards, the hot seat, retirements, the rookie draft, rookie signings, free agency, training camp** until the rollover into the next preseason shrank the save enough to write again (≈ 50–60 UI interactions per window).
- **Reload during the window loses everything since week 16.** Controlled test: from a stored week-16 save (8-6), clicked through weeks 17, 18 and into the playoffs (UI said "2028 playoffs"), stored stage stayed `regularSeason`, week 16, 224 games, **banner on**. After `reload`: the game restored **week 16 (8-6)**; the URL still said `#/bracket`, so the player lands on a "Not seeded yet" bracket for a season that, a minute earlier, had finished; **the warning was gone** (the flag is per page load). Nothing tells the player that progress was lost.
- **Recoverable: yes, the last good save stays intact** (old value survives a failed write) and the downloaded backup restores the in-memory league. But the player is never told the backup is the escape hatch.
- **Side effect on failure:** to make room the code deletes the online copy and the corrupted-save backup (by design; the online copy is a mirror).
- **Not tested:** the Restore-from-backup path with a >5 MB backup (restore writes through the same failing persist), private-window behaviour, quota shared with other keys, a second tab.

### Where did it NOT happen
Standalone solo on the Mock path (no adapter): peak 3.1 M in season 1–2, 4.0 M at season 10. 50 deliberate reloads at stage boundaries in the engine-path run **before** the first failure all returned the same screen.

## Root cause (confirmed)
Whole-league, uncompressed JSON in a 5 MiB store, with engine-path leagues carrying viewer play-by-play (~44 KB per game, ~29 games), a full 2,400-player dictionary and a growing game archive. Not a UI bug: the cause is in the persistence design and the engine-path payload.

## Proposed solutions (nothing implemented)
1. **Move the persist adapter to IndexedDB** (zustand `createJSONStorage` accepts an async store), localStorage kept as a read-fallback and migrated on first load. Quota is hundreds of MB. *Complexity M.* Needs a migration test and a "storage unavailable" path (private windows).
2. **Compress before writing** (`CompressionStream('gzip')` + base64): ≈8× on measured saves, 6.5 M → ≈1.0 M chars even at season 10. *S–M*; may be combined with 1. Must be backwards-compatible with existing uncompressed saves.
3. **Trim what is stored:** do not persist `broadcast` traces older than the current season (≈1 MB), drop `retired` player bodies after rollover (≈0.3 M), cap `gameArchive` further. *S.* Alone it removes the failure for ≈ seasons 2–5 but not forever.
4. **Failure handling, independent of 1–3:** make the banner name the backup button and the amount unsaved; keep it visible across reloads (persist a `lastSaveFailedAt` flag in a tiny separate key); `beforeunload` prompt while broken; offer **auto-download backup**; stop clearing the online copy silently. *S.*
5. **Budget guard in CI:** a test that plays 10 seasons headless (the harness in this folder) and fails if the serialized league exceeds e.g. 4 MB; plus a Playwright test that pre-fills storage to force a failed write and asserts the banner, the backup button and that reload shows a "restored from <time>" notice. *S.*

**Recommended order:** 4 immediately (cheap, no data-model change), 1+2 before Issue #74 ships, 3 as a stop-gap, 5 with whichever lands first.

## Regression tests
- vitest: `persisted league length after N seasons ≤ budget` (engine path, N=10), and `JSON → compress → decompress` round-trips every committed fixture.
- Playwright: fill `localStorage` to within 100 KB of 5,242,875, advance one week, expect banner **and** a Download-backup prompt; reload and expect a "last saved week X" notice.
- Migration: an old uncompressed save loads and is rewritten in the new format.
