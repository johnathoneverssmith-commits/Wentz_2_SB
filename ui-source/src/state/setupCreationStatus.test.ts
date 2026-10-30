import {describe,it,expect} from 'vitest';
import {beginSetupCreation,isSetupCreating,subscribeSetupCreation} from './setupCreationStatus';
describe('transient setup initialization status',()=>{
 it('survives subscriber replacement until the actual initialization finishes',()=>{
  const seen:boolean[]=[];const stop=beginSetupCreation();const off=subscribeSetupCreation(()=>seen.push(isSetupCreating()));expect(isSetupCreating()).toBe(true);off();
  const fresh=subscribeSetupCreation(()=>seen.push(isSetupCreating()));expect(isSetupCreating()).toBe(true);stop();expect(isSetupCreating()).toBe(false);expect(seen).toEqual([false]);fresh();
 });
 it('does not unlock until every pending initialization is finished and cleanup is idempotent',()=>{
  const seen:boolean[]=[];const off=subscribeSetupCreation(()=>seen.push(isSetupCreating()));const a=beginSetupCreation();const b=beginSetupCreation();a();a();expect(isSetupCreating()).toBe(true);b();expect(isSetupCreating()).toBe(false);expect(seen).toEqual([true,false]);off();
 });
});

it('does not let a UI observer alter initialization by throwing',()=>{
 const off=subscribeSetupCreation(()=>{throw Error('observer');});let done!:()=>void;expect(()=>{done=beginSetupCreation();}).not.toThrow();expect(()=>done()).not.toThrow();expect(isSetupCreating()).toBe(false);off();
});
