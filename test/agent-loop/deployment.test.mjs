import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeDeployment } from '../../scripts/authorize-render-deploy.mjs';
const sha='1'.repeat(40);
test('push, PR and default manual runs cannot authorize deployment',()=>{
 for(const eventName of ['push','pull_request','workflow_dispatch'])assert.throws(()=>authorizeDeployment({eventName,ref:'refs/heads/master',requestedSha:sha,runSha:sha,currentMasterSha:sha,authorized:false}));
});
test('deployment authorization binds an explicit request to exact current master',()=>{
 const valid={eventName:'workflow_dispatch',ref:'refs/heads/master',requestedSha:sha,runSha:sha,currentMasterSha:sha,authorized:true};
 assert.equal(authorizeDeployment(valid),sha);
 for(const bad of [{eventName:'push'},{ref:'refs/heads/feature'},{requestedSha:'$(printenv)'},{runSha:'2'.repeat(40)},{currentMasterSha:'2'.repeat(40)}])assert.throws(()=>authorizeDeployment({...valid,...bad}));
});
