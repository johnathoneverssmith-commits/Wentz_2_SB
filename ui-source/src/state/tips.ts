/**
 * A tip for a waiting screen, by where the league is. Every one is something
 * the game actually does, so a GM killing time reads a rule rather than
 * filler.
 */
const BY_STAGE: Record<string, string[]> = {
  fantasyDraft: [
    "If your own clock runs out, your staff drafts the best fit left on your board.",
    "Your manual picks come first; after the last GM has made theirs, the draft finishes itself until every team has a full 53-man roster.",
    "The automatic picks build each roster to the standard shape — three quarterbacks, four running backs, six receivers, one kicker, one punter — so a deep position isn't wasted on a fourth passer.",
  ],
  offseasonDraft: [
    "Star prospects in the draft preview: if your clock runs out, your staff takes your top star still on the board.",
    "Round one is the one that's picked by hand; the other six rounds complete themselves.",
  ],
  coachingDraft: [
    "A position coach develops his own group: a quarterbacks coach grows your quarterbacks, a line coach your tackles, guards and center.",
    "Your coordinators decide how much a training-camp focus is worth, so a good one pays off twice.",
    "The medical staff is the only hire who helps every player: injury recovery for the whole roster.",
  ],
  freeAgency: [
    "Offers are binding and stay live until the player signs. An offer below his asking price can't be accepted, however good the fit.",
    "Each free agent weighs what he cares about — the \"wants\" line on his row. A team that gives him that can beat a bigger offer.",
    "The cap and roster limits are suspended during free agency and enforced afterwards, so you can bid for someone you can't yet fit.",
  ],
  midseasonFreeAgency: [
    "The mid-season market works like the offseason one: one offer or a pass each turn, and offers stay live until the player signs.",
  ],
  tradeDeadline: [
    "At the deadline nothing is checked against the cap or the roster limit — you square it up afterwards.",
    "You get one offer or a pass on your turn, and either way the turn is gone.",
    "A pick traded away is gone for good; the league's value chart prices a first-rounder far above everything after it.",
  ],
  trainingCamp: [
    "Camp is the one place you choose how players develop: one offensive and one defensive focus, and neither can be left blank.",
    "A focus makes that group develop harder and decline less this season; how much depends on your coordinator.",
  ],
  offseasonDepthChart: [
    "\"Auto-reorder by overall\" sets a position's depth chart in one click; set it by hand only where you disagree with the ratings.",
  ],
  preseason: [
    "Preseason games don't count toward the standings, but injuries from them are real.",
    "Watch at your own pace: catching up on results never rushes anyone else in the league.",
  ],
  regularSeason: [
    "Watch at your own pace: catching up on results never rushes anyone else in the league.",
    "The trade deadline comes after week 9; after it, the only moves left are free agents.",
  ],
  playoffs: [
    "The top seed in each conference gets the bye through the wild-card round.",
    "A home team wins a little over half the time on a level field; the Super Bowl is played at a neutral site.",
  ],
  offseasonSignings: [
    "Every drafted rookie must be signed or released before the league can move on.",
  ],
};

const ANY: string[] = [
  "The league moves on together, and you'll be taken to the next stage automatically — you can close this and come back.",
  "Check-ins have no clock; only the draft, the markets and the deadline have turn timers.",
  "The League wire shows what everyone else is doing while you wait.",
  "Roster and Cap, League Rosters and Player Statistics are all open while you wait.",
];

/** The tips that fit this stage, then the ones that fit any. */
export function tipsFor(stage: string): string[] {
  const own = BY_STAGE[stage] ?? (stage.startsWith("midseason") ? (BY_STAGE.midseasonFreeAgency ?? []) : []);
  return [...own, ...ANY];
}
