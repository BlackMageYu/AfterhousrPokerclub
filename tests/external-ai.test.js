import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {AISettings,completionEndpoint} from '../src/ai-settings.js';
import {AIGameService,requestDecision,externalObservation,compactExternalObservation,decisionEffort,localRuleDecision,reviewExternalDecision,validateDecision,testObservation,aiActionWindowMs,BOT_ACTION_WINDOW_MS,ALL_IN_CALL_WINDOW_MS,AIError} from '../src/external-ai.js';
import {GameStore} from '../src/store.js';

function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'poker-api-'));t.after(()=>{const absolute=path.resolve(root);assert.ok(absolute.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('poker-api-'));fs.rmSync(absolute,{recursive:true,force:true});});return root;}
async function endpoint(t,handler){const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return `http://127.0.0.1:${server.address().port}/v1`;}
const read=async req=>{let body='';for await(const chunk of req)body+=chunk;return JSON.parse(body);};
function respond(res,action,extra={}){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(action)}}],...extra}));}
const payload=store=>({sessionId:store.session.id,handNumber:store.session.engine.hand.number,eventCount:store.session.engine.hand.events.length});
function game(t,baseUrl='https://example.invalid/v1',options={}){const root=temporary(t),store=new GameStore({root}),settings=new AISettings({root});settings.update({mode:'external',baseUrl,model:'test-model',apiKey:'fake-test-key',timeoutSeconds:5});const service=new AIGameService(store,settings,{useLocalRules:false,...options});store.dispatch('start',{config:{seats:2}});store.dispatch('action',{...payload(store),action:'call'});return {root,store,settings,service};}

test('settings normalize endpoints, retain secrets only for the same endpoint and never return or store plain keys',t=>{
  const root=temporary(t),secret='example-secret-never-log',adapter={protect:key=>{assert.equal(key,secret);return 'test-ciphertext';},unprotect:value=>{assert.equal(value,'test-ciphertext');return secret;}};
  const settings=new AISettings({root,...adapter});settings.update({mode:'external',baseUrl:'https://example.invalid/v1/',model:'m',apiKey:secret});
  assert.equal(settings.config.timeoutSeconds,20);
  assert.equal(completionEndpoint(settings.config.baseUrl),'https://example.invalid/v1/chat/completions');assert.equal(completionEndpoint('https://example.invalid'),'https://example.invalid/v1/chat/completions');
  assert.equal(completionEndpoint('http://localhost:1234/custom/chat/completions'),'http://localhost:1234/custom/chat/completions');
  assert.equal(settings.preview({apiKey:''}).apiKey,secret);assert.equal(settings.preview({baseUrl:'https://another.invalid/v1'}).apiKey,'');assert.equal(settings.preview({clearKey:true}).apiKey,'');
  assert.ok(!JSON.stringify(settings.public()).includes(secret));assert.ok(!fs.readFileSync(settings.file,'utf8').includes(secret));assert.equal(new AISettings({root,...adapter}).credentials().apiKey,secret);
  const moved=new AISettings({root,protect:adapter.protect,unprotect:()=>{throw new Error('wrong Windows account');}});assert.equal(moved.public().keyNeedsUpdate,true);
  for(const value of ['file:///C:/data','http://remote.invalid/v1','https://u:pw@example.invalid/v1','https://example.invalid/v1?key=secret'])assert.throws(()=>completionEndpoint(value));
  assert.throws(()=>settings.update({timeoutSeconds:0}));
});

test('only a call facing an all-in receives the extended forty-second AI window',()=>{
  const ordinary={...testObservation(),legal:{...testObservation().legal,toCall:10,fullToCall:10}};
  const allIn={...ordinary,players:ordinary.players.map(player=>player.id===0?{...player,allIn:true}:player)};
  assert.equal(aiActionWindowMs(ordinary),BOT_ACTION_WINDOW_MS);
  assert.equal(aiActionWindowMs(allIn),ALL_IN_CALL_WINDOW_MS);
  assert.equal(aiActionWindowMs({...allIn,legal:{...allIn.legal,toCall:0}}),BOT_ACTION_WINDOW_MS);
});

test('external observation isolates the acting seat and does not expose hidden cards, deck or other styles',t=>{
  const {store}=game(t),e=store.session.engine,obs=externalObservation(store);
  assert.equal(obs.id,1);assert.deepEqual(obs.hole,e.players[1].hole);assert.equal(obs.players[0].hole,undefined);assert.equal(obs.players[0].style,undefined);assert.equal(obs.deck,undefined);assert.equal(obs.burned,undefined);assert.equal(obs.memories,undefined);
  e.players[0].hole=['2c','2d'];e.hand.deck.reverse();assert.deepEqual(externalObservation(store),obs);
  assert.ok(obs.legal);assert.ok(obs.requestId.endsWith(':1'));
});

