import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HoldemEngine} from '../src/engine.js';
import {newDeck} from '../src/cards.js';
import {botObservation,chooseBotAction} from '../src/bot.js';
import {classifyExposure,memoryResponse,MEMORY_DECAY,observeShownCards} from '../src/memory.js';
import {GameStore} from '../src/store.js';
function deck(prefix){return [...prefix,...newDeck().filter(c=>!prefix.includes(c))];}
function bluffHand(){
  const e=new HoldemEngine({seats:2,styles:['GRINDER']});
  // HU order: bot, hero, bot, hero; burn, flop. Hero has 72 on KJ4 rainbow.
  e.startHand(deck(['As','7h','Qc','2d','3h','Ks','Jd','4c']));
  e.act(0,'call');e.act(1,'check');e.advance();e.act(1,'check');e.act(0,'raise',20);e.act(1,'fold');return e;
}
function passiveFinish(e){let steps=0;while(e.active){assert.ok(++steps<100);if(e.hand.actor===null)e.advance();else{const l=e.legal();e.act(e.hand.actor,l.canCheck?'check':'call');}}}
test('unshown air bluff is private; voluntary exposure updates each observer exactly once',()=>{
  const e=bluffHand();assert.equal(e.memories[1][0].shownHands,0);assert.equal(e.memories[1][0].bluffWeight,0);
  assert.throws(()=>observeShownCards(e,0),/尚未公开/);
  e.showCards();assert.equal(e.memories[1][0].shownBluffs,1);assert.equal(e.memories[1][0].bluffWeight,.8);
  assert.equal(e.hand.events.at(-1).type,'show');assert.equal(e.hands[0].events.at(-1).type,'show');assert.equal(e.view().hand.canShow,false);
  assert.equal(e.hand.memoryUpdates[0].evidence.kind,'air_bluff');assert.equal(e.hand.memoryUpdates[0].evidence.street,'flop');
  assert.throws(()=>e.showCards(),/已经亮牌/);assert.equal(e.memories[1][0].shownHands,1);
  const restored=HoldemEngine.restore(e.serialize());assert.deepEqual(restored.memories,e.memories);
  e.startHand();assert.throws(()=>e.showCards(),/结算后/);e.act(e.hand.actor,'fold');assert.equal(e.memories[1][0].bluffWeight,.8*MEMORY_DECAY);
  assert.deepEqual(new HoldemEngine().memories,{});
});
test('exposure classification uses the board at the aggressive action, distinguishes draws and value',()=>{
  const action=(board)=>[{type:'action',action:'raise',board,street:board.length===5?'river':'flop',seq:5}];
  assert.equal(classifyExposure(['7h','2d'],action(['Ks','Jd','4c'])).kind,'air_bluff');
  assert.equal(classifyExposure(['Ah','8h'],action(['Kh','4h','2c'])).kind,'draw_bluff');
  assert.equal(classifyExposure(['As','Kd'],action(['Kh','4h','2c'])).kind,'value');
  assert.equal(classifyExposure(['As','2d'],action(['Kh','4h','2c'])),null);
  assert.equal(classifyExposure(['7h','2d'],action(['Ks','Kd','Jc','Jh','Ac'])),null);
  assert.equal(classifyExposure(['7h','2d'],[{...action(['Ks','Jd','4c'])[0]},{action:'call',board:['Ks','Jd','4c','7c','7d']}]).kind,'air_bluff');
});
test('normal showdown teaches public cards; hidden folded cards and actual deck never enter bot observation',()=>{
  const e=new HoldemEngine({seats:3,styles:['TAG','GRINDER']});e.startHand();e.act(0,'fold');passiveFinish(e);
  assert.equal(e.memories[1][0].shownHands,0);assert.equal(e.memories[2][0].shownHands,0);
  assert.equal(e.memories[1][2].shownHands,1);assert.equal(e.memories[2][1].shownHands,1);
  const before=botObservation(e,1);e.players[0].hole=['Ah','Ad'];e.hand.deck.reverse();assert.deepEqual(botObservation(e,1),before);
  e.showCards();assert.equal(e.memories[1][0].shownHands,1);assert.equal(e.memories[2][0].shownHands,1);
});
test('one exposed bluff has bounded style-dependent influence and affects decisions with identical randomness',()=>{
  const e=bluffHand();e.showCards();const m=e.memories[1][0];
  const grinder=memoryResponse('GRINDER',m),nit=memoryResponse('NIT',m);
  assert.ok(grinder.callAdjustment>nit.callAdjustment&&grinder.callAdjustment<.04);
  const obs={id:1,style:'GRINDER',hole:['9h','8d'],stack:900,streetBet:0,board:['Ks','9d','4c','3h','2s'],street:'river',button:0,bb:10,pot:100,legal:{toCall:100,fullToCall:100,eligiblePotAfterCall:200,canCheck:false,canRaise:false},players:[{id:0,folded:false,stats:{hands:1,vpip:1}},{id:1,folded:false,stats:{hands:1,vpip:0}}],actions:[{action:'raise',playerId:0,street:'river'}],memory:{0:{...m,bluffWeight:0}}};
  function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
  let oldCalls=0,newCalls=0;
  for(let odds=.30;odds<=.50;odds+=.025)for(let seed=1;seed<=40;seed++){
    obs.hole=['Ah','8d'];obs.board=['Ks','Jd','4c','3h','2s'];obs.legal.toCall=Math.round(200*odds);obs.legal.fullToCall=obs.legal.toCall;obs.pot=200-obs.legal.toCall;
    const a=chooseBotAction(obs,rng(seed)),b=chooseBotAction({...obs,memory:{0:m}},rng(seed));
    oldCalls+=a.action==='call';newCalls+=b.action==='call';assert.ok(!(a.action==='call'&&b.action==='fold'));
  }
  assert.ok(newCalls>oldCalls,`${newCalls} should exceed ${oldCalls}`);
});
test('live and ended service hide undiscovered types even in replay and reports while preserving cards and memory',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poker-memory-'));
  try{
    const store=new GameStore({root});let state=store.dispatch('start',{config:{seats:2,sb:5,bb:10,buyBB:100,styles:['INVALID']}});
    assert.equal(state.session.players[1].style,'UNKNOWN');assert.equal(state.session.config.styles,undefined);assert.equal(state.session.reports,undefined);
    assert.deepEqual(fs.readdirSync(path.join(root,'日志')),[]);
    store.session.engine=bluffHand();store.session.engine.showCards();store.save();
    const h=store.dispatch('history?hand=1');assert.equal(h.players[1].style,'UNKNOWN');assert.equal(h.hand.memoryUpdates,undefined);assert.equal(h.hand.finalPlayers,undefined);
    const restored=new GameStore({root});assert.deepEqual(restored.session.engine.memories,store.session.engine.memories);
    state=store.dispatch('end',{sessionId:store.session.id});assert.equal(state.lastSummary.opponents[0].style,'UNKNOWN');
    const report=JSON.parse(fs.readFileSync(path.join(root,'日志',state.lastSummary.reports.json),'utf8'));
    assert.equal(report.schemaVersion,'2.2');assert.equal(report.hands[0].events.at(-1).type,'show');assert.equal(report.opponentMemories[1][0].shownBluffs,1);
    assert.equal(store.dispatch('history?hand=1&session='+state.lastSummary.id).players[1].style,'UNKNOWN');assert.equal(report.players[1].style,'UNKNOWN');assert.equal(report.players[1].styleName,undefined);
    assert.throws(()=>store.reportFile('../state.json'),/无效/);
    store.dispatch('start',{config:{seats:2}});assert.deepEqual(store.session.engine.memories,{});
  }finally{const resolved=path.resolve(root);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('poker-memory-'))throw new Error('Unsafe cleanup');fs.rmSync(resolved,{recursive:true,force:true});}
});
