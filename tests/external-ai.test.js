import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {AISettings,completionEndpoint} from '../src/ai-settings.js';
import {AIGameService,requestDecision,externalObservation,validateDecision,testObservation,AIError} from '../src/external-ai.js';
import {GameStore} from '../src/store.js';

function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'poker-api-'));t.after(()=>{const absolute=path.resolve(root);assert.ok(absolute.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('poker-api-'));fs.rmSync(absolute,{recursive:true,force:true});});return root;}
async function endpoint(t,handler){const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return `http://127.0.0.1:${server.address().port}/v1`;}
const read=async req=>{let body='';for await(const chunk of req)body+=chunk;return JSON.parse(body);};
function respond(res,action,extra={}){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(action)}}],...extra}));}
const payload=store=>({sessionId:store.session.id,handNumber:store.session.engine.hand.number,eventCount:store.session.engine.hand.events.length});
function game(t,baseUrl='https://example.invalid/v1',options={}){const root=temporary(t),store=new GameStore({root}),settings=new AISettings({root});settings.update({mode:'external',baseUrl,model:'test-model',apiKey:'fake-test-key',timeoutSeconds:5});const service=new AIGameService(store,settings,options);store.dispatch('start',{config:{seats:2}});store.dispatch('action',{...payload(store),action:'call'});return {root,store,settings,service};}

test('settings normalize endpoints, retain secrets only for the same endpoint and never return or store plain keys',t=>{
  const root=temporary(t),secret='example-secret-never-log',adapter={protect:key=>{assert.equal(key,secret);return 'test-ciphertext';},unprotect:value=>{assert.equal(value,'test-ciphertext');return secret;}};
  const settings=new AISettings({root,...adapter});settings.update({mode:'external',baseUrl:'https://example.invalid/v1/',model:'m',apiKey:secret});
  assert.equal(completionEndpoint(settings.config.baseUrl),'https://example.invalid/v1/chat/completions');assert.equal(completionEndpoint('https://example.invalid'),'https://example.invalid/v1/chat/completions');
  assert.equal(completionEndpoint('http://localhost:1234/custom/chat/completions'),'http://localhost:1234/custom/chat/completions');
  assert.equal(settings.preview({apiKey:''}).apiKey,secret);assert.equal(settings.preview({baseUrl:'https://another.invalid/v1'}).apiKey,'');assert.equal(settings.preview({clearKey:true}).apiKey,'');
  assert.ok(!JSON.stringify(settings.public()).includes(secret));assert.ok(!fs.readFileSync(settings.file,'utf8').includes(secret));assert.equal(new AISettings({root,...adapter}).credentials().apiKey,secret);
  const moved=new AISettings({root,protect:adapter.protect,unprotect:()=>{throw new Error('wrong Windows account');}});assert.equal(moved.public().keyNeedsUpdate,true);
  for(const value of ['file:///C:/data','http://remote.invalid/v1','https://u:pw@example.invalid/v1','https://example.invalid/v1?key=secret'])assert.throws(()=>completionEndpoint(value));
  assert.throws(()=>settings.update({timeoutSeconds:0}));
});

test('external observation isolates the acting seat and does not expose hidden cards, deck or other styles',t=>{
  const {store}=game(t),e=store.session.engine,obs=externalObservation(store);
  assert.equal(obs.id,1);assert.deepEqual(obs.hole,e.players[1].hole);assert.equal(obs.players[0].hole,undefined);assert.equal(obs.players[0].style,undefined);assert.equal(obs.deck,undefined);assert.equal(obs.burned,undefined);assert.equal(obs.memories,undefined);
  e.players[0].hole=['2c','2d'];e.hand.deck.reverse();assert.deepEqual(externalObservation(store),obs);
  assert.ok(obs.legal);assert.ok(obs.requestId.endsWith(':1'));
});

test('decision validation preserves betting rules including short all-ins and unopened raise rights',()=>{
  const obs=testObservation();assert.deepEqual(validateDecision({action:'raise',raiseTo:25},obs),{action:'raise',amount:25});assert.throws(()=>validateDecision({action:'call'},obs));
  for(const raiseTo of [0,5,991,1.5,'20',null])assert.throws(()=>validateDecision({action:'raise',raiseTo},obs));
  obs.streetBet=5;Object.assign(obs.legal,{canCheck:false,fullToCall:10,toCall:10,minRaiseTo:30,maxRaiseTo:20});assert.deepEqual(validateDecision({action:'raise',raiseTo:20},obs),{action:'raise',amount:20});assert.throws(()=>validateDecision({action:'raise',raiseTo:19},obs));
  Object.assign(obs.legal,{canRaise:false,canAllIn:false});assert.throws(()=>validateDecision({action:'allin'},obs));assert.throws(()=>validateDecision({action:'raise',raiseTo:20},obs));assert.throws(()=>validateDecision({action:'check'},obs));
});

test('compatible API sends only two stateless messages and validates the model response over HTTP',async t=>{
  let seen;const baseUrl=await endpoint(t,async(req,res)=>{seen={url:req.url,auth:req.headers.authorization,body:await read(req)};respond(res,{action:'raise',raiseTo:25},{usage:{prompt_tokens:120,completion_tokens:16,total_tokens:136}});});
  const result=await requestDecision({baseUrl,model:'chosen-model',apiKey:'fake-test-key',timeoutSeconds:5},testObservation());
  assert.equal(seen.url,'/v1/chat/completions');assert.equal(seen.auth,'Bearer fake-test-key');assert.equal(seen.body.model,'chosen-model');assert.equal(seen.body.stream,false);assert.equal(seen.body.messages.length,2);assert.equal(JSON.parse(seen.body.messages[1].content).requestId,'connection-test');assert.equal(result.decision.amount,25);assert.equal(result.usage.total_tokens,136);
});

