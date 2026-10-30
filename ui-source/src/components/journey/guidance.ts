import type {LeagueState, Stage} from '@/domain';
import {currentScreen, displaySeasonFor} from '@/state/stageMachine';
import {stepOf, viewerWeek} from '@/state/reveal';
import {onTheClock as faClock} from '@/state/freeAgencyEvent';
import {coachingOnTheClock} from '@/state/coachingDraft';
import {onTheClock as deadlineClock, pendingFor} from '@/state/tradeDeadline';
import {teamFullName} from '@/data/teams';

export type Connection = 'solo' | 'online' | 'reconnecting' | 'detached';
type Instructions = {next:string; why:string};
const campResults = {next:'Review your changes, then check in to prepare the depth chart.',why:'Camp has already run. Reviewing results never runs it a second time.'};
const reconciliation = {next:'Review signings and reconcile your roster and cap before checking in.',why:'Market limits were suspended during bidding. The summary explains what must be corrected before advancing.'};
const seasonReview = {next:'Review the season and your franchise history, then continue to the hot seat.',why:'The next offseason brings retirements, the rookie draft and another chance to build your team.'};
const CONTENT: Record<Stage,Instructions> = {
 setup:{next:'Choose your team and league settings, then use the readiness control to begin.',why:'Team selection and league settings lock when the league starts. Solo rivals play on this device; online seats belong to other people.'},
 fantasyDraft:{next:'Search the board and draft a player when your team is on the clock.',why:'Build a balanced roster. Snake order reverses each round; straight order does not. After the configured manual picks, staff completes the roster.'},
 fantasyDraftSummary:{next:'Review your drafted roster, then check in for the coaching draft.',why:'Your staff shapes game decisions and player development. Players are already assigned; this is a review.'},
 coachingDraft:{next:'Fill an open coaching role when your team is on the clock.',why:'The head coach and coordinators affect game decisions; position coaches shape development and the medical staff affects recovery.'},
 coachingDraftSummary:{next:'Review your staff, then check in for free agency.',why:'Use the staff summary to understand which groups your coaches help before you make your next decisions.'},
 freeAgency:{next:'Make one offer or pass in each round when it is your turn.',why:'Offers are binding and remain live. Players choose at the end of each round, not when you submit. Reconcile the roster and cap afterward.'},
 freeAgencySummary:reconciliation,
 trainingCamp:{next:'Choose one offensive and one defensive focus, then run training camp.',why:'Your coordinators boost the chosen groups. Repeating a focus weakens its effect. Submitting runs camp once and cannot be undone.'},
 trainingCampResults:campResults,
 hoodedFigureEncounter:{next:'Read your personal offer and decide before preparing the depth chart.',why:'Use the terms on this screen; this is an individual decision before preseason.'},
 coachingHiring:{next:'Review staff vacancies and finish this hiring window before preseason.',why:'This is an older league hiring window. The screen shows its remaining requirements.'},
 preseason:{next:'Review your lineup and game plan, then use the game controls to reveal or simulate the preseason.',why:'Online, results reveal at your own pace. Finish the block before checking in for the next checkpoint.'},
 leagueDevelopments:{next:'Review the league developments, then check in for the regular season.',why:'These are the developments available to your franchise now; no later results are revealed here.'},
 regularSeason:{next:'Review your lineup, view Game Day results and continue through the current block.',why:'The season pauses at the trade deadline before the final run to the playoffs. Game recaps and play-by-play are available from completed results.'},
 tradeDeadline:{next:'Propose, respond or pass when the negotiation is yours to act on.',why:'A counter has a final response. Deadline roster and cap limits are suspended until reconciliation; ordinary trades have different limits.'},
 tradeDeadlineSummary:{next:'Review the trades, then check in for mid-season free agency.',why:'The league completes trading before the five-round market and roster finalization.'},
 midseasonFreeAgency:{next:'Make one offer or pass in each round when it is your turn.',why:'There are five rounds. Offers remain binding and players choose at round end; roster and cap reconciliation follows.'},
 midseasonFreeAgencySummary:reconciliation,
 midseasonDepthChart:{next:'Resolve roster requirements and order the depth chart, then check in for the remaining games.',why:'This is the last roster checkpoint before the rest of the regular season is played.'},
 playoffs:{next:'Follow each playoff round, review its results and continue until the season is complete.',why:'The bracket shows only the results you have revealed. Byes and home field come from seeding; eliminated teams do not return.'},
 endOfSeasonAnnounce:{next:'Continue to your season awards and franchise review.',why:'Finishing the season does not start a new league. Your franchise continues into the offseason.'},
 endOfSeasonWin:seasonReview,
 endOfSeasonConsolation:seasonReview,
 offseasonHotSeat:{next:'Review your job security and any team choice, then continue to retirements.',why:'Follow the screen requirements before continuing your franchise with the next season.'},
 offseasonRetirement:{next:'Review retirements and the draft preview, then check in for the rookie draft.',why:'Plan around players leaving your roster. Annual aging and progression are handled by the game; reloading does not repeat them.'},
 offseasonDraftPrep:{next:'Review your roster needs and draft preview, then check in for the rookie draft.',why:'Scouting projections are estimates. College Grade is not the rookie’s eventual OVR.'},
 offseasonDraft:{next:'Scout the class and select a prospect when your team is on the clock.',why:'Non-playoff teams select first; playoff finish affects the later order. Picks can be traded, and staff handles rounds beyond your manual setting.'},
 offseasonDraftSummary:{next:'Review your selections, then continue to rookie signings.',why:'The drafted prospect is not yet a signed roster player. Review each signing and the roster it will join.'},
 offseasonSignings:{next:'Review each rookie signing, then check in for annual free agency.',why:'Signed rookies join your roster. Releases and later transactions must still meet the game’s existing rules.'},
 offseasonFreeAgency:{next:'Review this saved league’s market and finish the window before the depth chart.',why:'This is a legacy market window. Use its own remaining-day and signing controls rather than the five-round instructions.'},
 offseasonDepthChart:{next:'Resolve roster requirements and set your lineup, then check in for preseason.',why:'Starting the next preseason performs the season rollover where required. You are continuing this franchise, not creating a new league.'},
};

