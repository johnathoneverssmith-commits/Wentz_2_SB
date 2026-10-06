import { NEUTRAL_COACH_OVERALL } from "./coachEffects.ts";
import { DRAFT_ROUNDS } from "./draftPicks.ts";
import { FIRE_BELOW } from "./hotSeat.ts";
import { FA_ROUNDS_MAX } from "./rules.ts";
import { MAX_CONTRACT_M } from "@/sim/MockSimulationService";

/**
 * "How it works": the plain-language rules behind each system, one topic per
 * system, shown beside the screens that use them.
 *
 * THE RULE FOR THIS FILE: whenever a mechanic changes, its text changes in
 * the same commit. The numbers that exist as constants are read from them so
 * they cannot drift on their own; the rest is prose, and `howItWorks.test.ts`
 * pins the routes and the figures it can. If you change how something works
 * and this file still describes the old way, the change is not finished.
 */
export interface HowSection {
  heading: string;
  body: string[];
}
export interface HowTopic {
  id: string;
  title: string;
  summary: string;
  sections: HowSection[];
}

export const HOW_IT_WORKS: HowTopic[] = [
  {
    id: "drafts",
    title: "Drafts",
    summary: "The fantasy draft that builds a new league, and the rookie draft every year after.",
    sections: [
      {
        heading: "The rookie draft",
        body: [
          `${DRAFT_ROUNDS} rounds, worst record picks first, and picks can be traded. A team that lets a free agent walk and sees him sign for real money elsewhere can earn a compensatory pick (rounds three to seven, at most four a team), which comes after the regular picks of its round.`,
          "You pick by hand for the number of rounds your league sets (the league setting \"Rookie draft rounds by hand\", changed at the start of each offseason). After those rounds your staff makes your remaining picks, and the CPU teams were never by hand.",
          "The Star on a prospect marks him as a target. On the clock, the room suggests the best target still on the board; nobody else sees your stars online.",
        ],
      },
      {
        heading: "College Grade is not OVR",
        body: [
          "A prospect's College Grade is how he rated in college, and it runs well above the overall he arrives with. The room shows what he projects to as a rookie beside it, and a late-round prospect's range is far wider than a top pick's.",
          "His true overall is hidden until you sign him: rookies can come in above or below the projection, and you can release one before the deal counts.",
        ],
      },
      {
        heading: "The fantasy draft",
        body: [
          "Every team starts empty and the whole league is drafted, snake or straight order, with the order randomized or in order. Each GM picks a set number by hand; once everyone has, the rest of the board completes itself until every team has a full roster.",
          "The suggested pick is the same evaluator the CPU uses: it values players in points of margin, position by position, with weak links counted harder than strong units.",
        ],
      },
    ],
  },
  {
    id: "freeAgency",
    title: "Free agency",
    summary: "Five rounds of offers, one turn per team per round.",
    sections: [
      {
        heading: "How a round works",
        body: [
          `The market runs ${FA_ROUNDS_MAX} rounds. In each round every team gets one turn: make one offer (a salary and a length) or pass. The order is set from roster strength when the market opens, strongest roster first.`,
          "Nobody signs when the offer arrives. At the end of the round every player with an offer picks the best one for him at once, so waiting until late in a round costs nothing and bidding early doesn't lock a player up. Offers that didn't win stay live into the next round.",
          `The most any one deal pays in a year is $${MAX_CONTRACT_M}M, and a player's asking price follows his rating and his position.`,
        ],
      },
      {
        heading: "What a player picks",
        body: [
          "An offer only counts if it meets what the player expects to be paid. Among the offers that do, he scores each one: money against his asking price counts for three quarters (with diminishing returns: doubling it isn't twice as persuasive) and fit with the team, such as a chance to start, counts for a quarter. A tie goes to the bigger salary, then to whoever offered first.",
        ],
      },
      {
        heading: "By hand or by staff",
        body: [
          "Your league sets how many of the rounds you take your own turn in (the setting \"Free agency rounds by hand\"). After them your staff takes your turns. Skip Free Agency passes every turn of this market only; it switches itself off when the next market opens.",
          "Cap space, roster size and positional minimums are allowed to break during the market and are enforced when you check in at the summary.",
        ],
      },
    ],
  },
  {
    id: "trades",
    title: "Trades",
    summary: "What the CPU will accept, and how packages are counted.",
    sections: [
      {
        heading: "How a deal is judged",
        body: [
          "Every asset has a trade value (see Trade value). A package counts its best player in full and each one after him for 70% of the one before, so two good players for one star can work and a pile of spares never does. Draft picks add up.",
          "The CPU accepts when it gets at least what it gives, adjusted for how much it needs the position. The more a deal favors you, the less likely it says yes.",
          "A franchise quarterback is never sold for anything but another one. The Master CPU also refuses any deal that loses value on its own measure.",
        ],
      },
      {
        heading: "The trade deadline",
        body: [
          "The deadline runs in three rounds, one turn at a time: propose, or answer an offer made to you. CPU contenders buy from teams that are out of it, and a GM who refuses an ask isn't asked for the same player again.",
          "Cap, roster limit and positional minimums are allowed to break at the deadline and are enforced afterwards. Skip the Deadline passes your own turns for this deadline only; offers made to you still wait for an answer.",
        ],
      },
    ],
  },
  {
    id: "tradeValue",
    title: "Trade value",
    summary: "What a player or pick is worth on the market.",
    sections: [
      {
        heading: "A player",
        body: [
          "Value starts from his overall on a steep curve, so a 90 is worth far more than two 80s and about a first-round pick. It is then multiplied by his position's market value (quarterbacks highest, then edge rushers, tackles, receivers and corners, with interior linemen only a little under; kickers and punters least).",
          "Age moves it: a young player is worth more, and the discount steepens after thirty (later for quarterbacks, earlier for running backs).",
          "Years of control and cost move it too: more cheap years left is worth more, and a deal that pays him well above his market rate is worth less.",
        ],
      },
      {
        heading: "Quarterbacks and picks",
        body: [
          "A franchise quarterback (his team's starter, 84 or better, not at the end of his career) costs far more than his rating alone says. Picks follow the old draft-value chart, round one worth roughly 2.8 times round two, scaled by where the pick is projected to land and discounted the further away its draft is.",
          "This price is the market's, not the engine's: free-agent salaries use a separate position scale, so the two can disagree about who is underpriced.",
        ],
      },
    ],
  },
  {
    id: "development",
    title: "Player development",
    summary: "How players grow in training camp.",
    sections: [
      {
        heading: "The order of things",
        body: [
          "Three things stack. The aging model decides whether a player improves, holds or declines. His position coach scales that. If his group was one of the two the coordinators focused on, the focus scales it again.",
          "Nothing after the first step can change its direction: a focus makes a developing player develop more and a declining one decline less, but it never keeps a 34-year-old improving.",
        ],
      },
      {
        heading: "Who grows",
        body: [
          "Players below their development age grow by an amount set by the room between their rating and their potential: high-ceiling prospects can be stars by 24 and low-ceiling ones plateau. The youngest grow fastest, and three or more years of growth left counts in full.",
          `Coaches are neutral at ${NEUTRAL_COACH_OVERALL}; each point above speeds growth by 1.5%, each point below slows it by 1.5%.`,
        ],
      },
      {
        heading: "Rookies",
        body: [
          "A rookie who starts ahead of a better veteran grows faster at camp; one a veteran keeps on the bench grows more slowly. The Game Plan's rookies dial decides how willing the lineup is to start a rookie (never giving up more than four points at a position).",
        ],
      },
    ],
  },
  {
    id: "regression",
    title: "Aging and decline",
    summary: "What happens to players past their prime, and when they retire.",
    sections: [
      {
        heading: "Decline",
        body: [
          "Between a player's development age and his decline age his rating barely moves. Past the decline age he loses points every year, more each year than the last, between one and seven a season. The ages are set per player, by position.",
          `The same coach scale applies: a position coach above ${NEUTRAL_COACH_OVERALL} makes the decline land 1.5% lighter per point, below it 1.5% heavier. Coaching changes the size of the move, never when a career turns.`,
        ],
      },
      {
        heading: "Retirement",
        body: [
          "Retirement depends on age against the position's typical retirement age and on prior injuries (a battered career is shorter). Retirements are decided once before the draft and shown on the Retirement Review, where you see which starters you are losing.",
        ],
      },
    ],
  },
  {
    id: "injuries",
    title: "Injuries",
    summary: "How players get hurt, and what the report means.",
    sections: [
      {
        heading: "How they happen",
        body: [
          "Injuries happen inside games: on any play the engine can roll an injury for a player on the field, and records who was hurt, how badly, and the projected weeks. A player hurt in a game is replaced by the next man up for the rest of it.",
          "Severity runs from minor (about a week) through moderate, significant and severe to season-ending. A player already hurt keeps whichever injury is worse.",
        ],
      },
      {
        heading: "What the report says",
        body: [
          "Questionable is out about a week or less, doubtful about two, out is three or more. An injured starter doesn't play; the depth chart and the engine fill in behind him, and a position wiped out entirely is filled with a replacement-level player.",
        ],
      },
    ],
  },
  {
    id: "recovery",
    title: "Injury recovery",
    summary: "How long it takes, and what changes that.",
    sections: [
      {
        heading: "The clock",
        body: [
          "Every game week that passes takes a week off everyone's projected time out, and a player is back when it reaches zero. Offseason injuries all heal: everyone starts a new season healthy.",
          `The medical staff changes how long, never whether: neutral at ${NEUTRAL_COACH_OVERALL}, each point above shortens a recovery by 1%, each below lengthens it by 1%. The change is applied when the injury is recorded, so the timeline you see is the one that holds.`,
        ],
      },
    ],
  },
  {
    id: "gameSim",
    title: "How games are simulated",
    summary: "The engine behind every score.",
    sections: [
      {
        heading: "Play by play",
        body: [
          "Every game is played one play at a time. The engine was fitted to real NFL play data: the call, the throw, the catch, the yards and the penalties each come from models of the situation (down, distance, field position, score, clock), then your players' ratings shift those odds.",
          "Rosters matter in proportion to the league's Talent Impact setting: Realistic is the fitted engine, Amplified (the new-league default) and Extreme make a better roster win more often with scoring unchanged.",
        ],
      },
      {
        heading: "What moves the odds",
        body: [
          "Players act by the unit they play in. A great unit with one weak starter plays closer to that starter, two units that work together (a quarterback and his receivers, a line and its back) are worth more than their ratings add up to, and the pass rush against the protection decides sacks.",
          "Home field is worth about a 54% win rate to the home team (none at the Super Bowl), weather changes throws, kicks and fumbles, and coaching nudges a few decisions.",
          "The last two minutes of each half run on the clock: game plans never apply there. Overtime follows the NFL rule, and playoff games always finish with a winner.",
        ],
      },
      {
        heading: "Win probability",
        body: [
          "The win chance on the matchup screen is the standard game plan against the other team's, from the gap in team overall, measured by simulating thousands of games. Home field is included. It is labelled \"with default game strategy\" because the plan you set can move it; in the preseason the Game Plan screen's lab measures exactly how much.",
        ],
      },
    ],
  },
  {
    id: "strategyEffects",
    title: "Game plan and strategy",
    summary: "What each dial does, and what it can't.",
    sections: [
      {
        heading: "The dials",
        body: [
          "Pass rate, fourth-down aggressiveness (by field zone and distance), blitz, personnel mix, how many carries the second back gets, quarterback runs, two-point tries, kickoffs, returns and how readily rookies start.",
          "Every dial is a small change from the standard plan, which is the engine as validated. A plan never beats the standard plan by a wide margin: a style costs on a roster not built for it and pays on one that is.",
        ],
      },
      {
        heading: "Limits",
        body: [
          "Sanity guards stop nonsense (going for it on fourth and 20 from your own end, kicking field goals from beyond the range of any kicker), and the last two minutes of each half ignore the plan.",
          "Your plan is saved on your team and applies to every game simulated from then on. Online, each playoff round is a checkpoint: set the plan for the next opponent, check in, and the round is played with the plan saved then. CPU teams play the plan that matches their GM's strategy.",
        ],
      },
      {
        heading: "The preseason lab",
        body: [
          "In the preseason, \"Test this plan\" plays your next game 160 times with the standard plan and 160 with yours, on the same random streams, and reports both win chances, the points per game it moves, and how sure that is. A difference inside the noise reads \"too close to call\". From Week 1 on there is no answer key.",
        ],
      },
    ],
  },
  {
    id: "awards",
    title: "Season awards",
    summary: "How MVP and the other awards are decided.",
    sections: [
      {
        heading: "Production, not volume",
        body: [
          "Players need at least eight games. Offensive players score on yards and touchdowns (a passing yard counts for less than a rushing or receiving yard, touchdowns count for a lot, interceptions count against). The MVP is the best offensive season on a winning team, with a quarterback's season counting for more and each team win adding to it.",
          "Defensive players score on splash plays: a sack, an interception or a forced fumble is worth far more than a tackle, and passes defended count too.",
          "Offensive and Defensive Player of the Year use the same scores without the team-wins term, and the rookie awards the same scores among first-year players. Coach of the Year goes to the biggest turnaround among winning teams. Every human GM sees the awards on the way into the season screen.",
        ],
      },
    ],
  },
  {
    id: "unitGrades",
    title: "Unit grades",
    summary: "The roster the way the engine reads it.",
    sections: [
      {
        heading: "What a grade is",
        body: [
          "Each unit (quarterback, receivers, running back, tight end, offensive line, pass rush, interior line, linebackers, corners, safeties) is graded on its starters as the depth chart sets them: the average of its starters, pulled toward the weakest, ranked against every other team.",
          "A weak starter drags a unit down more than his share, and complete units count for more than the average of their parts. Outside linebacker isn't a lineup slot in the engine and is left out. The top priorities are the units where an upgrade would add the most.",
          "You can open it from the draft, free agency, a trade and the deadline without leaving what you are doing.",
        ],
      },
    ],
  },
  {
    id: "playoffOdds",
    title: "Playoff odds",
    summary: "The percentage next to each team.",
    sections: [
      {
        heading: "A projection",
        body: [
          "Games played count at the record so far. Games left are projected from how strong the roster is against the league (a stronger roster is a better bet to win what's left) with the base being the share of the league that makes it, 14 of 32.",
          "Odds are held between 2% and 98% until the field is set. Once the bracket exists, in it is 100% and out is 0%.",
        ],
      },
    ],
  },
  {
    id: "gmFiring",
    title: "Job security",
    summary: "How a human GM loses a team, and how CPU GMs do.",
    sections: [
      {
        heading: "The score",
        body: [
          "A GM's score starts at 60 and is read off the last five seasons with the current team: +4 per win above .500 (−4 per win below), +10 for making the playoffs (−2 for missing them), +5 per playoff round won and +15 for the title.",
          `Secure is 55 or more, warm 40 to 54, hot seat 20 to 39, and below ${FIRE_BELOW} is fired. A playoff drought costs more from the third winless January on, and nobody is fired before their third season with a team.`,
          "A fired GM takes over one of the league's worst teams. CPU GMs are judged on the same kind of score, hired from a pool, and replaced with someone who plays a different style.",
        ],
      },
    ],
  },
  {
    id: "coachingEffects",
    title: "Coaching",
    summary: "What the three coordinators and nine position coaches do.",
    sections: [
      {
        heading: "In a game",
        body: [
          "The head coach, offensive coordinator and defensive coordinator each nudge a few decisions: game management and aggression (fourth downs, the clock), discipline (penalties), the offensive coordinator's pass lean and play-calling, and the defense's blitz tendency. A league-average staff changes nothing.",
        ],
      },
      {
        heading: "Between seasons",
        body: [
          "The nine position coaches never touch a play. They scale how fast their group's players grow, how fast the older ones fall off, and (the medical staff) how long injuries last.",
          `${NEUTRAL_COACH_OVERALL} is neutral. Every point above or below moves growth and decline by 1.5% and recovery time by 1%, the same distance either way, so a bad hire costs what a good one gains. Nothing a coach does changes when a career turns.`,
        ],
      },
    ],
  },
];

