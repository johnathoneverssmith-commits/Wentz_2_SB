# Arcade player attributes: the 5C integration interface

Milestone 5B puts 22 players on the field. Every one of them already carries an `abilities` record, and nothing in the engine
assumes two players share a profile. Milestone 5C fills those records from the franchise engine; this is the contract.

## Where the data lives

* `core/personnel.ts` — the roster of persistent players. Each has a stable id (`home-QB`, `away-DE1`), a football position, a
  jersey number and `baseAbilities(position)`, the average profile of that position.
* `core/simulation.ts` — `Abilities`, the 0–99 record every `ArcadePlayer` carries.
* `src/schema/player.ts` — the franchise schema this must map to.

## Position mapping

`FRANCHISE_POSITION` in `core/personnel.ts` maps each arcade position to the franchise `Position`:
QB→QB, RB/FB→RB, WR→WR, TE→TE, LT/RT→OT, LG/RG→OG, C→C, DE→EDGE, DT→DT, MLB→ILB, OLB→OLB, CB→CB, FS/SS→S.
Kicker and punter are not on the field in 5B.

## Attribute mapping (arcade → franchise)

| Arcade ability | Franchise source | Used for in 5B |
|---|---|---|
| `speed` | `speed` | top speed, `4 + speed/20` yards per second |
| `accel` | `acceleration` | how fast a player reaches top speed |
| `strength` | `strength` | how long a block holds, and who wins it |
| `agility` | `agility` | slipping a tackle (a stumble) |
| `awareness` | `awareness` | reserved |
| `block` | `pass_block` / `run_block` (OL, TE, RB), `block` aggregate | block hold time |
| `passRush` | pass-rush ratings (EDGE, DT) | block hold time in the pocket |
| `tackle` | tackle ratings | tackle strength against a runner's agility; run-block hold time |
| `coverage` | man / zone coverage ratings | reserved (5C: coverage reaction and tightness) |
| `hands` | `catching`, `catch_in_traffic` | reserved (5C: contested catches) |
| `throwing` | `throw_power`, `throw_accuracy_*` | reserved (5C: throw distance and accuracy) |

`block`, `strength`, `passRush`, `tackle`, `agility`, `speed` and `accel` already change outcomes, so giving one player a different
number already changes the game (see `holdTicks` and `tackler` in `core/`). `coverage`, `hands`, `throwing` and `awareness` are
declared and persisted but intentionally not yet read.

## How 5C plugs in

1. Replace `baseAbilities(position)` with a lookup of the real player (by the persistent id) that returns an `Abilities`. Nothing
   else in `core/` changes: formations ask `baseAbilities` once when a play is lined up.
2. Names and skin tones come from `browser/render/roster.ts`; replace the table with the franchise roster, keyed by the same id.
3. Saves already validate and store each player's abilities (0–99, all eleven keys), so a franchise-backed game survives a reload.
4. Wire the reserved abilities where the code has an obvious seam: man-coverage lag (`MAN_LAG`), reaction ticks, catch resolution in
   `stepPlay`, and the throw lead in `throwPass`.
