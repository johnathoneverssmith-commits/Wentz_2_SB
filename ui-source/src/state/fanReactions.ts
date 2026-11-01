import { TEAMS_BY_CODE } from "@/data/teams";
import type { GameResult, LeagueState, PlayerGameLine } from "@/domain";
import { visibleGames } from "./reveal";

/**
 * "What the Fans Are Saying": a handful of invented fans reacting to one game.
 *
 * Everything a post claims comes from the game's own record (score, quarter
 * points, totals, player lines, scoring plays) and the team's results in the
 * games before it. A figure that is not in the record is not claimed: with no
 * player lines there are no player posts, with no scoring plays there is no
 * comeback. The fans, their handles and their voices are made up — none of
 * them is a real account — and the same game always yields the same posts
 * (a seeded choice, no clock, no `Math.random`, no network, no AI call).
 */

export type FanTone = "excited" | "angry" | "funny" | "analytical" | "anxious" | "wholesome";

export interface FanPost {
  id: string;
  handle: string;
  /** a short descriptor of the fan, e.g. "season-ticket holder since the 90s" */
  bio: string;
  tone: FanTone;
  text: string;
  /** which fact in the record produced it (also what the tests check) */
  basis: string;
}

export interface FanContext {
  /** this team's earlier finished games in the same season, oldest first */
  prior?: readonly GameResult[];
  /** this team's record entering/after the game, if known */
  record?: { wins: number; losses: number; ties: number } | undefined;
  /** games left in the regular season after this one */
  gamesLeft?: number | undefined;
}

const FANS: { handle: string; bio: string; tones: FanTone[] }[] = [
  { handle: "@TailgateTheo", bio: "grills before every home game", tones: ["excited", "funny", "wholesome"] },
  { handle: "@FilmRoomFelix", bio: "re-watches the all-22 for fun", tones: ["analytical", "anxious"] },
  { handle: "@SaltySunday", bio: "has opinions about the punter", tones: ["angry", "funny"] },
  { handle: "@BleacherBetty", bio: "season-ticket holder since the 90s", tones: ["wholesome", "angry", "excited"] },
  { handle: "@CapSpaceCassie", bio: "reads every contract twice", tones: ["analytical", "anxious"] },
  { handle: "@HotTakeHank", bio: "fired the coach in week 2", tones: ["angry", "funny"] },
  { handle: "@EndZoneEmmy", bio: "never leaves before the final whistle", tones: ["excited", "wholesome"] },
  { handle: "@DoomScrollDave", bio: "expects the worst, politely", tones: ["anxious", "funny"] },
  { handle: "@BlitzBabs", bio: "yells at the TV with love", tones: ["angry", "excited"] },
  { handle: "@NickelbackNorm", bio: "retired, watches every snap", tones: ["analytical", "wholesome"] },
  { handle: "@PigskinPriya", bio: "fantasy and franchise, in that order", tones: ["excited", "analytical"] },
  { handle: "@SidelineSam", bio: "brings a radio to the stadium", tones: ["anxious", "wholesome"] },
  { handle: "@ChainGangChuck", bio: "counts the first-down markers", tones: ["analytical", "funny"] },
  { handle: "@RedZoneRosa", bio: "three screens, one couch", tones: ["excited", "funny"] },
  { handle: "@PuntReturnPete", bio: "optimist, mostly", tones: ["wholesome", "excited", "funny"] },
  { handle: "@GoalPostGus", bio: "still mad about 2019", tones: ["angry", "anxious"] },
];

// ---------------------------------------------------------------- seeding

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ facts