/** Which topics each screen shows, by route. */
export const HOW_BY_ROUTE: Record<string, string[]> = {
  "/draft": ["drafts", "unitGrades"],
  "/coaching-draft": ["coachingEffects"],
  "/coaching": ["coachingEffects", "development"],
  "/free-agency": ["freeAgency", "unitGrades"],
  "/free-agency-board": ["freeAgency", "unitGrades"],
  "/free-agency-summary": ["freeAgency"],
  "/trade": ["trades", "tradeValue", "unitGrades"],
  "/trade-deadline": ["trades", "tradeValue", "unitGrades"],
  "/trade-summary": ["trades", "tradeValue"],
  "/training-camp": ["development", "coachingEffects"],
  "/training-camp-results": ["development", "regression"],
  "/retirement": ["regression", "injuries"],
  "/rookie-draft-summary": ["drafts"],
  "/rookie-signings": ["drafts"],
  "/roster": ["unitGrades", "injuries", "recovery"],
  "/hub": ["gameSim", "playoffOdds", "injuries", "recovery", "strategyEffects"],
  "/game-plan": ["strategyEffects", "gameSim"],
  "/game-day": ["gameSim"],
  "/bracket": ["playoffOdds", "strategyEffects", "gameSim"],
  "/hot-seat": ["gmFiring"],
  "/end-of-season": ["awards"],
  "/season-complete": ["awards", "gmFiring"],
  "/league-stats": ["gameSim", "playoffOdds"],
  "/player-stats": ["awards"],
};

export function topicsFor(route: string): HowTopic[] {
  return (HOW_BY_ROUTE[route] ?? [])
    .map((id) => HOW_IT_WORKS.find((t) => t.id === id))
    .filter((t): t is HowTopic => !!t);
}
