import { describe,it,expect } from 'vitest';
import { counterSelectionForViewer } from './decision-view';
describe('counteroffer presentation orientation',()=>{
 it('shows the recipient their own assets without changing the proposer-oriented payload',()=>{
  const gives=['a','pick:2027:1:BAL'],gets=['b'];
  expect(counterSelectionForViewer('BAL','KC',gives,gets)).toEqual({give:gets,get:gives});
  expect(counterSelectionForViewer('BAL','BAL',gives,gets)).toEqual({give:gives,get:gets});
  expect(gives).toEqual(['a','pick:2027:1:BAL']);expect(gets).toEqual(['b']);
 });
});