interface Facts {
  us: number;
  them: number;
  margin: number;
  won: boolean;
  lost: boolean;
  tied: boolean;
  team: string;
  opp: string;
  oppName: string;
  teamName: string;
  home: boolean;
  phase: GameResult["phase"];
  division: boolean;
  /** largest deficit our side faced, from the scoring plays; null when they are not recorded */
  maxDeficit: number | null;
  /** largest lead we held */
  maxLead: number | null;
  /** margin at halftime from the quarter points; null when not recorded */
  halfMargin: number | null;
  /** the last lead change came in the 4th quarter or overtime */
  lateSwing: boolean;
  turnovers: number | null;
  oppTurnovers: number | null;
  sacksAllowed: number | null;
  ourSacks: number;
  stars: PlayerGameLine[];
  streak: { kind: "W" | "L"; n: number } | null;
  record: FanContext["record"];
  gamesLeft: number | undefined;
}

const tdsOf = (l: PlayerGameLine): number => (l.passTd ?? 0) + (l.rushTd ?? 0) + (l.recTd ?? 0);
const surname = (n: string): string => n.trim().split(/\s+/).slice(-1)[0] ?? n;

export function factsOf(game: GameResult, team: string, ctx: FanContext = {}): Facts {
  const home = game.homeTeam === team;
  const us = home ? game.homeScore : game.awayScore;
  const them = home ? game.awayScore : game.homeScore;
  const opp = home ? game.awayTeam : game.homeTeam;
  const side = home ? "home" : "away";
  const other = home ? "away" : "home";
  const mine = game.totals?.[side];
  const theirs = game.totals?.[other];

  // running margin (ours minus theirs) after each recorded scoring play
  let maxDeficit: number | null = null;
  let maxLead: number | null = null;
  let lateSwing = false;
  const sp = game.scoringPlays ?? [];
  if (sp.length > 0) {
    maxDeficit = 0;
    maxLead = 0;
    let prevSign = 0;
    for (const p of sp) {
      const m = home ? p.homeScore - p.awayScore : p.awayScore - p.homeScore;
      maxDeficit = Math.max(maxDeficit, -m);
      maxLead = Math.max(maxLead, m);
      const sign = Math.sign(m);
      if (sign !== 0 && sign !== prevSign && prevSign !== 0 && p.quarter >= 4) lateSwing = true;
      if (sign !== 0) prevSign = sign;
    }
  }
  const q = (t: typeof mine) => (t?.byQuarter ?? []) as number[];
  const half = (t: typeof mine) => q(t).slice(0, 2).reduce((a, b) => a + b, 0);
  const halfMargin = mine && theirs && q(mine).length >= 2 && q(theirs).length >= 2 ? half(mine) - half(theirs) : null;

  const lines = game.playerLines?.[side] ?? [];
  const stars = lines
    .filter(
      (l) =>
        (l.passTd ?? 0) >= 3 ||
        (l.passYds ?? 0) >= 300 ||
        (l.rushYds ?? 0) >= 100 ||
        (l.recYds ?? 0) >= 100 ||
        (l.sacks ?? 0) >= 2 ||
        (l.defInt ?? 0) >= 1 ||
        tdsOf(l) >= 2 ||
        (l.fgm ?? 0) >= 3,
    )
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3);

  // streak from the earlier games plus this one
  const results = [...(ctx.prior ?? []), game]
    .filter((g) => g.played && (g.homeTeam === team || g.awayTeam === team))
    .map((g) => {
      const h = g.homeTeam === team;
      const a = h ? g.homeScore : g.awayScore;
      const b = h ? g.awayScore : g.homeScore;
      return a > b ? "W" : a < b ? "L" : "T";
    });
  let n = 0;
  const last = results[results.length - 1];
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
  const streak: Facts["streak"] = last === "W" || last === "L" ? (n >= 2 ? { kind: last, n } : null) : null;

  return {
    us,
    them,
    margin: us - them,
    won: us > them,
    lost: us < them,
    tied: us === them,
    team,
    opp,
    oppName: TEAMS_BY_CODE[opp]?.name ?? opp,
    teamName: TEAMS_BY_CODE[team]?.name ?? team,
    home,
    phase: game.phase,
    division:
      !!TEAMS_BY_CODE[team] &&
      !!TEAMS_BY_CODE[opp] &&
      TEAMS_BY_CODE[team]!.conference === TEAMS_BY_CODE[opp]!.conference &&
      TEAMS_BY_CODE[team]!.division === TEAMS_BY_CODE[opp]!.division,
    maxDeficit,
    maxLead,
    halfMargin,
    lateSwing,
    turnovers: mine ? mine.turnovers : null,
    oppTurnovers: theirs ? theirs.turnovers : null,
    sacksAllowed: mine?.sacksAllowed ?? null,
    ourSacks: lines.reduce((a, l) => a + (l.sacks ?? 0), 0),
    stars,
    streak,
    record: ctx.record,
    gamesLeft: ctx.gamesLeft,
  };
}

