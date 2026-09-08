# Design decisions & open questions

Running log. Each entry: **status** (open / decided / deferred), the question,
and — once decided — what and why. Convert relative dates to absolute.

---

## OQ-1 — Full player pool: source vs generate
**Status:** decided (2026-09-07) — **generate from public stats** is the real
answer; a Madden CSV import is a temporary, local-only bootstrap.

Options were: (a) license/source a real ratings dataset, (b) generate
attribute values ourselves from public stats + heuristics, (c) hybrid — real
identities, generated ratings.

**Decision:** (b). Licensing is not realistic for a hobby project, and
wholesale copying a commercial ratings database (Madden) into the repo is the
IP concern the README flags — fine to *use* privately, not to redistribute.

**Interim bootstrap:** `src/data/madden.ts` (`npm run import:madden`) converts
a Madden-style CSV export to `data/players.local.json`, which is **git-ignored**
(`/data/*.csv`, `/data/*.local.json`). This gives Phase 1 a full pool to work
against without committing EA's data. `loadPlayerPool()` prefers the local pool
when it exists, else the committed 8-player sample.

**Still to build:** the generate-from-public-stats model (nflverse /
`nfl-data-py` rosters + play-by-play + snap counts, PFR, combine → 0–99).
Do it once Phase 1 has settled which attributes actually move outcomes, so we
are not rating fields the engine ignores. Overlaps with the rookie-`overall`
generation model (Phase 3).

## OQ-2 — Attribute → `overall` weighting
**Status:** deferred to Phase 7 (polish)

v0 `overall` values in the sample are hand-picked, not computed. Needs a
per-position weighting function, benchmarked against something. Do not treat
any interim formula as final.

## OQ-3 — Scheme-fit modifiers
**Status:** open (needed for Phase 2 core sim)

`scheme_tags` on players + an OC/DC scheme define in-scheme vs out-of-scheme
performance multipliers. Need: the scheme vocabulary, how many tags a scheme
has, and the size of the in/out modifier.

## OQ-4 — Aging curves
**Status:** open (needed for Phase 4 full loop)

`dev_age_threshold` / `decline_age_threshold` are position-curve derived and
currently hand-set. Need the actual per-position curves, the drift magnitude
per year, and how `injury_history` shifts them.

## OQ-5 — Trade value model
**Status:** open (needed for Phase 4 trades, Phase 6 vote safeguard)

A function from (players, picks, cap situation) → comparable value, plus the
human-vote threshold for lopsided deals.

## OQ-6 — Free-agency demand model
**Status:** open (needed for Phase 4 simplified FA, Phase 6 live FA)

What contract a free agent will accept, as a function of overall, age,
position scarcity, and team context.

## OQ-7 — `severity` vocabulary for injuries
**Status:** open (low stakes, easy)

Schema currently accepts any string. Sample uses `"minor"`. Pin the set
(`minor | moderate | major | season_ending`?) once the aging model consumes it.
