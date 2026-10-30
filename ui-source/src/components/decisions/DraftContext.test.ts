import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import { DraftContext } from './DraftContext';
vi.mock('@/motion/level',()=>({useMotionLevel:()=> 'off'}));
describe('draft context',()=>{
 it('shows only drafted-roster context and binds upcoming picks to real team order',()=>{
  const html=renderToStaticMarkup(createElement(DraftContext,{pickOrder:['BAL','KC','BAL'],current:1,recent:[{pickNumber:1,selectedName:'Exact player',teamCode:'BAL'}],roster:[],units:[],mode:'fantasy'}));
  expect(html).toContain('Pick 2');expect(html).toContain('Kansas City');expect(html).toContain('Exact player');expect(html).toContain('Drafted roster only');
 });
});
