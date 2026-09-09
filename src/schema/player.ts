/**
 * Player data schema (v0) — single source of truth.
 *
 * The prose spec lives in `docs/player_schema.md`; this file is the
 * machine-enforced version of it. Every downstream system (sim engine,
 * aging, cap, trades, free agency) imports types and validation from here.
 *
 * v0 is deliberately permissive in a few places (see NOTE comments). The
 * roadmap calls for tightening attribute/severity/scheme vocabularies once
 * the sim engine tells us which distinctions actually matter.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enumerations                                                         */
/* ------------------------------------------------------------------ */

export const POSITIONS = [
  "QB",
  "RB",
  "WR",
  "TE",
  "OT",
  "OG",
  "C",
  "EDGE",
  "DT",
  "ILB",
  "OLB",
  "CB",
  "S",
  "K",
  "P",
] as const;

export const PositionSchema = z.enum(POSITIONS);
export type Position = z.infer<typeof PositionSchema>;

export const INJURY_STATUS_VALUES = ["out", "doubtful", "questionable"] as const;
export const InjuryStatusValueSchema = z.enum(INJURY_STATUS_VALUES);
export type InjuryStatusValue = z.infer<typeof InjuryStatusValueSchema>;

/* ------------------------------------------------------------------ */
/* Attributes                                                           */
/* ------------------------------------------------------------------ */

/** Every attribute is a 0–99 integer rating. */
export const RatingSchema = z.number().int().min(0).max(99);

/**
 * General (position-independent) attributes. All optional so a record only
 * carries the ones relevant to its position, matching the sample data.
 */
export const GENERAL_ATTRIBUTE_KEYS = [
  "speed",
  "acceleration",
  "strength",
  "agility",
  "awareness",
  "injury",
  "stamina",
  "toughness",
  "jumping",
] as const;

/**
 * Position-specific attribute keys we currently expect to see. This list is
 * advisory in v0 — the schema still accepts unknown numeric keys via
 * `.catchall()` so new data does not fail validation. `assertKnownAttributes`
 * (below) can be used in tests/tools to surface typos.
 */
export const POSITION_ATTRIBUTE_KEYS: Readonly<Record<Position, readonly string[]>> = {
  QB: [
    "throw_power",
    "throw_accuracy_short",
    "throw_accuracy_mid",
    "throw_accuracy_deep",
    "play_action",
    "break_sack",
    "scrambling",
    "clutch",
  ],
  RB: [
    "carrying",
    "break_tackle",
    "ball_carrier_vision",
    "juke_move",
    "stiff_arm",
    "spin_move",
    "catching",
    "pass_block",
    "yac",
  ],
  WR: [
    "catching",
    "route_running_short",
    "route_running_mid",
    "route_running_deep",
    "release",
    "catch_in_traffic",
    "spectacular_catch",
    "break_tackle",
    "yac",
  ],
  TE: [
    "catching",
    "route_running_short",
    "route_running_mid",
    "route_running_deep",
    "run_block",
    "pass_block",
    "catch_in_traffic",
    "spectacular_catch",
    "break_tackle",
    "yac",
  ],
  OT: ["pass_block", "run_block", "pass_block_power", "pass_block_finesse", "anchor", "line_calls"],
  OG: ["pass_block", "run_block", "pass_block_power", "pass_block_finesse", "anchor", "line_calls"],
  C: [
    "pass_block",
    "run_block",
    "pass_block_power",
    "pass_block_finesse",
    "snap_accuracy",
    "line_calls",
    "anchor",
  ],
  EDGE: [
    "power_moves",
    "finesse_moves",
    "block_shedding",
    "pursuit",
    "tackle",
    "run_defense",
    "hit_power",
    "play_recognition",
  ],
  DT: [
    "power_moves",
    "finesse_moves",
    "block_shedding",
    "pursuit",
    "tackle",
    "run_defense",
    "hit_power",
    "play_recognition",
  ],
  ILB: [
    "tackle",
    "block_shedding",
    "pursuit",
    "play_recognition",
    "zone_coverage",
    "man_coverage",
    "hit_power",
    "blitz",
  ],
  OLB: [
    "tackle",
    "block_shedding",
    "pursuit",
    "play_recognition",
    "zone_coverage",
    "man_coverage",
    "hit_power",
    "blitz",
  ],
  CB: ["man_coverage", "zone_coverage", "press", "play_recognition", "pursuit", "tackle"],
  S: ["zone_coverage", "man_coverage", "tackle", "play_recognition", "pursuit", "hit_power"],
  K: ["kick_power", "kick_accuracy", "clutch"],
  P: ["punt_power", "punt_accuracy", "hang_time", "coffin_corner"],
};

