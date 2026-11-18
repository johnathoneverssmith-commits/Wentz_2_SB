/**
 * The franchise simulation service, host-independent (issue #74 Phases 3-4):
 * what a week or a playoff round means for a franchise's rosters, depth
 * charts, staffs and plans, how a finished game becomes a box score, and the
 * routes the UI calls. Hosts supply transport and threading: the local adapter
 * (`server/`) brings HTTP and a Node worker pool; the browser worker
 * (`worker-host.ts`) brings messages; the online server uses the box-score
 * mapping.
 */
export * from "./boxscore-map.js";
export * from "./game.js";
export * from "./playoffs.js";
export * from "./routes.js";
export * from "./week.js";
export * from "./worker-host.js";