test('external prompt is compact and reserves thinking effort for stack-committing decisions',()=>{
  const low={...testObservation(),importantHands:[{handNumber:4,potBB:126,showdown:false,players:[{playerId:0,won:true,aggressive:true,allIn:false,voluntaryShow:true,showTag:'air_bluff'}]}]},compact=compactExternalObservation(low);
  assert.equal(decisionEffort(low),'none');assert.equal(compact.reasoningEffort,'none');assert.equal(compact.character,undefined);assert.equal(compact.playerCard,undefined);assert.equal(compact.players[0].hole,undefined);
  assert.ok(compact.actor.postflopInitiative>=.32&&compact.actor.postflopInitiative<=.76);assert.ok(compact.actor.bluffFrequency>=.018&&compact.actor.bluffFrequency<=.19);
  assert.equal(compact.strategy.position,'heads_up');assert.equal(compact.strategy.boardTexture,'dry');assert.equal(compact.strategy.preflopInitiative,false);
  assert.deepEqual(compact.draw,{active:false,kinds:[],outs:0,flushOuts:0,straightOuts:0,nextCardChance:0});
  assert.deepEqual(compact.tableImage,[{handNumber:4,potBB:126,showdown:false,players:[{id:0,won:true,aggressive:true,allIn:false,voluntaryShow:true,showTag:'air_bluff'}]}]);
  assert.equal(decisionEffort({...low,street:'river'}),'none');assert.equal(decisionEffort({...low,legal:{...low.legal,toCall:20},pot:20}),'none');assert.equal(decisionEffort({...low,legal:{...low.legal,toCall:500},stack:900}),'high');
  assert.equal(localRuleDecision(low,()=>.5),null,'postflop free actions must reach the AI instead of being forced checks');
  assert.equal(localRuleDecision({...low,street:'preflop'},()=>.5).reason,'free-preflop-check');
});

test('a decisive river value hand receives deliberate reasoning and cannot silently check away value',()=>{
  const base=testObservation(),observation={...base,street:'river',bb:200,pot:7700,stack:19808,hole:['Ah','Th'],board:['4c','As','7h','Ac','5d'],actions:[{playerId:0,street:'preflop',action:'raise',amount:800,raiseTo:800},{playerId:1,street:'preflop',action:'call',amount:800},{playerId:1,street:'turn',action:'raise',amount:1400,raiseTo:1400},{playerId:0,street:'turn',action:'call',amount:1400}],legal:{...base.legal,canCheck:true,canRaise:true,canAllIn:true,toCall:0,fullToCall:0,minRaiseTo:800,maxRaiseTo:19808}};
  const compact=compactExternalObservation(observation),review=reviewExternalDecision(observation,{action:'check'});
  assert.equal(decisionEffort(observation),'high');assert.equal(compact.reasoningEffort,'high');
  assert.deepEqual(review.decision,{action:'raise',amount:3619});assert.equal(review.guard.kind,'river-strong-value-check-override');assert.equal(review.guard.madeHand,'trips');
  const unsafe={...observation,board:['4s','As','7s','Ac','5s']};assert.deepEqual(reviewExternalDecision(unsafe,{action:'check'}),{decision:{action:'check'},guard:null},'four-flush boards retain the model-selected check');
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
  assert.equal(seen.url,'/v1/chat/completions');assert.equal(seen.auth,'Bearer fake-test-key');assert.equal(seen.body.model,'chosen-model');assert.equal(seen.body.stream,false);assert.equal(seen.body.temperature,.15);assert.equal(seen.body.max_tokens,48);assert.deepEqual(seen.body.response_format,{type:'json_object'});assert.deepEqual(seen.body.thinking,{type:'disabled'});assert.equal(seen.body.reasoning_effort,undefined);assert.equal(seen.body.messages.length,2);const prompt=JSON.parse(seen.body.messages[1].content);assert.equal(prompt.requestId,'connection-test');assert.equal(prompt.character,undefined);assert.equal(prompt.opponentRanges[0].position,'heads_up');assert.equal(result.decision.amount,25);assert.equal(result.usage.total_tokens,136);
});

