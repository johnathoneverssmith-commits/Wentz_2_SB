import { describe, expect, it } from 'vitest';
import { publicDecisionRow, sortDecisionRows, resolveDecision } from './decision-view';

describe('decision presentation privacy and identity', () => {
 const players = [{id:'a',name:'Same Name',position:'QB',overall:90,age:31,potential:998,trueOverall:997},{id:'b',name:'Same Name',position:'QB',overall:90,age:22,potential:996},{id:'c',name:'Low rated kicker',position:'K',overall:60,age:22}];
 it('projects only public fields, never hidden ceilings or prospect outcomes',()=>{
  expect(publicDecisionRow(players[0]!)).toEqual({id:'a',name:'Same Name',position:'QB',rating:90,ratingLabel:'OVR',age:31,context:undefined});
  expect(JSON.stringify(publicDecisionRow(players[0]!))).not.toMatch(/998|997|potential|trueOverall/);
 });
 it('keeps board order and never sorts the source array in place',()=>{
  const rows=players.map(p=>publicDecisionRow(p)); expect(sortDecisionRows(rows,'board').map(p=>p.id)).toEqual(['a','b','c']);
  expect(sortDecisionRows(rows,'age').map(p=>p.id)).toEqual(['b','c','a']); expect(rows.map(p=>p.id)).toEqual(['a','b','c']);
 });
 it('has stable ties and exact identity despite duplicate names',()=>{
  const rows=players.map(p=>publicDecisionRow(p)); expect(sortDecisionRows(rows,'rating').map(p=>p.id)).toEqual(['a','b','c']);
  expect(resolveDecision(rows,'b',true)?.age).toBe(22);
 });
 it('refuses stale identities or a lost turn',()=>{
  const rows=players.map(p=>publicDecisionRow(p)); expect(resolveDecision(rows,'missing',true)).toBeUndefined(); expect(resolveDecision(rows,'a',false)).toBeUndefined();
 });
 it('retains reachable candidates when filtering before a display limit',()=>{
  const rows=players.map(p=>publicDecisionRow(p)); expect(sortDecisionRows(rows.filter(p=>p.position==='K'),'rating').slice(0,1)[0]?.id).toBe('c');
 });
});