function score(l: PlayerGameLine): number {
  return (
    (l.passYds ?? 0) / 40 + (l.passTd ?? 0) * 3 + (l.rushYds ?? 0) / 15 + (l.recYds ?? 0) / 15 + tdsOf(l) * 2 + (l.sacks ?? 0) * 3 + (l.defInt ?? 0) * 4 + (l.fgm ?? 0)
  );
}

/** The one true sentence about a player's day, from his line only. */
export function starLine(l: PlayerGameLine): string {
  const bits: string[] = [];
  if ((l.passAtt ?? 0) > 0 && ((l.passYds ?? 0) >= 250 || (l.passTd ?? 0) >= 2)) bits.push(`${l.passYds} yards and ${l.passTd ?? 0} TD${(l.passTd ?? 0) === 1 ? "" : "s"} through the air`);
  if ((l.rushYds ?? 0) >= 80) bits.push(`${l.rushYds} rushing yards${(l.rushTd ?? 0) > 0 ? ` and ${l.rushTd} TD${l.rushTd === 1 ? "" : "s"}` : ""}`);
  else if ((l.rushTd ?? 0) >= 2) bits.push(`${l.rushTd} rushing TDs`);
  if ((l.recYds ?? 0) >= 80) bits.push(`${l.rec ?? 0} catches for ${l.recYds}${(l.recTd ?? 0) > 0 ? ` and ${l.recTd} TD${l.recTd === 1 ? "" : "s"}` : ""}`);
  else if ((l.recTd ?? 0) >= 2) bits.push(`${l.recTd} receiving TDs`);
  if ((l.sacks ?? 0) >= 2) bits.push(`${l.sacks} sacks`);
  if ((l.defInt ?? 0) >= 1) bits.push(`${l.defInt === 1 ? "an interception" : `${l.defInt} interceptions`}`);
  if ((l.fgm ?? 0) >= 3) bits.push(`${l.fgm} field goals`);
  return bits.length ? bits.join(" and ") : "a big day";
}

// -------------------------------------------------------------- templates

interface Cand {
  basis: string;
  weight: number;
  variants: { tone: FanTone; text: (f: Facts, p?: PlayerGameLine) => string }[];
  player?: PlayerGameLine;
}

const sc = (f: Facts): string => `${f.us}-${f.them}`;

