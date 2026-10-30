import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {TradeColumn} from '@/screens/TradeProposal';
describe('trade asset selection presentation',()=>{
 it('uses native buttons and exact selection identity for players and picks',()=>{
  const html=renderToStaticMarkup(createElement(TradeColumn,{title:'You send',role:'you',roster:[{id:'a',name:'Same Name',position:'QB',overall:80},{id:'b',name:'Same Name',position:'QB',overall:81},{id:'pick:2027:1:BAL',name:'2028 Round 1',position:'PICK',overall:0,badge:'R1'}],selected:['b','pick:2027:1:BAL'],onToggle:()=>{}}));
  expect(html).toMatch(/<button[^>]*data-asset-id="b"[^>]*aria-pressed="true"/);
  expect(html).toContain('data-asset-id="pick:2027:1:BAL"');
 });
});
