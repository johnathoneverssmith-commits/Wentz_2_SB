import test from 'node:test';
import assert from 'node:assert/strict';
import { emergencyPause } from '../../scripts/agent-loop/control.mjs';
test('authenticated human stop works without valid execution approval',async()=>{
 const operations=[],client={verifyHuman:async actor=>{if(actor!=='owner')throw new Error('Unauthorized');operations.push('human');},recordEmergencyPause:async()=>operations.push('state')},broker={pause:async()=>operations.push('stop')};
 await emergencyPause(client,broker,{actor:'owner',id:'human-stop',at:1000});assert.deepEqual(operations,['human','stop','state']);
 await assert.rejects(emergencyPause(client,broker,{actor:'bot',id:'bad',at:1000}));assert.equal(operations.length,3);
});
