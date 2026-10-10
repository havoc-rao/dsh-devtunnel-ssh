import test from 'node:test';import assert from 'node:assert/strict';
import {detectCapabilities} from '../lib/capabilities.js';
const sample={apiVersion:1,experimental:true,workspaceSupported:true,freshProbe:true,schemaVersion:3,authModes:['agent','private-key'],productionReady:false,additionalForwards:false,perWorkspaceDisconnect:false};
test('actual status shape yields instance experimental support only',()=>{
 const result=detectCapabilities({sshCarrierCapabilities:sample});assert.equal(result.experimentalWorkspaceSupported,true);assert.equal(result.freshProbe,true);assert.equal(result.productionReady,false);assert.deepEqual(result.authModes,['agent','private-key']);
 const disabled=detectCapabilities({sshCarrierCapabilities:{...sample,workspaceSupported:false}});assert.equal(disabled.experimentalWorkspaceSupported,false);assert.equal(disabled.freshProbe,false);
});
test('missing unknown malformed and getter data never promotes support',()=>{
 for(const status of [undefined,null,{}, {workspaceSupported:true},{sshCarrierCapabilities:{...sample,apiVersion:2}},{sshCarrierCapabilities:{...sample,workspaceSupported:'true'}},{get sshCarrierCapabilities(){throw Error('private');}}])assert.equal(detectCapabilities(status).experimentalWorkspaceSupported,false);
 const invalid={...sample};Object.defineProperty(invalid,'workspaceSupported',{get(){throw Error('private');}});assert.equal(detectCapabilities({sshCarrierCapabilities:invalid}).experimentalWorkspaceSupported,false);
});
test('managed requires precise authenticated runtime opt-in and workspace support',()=>{
 for(const [value,supported,expected] of [[true,true,true],[true,false,false],['true',true,false],[undefined,true,false]]){
  assert.equal(detectCapabilities({sshCarrierCapabilities:{...sample,workspaceSupported:supported,devTunnelManaged:value}}).devTunnelManaged,expected);
 }
 assert.equal(detectCapabilities({}).devTunnelManaged,false);
});
test('future production claim and auth secret fields remain fenced',()=>{
 const result=detectCapabilities({sshCarrierCapabilities:{...sample,productionReady:true,additionalForwards:true,perWorkspaceDisconnect:true,authModes:['agent','token','secret']}});assert.equal(result.productionReady,false);assert.equal(result.additionalForwards,false);assert.deepEqual(result.authModes,['agent']);
});
