# Player data schema (v0)

This defines the shape of every player record in the fantasy-draft pool.
Everything downstream (sim engine, aging, cap, trades, free agency) reads
from this structure, so getting it right now avoids rework later.

## Core identity
- `id` (string) — stable unique id, e.g. `"p_00042"`
- `name` (string)
- `position` (string) — QB, RB, WR, TE, OT, OG, C, EDGE, DT, ILB, OLB, CB, S, K, P
  (linebackers are split into off-ball ILB and OLB; most 3-4 rush OLBs sit under EDGE)
- `age` (int)
- `nfl_team` (string) — current real-world team, used only for pool generation/flavor
- `years_pro` (int)

## Overall + attributes
- `overall` (int, 0-99)
- `attributes` (object) — position-general + position-specific, e.g.:
  - General: `speed`, `acceleration`, `strength`, `agility`, `awareness`, `injury`, `stamina`, `toughness`, `jumping`
  - Position-specific (only the relevant subset populated per position): e.g. QB gets `throw_power`, `throw_accuracy_short/mid/deep`, `play_action`; WR gets `catching`, `route_running_short/mid/deep`, `release`; CB gets `man_coverage`, `zone_coverage`, `press`; etc.

## Scheme fit (drives OC/DC system)
- `scheme_tags` (array of strings) — e.g. `["air_raid", "west_coast"]` for a WR that fits both; used to compute in-scheme vs out-of-scheme performance modifiers

## Aging model inputs
- `dev_age_threshold` (int) — position-curve derived, when upward drift stops being likely
- `decline_age_threshold` (int) — position-curve derived, when downward drift becomes likely
- `injury_history` (array of objects) — `{season, type, severity, weeks_out}` — feeds both retirement odds and the aging-curve shift

## Contract / cap
- `contract` (object or null) — `{team_id, years_remaining, total_value, guaranteed, cap_hit_by_year, signing_bonus}`
- `free_agent` (bool)

## Status
- `injury_status` (object or null) — `{status: "out"|"doubtful"|"questionable", weeks_out_est: [min,max] or null, description}`
- `retired` (bool)

## Notes for later phases
- `overall` for rookies (post year-1) will be generated, not real — needs a
  separate generation model benchmarked against real upcoming draft class
  rankings (Phase 3 concern, not Phase 0).
- Attribute weighting into `overall` and into game-sim output is a balancing
  problem explicitly flagged for later refinement — don't treat v0 weights
  as final.
