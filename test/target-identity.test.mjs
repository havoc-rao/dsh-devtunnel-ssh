import test from 'node:test';import assert from 'node:assert/strict';
import {targetIdentity,createCarrier} from '../lib/core/carrier.js';
const connector={kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}};
test('pure canonical descriptor excludes transient endpoint and managed mode',()=>{
 const identity=targetIdentity(connector);
 assert.equal(identity,targetIdentity({...connector,endpoint:{host:'::1',port:64894}}));
 assert.equal(identity,targetIdentity({kind:'devtunnel',mode:'managed',tunnelId:'fixture.jpe1',remotePort:22}));
 assert.notEqual(identity,targetIdentity({...connector,tunnelId:'fixture.use1'}));
 assert.notEqual(identity,targetIdentity({...connector,remotePort:23}));
 assert.throws(()=>targetIdentity({...connector,targetIdentity:identity}));
 assert.equal(createCarrier().targetIdentity(connector),identity);
});
