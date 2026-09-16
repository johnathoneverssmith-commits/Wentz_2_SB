import type { LeagueState } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { REGULAR_SEASON_WEEKS } from "./stageMachine";

/**
 * Around the League, with teeth.
 *
 * One line per human team, chosen from a fixed library rather than generated,
 * so every GM provably reads the same thing, nothing can fail at a checkpoint,
 * and there is no API in the path. The variety comes from the selection being
 * driven by what actually happened: the templates are sorted into situations,
 * the situation is computed from real numbers, and only then does a hash pick
 * which of that situation's lines to use.
 *
 * That ordering is the whole trick. Picking a random line and bending the
 * facts to fit would produce jokes about a blowout after a one-point game.
 * Picking the situation first means the joke is always *about* something —
 * and a GM who got beaten by forty knows we noticed.
 */

export interface RoastContext {
  teamCode: string;
  gmName: string;
  /** Points for and against across the games this roast covers. */
  pointsFor: number;
  pointsAgainst: number;
  wins: number;
  losses: number;
  /** Biggest margin either way, signed: positive is a win. */
  biggestMargin: number;
  /** Best player on the roster, for the "carrying them" lines. */
  bestPlayer: string;
  bestOverall: number;
  /** Weakest starting unit, named. */
  weakestUnit: string;
  onBye: boolean;
  /** Season one has no prior games; the roast comes off the draft instead. */
  fromDraft: boolean;
  /**
   * How last season went, when there was one. A preseason roast has no games
   * to work with — the joke has to come off the year that just ended.
   */
  /**
   * Where this team stands in the playoff race, when the season is running.
   *
   * Absent before week one and after elimination, which is exactly when the
   * race is not the story.
   */
  race?: { inField: boolean; gamesBack: number; eliminated: boolean };
  lastSeason?: {
    wins: number;
    losses: number;
    madePlayoffs: boolean;
    wonSuperBowl: boolean;
    furthestRound: string;
  };
}

type Situation =
  | "blowoutWin"
  | "blowoutLoss"
  | "narrowWin"
  | "narrowLoss"
  | "undefeated"
  | "winless"
  | "bye"
  | "draftReach"
  | "draftStrong"
  | "champion"
  | "lastSeasonGood"
  | "lastSeasonBad"
  | "collapse"
  | "raceLeading"
  | "raceHunting"
  | "raceFading"
  | "mediocre";

/**
 * The library. Roughly a thousand lines once the situations are multiplied
 * out by the substitutions below — each template draws from the context, so
 * the same line about two different teams reads differently.
 *
 * `{team}` `{gm}` `{star}` `{unit}` `{margin}` are filled from the context.
 */
