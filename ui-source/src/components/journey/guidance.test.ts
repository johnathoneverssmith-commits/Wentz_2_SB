import {describe,it,expect} from 'vitest';
import {createLeague} from '@/state/seed';
import {STAGE_HOME,currentScreen} from '@/state/stageMachine';
import {emptyReveal,markStep,stepOf} from '@/state/reveal';
import {seasonShape} from '@/state/leagueFormat';
import type {Stage} from '@/domain';
import {journeyGuidance,quickGuide} from './guidance';
const initial=createLeague(4242);
const state=()=>structuredClone(initial);
describe('public franchise guidance',()=>{
 it('covers every real and legacy stage with a return to its canonical screen',()=>{
  for(const stage of Object.keys(STAGE_HOME) as Stage[]){const s=state();s.stage=stage;const g=journeyGuidance(s,'solo');expect(g.title).toBeTruthy();expect(g.next.length).toBeGreaterThan(15);expect(g.route).toBe(currentScreen(stage,stepOf(s,s.viewerGmId)).route);}
 });
 it('distinguishes fantasy and inherited-roster starts and does not promise an immediate season',()=>{
  const s=state();s.config.fantasyDraft=true;expect(journeyGuidance(s,'solo').next).toContain('fantasy draft');s.config.fantasyDraft=false;expect(journeyGuidance(s,'solo').next).toContain('coaching draft');s.stage='coachingDraftSummary';expect(journeyGuidance(s,'solo').next).toContain('free agency');s.config.fantasyDraft=true;expect(journeyGuidance(s,'solo').next).toContain('training camp');
 });
 it('follows personal camp/signings steps without moving league state',()=>{
  const s=state();s.stage='trainingCamp';s.reveal=emptyReveal();markStep(s,s.viewerGmId,'trainingCampResults');expect(journeyGuidance(s,'solo').route).toBe('/training-camp-results');expect(journeyGuidance(s,'solo').next).toContain('depth chart');s.stage='offseasonDraftSummary';markStep(s,s.viewerGmId,'rookieSignings');expect(journeyGuidance(s,'solo').route).toBe('/rookie-signings');
 });
 it('does not call a reconnecting or checked-in GM ready to make another move',()=>{
  const s=state();s.stage='fantasyDraft';expect(journeyGuidance(s,'detached').status).toContain('Reconnect');expect(journeyGuidance(s,'reconnecting').status).toContain('Reconnect');s.readiness[s.viewerGmId]=true;expect(journeyGuidance(s,'online').status).toContain('Checked in');
 });
 it('uses the actual clock owner rather than another GM private information',()=>{
  const s=state();const me=s.gms.find(g=>g.id===s.viewerGmId)!;me.teamCode='BAL';s.stage='fantasyDraft';s.draft={mode:'fantasy',pickOrder:['CIN','BAL'],currentPickIndex:0,results:[],complete:false} as any;
  expect(journeyGuidance(s,'online').status).toContain('Waiting');s.draft!.currentPickIndex=1;expect(journeyGuidance(s,'online').status).toBe('Your turn');
 });
 it('never reads unrevealed games, bracket outcomes or player potential',()=>{
  const s=state();s.stage='playoffs';Object.defineProperty(s,'games',{get:()=>{throw Error('hidden games');}});Object.defineProperty(s,'bracket',{get:()=>{throw Error('hidden bracket');}});Object.defineProperty(s,'players',{get:()=>{throw Error('private ratings');}});expect(journeyGuidance(s,'online').next).toContain('round');
 });
 it('provides different short help for standing signing and five-round bidding',()=>{
  const s=state();expect(quickGuide('/free-agency',s).join(' ')).toContain('sign');expect(quickGuide('/free-agency-board',s).join(' ')).toContain('round');
 });
});

it('uses the league-shaped, viewer-relative week in a humans-only season',()=>{
 const s=state();s.config.leagueFormat='humansOnly';s.teams=Object.fromEntries(Object.entries(s.teams).slice(0,6));s.stage='regularSeason';s.week=1;s.games=[];s.reveal=emptyReveal();s.reveal.regularWeek[s.viewerGmId]=3;
 expect(seasonShape(s).regularSeasonWeeks).not.toBe(18);expect(journeyGuidance(s,'online').context).toContain('Week 4');
});
it('directs a submitted camp without a results marker to opening results, not rerunning camp',()=>{
 const s=state();s.stage='trainingCamp';const gm=s.gms.find(g=>g.id===s.viewerGmId)!;gm.teamCode='BAL';s.trainingCamp={plans:{BAL:{offensiveFocus:'QB',defensiveFocus:'DL',submitted:true}},results:{}};expect(journeyGuidance(s,'online').next).toContain('Open');expect(journeyGuidance(s,'online').next).not.toContain('run training camp');
});