test('HTTP errors, invalid JSON, illegal actions and oversize bodies cannot be executed or leak provider text',async t=>{
  let kind='auth';const baseUrl=await endpoint(t,async(req,res)=>{await read(req);if(kind==='auth'){res.statusCode=401;res.end('secret echo fake-test-key');}else if(kind==='json'){res.end('not json');}else if(kind==='action'){respond(res,{action:'raise',raiseTo:999999});}else{res.end('x'.repeat(270000));}});
  const config={baseUrl,model:'m',apiKey:'fake-test-key',timeoutSeconds:5};
  for(const variant of ['auth','json','action','size']){kind=variant;await assert.rejects(requestDecision(config,testObservation()),error=>error instanceof AIError&&!error.message.includes('fake-test-key'));}
});

test('timeout, explicit cancellation and redirect handling bound network work without forwarding keys',async t=>{
  let received=0;const destination=await endpoint(t,(req,res)=>{received++;respond(res,{action:'check'});});
  let redirect=true;const baseUrl=await endpoint(t,async(req,res)=>{await read(req);if(redirect){res.writeHead(302,{Location:destination+'/chat/completions'});res.end();}});
  const config={baseUrl,model:'m',apiKey:'fake-test-key',timeoutSeconds:.04};
  await assert.rejects(requestDecision(config,testObservation()),error=>error.code==='network');assert.equal(received,0);
  redirect=false;await assert.rejects(requestDecision(config,testObservation()),error=>error.code==='timeout');
  const controller=new AbortController(),pending=requestDecision({...config,timeoutSeconds:5},testObservation(),{signal:controller.signal});controller.abort();await assert.rejects(pending,error=>error.code==='cancelled');
});

test('external turns apply once, failures fall back legally and final reports record sources without credentials',async t=>{
  let broken=false;const baseUrl=await endpoint(t,async(req,res)=>{const body=await read(req),obs=JSON.parse(body.messages[1].content);respond(res,broken?{action:'raise',raiseTo:-1}:{action:obs.legal.canCheck?'check':'call'});});
  const {root,store,service}=game(t,baseUrl),e=store.session.engine;
  await service.dispatch('tick',payload(store));assert.equal(e.hand.aiDecisions.at(-1).source,'external');assert.equal(e.hand.actor,null);
  await service.dispatch('tick',payload(store));broken=true;await service.dispatch('tick',payload(store));assert.equal(e.hand.aiDecisions.at(-1).source,'fallback');assert.equal(service.state().ai.lastSource,'fallback');
  const history=JSON.stringify(service.state());assert.ok(!history.includes('fake-test-key'));assert.equal(service.state().session.hand.aiDecisions,undefined);
  await service.dispatch('end',{sessionId:store.session.id});const report=JSON.parse(fs.readFileSync(path.join(root,'日志',store.lastSummary.reports.json),'utf8'));
  assert.ok(report.hands.flatMap(h=>h.aiDecisions??[]).some(d=>d.source==='external'));assert.ok(report.hands.flatMap(h=>h.aiDecisions??[]).some(d=>d.source==='fallback'));assert.ok(!JSON.stringify(report).includes('fake-test-key'));
});

test('duplicate ticks coalesce; changing credentials cancels pending decisions; mode changes wait until leaving',async t=>{
  let resolve,calls=0;const {store,settings,service}=game(t,undefined,{request:()=>{calls++;return new Promise(r=>resolve=r);}}),before=store.session.engine.hand.events.length,body=payload(store);
  const first=service.dispatch('tick',body),duplicate=service.dispatch('tick',body);assert.equal(calls,1);
  await assert.rejects(service.dispatch('ai-settings',{mode:'local'}),/下桌/);
  await service.dispatch('ai-settings',{model:'replacement-model'});resolve({decision:{action:'check'},elapsedMs:10,usage:{}});await Promise.all([first,duplicate]);assert.equal(store.session.engine.hand.events.length,before);assert.equal(settings.config.mode,'external');assert.equal(service.pending,null);
  await service.dispatch('end',{sessionId:store.session.id});await service.dispatch('ai-settings',{mode:'local'});assert.equal(settings.config.mode,'local');assert.equal(calls,1);
});

test('late responses after leaving a table are discarded; test connection uses synthetic data without changing gameplay',async t=>{
  let resolve,seen;const {store,service}=game(t,undefined,{request:(_config,obs)=>{seen=obs;return new Promise(r=>resolve=r);}});
  const pending=service.dispatch('tick',payload(store));await service.dispatch('end',{sessionId:store.session.id});const wallet=store.profile.wallet;resolve({decision:{action:'check'},elapsedMs:0,usage:{}});await pending;assert.equal(store.session,null);assert.equal(store.profile.wallet,wallet);
  const connection=service.dispatch('ai-test',{});assert.equal(seen.requestId,'connection-test');resolve({decision:{action:'check'},elapsedMs:12});assert.deepEqual(await connection,{ok:true,elapsedMs:12,action:'check'});assert.equal(store.profile.wallet,wallet);
});