const LIBRARY: Record<Situation, string[]> = {
  blowoutWin: [
    "{team} won by {margin}. At some point running it up stops being a strategy and starts being a personality.",
    "{gm} beat someone by {margin} and somehow still looks unhappy about the third-quarter punt.",
    "{team} put up {margin} points of margin. The tape is not so much film study as a hostage video.",
    "A {margin}-point win for {team}. Somewhere a defensive coordinator is updating his LinkedIn.",
    "{team} by {margin}. The scoreboard operator has asked for hazard pay.",
    "{gm} is winning by {margin} and still describing this as a rebuild. Nobody believes you.",
    "{team} won by {margin}, which is less a football result than a weather event.",
  ],
  blowoutLoss: [
    "{team} lost by {margin}. There is no polite way to write that sentence, so we didn't try.",
    "{gm} was beaten by {margin}. The good news is the season is long. That is also the bad news.",
    "{team} conceded enough to lose by {margin}. The {unit} were last seen asking for directions.",
    "A {margin}-point defeat for {team}. Even {star} looked like he wanted to be substituted into a different franchise.",
    "{team} lost by {margin}. At this point the film session is just a group therapy circle.",
    "{gm} down by {margin}. We checked: yes, they were allowed to tackle.",
    "{team} by minus {margin}. Some teams lose games; this one lost an argument with physics.",
  ],
  narrowWin: [
    "{team} squeaked one out. A win is a win, and this one needed the receipt kept.",
    "{gm} won by a hair. The heart rate monitor in the booth is being examined as evidence.",
    "{team} got there in the end, which is more than the {unit} deserved.",
    "{star} dragged {team} over the line. He should be invoicing by the snap.",
    "{team} won narrowly. They'll take it, hide it, and never speak of the third quarter again.",
    "{gm} escaped with a win. Escaped is doing a lot of work in that sentence.",
  ],
  narrowLoss: [
    "{team} lost a close one. Which is somehow worse — at least a blowout is a clean break.",
    "{gm} came up just short. The {unit} would like to apologise to everybody.",
    "{team} fell by a whisker. {star} was excellent and it did not matter even slightly.",
    "{team} lost narrowly, which in this league counts as character building. Allegedly.",
    "{gm} was a play away. They are always a play away. That is the problem.",
  ],
  undefeated: [
    "{team} haven't lost yet. {gm} has started using the word 'process' unironically.",
    "Unbeaten {team}. Enjoy it — regression is undefeated too, and it has a longer record.",
    "{team} are perfect so far, which means the only way left is the interesting way.",
    "{gm} is undefeated and has become insufferable at roughly twice the expected rate.",
  ],
  winless: [
    "{team} are still looking for a win. The {unit} are still looking for the ball.",
    "{gm} remains winless. At this rate the draft pick will be worth more than the roster.",
    "{team} haven't won yet, but {star} is playing well enough to make it genuinely tragic.",
    "Winless {team}. Somewhere, a moral victory is being quietly awarded in private.",
  ],
  bye: [
    "{team} were on bye and it is the best they've looked all year.",
    "{gm} had a bye week. Undefeated in games not played — a proud tradition.",
    "{team} rested. The {unit} needed it more than anyone has ever needed anything.",
    "Bye week for {team}. No notes. Genuinely their strongest performance to date.",
  ],
  draftReach: [
    "{gm} drafted like a man being timed. The {unit} will be a talking point all year.",
    "{team}'s draft had a plan. We're just not sure whose.",
    "{gm} reached early and often. {star} is excellent; the rest is an act of faith.",
    "{team} built a roster with one obvious strength and a {unit} held together by optimism.",
    "{gm} came out of the draft with {star} and a long list of things to explain.",
  ],
  draftStrong: [
    "{gm} drafted well and knows it. The smugness is already at midseason levels.",
    "{team} look loaded. {star} headlines a roster that has no business being this deep this early.",
    "{gm} had a good draft. Annoyingly, infuriatingly good.",
    "{team} came out of the draft with {star} and very few excuses left.",
  ],
  champion: [
    "{team} won it all and {gm} has not shut up since. The ring is load-bearing.",
    "Defending champions {team}. Every opponent this year has that game circled and {gm} knows it.",
    "{gm} is a champion, which is the only reason anyone is still pretending the {unit} were fine.",
    "{team} raise a banner. Historically, the year after is where this gets funny.",
  ],
  lastSeasonGood: [
    "{team} went {margin} games over .500 last year, and {gm} has taken that as a personality.",
    "{gm}'s team was good last season. {star} was the reason, and he would like that noted.",
    "{team} were one of the better outfits in the league and still could not fix the {unit}.",
    "{gm} had a winning season, which in this league buys roughly nine weeks of patience.",
  ],
  lastSeasonBad: [
    "{team} lost {margin} more than they won last season. {gm} calls it a foundation.",
    "{gm} is coming off a bad year and has spent the offseason blaming the {unit}. Fairly, mind you.",
    "{team} were dreadful last season. {star} is still here, which is either loyalty or paperwork.",
    "{gm} returns from a losing season with the same plan and more confidence. Bold.",
  ],
  collapse: [
    "{team} made the playoffs and went out immediately. {gm} has described this as progress.",
    "{gm}'s season ended the moment it mattered. The {unit} picked a memorable week to show up late.",
    "{team} got in and got out. {star} deserved better and has said so in several interviews.",
  ],
  raceLeading: [
    "{team} are in the field at {margin} games over. {gm} has started using the phrase 'championship window' out loud.",
    "{gm} holds a playoff spot. The {unit} are doing their best to give it back weekly.",
    "{team} look like a playoff team, which around here counts as an unsolved mystery.",
    "{star} is dragging {team} into the bracket more or less by himself. Somebody get the man a defense.",
  ],
  raceHunting: [
    "{team} are still alive, in the sense that a dropped call is still a conversation.",
    "{gm} needs help, results and possibly a lawyer. The path exists. It is narrow.",
    "{team} are hanging around the race. The {unit} would like everyone to stop looking at them.",
    "{star} is playing like a man who has read the tiebreakers. Nobody else on {team} has.",
  ],
  raceFading: [
    "{team} are technically not eliminated, which is the nicest thing available to say.",
    "{gm} is working the scenarios. There are eleven of them and they all require a miracle in Cleveland.",
    "{team} need to win out and get help from people who dislike them. Good luck.",
  ],
  mediocre: [
    "{team} were fine. Aggressively, forgettably fine.",
    "{gm} did enough. Nobody is writing a documentary about it.",
    "{team} exist. The {unit} are a project. {star} is carrying more than his share.",
    "{gm}'s team is neither good nor bad, which is its own kind of crime.",
    "{team} continue to be a rounding error with a logo.",
  ],
};

