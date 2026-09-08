import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HoldemEngine} from '../src/engine.js';
import {chooseBotAction} from '../src/bot.js';
import {AIGameService,AIError} from '../src/external-ai.js';
import {AISettings} from '../src/ai-settings.js';
import {GameStore} from '../src/store.js';

const turn=store=>({sessionId:store.session.id,handNumber:store.session.engine.hand.number,eventCount:store.session.engine.hand.events.length});
const close=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'afterhours-v101-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};

test('showdown is surfaced to the client with the best five cards',()=>{
  const engine=new HoldemEngine({seats:2,styles:['TAG']});engine.startHand();
  while(engine.active){if(engine.hand.actor===null)engine.advance();else{const legal=engine.legal();engine.act(engine.hand.actor,legal.canCheck?'check':'call');}}
  const hand=engine.view().hand;
  assert.equal(hand.status,'complete');assert.equal(hand.showdown,true);
  assert.ok(hand.results.filter(result=>!result.folded).every(result=>result.rank.cards.length===5));
});

test('weak cards do not defend repeated preflop raises just because a style is aggressive',()=>{
  const observation={id:1,style:'MANIAC',level:.32,hole:['7h','2d'],stack:1000,streetBet:10,board:[],street:'preflop',button:0,bb:10,pot:70,legal:{canCheck:false,canRaise:true,canAllIn:true,toCall:50,fullToCall:50,eligiblePotAfterCall:120,minRaiseTo:130,maxRaiseTo:1000},memory:{},players:[{id:0,stack:1000,folded:false,allIn:false,stats:{}},{id:1,stack:1000,folded:false,allIn:false,stats:{}}],actions:[{playerId:0,action:'raise',street:'preflop'},{playerId:0,action:'raise',street:'preflop'}]};
  for(const random of [()=>0,()=>.5,()=>.999])assert.deepEqual(chooseBotAction(observation,random),{action:'fold'});
});

test('fast fold cancels a pending external decision and settles without waiting for the API',async t=>{
  const root=close(t),store=new GameStore({root}),settings=new AISettings({root});settings.update({mode:'external',baseUrl:'https://example.invalid/v1',model:'test',apiKey:'test-key',timeoutSeconds:30});
  let started=false;const service=new AIGameService(store,settings,{useLocalRules:false,request:(_config,_observation,{signal})=>new Promise((resolve,reject)=>{started=true;signal.addEventListener('abort',()=>reject(new AIError('cancelled','cancelled')),{once:true});})});
  store.dispatch('start',{config:{seats:5}});const engine=store.session.engine;while(engine.active){if(engine.hand.actor===null)engine.advance();else{const legal=engine.legal();engine.act(engine.hand.actor,legal.canCheck?'check':'call');}}engine.startHand();assert.notEqual(engine.hand.actor,0);assert.ok(engine.hand.pending.includes(0));const pending=service.dispatch('tick',turn(store));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);
  const stale={...turn(store),eventCount:turn(store).eventCount-1};
  const result=await service.dispatch('action',{...stale,action:'fold',fastFold:true});
  assert.equal(result.session.hand.status,'complete');assert.equal(result.session.players[0].folded,true);
  await pending;assert.ok((store.session.engine.hand.aiDecisions??[]).every(decision=>decision.source!=='external'));
});

test('an API client that ignores cancellation still yields the turn to the local strategy',async t=>{
  const root=close(t),store=new GameStore({root}),settings=new AISettings({root});settings.update({mode:'external',baseUrl:'https://example.invalid/v1',model:'test',apiKey:'test-key'});
  const service=new AIGameService(store,settings,{useLocalRules:false,actionWindowMs:5,request:()=>new Promise(()=>{})});
  store.dispatch('start',{config:{seats:2}});store.dispatch('action',{...turn(store),action:'call'});
  await service.dispatch('tick',turn(store));
  const decision=store.session.engine.hand.aiDecisions.at(-1);
  assert.equal(decision.source,'fallback');assert.equal(decision.errorCode,'action_window');
});
