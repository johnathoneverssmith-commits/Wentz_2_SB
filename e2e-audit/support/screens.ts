/**
 * The screen inventory the captures run over. Each entry is a route in `ui-source/src/App.tsx` reached with a league
 * the game itself played into a stage (e2e/fixtures/build.ts). A route that the stage machine redirects away from is
 * recorded as "redirected" in the manifest, never counted as a pass: coverage is what the final URL and h1 say it was.
 *
 * `group` is the brief's inventory heading, so the coverage matrix reads straight off this file.
 */
import type { Page } from "@playwright/test";

export type Group =
  | "command-center"
  | "roster-dossier"
  | "coaching-staff"
  | "drafts"
  | "free-agency-trading"
  | "schedule-standings"
  | "gameplan-gameday-results"
  | "playoffs"
  | "season-end-offseason"
  | "online"
  | "setup";

export interface Screen {
  id: string;
  group: Group;
  /** Fixture name from e2e/fixtures/build.ts, or null for an empty browser (no league yet). */
  fixture: string | null;
  /** Hash route. */
  route: string;
  /** What the capture should find; a mismatch is recorded as "redirected", not failed. */
  expectPath?: RegExp;
  /** The state this capture shows, in words, for the matrix. */
  state: string;
  /** Opens an overlay / modal / drawer before the capture. Absent: the page as loaded. */
  open?: (page: Page) => Promise<void>;
  /** The palette sweep (every team) runs only for these; the rest run for the primary team. */
  palette?: boolean;
}

export const SCREENS: readonly Screen[] = [
  // ---- setup
  { id: "setup", group: "setup", fixture: null, route: "/setup", state: "no league yet; team picker, neutral skyline", palette: true },
  // ---- drafts
  { id: "fantasy-draft", group: "drafts", fixture: "fantasy-draft", route: "/", state: "fantasy draft, first pick on the clock", palette: true },
  { id: "coaching-draft", group: "drafts", fixture: "coaching-draft", route: "/", state: "coaching draft, first arrival", palette: true },
  { id: "coaching-draft-hub", group: "coaching-staff", fixture: "coaching-draft", route: "/coaching", state: "coaching staff hub during the coaching draft" },
  { id: "training-camp", group: "coaching-staff", fixture: "training-camp", route: "/", state: "training camp, focus choices", palette: true },
  // ---- command centre and office
  { id: "hub-preseason", group: "command-center", fixture: "preseason", route: "/hub", state: "weekly team hub, preseason" },
  { id: "hub-week-1", group: "command-center", fixture: "season-week-1", route: "/hub", state: "weekly team hub, opening week", palette: true },
  { id: "hub-week-9", group: "command-center", fixture: "season-week-9", route: "/hub", state: "weekly team hub, last week before the deadline", palette: true },
  { id: "hub-week-17", group: "command-center", fixture: "season-week-17", route: "/hub", state: "weekly team hub, two weeks from the playoffs" },
  { id: "roster", group: "roster-dossier", fixture: "season-week-9", route: "/roster", state: "roster, cap and depth chart, mid-season" },
  { id: "league-rosters", group: "roster-dossier", fixture: "season-week-9", route: "/league-rosters", state: "other teams' rosters" },
  { id: "coaching-staff", group: "coaching-staff", fixture: "season-week-9", route: "/coaching", state: "coaching staff hub, mid-season" },
  { id: "hot-seat", group: "coaching-staff", fixture: "season-week-9", route: "/hot-seat", state: "job security" },
  { id: "dossier", group: "roster-dossier", fixture: "fantasy-draft", route: "/", state: "scouting dossier modal opened from the draft board",
    open: async (page) => {
      await page.getByRole("dialog").filter({ hasText: "on the clock" }).click().catch(() => undefined);
      await page.locator(".draft-avail tbody tr").first().locator("[role=button]").first().click();
      await page.getByRole("dialog").last().waitFor();
    } },
  // ---- free agency and trading
  { id: "free-agency-board", group: "free-agency-trading", fixture: "midseason-fa", route: "/free-agency-board", state: "mid-season market, my turn" },
  { id: "free-agency-standing", group: "free-agency-trading", fixture: "season-week-9", route: "/free-agency", state: "standing market during a played block" },
  { id: "trade", group: "free-agency-trading", fixture: "season-week-9", route: "/trade", state: "trade proposal builder" },
  { id: "trade-deadline", group: "free-agency-trading", fixture: "trade-deadline", route: "/trade-deadline", state: "trade deadline room" },
  { id: "free-agency-summary", group: "free-agency-trading", fixture: "midseason-fa", route: "/free-agency-summary", state: "free agency summary route during the market (expected to redirect)" },
  // ---- schedule, standings, statistics
  { id: "schedule", group: "schedule-standings", fixture: "season-week-9", route: "/schedule", state: "full schedule and standings, mid-season", palette: true },
  { id: "league-stats", group: "schedule-standings", fixture: "season-week-9", route: "/league-stats", state: "league stats and rankings" },
  { id: "player-stats", group: "schedule-standings", fixture: "season-week-9", route: "/player-stats", state: "player statistics, dense table" },
  { id: "history", group: "schedule-standings", fixture: "end-of-season", route: "/history", state: "league history after a finished season" },
  // ---- game plan, game day, results
  { id: "game-plan", group: "gameplan-gameday-results", fixture: "season-week-9", route: "/game-plan", state: "game plan" },
  { id: "game-day-preseason", group: "gameplan-gameday-results", fixture: "preseason", route: "/game-day", state: "game day, preseason week 1, unplayed" },
  { id: "game-day-week-9", group: "gameplan-gameday-results", fixture: "season-week-9", route: "/game-day", state: "game day, regular season, unplayed" },
  { id: "games", group: "gameplan-gameday-results", fixture: "season-week-17", route: "/games", state: "game history" },
  // ---- postseason
  { id: "bracket", group: "playoffs", fixture: "playoffs-wild-card", route: "/bracket", state: "postseason bracket, seeded, nothing played", palette: true },
  { id: "game-day-playoffs", group: "playoffs", fixture: "playoffs-wild-card", route: "/game-day", state: "game day, wild card round" },
  // ---- season end and offseason
  { id: "end-of-season", group: "season-end-offseason", fixture: "end-of-season", route: "/", state: "season over: champion, awards", palette: true },
  { id: "season-complete", group: "season-end-offseason", fixture: "end-of-season", route: "/season-complete", state: "season complete route" },
  { id: "offseason-fa", group: "season-end-offseason", fixture: "offseason-fa-skip-carried", route: "/", state: "offseason, door of the market" },
  // ---- online (needs the controlled transport; see specs/online-states.spec.ts)
  { id: "online-lobby", group: "online", fixture: null, route: "/online", state: "online lobby (state varies by scenario, see online-states.spec.ts)" },
];

export const screenById = (id: string): Screen => {
  const s = SCREENS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown screen ${id}`);
  return s;
};

/** Every fixture a given team needs for the screens it will be captured on. */
export function fixturesFor(team: string, primary: string): string[] {
  const names = new Set<string>();
  for (const s of SCREENS) {
    if (!s.fixture) continue;
    if (team === primary || s.palette) names.add(s.fixture);
  }
  return [...names];
}

/** Fixtures the condition and online specs read regardless of which screens a run is narrowed to. */
export const SPEC_FIXTURES: readonly string[] = ["season-week-9", "fantasy-draft", "coaching-draft", "trade-deadline", "midseason-fa"];