/** All attribute keys the schema knows about, across every position. */
export const KNOWN_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set<string>([
  ...GENERAL_ATTRIBUTE_KEYS,
  ...Object.values(POSITION_ATTRIBUTE_KEYS).flat(),
]);

const OptionalRating = RatingSchema.optional();

/**
 * Attributes object: typed general keys (all optional — a record only carries
 * the ones relevant to its position) + any number of position-specific numeric
 * keys via `.catchall()`. NOTE (v0): unknown keys pass validation; use
 * `unknownAttributeKeys` / `strictAttributes` where you want them flagged.
 */
export const AttributesSchema = z
  .object({
    speed: OptionalRating,
    acceleration: OptionalRating,
    strength: OptionalRating,
    agility: OptionalRating,
    awareness: OptionalRating,
    injury: OptionalRating,
    stamina: OptionalRating,
    toughness: OptionalRating,
    jumping: OptionalRating,
  })
  .catchall(RatingSchema);
export type Attributes = z.infer<typeof AttributesSchema>;

/**
 * Return the attribute keys on a record that this schema version does not
 * recognise for the given position (likely typos or vocabulary we have not
 * added yet). Empty array === all keys known.
 */
export function unknownAttributeKeys(position: Position, attributes: Attributes): string[] {
  const allowed = new Set<string>([
    ...GENERAL_ATTRIBUTE_KEYS,
    ...POSITION_ATTRIBUTE_KEYS[position],
  ]);
  return Object.keys(attributes).filter((k) => !allowed.has(k));
}

/* ------------------------------------------------------------------ */
/* Sub-objects                                                          */
/* ------------------------------------------------------------------ */

/** NOTE (v0): `severity` is a free string until the aging model pins the set. */
export const InjuryHistoryEntrySchema = z.object({
  season: z.number().int(),
  type: z.string(),
  severity: z.string(),
  weeks_out: z.number().int().min(0),
});
export type InjuryHistoryEntry = z.infer<typeof InjuryHistoryEntrySchema>;

export const ContractSchema = z.object({
  team_id: z.string(),
  years_remaining: z.number().int().min(0),
  total_value: z.number().min(0),
  guaranteed: z.number().min(0),
  /** Cap hit per remaining contract year, index 0 === upcoming season. */
  cap_hit_by_year: z.array(z.number().min(0)),
  signing_bonus: z.number().min(0),
});
export type Contract = z.infer<typeof ContractSchema>;

export const InjuryStatusSchema = z.object({
  status: InjuryStatusValueSchema,
  /** [min, max] weeks, or null when unknown / week-to-week. */
  weeks_out_est: z.tuple([z.number().int().min(0), z.number().int().min(0)]).nullable(),
  description: z.string(),
});
export type InjuryStatus = z.infer<typeof InjuryStatusSchema>;

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

export const PlayerSchema = z
  .object({
    // --- core identity ---
    id: z.string().regex(/^p_\d+$/, 'id must look like "p_00042"'),
    name: z.string().min(1),
    position: PositionSchema,
    age: z.number().int().min(18).max(50),
    /** Current real-world team; pool-generation flavor only. */
    nfl_team: z.string(),
    years_pro: z.number().int().min(0),

    // --- overall + attributes ---
    overall: RatingSchema,
    attributes: AttributesSchema,

    // --- scheme fit ---
    scheme_tags: z.array(z.string()),

    // --- aging model inputs ---
    dev_age_threshold: z.number().int(),
    decline_age_threshold: z.number().int(),
    injury_history: z.array(InjuryHistoryEntrySchema),

    // --- contract / cap ---
    contract: ContractSchema.nullable(),
    free_agent: z.boolean(),

    // --- status ---
    injury_status: InjuryStatusSchema.nullable(),
    retired: z.boolean(),
  })
  .strict()
  .superRefine((player, ctx) => {
    if (player.decline_age_threshold < player.dev_age_threshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "decline_age_threshold must be >= dev_age_threshold",
        path: ["decline_age_threshold"],
      });
    }
    if (player.free_agent && player.contract !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a free agent must not have a contract",
        path: ["contract"],
      });
    }
    if (!player.free_agent && player.contract === null && !player.retired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a rostered (non-FA, non-retired) player needs a contract",
        path: ["contract"],
      });
    }
  });

export type Player = z.infer<typeof PlayerSchema>;

export const PlayerPoolSchema = z.array(PlayerSchema);
export type PlayerPool = z.infer<typeof PlayerPoolSchema>;