test('turn decisions facing pot-sized pressure use deliberate reasoning',async t=>{
  let seen;const baseUrl=await endpoint(t,async(req,res)=>{seen={body:await read(req)};respond(res,{action:'call'});});
  const observation={...testObservation(),street:'turn',board:['2h','7c','Ts','Jd'],legal:{...testObservation().legal,canCheck:false,toCall:20,fullToCall:20,minRaiseTo:40,maxRaiseTo:990}};
  await requestDecision({baseUrl,model:'chosen-model',apiKey:'fake-test-key',timeoutSeconds:5},observation);
  assert.deepEqual(seen.body.thinking,{type:'enabled'});assert.equal(seen.body.reasoning_effort,'high');assert.equal(seen.body.max_tokens,1024);assert.deepEqual(seen.body.response_format,{type:'json_object'});
});

test('all-in and stack-commitment decisions enable high-effort reasoning with a JSON final answer',async t=>{
  let seen;const baseUrl=await endpoint(t,async(req,res)=>{seen={body:await read(req)};respond(res,{action:'call'});});
  const observation={...testObservation(),street:'river',board:['2h','7c','Ts','Jd','Qh'],stack:900,legal:{...testObservation().legal,canCheck:false,toCall:500,fullToCall:500,minRaiseTo:1000,maxRaiseTo:900}};
  await requestDecision({baseUrl,model:'chosen-model',apiKey:'fake-test-key',timeoutSeconds:5},observation);
  assert.deepEqual(seen.body.thinking,{type:'enabled'});assert.equal(seen.body.reasoning_effort,'high');assert.equal(seen.body.max_tokens,1024);assert.equal(seen.body.temperature,undefined);assert.deepEqual(seen.body.response_format,{type:'json_object'});
  assert.equal(JSON.parse(seen.body.messages[1].content).reasoningEffort,'high');
});

test('an empty high-reasoning final retries once in JSON-only mode without recording private reasoning',async t=>{
  const seen=[];const baseUrl=await endpoint(t,async(req,res)=>{const body=await read(req);seen.push(body);res.setHeader('Content-Type','application/json');if(seen.length===1){res.end(JSON.stringify({choices:[{finish_reason:'length',message:{content:'',reasoning_content:'private chain fake-test-key'}}],usage:{prompt_tokens:100,completion_tokens:1024,total_tokens:1124}}));return;}respond(res,{action:'fold'},{usage:{prompt_tokens:90,completion_tokens:5,total_tokens:95}});});
  const observation={...testObservation(),street:'river',board:['2h','7c','Ts','Jd','Qh'],stack:900,legal:{...testObservation().legal,canCheck:false,toCall:500,fullToCall:500,minRaiseTo:1000,maxRaiseTo:900}};
  const result=await requestDecision({baseUrl,model:'chosen-model',apiKey:'fake-test-key',timeoutSeconds:5},observation);
  assert.equal(seen.length,2);assert.deepEqual(seen[0].thinking,{type:'enabled'});assert.equal(seen[0].max_tokens,1024);assert.deepEqual(seen[1].thinking,{type:'disabled'});assert.equal(seen[1].reasoning_effort,undefined);assert.equal(seen[1].max_tokens,48);
  assert.equal(result.decision.action,'fold');assert.equal(result.recovery.kind,'empty-final-retry');assert.equal(result.recovery.initialResponse.finishReason,'length');assert.equal(result.recovery.initialResponse.hasReasoningContent,true);assert.equal(result.recovery.initialResponse.reasoningLength,27);assert.equal(result.usage.total_tokens,1219);assert.ok(!JSON.stringify(result).includes('private chain'));assert.ok(!JSON.stringify(result).includes('fake-test-key'));
});

test('HTTP errors, invalid JSON, illegal actions and oversize bodies cannot be executed or leak provider text',async t=>{
  let kind='auth';const baseUrl=await endpoint(t,async(req,res)=>{await read(req);if(kind==='auth'){res.statusCode=401;res.end('secret echo fake-test-key');}else if(kind==='json'){res.end('not json');}else if(kind==='action'){respond(res,{action:'raise',raiseTo:999999});}else{res.end('x'.repeat(270000));}});
  const config={baseUrl,model:'m',apiKey:'fake-test-key',timeoutSeconds:5};
  for(const variant of ['auth','json','action','size']){kind=variant;await assert.rejects(requestDecision(config,testObservation()),error=>error instanceof AIError&&!error.message.includes('fake-test-key'));}
});

