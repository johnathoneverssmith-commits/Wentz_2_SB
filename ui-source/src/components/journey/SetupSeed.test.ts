import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {SetupSeed,parseSetupSeed} from './SetupSeed';
import {DEFAULT_CONFIG} from '@/state/seed';
describe('optional setup seed',()=>{
 it('accepts unsigned integer seeds and rejects empty, fractional and unsafe values',()=>{
  expect(parseSetupSeed('0')).toBe(0);expect(parseSetupSeed('4242')).toBe(4242);expect(parseSetupSeed('4294967295')).toBe(4294967295);
  for(const s of ['', '-1','2.5','1e3','4294967296','Infinity'])expect(parseSetupSeed(s)).toBeUndefined();
 });
 it('does not render a restart form for online, detached or running leagues',()=>{
  const html=renderToStaticMarkup(createElement(SetupSeed,{seed:4242,config:DEFAULT_CONFIG,canRestart:false}));expect(html).toContain('4242');expect(html).not.toContain('<form');expect(html).not.toContain('<input');
 });
});
