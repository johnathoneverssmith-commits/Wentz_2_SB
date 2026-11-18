/**
 * The franchise simulation service, host-independent (issue #74 Phase 3):
 * what a week or a playoff round means for a franchise's rosters, depth
 * charts, staffs and plans, and how a finished game becomes a box score.
 * Hosts supply transport and threading: the local adapter (`server/`) brings
 * HTTP and a Node worker pool; the online server uses the box-score mapping.
 */
export * from "./boxscore-map.js";
export * from "./game.js";
export * from "./playoffs.js";
export * from "./week.js";