function candidates(f: Facts): Cand[] {
  const out: Cand[] = [];
  const add = (c: Cand): void => void out.push(c);
  const playoff = f.phase !== "REG" && f.phase !== "PRE";
  const pre = f.phase === "PRE";

  if (pre) {
    add({
      basis: "preseason",
      weight: 10,
      variants: [
        { tone: "wholesome", text: (x) => `Preseason ${x.won ? "win" : x.lost ? "loss" : "tie"}, ${sc(x)} ${x.home ? "vs" : "at"} ${x.oppName}. Doesn't count, but I'll take watching football again.` },
        { tone: "analytical", text: (x) => `Preseason ${sc(x)}. I'm not reading anything into the score — I'm watching who's getting the reps.` },
        { tone: "funny", text: (x) => `${x.teamName} ${x.won ? "won" : x.lost ? "lost" : "tied"} ${sc(x)} and I already have a full season's worth of opinions. Send help.` },
      ],
    });
  }

  if (f.tied) {
    add({
      basis: "tie",
      weight: 10,
      variants: [
        { tone: "funny", text: (x) => `${x.us}-${x.them}. A tie. I have driven home from a stadium feeling this exact amount of nothing before.` },
        { tone: "angry", text: (x) => `We tied ${x.oppName} ${sc(x)}. A TIE. Nobody wins, nobody loses, everybody is annoyed.` },
      ],
    });
  }

  if (f.won) {
    if (f.them === 0) {
      add({
        basis: "shutout-win",
        weight: 9,
        variants: [
          { tone: "excited", text: (x) => `SHUTOUT. ${x.oppName} scored ZERO. ${sc(x)}. Frame that scoreboard.` },
          { tone: "analytical", text: (x) => `Holding ${x.oppName} to nothing is rare. ${sc(x)} and the defense never blinked.` },
        ],
      });
    }
    if (f.margin >= 21) {
      add({
        basis: "blowout-win",
        weight: 8,
        variants: [
          { tone: "excited", text: (x) => `${sc(x)} over ${x.oppName}?! ${x.margin} points. I can't sit down.` },
          { tone: "funny", text: (x) => `Won by ${x.margin}. I started checking the weather in the other city to see if they'd already left.` },
          { tone: "wholesome", text: (x) => `Days like this are why I keep the season tickets. ${sc(x)}, and everybody around me was hugging strangers.` },
        ],
      });
    } else if (f.margin <= 3) {
      add({
        basis: "close-win",
        weight: 8,
        variants: [
          { tone: "anxious", text: (x) => `${sc(x)}. My heart can't take ${x.margin}-point finishes. We won, and I'm exhausted.` },
          { tone: "excited", text: (x) => `WON BY ${x.margin}. Take the W and don't look at how it happened.` },
          { tone: "analytical", text: (x) => `A ${x.margin}-point win over ${x.oppName} says the margin for error is thin. Good result, tight game.` },
        ],
      });
    } else {
      add({
        basis: "win",
        weight: 6,
        variants: [
          { tone: "excited", text: (x) => `${x.teamName} ${sc(x)} over ${x.oppName}. That's a good Sunday.` },
          { tone: "wholesome", text: (x) => `Good win ${x.home ? "at home" : "on the road"}, ${sc(x)}. Proud of this team.` },
        ],
      });
    }
    if (f.maxDeficit !== null && f.maxDeficit >= 10) {
      add({
        basis: "comeback",
        weight: 11,
        variants: [
          { tone: "excited", text: (x) => `We were down ${x.maxDeficit} and still won ${sc(x)}. I will never doubt this team again (I will, but not tonight).` },
          { tone: "funny", text: (x) => `Trailed by ${x.maxDeficit}, won by ${x.margin}. That's the most stressful two hours I've paid for.` },
        ],
      });
    } else if (f.lateSwing && f.margin <= 7) {
      add({
        basis: "late-win",
        weight: 10,
        variants: [{ tone: "excited", text: (x) => `Took the lead in the fourth and held on, ${sc(x)}. Late and loud.` }],
      });
    }
    if (f.us + f.them <= 24 && f.them > 0) {
      add({
        basis: "defensive-win",
        weight: 6,
        variants: [{ tone: "analytical", text: (x) => `${sc(x)} is the kind of game a defense wins. Nobody was scoring easily today.` }],
      });
    }
  }

  if (f.lost) {
    if (f.us === 0) {
      add({
        basis: "shutout-loss",
        weight: 10,
        variants: [
          { tone: "angry", text: (x) => `ZERO points. Zero. ${x.oppName} ${x.them}, us nothing. I want to talk to a manager.` },
          { tone: "funny", text: () => `Our offense was shut out. At this point the scoreboard operator was just being polite.` },
        ],
      });
    }
    if (f.margin <= -21) {
      add({
        basis: "blowout-loss",
        weight: 9,
        variants: [
          { tone: "angry", text: (x) => `Lost ${sc(x)}. That's a ${-x.margin}-point beating. Embarrassing.` },
          { tone: "funny", text: (x) => `Down ${-x.margin}. I started watching the commercials for the plot.` },
          { tone: "anxious", text: (x) => `${sc(x)}. I'm not even mad, I'm just worried about what it means for the rest of the year.` },
        ],
      });
    } else if (f.margin >= -3) {
      add({
        basis: "close-loss",
        weight: 8,
        variants: [
          { tone: "angry", text: (x) => `Lost by ${-x.margin}, ${sc(x)}. One play. ONE PLAY.` },
          { tone: "analytical", text: (x) => `A ${-x.margin}-point loss to ${x.oppName} comes down to a handful of snaps. This team was close.` },
          { tone: "wholesome", text: () => `Tough loss, but they fought to the end. That's all I ask.` },
        ],
      });
    } else {
      add({
        basis: "loss",
        weight: 6,
        variants: [
          { tone: "angry", text: (x) => `${x.oppName} ${x.them}, ${x.teamName} ${x.us}. We have to be better than this.` },
          { tone: "anxious", text: (x) => `${sc(x)} loss. Not the end of the world, but I keep checking the standings.` },
        ],
      });
    }
    if (f.maxLead !== null && f.maxLead >= 10) {
      add({
        basis: "blown-lead",
        weight: 12,
        variants: [
          { tone: "angry", text: (x) => `We led by ${x.maxLead} and LOST. ${sc(x)}. Coaching staff, explain yourselves.` },
          { tone: "analytical", text: (x) => `A ${x.maxLead}-point lead gone. The game plan stopped adjusting; that's on the staff.` },
        ],
      });
    } else if (f.halfMargin !== null && f.halfMargin > 0) {
      add({
        basis: "led-at-half",
        weight: 9,
        variants: [{ tone: "angry", text: (x) => `Up ${x.halfMargin} at halftime and we still lost ${sc(x)}? The second-half adjustments were nowhere.` }],
      });
    }
  }

  if (f.turnovers !== null && f.turnovers >= 3) {
    add({
      basis: "turnovers",
      weight: f.lost ? 10 : 7,
      variants: [
        { tone: "angry", text: (x) => `${x.turnovers} turnovers. You can't win like that${x.won ? " — we got away with one" : ""}.` },
        { tone: "funny", text: (x) => `${x.turnovers} giveaways. Generous team. Very giving.` },
      ],
    });
  }
  if (f.turnovers === 0 && f.won) {
    add({
      basis: "clean-game",
      weight: 5,
      variants: [{ tone: "analytical", text: () => `No turnovers. That's the whole recipe: take care of the ball and the rest follows.` }],
    });
  }
  if (f.oppTurnovers !== null && f.oppTurnovers >= 3 && f.won) {
    add({
      basis: "takeaways",
      weight: 8,
      variants: [{ tone: "excited", text: (x) => `${x.oppTurnovers} takeaways! The defense was hunting all day.` }],
    });
  }
  if (f.sacksAllowed !== null && f.sacksAllowed >= 4) {
    add({
      basis: "sacks-allowed",
      weight: 9,
      variants: [
        { tone: "angry", text: (x) => `${x.sacksAllowed} sacks allowed. Our quarterback spent the day on his back.` },
        { tone: "analytical", text: (x) => `${x.sacksAllowed} sacks given up — the protection never held up. Fix the line before anything else.` },
      ],
    });
  }
  if (f.ourSacks >= 4) {
    add({
      basis: "sacks-made",
      weight: 8,
      variants: [{ tone: "excited", text: (x) => `${x.ourSacks} sacks! The pass rush lived in their backfield.` }],
    });
  }

  for (const star of f.stars.slice(0, 2)) {
    add({
      basis: `star:${star.playerId}`,
      weight: 9,
      player: star,
      variants: [
        { tone: "excited", text: (x, p) => `${surname(p!.name)}: ${starLine(p!)}. ${x.won ? "Take a bow." : "Wasted on a loss, honestly."}` },
        { tone: "wholesome", text: (_x, p) => `Shoutout to ${p!.name} — ${starLine(p!)}. Played their heart out.` },
        { tone: "analytical", text: (_x, p) => `${p!.name} with ${starLine(p!)}. That's the kind of production you build around.` },
      ],
    });
  }

  if (f.streak && f.streak.n >= 3) {
    const win = f.streak.kind === "W";
    add({
      basis: "streak",
      weight: 8,
      variants: win
        ? [
            { tone: "excited", text: (x) => `${x.streak!.n} straight wins. Don't wake me up.` },
            { tone: "anxious", text: (x) => `${x.streak!.n} in a row and all I can think about is when it ends.` },
          ]
        : [
            { tone: "angry", text: (x) => `${x.streak!.n} straight losses. I'm out of patience and out of snacks.` },
            { tone: "funny", text: (x) => `${x.streak!.n}-game losing streak. At least the parking is easy now.` },
          ],
    });
  }
  if (f.division) {
    add({
      basis: "division",
      weight: 6,
      variants: [
        { tone: f.won ? "excited" : f.lost ? "angry" : "anxious", text: (x) => `${x.won ? "Beat" : x.lost ? "Lost to" : "Tied"} a division rival, ${sc(x)}. Those count double in my heart.` },
      ],
    });
  }
  if (f.record && f.gamesLeft !== undefined && f.gamesLeft >= 0 && f.gamesLeft <= 6 && f.phase === "REG") {
    const r = f.record;
    add({
      basis: "race",
      weight: 7,
      variants: [
        { tone: "anxious", text: (x) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""} with ${x.gamesLeft} to play. Every game is a playoff game now. I can't breathe.` },
        { tone: "analytical", text: (x) => `At ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}, ${x.gamesLeft} games left. The seeding picture is still very much alive.` },
      ],
    });
  }
  if (playoff) {
    add({
      basis: "playoffs",
      weight: 12,
      variants: f.won
        ? [
            { tone: "excited", text: (x) => `PLAYOFF WIN, ${sc(x)}! ${x.phase === "SB" ? "CHAMPIONS." : "Still dancing."}` },
            { tone: "anxious", text: (x) => `We survived ${x.oppName}, ${sc(x)}. I've bitten every fingernail I own.` },
          ]
        : [
            { tone: "angry", text: (x) => `Season over. ${x.oppName} ${x.them}, us ${x.us}. See you in the offseason.` },
            { tone: "wholesome", text: () => `Heartbreaking way to end it, but I'm proud of this team. Wait till next year.` },
          ],
    });
  }
  // Always-available reactions to the result itself, so even a score-only game
  // (no totals, no lines, no scoring plays) gets a believable, true feed.
  const verdict = f.won ? "win" : f.lost ? "loss" : "tie";
  add({ basis: "score-a", weight: 2, variants: [{ tone: f.won ? "excited" : f.lost ? "angry" : "funny", text: (x) => `Final: ${x.teamName} ${x.us}, ${x.oppName} ${x.them}. ${x.won ? "Take it." : x.lost ? "Ugh." : "Well."}` }] });
  add({ basis: "score-b", weight: 2, variants: [{ tone: f.won ? "wholesome" : "anxious", text: (x) => `${x.home ? "Home" : "Road"} ${verdict}, ${sc(x)}. On to next week.` }] });
  add({ basis: "score-c", weight: 2, variants: [{ tone: "analytical", text: (x) => `${x.us + x.them} total points, ${Math.abs(x.margin)}-point ${verdict === "tie" ? "tie game" : "margin"}. ${x.us + x.them >= 50 ? "Defenses took the day off." : x.us + x.them <= 24 ? "A grind." : "A normal one."}` }] });
  return pool(out, pre);
}