/** Which bucket this team's week falls into. */
function situationOf(c: RoastContext): Situation {
  if (c.onBye) return "bye";
  if (c.fromDraft) {
    return c.bestOverall >= 88 ? "draftStrong" : "draftReach";
  }
  // Change 10: while a team can still get in, the joke is about the race —
  // that is the thing a GM in November actually wants read back to them.
  // Once the maths says no, it goes back to being a roast.
  if (c.race && !c.race.eliminated) {
    if (c.race.inField) return "raceLeading";
    return c.race.gamesBack <= 2 ? "raceHunting" : "raceFading";
  }
  if (c.lastSeason) {
    const { wins, losses, wonSuperBowl, madePlayoffs, furthestRound } = c.lastSeason;
    if (wonSuperBowl) return "champion";
    if (madePlayoffs && furthestRound === "WC") return "collapse";
    if (wins - losses >= 3) return "lastSeasonGood";
    if (losses - wins >= 3) return "lastSeasonBad";
    return "mediocre";
  }
  const played = c.wins + c.losses;
  if (played >= 2 && c.losses === 0) return "undefeated";
  if (played >= 2 && c.wins === 0) return "winless";
  if (c.biggestMargin >= 17) return "blowoutWin";
  if (c.biggestMargin <= -17) return "blowoutLoss";
  if (c.biggestMargin > 0) return "narrowWin";
  if (c.biggestMargin < 0) return "narrowLoss";
  return "mediocre";
}

function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * One line, deterministic in the league, the team and the week.
 *
 * Deterministic so every GM sees the same thing and a reload does not reroll
 * the joke — a comment that changed when you refreshed would read as broken
 * rather than as variety.
 */
export function roastFor(c: RoastContext, seedKey: string): string {
  const situation = situationOf(c);
  const lines = LIBRARY[situation];
  const line = lines[hash(`${seedKey}|${c.teamCode}`) % lines.length]!;
  const team = TEAMS_BY_CODE[c.teamCode]?.label ?? c.teamCode;
  return line
    .replace(/\{team\}/g, team)
    .replace(/\{gm\}/g, c.gmName)
    .replace(/\{star\}/g, c.bestPlayer)
    .replace(/\{unit\}/g, c.weakestUnit)
    .replace(/\{margin\}/g, String(Math.abs(c.biggestMargin)));
}