test('syntax-invalid model content is redacted and retained in JSON and Markdown diagnostics',async t=>{
  const raw='I will fold now.\n{"action":"fold"}\napiKey=fake-test-key';
  const baseUrl=await endpoint(t,async(req,res)=>{await read(req);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:raw}}]}));});
  const {root,store,service}=game(t,baseUrl),e=store.session.engine;
  await service.dispatch('tick',payload(store));const decision=e.hand.aiDecisions.at(-1);
  assert.equal(decision.source,'fallback');assert.equal(decision.errorCode,'invalid_response');assert.equal(decision.responseDiagnostic.originalLength,raw.length);assert.equal(decision.responseDiagnostic.truncated,false);assert.equal(decision.responseDiagnostic.redacted,true);assert.ok(decision.responseDiagnostic.content.includes('apiKey=[REDACTED]'));assert.ok(!decision.responseDiagnostic.content.includes('fake-test-key'));
  await service.dispatch('end',{sessionId:store.session.id});const json=JSON.parse(fs.readFileSync(path.join(root,'日志',store.lastSummary.reports.json),'utf8')),markdown=fs.readFileSync(path.join(root,'日志',store.lastSummary.reports.markdown),'utf8');
  const reported=json.hands.flatMap(hand=>hand.aiDecisions??[]).find(entry=>entry.errorCode==='invalid_response');assert.equal(reported.responseDiagnostic.content,decision.responseDiagnostic.content);assert.ok(markdown.includes('无法解析的 AI 原始响应（诊断）'));assert.ok(markdown.includes('apiKey=[REDACTED]'));assert.ok(!JSON.stringify(json).includes('fake-test-key'));assert.ok(!markdown.includes('fake-test-key'));
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
  await service.dispatch('tick',payload(store));broken=true;await service.dispatch('tick',payload(store));assert.equal(e.hand.aiDecisions.at(-1).source,'fallback');assert.equal(service.state().ai.lastSource,'fallback');assert.equal(e.players.find(player=>player.localManaged)?.localManaged,'本地托管');assert.equal(service.state().session.players.find(player=>player.localManaged)?.localManaged,'本地托管');
  const history=JSON.stringify(service.state());assert.ok(!history.includes('fake-test-key'));assert.equal(service.state().session.hand.aiDecisions,undefined);
  await service.dispatch('end',{sessionId:store.session.id});const report=JSON.parse(fs.readFileSync(path.join(root,'日志',store.lastSummary.reports.json),'utf8'));
  assert.ok(report.hands.flatMap(h=>h.aiDecisions??[]).some(d=>d.source==='external'));assert.ok(report.hands.flatMap(h=>h.aiDecisions??[]).some(d=>d.source==='fallback'));assert.ok(!JSON.stringify(report).includes('fake-test-key'));
});

test('a slow external turn is locally managed at the twenty-second action window',async t=>{
  const slow=(_config,_observation,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new AIError('cancelled','cancelled')),{once:true}));
  const {store,service}=game(t,undefined,{request:slow,actionWindowMs:5}),e=store.session.engine;
  await service.dispatch('tick',payload(store));const decision=[...e.hands,e.hand].flatMap(hand=>hand.aiDecisions??[]).at(-1);
  assert.equal(decision.source,'fallback');assert.equal(decision.errorCode,'action_window');assert.equal(e.players[decision.playerId].localManaged,'本地托管');
});

test('check and ordinary preflop entries bypass the provider through local rules',async t=>{
  let calls=0;const {store,service}=game(t,undefined,{useLocalRules:true,request:()=>{calls++;throw new Error('provider should not be called');}}),e=store.session.engine;
  await service.dispatch('tick',payload(store));assert.equal(calls,0);assert.equal(e.hand.aiDecisions.at(-1).source,'local-rule');assert.equal(service.state().ai.lastSource,'local-rule');
});

test('a postflop free action reaches the provider and can make a continuation bet',async t=>{
  let seen;const {store,service}=game(t,undefined,{useLocalRules:true,request:(_config,observation)=>{seen=observation;return {decision:{action:'raise',amount:observation.legal.minRaiseTo},elapsedMs:1,usage:{}};}}),e=store.session.engine;
  await service.dispatch('tick',payload(store)); // preflop big-blind check stays local
  await service.dispatch('tick',payload(store)); // advance to flop
  assert.equal(e.hand.street,'flop');assert.equal(e.hand.actor,1);
  await service.dispatch('tick',payload(store));
  assert.equal(seen.street,'flop');assert.equal(e.hand.aiDecisions.at(-1).source,'external');assert.equal(e.hand.events.at(-1).action,'raise');
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
