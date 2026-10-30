import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {DecisionComparison} from './DecisionWorkspace';
vi.mock('@/motion/level',()=>({useMotionLevel:()=> 'off'}));
describe('departed comparison selections',()=>{
 it('always provides recovery when every compared player has left the available pool',()=>{
  const html=renderToStaticMarkup(createElement(DecisionComparison,{rows:[],ids:['drafted-a','signed-b'],onClear:()=>{}}));
  expect(html).toContain('Clear comparison');
 });
});
import {pruneComparison} from './decision-view';
it('prunes departed IDs and preserves state references when the pool is unchanged',()=>{
 const ids=['a','b'];expect(pruneComparison(ids,[{id:'a'}])).toEqual(['a']);expect(pruneComparison(ids,[])).toEqual([]);expect(pruneComparison(ids,[{id:'a'},{id:'b'}])).toBe(ids);
});