/** Build the context for one team from what actually happened. */
export function roastContext(
  s: LeagueState,
  teamCode: string,
  gmName: string,
  games: { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }[],
  fromDraft: boolean,
): RoastContext {
  const mine = games.filter((g) => g.homeTeam === teamCode || g.awayTeam === teamCode);
  let pointsFor = 0;
  let pointsAgainst = 0;
  let wins = 0;
  let losses = 0;
  let biggestMargin = 0;

  for (const g of mine) {
    const home = g.homeTeam === teamCode;
    const us = home ? g.homeScore : g.awayScore;
    const them = home ? g.awayScore : g.homeScore;
    pointsFor += us;
    pointsAgainst += them;
    if (us > them) wins++;
    else if (them > us) losses++;
    const margin = us - them;
    if (Math.abs(margin) > Math.abs(biggestMargin)) biggestMargin = margin;
  }

  const roster = Object.values(s.players).filter(
    (p) => p.nfl_team === teamCode && !p.retired && !p.free_agent,
  );
  const best = roster.reduce<{ name: string; overall: number }>(
    (n, p) => (p.overall > n.overall ? { name: p.name, overall: p.overall } : n),
    { name: "somebody", overall: 0 },
  );

  const team = s.teams[teamCode];
  const units: { label: string; value: number }[] = [
    { label: "offensive line", value: team?.ratings.offense ?? 60 },
    { label: "secondary", value: team?.ratings.defense ?? 60 },
    { label: "special teams", value: team?.ratings.specialTeams ?? 60 },
  ];
  const weakest = units.reduce((a, b) => (b.value < a.value ? b : a));

  return {
    teamCode,
    gmName,
    pointsFor,
    pointsAgainst,
    wins,
    losses,
    biggestMargin,
    bestPlayer: best.name,
    bestOverall: best.overall,
    weakestUnit: weakest.label,
    onBye: mine.length === 0 && !fromDraft,
    fromDraft,
  };
}

/**
 * One roast per human team off an arbitrary set of games.
 *
 * The general form the two callers below specialise: they differ only in
 * which games they hand it and what they seed the choice with.
 */
export function roastsForWeek(
  s: LeagueState,
  games: { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }[],
  seedKey: string,
  fromDraft = false,
): { teamCode: string; gmName: string; line: string }[] {
  return s.gms
    .filter((g) => g.isHuman && g.teamCode)
    .map((g) => {
      const ctx = roastContext(s, g.teamCode, g.name, games, fromDraft);
      return { teamCode: g.teamCode, gmName: g.name, line: roastFor(ctx, seedKey) };
    });
}

/**
 * The preseason set: one line per human GM, fixed for the whole preseason.
 *
 * Not derived from revealed games on purpose. Every GM has to read the same
 * cards — a roast that changed depending on how far you had watched would be
 * a spoiler channel, since the line about somebody's 0-3 start would tell you
 * they had started 0-3. So it comes off the completed prior season, or off
 * the fantasy draft in season one, and does not move again until the regular
 * season starts.
 */
export function preseasonRoasts(s: LeagueState): { teamCode: string; gmName: string; line: string }[] {
  const priorSeason = s.season - 1;
  return s.gms
    .filter((g) => g.isHuman && g.teamCode)
    .map((g) => {
      const outcome = s.history.find((h) => h.gmId === g.id && h.season === priorSeason);
      const ctx = roastContext(s, g.teamCode, g.name, [], !outcome);
      // no games went into this, so "they were on bye" is not the reading
      ctx.onBye = false;
      if (outcome) {
        ctx.lastSeason = {
          wins: outcome.regularSeasonRecord.wins,
          losses: outcome.regularSeasonRecord.losses,
          madePlayoffs: outcome.madePlayoffs,
          wonSuperBowl: outcome.wonSuperBowl,
          furthestRound: outcome.furthestRound,
        };
        // {margin} reads as "games over .500" in the last-season lines
        ctx.biggestMargin = outcome.regularSeasonRecord.wins - outcome.regularSeasonRecord.losses;
      }
      return {
        teamCode: g.teamCode,
        gmName: g.name,
        line: roastFor(ctx, `preseason|${s.season}`),
      };
    });
}

