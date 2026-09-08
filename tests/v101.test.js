import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HoldemEngine} from '../src/engine.js';
import {chooseBotAction,decisionProfile} from '../src/bot.js';
import {AIGameService,AIError} from '../src/external-ai.js';
import {AISettings} from '../src/ai-settings.js';
import {GameStore} from '../src/store.js';
import {STYLES} from '../src/styles.js';

const turn=store=>({sessionId:store.session.id,handNumber:store.session.engine.hand.number,eventCount:store.session.engine.hand.events.length});
const close=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'afterhours-v101-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};

test('showdown is surfaced to the client with the best five cards',()=>{
  const engine=new HoldemEngine({seats:2,styles:['TAG']});engine.startHand();
  while(engine.active){if(engine.hand.actor===null)engine.advance();else{const legal=engine.legal();engine.act(engine.hand.actor,legal.canCheck?'check':'call');}}
  const hand=engine.view().hand;
  assert.equal(hand.status,'complete');assert.equal(hand.showdown,true);
  assert.ok(hand.results.filter(result=>!result.folded).every(result=>result.rank.cards.length===5));
});

test('normal table ticks keep an all-in flop visible until its runout pause elapses',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'afterhours-allin-pace-'));
  try{
    const store=new GameStore({root});store.dispatch('start',{config:{seats:2}});const e=store.session.engine;
    // Make both stacks finish at the same all-in total after their blinds.
    e.players[0].stack=25;e.players[1].stack=20;e.hand.initialStacks=[30,30];
    e.act(0,'allin');e.act(1,'allin');e.advance();assert.equal(e.hand.street,'flop');
    const body=turn(store),before=e.hand.board.length;store.dispatch('tick',body);assert.equal(e.hand.board.length,before);
    e.hand.runoutNextAt=Date.now()-1;store.dispatch('tick',turn(store));assert.equal(e.hand.street,'turn');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('weak cards do not defend repeated preflop raises just because a style is aggressive',()=>{
  const observation={id:1,style:'MANIAC',level:.32,hole:['7h','2d'],stack:1000,streetBet:10,board:[],street:'preflop',button:0,bb:10,pot:70,legal:{canCheck:false,canRaise:true,canAllIn:true,toCall:50,fullToCall:50,eligiblePotAfterCall:120,minRaiseTo:130,maxRaiseTo:1000},memory:{},players:[{id:0,stack:1000,folded:false,allIn:false,stats:{}},{id:1,stack:1000,folded:false,allIn:false,stats:{}}],actions:[{playerId:0,action:'raise',street:'preflop'},{playerId:0,action:'raise',street:'preflop'}]};
  for(const random of [()=>0,()=>.5,()=>.999])assert.deepEqual(chooseBotAction(observation,random),{action:'fold'});
});

test('player styles are pulled toward the middle and a preflop raiser c-bets a favorable flop',()=>{
  for(const style of Object.values(STYLES)){assert.ok(style.looseness>=.20&&style.looseness<=.67);assert.ok(style.aggression>=.42&&style.aggression<=.72);assert.ok(style.bluff>=.025&&style.bluff<=.20);}
  const observation={id:1,style:'TP',level:.7,hole:['As','Kd'],stack:990,streetBet:0,board:['7h','3c','2d'],street:'flop',button:0,bb:10,pot:60,legal:{canCheck:true,canRaise:true,canAllIn:true,toCall:0,fullToCall:0,eligiblePotAfterCall:60,minRaiseTo:20,maxRaiseTo:990},memory:{},players:[{id:0,stack:990,folded:false,allIn:false,stats:{}},{id:1,stack:990,folded:false,allIn:false,stats:{}}],actions:[{playerId:1,action:'raise',street:'preflop',raiseTo:30}]};
  const profile=decisionProfile(observation),decision=chooseBotAction(observation,()=>.5);
  assert.ok(profile.aggression>=.32&&profile.aggression<=.76);assert.equal(decision.action,'raise');assert.ok(decision.amount>=observation.legal.minRaiseTo);
});

test('a limped multiway pot still value-bets a dry-board top pair for protection',()=>{
  const observation={id:4,style:'TAG',level:.7,hole:['Kh','9d'],stack:14900,streetBet:0,board:['5d','7h','Kc'],street:'flop',button:1,bb:200,pot:1200,memory:{},actions:[{playerId:4,action:'call',street:'preflop'},{playerId:3,action:'call',street:'preflop'},{playerId:2,action:'call',street:'preflop'},{playerId:1,action:'call',street:'preflop'}],legal:{canCheck:true,canRaise:true,canAllIn:true,toCall:0,fullToCall:0,eligiblePotAfterCall:1200,minRaiseTo:400,maxRaiseTo:14900},players:[0,1,2,3,4,6].map(id=>({id,stack:id===0?9800:14900,folded:false,allIn:false,status:'active',stats:{hands:20,vpip:8,pfr:3}}))};
  const decision=chooseBotAction(observation,()=>.5);
  assert.equal(decision.action,'raise');assert.ok(decision.amount>=observation.legal.minRaiseTo);
});

test('compact review includes a redacted snapshot of the current live hand',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'afterhours-compact-live-'));
  try{
    const store=new GameStore({root});store.dispatch('start',{config:{seats:2}});const compact=store.dispatch('compact-history?hand=1');
    assert.equal(compact.hand.compactLive,true);assert.equal(compact.hand.deck,undefined);assert.equal(compact.hand.results.length,2);assert.equal(compact.hand.results.find(result=>result.playerId===0).hole.length,2);assert.deepEqual(compact.hand.results.find(result=>result.playerId===1).hole,[]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
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

test('quick fold follows the current preflop hand when a local table advances between click and dispatch',async t=>{
  const root=close(t),store=new GameStore({root}),settings=new AISettings({root});settings.update({mode:'local'});
  const service=new AIGameService(store,settings);store.dispatch('start',{config:{seats:3}});const engine=store.session.engine,staleTurn=turn(store);
  while(engine.active){if(engine.hand.actor===null)engine.advance();else{const legal=engine.legal();engine.act(engine.hand.actor,legal.canCheck?'check':'call');}}
  engine.startHand();const currentHand=engine.hand.number;assert.ok(engine.hand.pending.includes(0));
  const result=await service.dispatch('action',{...staleTurn,action:'fold',fastFold:true});
  assert.equal(result.session.hand.number,currentHand);assert.equal(result.session.players[0].folded,true);assert.equal(result.session.hand.status,'complete');
});

test('direct quick fold also refreshes a stale rendered hand revision',t=>{
  const root=close(t),store=new GameStore({root});
  store.dispatch('start',{config:{seats:3}});const engine=store.session.engine,staleTurn=turn(store);
  while(engine.active){if(engine.hand.actor===null)engine.advance();else{const legal=engine.legal();engine.act(engine.hand.actor,legal.canCheck?'check':'call');}}
  engine.startHand();const currentHand=engine.hand.number;
  const result=store.dispatch('action',{...staleTurn,action:'fold',fastFold:true});
  assert.equal(result.session.hand.number,currentHand);
  assert.equal(result.session.players[0].folded,true);
  assert.equal(result.session.hand.status,'complete');
});

test('an API client that ignores cancellation still yields the turn to the local strategy',async t=>{
  const root=close(t),store=new GameStore({root}),settings=new AISettings({root});settings.update({mode:'external',baseUrl:'https://example.invalid/v1',model:'test',apiKey:'test-key'});
  const service=new AIGameService(store,settings,{useLocalRules:false,actionWindowMs:5,request:()=>new Promise(()=>{})});
  store.dispatch('start',{config:{seats:2}});store.dispatch('action',{...turn(store),action:'call'});
  await service.dispatch('tick',turn(store));
  const decision=store.session.engine.hand.aiDecisions.at(-1);
  assert.equal(decision.source,'fallback');assert.equal(decision.errorCode,'action_window');
});