/** Display only: never reads players, raw game results or bracket outcomes. */
export function journeyGuidance(s:LeagueState, connection:Connection) {
 const step=stepOf(s,s.viewerGmId); const screen=currentScreen(s.stage,step);
 let content=CONTENT[s.stage];
 if(s.stage==='setup') content={...content,next:s.config.fantasyDraft?'Choose your team and settings, then check in to begin the fantasy draft.':'Choose your team and settings, then check in to begin the coaching draft.'};
 if(s.stage==='coachingDraftSummary'&&s.config.fantasyDraft) content={...content,next:'Review your staff, then check in for training camp.'};
 if(s.stage==='trainingCamp'&&step==='trainingCampResults') content=campResults;
 const submittedCamp=s.stage==='trainingCamp'&&!!s.trainingCamp?.plans[s.gms.find(g=>g.id===s.viewerGmId)?.teamCode??'']?.submitted;
 if(submittedCamp&&step!=='trainingCampResults') content={next:'Open your completed camp results. If opening failed, retry results without running camp again.',why:campResults.why};
 if(s.stage==='offseasonDraftSummary'&&step==='rookieSignings') content=CONTENT.offseasonSignings;
 let status=submittedCamp&&step!=='trainingCampResults'?'Camp complete — open results':'Your next step';
 const me=s.gms.find(g=>g.id===s.viewerGmId)?.teamCode;
 let clock:string|null|undefined;let turnBased=false;
 if(s.stage==='fantasyDraft'||s.stage==='offseasonDraft'){turnBased=true;clock=s.draft?.pickOrder[s.draft.currentPickIndex];}
 if(s.stage==='coachingDraft'){turnBased=true;clock=coachingOnTheClock(s);}
 if(s.stage==='freeAgency'||s.stage==='midseasonFreeAgency'){turnBased=true;clock=faClock(s);}
 if(s.stage==='tradeDeadline'){turnBased=true;const a=s.tradeDeadline?.active;clock=a?(a.awaiting==='recipient'?a.toTeam:a.fromTeam):deadlineClock(s);}
 if(turnBased) status=me&&((s.stage==='tradeDeadline'&&pendingFor(s,me))||clock===me)?'Your turn':clock?`Waiting for ${teamFullName(clock)}`:'Preparing the next step';
 if(connection==='online'&&s.readiness[s.viewerGmId]){status='Checked in — waiting for the league';content={...content,next:'Wait for the other GMs. Use the waiting room to take back your check-in before the league advances.'};}
 if(connection==='detached'){status='Reconnect before making another move';content={...content,next:'This is a saved online view. Moves are paused until your session reconnects; open Online leagues if you need to sign in again.'};}
 if(connection==='reconnecting'){status='Reconnecting to live updates';content={...content,next:'Live updates may be behind. Review the refreshed league before committing a decision; open Online leagues if your session needs recovery.'};}
 let context=`${displaySeasonFor(s.season,s.stage)} season`;
 if(s.stage==='preseason'||s.stage==='regularSeason'){const week=viewerWeek(s);if(week!==null)context+=` · Week ${week}`;}
 if((s.stage==='freeAgency'||s.stage==='midseasonFreeAgency')&&s.freeAgencyEvent) context+=` · Round ${s.freeAgencyEvent.round}`;
 if((s.stage==='fantasyDraft'||s.stage==='offseasonDraft')&&s.draft?.pickOrder.length) context+=` · Pick ${Math.min(s.draft.currentPickIndex+1,s.draft.pickOrder.length)} of ${s.draft.pickOrder.length}`;
 if(s.stage==='coachingDraft'&&s.coachingDraft?.pickOrder.length) context+=` · Pick ${Math.min(s.coachingDraft.currentPickIndex+1,s.coachingDraft.pickOrder.length)} of ${s.coachingDraft.pickOrder.length}`;
 if(s.stage==='tradeDeadline'&&s.tradeDeadline) context+=` · Round ${s.tradeDeadline.round}`;
 return {title:screen.label,route:screen.route,context,status,...content};
}