/**
 * The in-season set: one line per human GM, off the week just watched.
 *
 * Keyed to a week rather than to a GM's progress, which is what makes it
 * both spoiler-free and identical for everyone. A GM sitting on week two
 * reads the week-two cards; a GM who has raced to week nine reads the
 * week-nine cards; and when the first one catches up they read exactly what
 * the second one read. Nothing here can mention a week the viewer has not
 * watched, because the only games it looks at are the ones from the week
 * before the hub they are standing on.
 *
 * `throughWeek` is the last week this GM has revealed. Week one has no
 * preceding week, so it falls back to the preseason set.
 */
export function weeklyRoasts(
  s: LeagueState,
  throughWeek: number,
): { teamCode: string; gmName: string; line: string }[] {
  if (throughWeek < 1) return preseasonRoasts(s);
  const games = s.games.filter((g) => g.phase === "REG" && g.played && g.week === throughWeek);
  return s.gms
    .filter((g) => g.isHuman && g.teamCode)
    .map((g) => {
      const ctx = roastContext(s, g.teamCode, g.name, games, false);
      const race = raceFor(s, g.teamCode, throughWeek);
      if (race) {
        ctx.race = race;
        // in the race lines {margin} reads as games over .500, not as a score
        const rec = recordThrough(s, g.teamCode, throughWeek);
        ctx.biggestMargin = rec.wins - rec.losses;
      }
      return {
        teamCode: g.teamCode,
        gmName: g.name,
        line: roastFor(ctx, `week|${s.season}|${throughWeek}`),
      };
    });
}

/**
 * Where a team sits in its conference, and whether it can still get in.
 *
 * Elimination is the plain arithmetic version: you are out when winning
 * every remaining game still leaves you short of the seventh seed's current
 * total. That is conservative — it ignores tiebreakers and the fact that the
 * teams ahead have to play each other — which is the right direction to be
 * wrong in. Telling a GM they are eliminated when they are not would be a
 * much worse mistake than being slow to say it.
 */
export function raceFor(
  s: LeagueState,
  teamCode: string,
  throughWeek: number,
): { inField: boolean; gamesBack: number; eliminated: boolean } | undefined {
  if (throughWeek < 1) return undefined;
  const conference = TEAMS_BY_CODE[teamCode]?.conference;
  if (!conference) return undefined;

  const winsOf = (code: string): number => {
    let wins = 0;
    for (const g of s.games) {
      if (g.phase !== "REG" || !g.played || g.week > throughWeek) continue;
      const home = g.homeTeam === code;
      if (!home && g.awayTeam !== code) continue;
      if ((home ? g.homeScore : g.awayScore) > (home ? g.awayScore : g.homeScore)) wins++;
    }
    return wins;
  };

  const rivals = Object.keys(s.teams)
    .filter((c) => TEAMS_BY_CODE[c]?.conference === conference)
    .map((c) => ({ code: c, wins: winsOf(c) }))
    .sort((a, b) => b.wins - a.wins);

  const mine = rivals.find((r) => r.code === teamCode);
  if (!mine) return undefined;
  const cut = rivals[6]?.wins ?? 0;
  const rank = rivals.findIndex((r) => r.code === teamCode);
  const left = Math.max(0, REGULAR_SEASON_WEEKS - throughWeek);

  return {
    inField: rank < 7,
    gamesBack: Math.max(0, cut - mine.wins),
    eliminated: mine.wins + left < cut,
  };
}

/** A team's record through a given week, from the games themselves. */
function recordThrough(s: LeagueState, teamCode: string, throughWeek: number) {
  let wins = 0;
  let losses = 0;
  for (const g of s.games) {
    if (g.phase !== "REG" || !g.played || g.week > throughWeek) continue;
    const home = g.homeTeam === teamCode;
    if (!home && g.awayTeam !== teamCode) continue;
    const us = home ? g.homeScore : g.awayScore;
    const them = home ? g.awayScore : g.homeScore;
    if (us > them) wins++;
    else if (them > us) losses++;
  }
  return { wins, losses };
}