function pool(out: Cand[], pre: boolean): Cand[] {
  return pre ? out.filter((c) => c.basis === "preseason" || c.basis.startsWith("star:") || c.basis.startsWith("score-")) : out;
}

// ----------------------------------------------------------------- public

/**
 * Four to six posts about this game from this team's side. Deterministic in
 * `(game.id, team)`; never throws on a sparse record (a score-only game still
 * yields the fans' reaction to the score).
 */
export function buildFanPosts(game: GameResult, team: string, ctx: FanContext = {}): FanPost[] {
  if (!game.played) return [];
  const f = factsOf(game, team, ctx);
  const rand = rng(hash(`${game.id}|${team}`));
  const pool = candidates(f);

  // weighted order without replacement
  const keyed = pool.map((c) => ({ c, k: -Math.log(1 - rand()) / c.weight }));
  keyed.sort((a, b) => a.k - b.k);

  const want = 4 + Math.floor(rand() * 3); // 4..6
  const chosen: Cand[] = [];
  const tones = new Set<FanTone>();
  // first pass favours new tones, so the feed mixes voices
  for (const { c } of keyed) {
    if (chosen.length >= want) break;
    chosen.push(c);
  }
  const usedHandles = new Set<string>();
  const posts: FanPost[] = [];
  const fanOrder = FANS.map((fan) => ({ fan, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.fan);

  for (const c of chosen) {
    // prefer a variant whose tone is not yet in the feed
    const fresh = c.variants.filter((v) => !tones.has(v.tone));
    const vs = fresh.length > 0 ? fresh : c.variants;
    const v = vs[Math.floor(rand() * vs.length)]!;
    const fan =
      fanOrder.find((x) => !usedHandles.has(x.handle) && x.tones.includes(v.tone)) ??
      fanOrder.find((x) => !usedHandles.has(x.handle))!;
    usedHandles.add(fan.handle);
    tones.add(v.tone);
    posts.push({
      id: `${game.id}:${team}:${c.basis}`,
      handle: fan.handle,
      bio: fan.bio,
      tone: v.tone,
      text: v.text(f, c.player),
      basis: c.basis,
    });
  }
  return posts;
}

/** The newest game this team's GM has been allowed to see, regular season or after. */
export function latestFanGame(s: LeagueState, code: string, online: boolean): GameResult | undefined {
  const seen = online ? visibleGames(s, s.viewerGmId) : s.games.filter((g) => g.played);
  const order = (g: { phase: string; week: number }): number =>
    g.phase === "PRE" ? g.week : g.phase === "REG" ? 100 + g.week : 200 + ["WC", "DIV", "CONF", "SB"].indexOf(g.phase);
  return [...seen]
    .filter((g) => g.played && (g.homeTeam === code || g.awayTeam === code))
    .sort((a, b) => order(b) - order(a))[0];
}

/** This team's finished games before `game` this season, oldest first (same phase group). */
export function priorGamesOf(s: LeagueState, code: string, game: GameResult, online: boolean): GameResult[] {
  const seen = online ? visibleGames(s, s.viewerGmId) : s.games.filter((g) => g.played);
  const order = (g: { phase: string; week: number }): number =>
    g.phase === "PRE" ? g.week : g.phase === "REG" ? 100 + g.week : 200 + ["WC", "DIV", "CONF", "SB"].indexOf(g.phase);
  return seen
    .filter((g) => g.phase !== "PRE" && (g.homeTeam === code || g.awayTeam === code) && order(g) < order(game))
    .sort((a, b) => order(a) - order(b));
}