/** Short, route-specific explanations; detailed rule topics remain available in the drawer. */
export function quickGuide(route:string,s:LeagueState):string[] {
 const routeTips:Record<string,string[]>={
  '/coaching-draft':['Fill head coach, offensive and defensive coordinators, then the remaining position and medical roles.','Coordinators affect game decisions and camp focuses; position coaches shape development. Read each role’s details before choosing.','The draft advances on accepted hires; staff handles CPU turns. Review the completed staff before checking in.'],
  '/coaching':['Inspect each role and its effects before changing your staff.','Coaching decisions use the existing hiring windows; browsing does not make a hire.','Return to the current phase to continue your franchise.'],
  '/training-camp':['Choose one offensive group and one defensive group. Both are required.','The displayed coordinator strengths are base bonuses; consecutive repeated focuses reduce the effect.','Submitting runs camp once. Review the results, then finalize your depth chart before preseason.'],
  '/training-camp-results':['Review each player’s change from the completed camp.','This is a results screen; reloading or reopening it does not run camp again.','Check in when you have finished reviewing, then prepare the depth chart.'],
  '/trade-deadline':['Take the action offered for your current negotiation: propose, respond, counter or give a final answer.','A counter uses the same assets from each team’s viewpoint; review exactly what you send and receive.','After the deadline summary, use mid-season free agency and reconcile your roster before the next block.'],
  '/roster':['Set active players and depth order, and use the displayed roster and cap requirements.','A disabled progression control explains what must be fixed; browsing finances does not finalize the depth chart.','Use the current-phase link to return to the correct checkpoint.'],
  '/bracket':['Follow the current round and its completed results before continuing.','Seeds determine byes and home field; use the bracket’s actual matchups.','After the final result, continue within this franchise to awards and the offseason.'],
  '/retirement':['Review the players who retired before planning replacements.','Continue through the draft preview and inspect the new class and your roster needs.','Check in when you are ready for the rookie draft; this does not create a new league.'],
  '/rookie-signings':['Review each drafted player and the offered rookie contract.','Sign or release using the available controls; drafting alone is not a completed signing.','Finish the class review before checking in for annual free agency.'],
  '/history':['Choose the season you want to review.','Read its champion, runner-up and awards together; this screen does not advance or reset the franchise.','Return to your current phase when you are ready to continue.'],
  '/schedule':['Choose a completed game to inspect results; upcoming games have no final score.','Online schedules show only the results you have revealed.','Use the current phase’s game controls to progress; opening a schedule entry never plays the game again.'],
  '/game-plan':['Review your team’s strategies and personnel settings.','Changes affect future games where the league still allows them; a played online block is already fixed.','Return to the team hub to reveal results or continue the season.'],
 };
 if(routeTips[route])return routeTips[route]!;
 if(route==='/draft')return s.stage==='offseasonDraft'||s.draft?.mode==='rookie'
  ?['Read College Grade, projected rookie ability and the class scouting information; they are not a guaranteed future rating.','Choose by exact player identity and roster need, then confirm your pick when it is your turn.','Staff handles rounds beyond the league’s manual setting; review the summary and signings afterward.']
  :['Snake order reverses each round; straight order keeps the same order.','Use public ratings, position and roster needs to build a balanced team. CPU selections and staff completion use the existing league rules.','Your configured number of manual picks is followed by staff completion, then the coaching draft.'];
 if(route==='/free-agency') return ['Browse the standing market and open a player’s offer controls to negotiate a signing.','Read the asking terms and cap check; an unavailable signing stays unavailable even while you browse.','This page is separate from the five-round bidding board.'];
 if(route==='/free-agency-board') return ['One offer or pass per turn, across five rounds.','A submitted offer is binding; a player chooses at round end, and losing offers stay live.','Cap and roster limits are reconciled after the market.'];
 if(route==='/trade') return ['Choose a partner and exact assets on both sides, then review the package.','Sending an offer does not mean the other GM accepted it. Check its response and any roster/cap requirement.','Ordinary trading closes after the regular-season deadline and reopens in the offseason. Checkpoint negotiation uses its own rules.'];
 if(route.startsWith('/watch/')) return ['Playback controls move through the saved broadcast; they do not change the outcome.','Watch individual plays or jump ahead at your own pace.','Return to Game Day or the recap to continue franchise progression.'];
 if(route==='/game-day'||route.startsWith('/box/')||route.startsWith('/results/')) return ['Review each completed matchup and open its box score or recap.','Play-by-play describes the saved game; it does not simulate a new result.','Use the screen’s Continue control to return to franchise progression.'];
 if(route==='/setup')return [CONTENT.setup.why,'Fantasy draft on: build player rosters, then draft coaches. Off: keep the starting rosters and begin with coaches.','You can review consequential settings before committing. An optional solo seed restarts setup only.'];
 const g=journeyGuidance(s,'solo');return [g.next,g.why,'The current phase link returns to your personal step; browsing reference screens does not advance the league.'];
}
