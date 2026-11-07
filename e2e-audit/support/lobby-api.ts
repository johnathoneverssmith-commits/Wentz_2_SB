/**
 * Scripted answers for the online lobby (`/online`), one named scenario at a time. The lobby talks to /auth/*,
 * /leagues, /inbox and /invites/*; each scenario sets what those say, including the failures a player can meet
 * (slow server, wrong password, server down, an HTML error page). No server exists: this is a route handler.
 */
import type { Page } from "@playwright/test";

export type LobbyScenario =
  | "loading"
  | "signed-out"
  | "sign-in-refused"
  | "server-down"
  | "html-error-page"
  | "account-empty"
  | "account-member"
  | "account-commissioner"
  | "account-many-long";

interface LeagueRow {
  id: string;
  name: string;
  teamCode: string | null;
  stage: string;
  season: number;
  isCommissioner: boolean;
  inviteCode: string | null;
}

const row = (o: Partial<LeagueRow> & { id: string; name: string }): LeagueRow => ({ teamCode: "BAL", stage: "regularSeason", season: 2026, isCommissioner: false, inviteCode: null, ...o });

const LEAGUES: Record<string, LeagueRow[]> = {
  "account-empty": [],
  "account-member": [row({ id: "l1", name: "Sunday Night Crew" })],
  "account-commissioner": [row({ id: "l1", name: "Sunday Night Crew", isCommissioner: true, inviteCode: "SNC4K9" }), row({ id: "l2", name: "Playoff Pushers", teamCode: null, stage: "setup" })],
  "account-many-long": Array.from({ length: 9 }, (_, i) =>
    row({
      id: `l${i}`,
      name: i % 3 === 0 ? "The Extraordinarily Long Named League of Gentlemen and Gentlewomen Who Take Fantasy Football Entirely Too Seriously" : `League number ${i + 1}`,
      teamCode: ["BAL", "PIT", "CIN", "CHI", "LV", "GB", "MIA", "LAC", "JAX"][i] ?? "BAL",
      stage: ["regularSeason", "fantasyDraft", "coachingDraft", "playoffs", "offseasonFreeAgency"][i % 5]!,
      isCommissioner: i % 2 === 0,
      inviteCode: i % 2 === 0 ? `INV${i}XYZ` : null,
    }),
  ),
};

export async function lobbyScenario(page: Page, origin: string, scenario: LobbyScenario): Promise<{ paths: string[] }> {
  const paths: string[] = [];
  const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
  const signedIn = scenario.startsWith("account-");
  await page.route("http://127.0.0.1:9/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    paths.push(`${request.method()} ${path}`);
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (scenario === "server-down") return route.abort("connectionrefused");
    if (scenario === "html-error-page") return route.fulfill({ status: 502, headers: { ...headers, "content-type": "text/html" }, body: "<html><body>Bad gateway</body></html>" });
    if (scenario === "loading") {
      await new Promise((r) => setTimeout(r, 8_000));
      return route.fulfill({ headers, json: { user: null } });
    }
    if (path === "/auth/me") return route.fulfill({ headers, json: { user: signedIn ? { id: "u1", name: "Jordan Reyes" } : null } });
    if (path === "/auth/login" || path === "/auth/register") {
      return scenario === "sign-in-refused" ? route.fulfill({ status: 401, headers, json: { error: "That name and password don't match." } }) : route.fulfill({ headers, json: { user: { id: "u1", name: "Jordan Reyes" } } });
    }
    if (path === "/leagues") return route.fulfill({ headers, json: { leagues: LEAGUES[scenario] ?? [] } });
    if (path === "/inbox") return route.fulfill({ headers, json: { leagues: [] } });
    if (path.startsWith("/invites/")) return route.fulfill({ status: 404, headers, json: { error: "No league has that invite code." } });
    return route.fulfill({ status: 404, headers, json: { error: `Unscripted lobby endpoint: ${path}` } });
  });
  return { paths };
}
