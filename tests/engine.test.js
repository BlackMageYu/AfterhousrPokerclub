import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HoldemEngine,PLAYER_ACTION_TIME_MS,ACTION_EXTENSION_MS} from '../src/engine.js';
import {newDeck,evaluate} from '../src/cards.js';
import {botObservation,chooseBotAction,chooseBotTiming,decisionContext,drawProfile,importantHandContext} from '../src/bot.js';
import {GameStore} from '../src/store.js';
import {STYLES} from '../src/styles.js';
import {buildReport} from '../src/report.js';
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const make=(seats=2)=>new HoldemEngine({seats},{random:rng(123)});
function finish(e) {let steps=0;while(e.active){if(++steps>200)throw new Error('Hand stalled');if(e.hand.actor==null)e.advance();else{const id=e.hand.actor,l=e.legal(id);e.act(id,l.canCheck?'check':'call');}}}
function setTestStacks(e,stacks) {for(const [id,total] of Object.entries(stacks)){const p=e.players[id];p.stack=total-p.streetBet;p.totalBuyIn=total;p.allIn=p.stack===0;e.hand.initialStacks[id]=total;}}
function deckFor(holes,board,burned=['2c','3c','4c']) {
  const seats=holes.length,order=Array.from({length:seats},(_,i)=>(seats-3-i+seats*2)%seats),used=[];
  for(let i=0;i<2;i++)for(const id of order)used.push(holes[id][i]);
  used.push(burned[0],...board.slice(0,3),burned[1],board[3],burned[2],board[4]);
  assert.equal(new Set(used).size,used.length);return [...used,...newDeck().filter(c=>!used.includes(c))];
}

test('hand categories, kickers, wheel, double trips, board plays',()=>{
  const cases=[['As Ks Qs Js Ts 2h 3d',8,'皇家同花顺'],['9h 8h 7h 6h 5h Ac Ad',8,'同花顺'],['As Ah Ad Ac Kd 2s 3s',7,'四条'],['As Ah Ad Ks Kh Kd 2s',6,'葫芦'],['As Ts 8s 6s 3s 4s 2s',5,'同花'],['As 2h 3d 4c 5s Kh Qh',4,'顺子'],['As Ah Ad Ks Qh 4s 2c',3,'三条'],['As Ah Ks Kh Qh Qs 2d',2,'两对'],['As Ah Ks Qh Js 2d 3c',1,'一对'],['As Kh Qs Jd 9c 2s 3h',0,'高牌']];
  for(const [input,cat,name] of cases){const result=evaluate(input.split(' '));assert.equal(result.category,cat);assert.equal(result.name,name);}
  assert.ok(evaluate('6s 5d 4h 3c 2s'.split(' ')).score>evaluate('As 2h 3d 4c 5s'.split(' ')).score);
  assert.ok(evaluate('As Ah Kd Qc Js'.split(' ')).score>evaluate('Ad Ac Kh Qs Td'.split(' ')).score);
  assert.deepEqual(evaluate('As Ah Ad Ks Kh Kd 2s'.split(' ')).kickers,[14,13]);
  assert.deepEqual(evaluate('As Ts 8s 6s 3s 4s 2s'.split(' ')).kickers,[14,10,8,6,4]);
  assert.throws(()=>evaluate(['As','As','Ks','Qs','Js']));
});
test('heads up button posts small blind and acts first preflop, last postflop',()=>{
  const e=make();e.startHand();assert.equal(e.hand.button,0);assert.equal(e.hand.sb,0);assert.equal(e.hand.bb,1);assert.equal(e.hand.actor,0);
  e.act(0,'call');assert.equal(e.hand.actor,1);e.act(1,'check');assert.equal(e.hand.actor,null);e.advance();assert.equal(e.hand.actor,1);assert.equal(e.hand.board.length,3);assert.equal(e.hand.burned.length,1);
  finish(e);e.startHand();assert.equal(e.hand.button,1);assert.equal(e.hand.actor,1);
});
test('multiway first action, big blind option and three burn cards',()=>{
  for(const seats of [3,5,7]){const e=make(seats);e.startHand();assert.equal(e.hand.actor,(seats-5+seats)%seats);finish(e);assert.equal(e.hand.board.length,5);assert.equal(e.hand.burned.length,3);assert.equal(e.hand.dealIndex,seats*2+8);assert.ok(e.hand.events.some(x=>x.playerId===e.hand.bb&&x.street==='preflop'&&x.action==='check'));}
});
test('invalid action rejection is atomic',()=>{
  const e=make();e.startHand();const before=e.serialize();
  for(const [id,action,amount] of [[1,'fold'],[0,'check'],[0,'raise',19],[0,'raise',Infinity],[0,'raise',50.5],[0,'raise',1001]])assert.throws(()=>e.act(id,action,amount));
  assert.deepEqual(e.serialize(),before);
});
test('unmatched bet returned on folds; winner only wins matched pot',()=>{
  const e=make();e.startHand();e.act(0,'raise',1000);e.act(1,'fold');assert.equal(e.active,false);assert.equal(e.players[0].stack,1010);assert.equal(e.players[1].stack,990);assert.equal(e.hand.pots[0].amount,20);assert.equal(e.hand.results[0].refunded,990);assert.equal(e.hand.results[0].net,10);
});
test('100BB pots become public important-hand records and affect later bot table-image context',()=>{
  const e=make();e.startHand();
  e.act(0,'raise',500);e.act(1,'call');e.advance();e.act(1,'raise',500);e.act(0,'fold');
  assert.equal(e.hand.finalPot,1000);assert.equal(e.hand.importantHand.potBB,100);assert.equal(e.importantHands.length,1);assert.equal(e.hand.events.some(event=>event.type==='important'),true);
  const record=e.importantHands[0];assert.equal(record.players.find(player=>player.playerId===1).aggressive,true);assert.equal(record.players.some(player=>Object.hasOwn(player,'hole')),false);
  e.startHand();const observation=botObservation(e,1),image=importantHandContext(observation).byPlayer[1];
  assert.equal(observation.importantHands[0].potBB,100);assert.ok(image.aggression>0&&image.wins>0);assert.equal(observation.importantHands[0].players.some(player=>Object.hasOwn(player,'hole')),false);
  const report=buildReport({id:'important',engine:e,walletBefore:20000,wallet:19000});assert.equal(report.json.importantHands.length,1);assert.ok(report.markdown.includes('重要牌局（底池至少 100BB）'));
});
test('a folded hero retains only their own dimmable hole cards in the live view',()=>{
  const e=make();e.startHand();const hole=[...e.players[0].hole];e.act(0,'fold');
  const view=e.view();assert.equal(view.players[0].folded,true);assert.deepEqual(view.players[0].hole,hole);assert.deepEqual(view.players[1].hole,[]);
});
test('three distinct stacks produce independently awarded main and side pots',()=>{
  const e=make(3);
  e.startHand(deckFor([['As','Ah'],['Ks','Kh'],['Qs','Qh']],['2s','5d','7h','9c','Jd']));
  setTestStacks(e,{0:40,1:100,2:200});
  e.act(1,'allin');e.act(0,'allin');e.act(2,'call');finish(e);
  assert.deepEqual(e.hand.pots.map(p=>p.amount),[120,120]);assert.deepEqual(e.hand.pots.map(p=>p.awards[0].playerId),[0,1]);assert.deepEqual(e.players.map(p=>p.stack),[120,120,100]);
  assert.equal(e.players.reduce((n,p)=>n+p.stack,0),340);
});
test('equal board splits including odd chips clockwise after button',()=>{
  const e=make(3);e.startHand(deckFor([['2s','2h'],['3s','3h'],['4s','4h']],['As','Ks','Qs','Js','Ts'],['5c','6c','7c']));
  e.act(1,'fold');e.act(0,'call');e.act(2,'check');finish(e);
  assert.deepEqual(e.hand.pots[0].awards,[{playerId:0,amount:10},{playerId:2,amount:10}]);
  assert.equal(e.players.reduce((sum,p)=>sum+p.stack,0),3000);assert.equal(e.hand.results[0].won,10);assert.equal(e.hand.results[2].won,10);
});
test('short all-in does not reopen a full raise to a player who already acted',()=>{
  const e=make(3);e.startHand();setTestStacks(e,{0:25});e.act(1,'raise',20);e.act(0,'allin');e.act(2,'call');assert.equal(e.hand.actor,1);assert.equal(e.legal(1).canRaise,false);assert.equal(e.legal(1).fullToCall,5);assert.throws(()=>e.act(1,'raise',100));e.act(1,'call');finish(e);
});
test('cumulative short all-ins can reopen action after one full increment',()=>{
  const e=make(5);e.startHand();setTestStacks(e,{4:25,3:30});e.act(0,'raise',20);e.act(4,'allin');e.act(3,'allin');e.act(2,'call');e.act(1,'call');assert.equal(e.hand.actor,0);assert.equal(e.legal(0).canRaise,true);assert.equal(e.legal(0).minRaiseTo,40);finish(e);
});
test('short opening all-in permits an earlier checker to complete to the minimum',()=>{
  const e=make(3);e.startHand();setTestStacks(e,{2:15});e.act(1,'call');e.act(0,'call');e.act(2,'check');e.advance();e.act(0,'check');e.act(2,'allin');e.act(1,'call');assert.equal(e.hand.actor,0);assert.equal(e.legal(0).canRaise,true);assert.equal(e.legal(0).minRaiseTo,10);e.act(0,'raise',10);finish(e);
});
test('only non-all-in player cannot bet into an uncontested side pot',()=>{
  const e=make();e.players[0].stack=10;e.startHand();assert.equal(e.legal(0).canRaise,false);e.act(0,'call');assert.equal(e.hand.actor,null);finish(e);assert.equal(e.hand.events.filter(x=>x.type==='action').length,1);
});
test('all-in undercall can call only own stack and uncalled remainder is returned',()=>{
  const e=make();e.players[0].stack=17;e.startHand();e.act(0,'call');e.act(1,'raise',100);assert.equal(e.legal(0).toCall,7);assert.equal(e.legal(0).eligiblePotAfterCall,34);e.act(0,'allin');finish(e);assert.equal(e.hand.pots[0].amount,34);assert.equal(e.hand.results[1].refunded,83);assert.equal(e.view().hand.pot,34);
});
test('every live all-in player exposes hole cards before the automatic runout',()=>{
  const e=make();e.startHand(deckFor([['As','Ah'],['Ks','Kh']],['2s','5d','7h','9c','Jd']));setTestStacks(e,{0:30,1:30});
  e.act(0,'allin');assert.equal(e.hand.allInShowdown,false);e.act(1,'allin');
  assert.equal(e.hand.status,'playing');assert.equal(e.hand.street,'preflop');assert.equal(e.hand.actor,null);assert.equal(e.hand.allInShowdown,true);
  assert.deepEqual(e.hand.shownPlayers,[0,1]);assert.equal(e.hand.events.at(-1).type,'show');assert.equal(e.hand.events.at(-1).allInShowdown,true);
  const live=e.view();assert.deepEqual(live.players[1].hole,['Ks','Kh']);assert.equal(live.hand.showdown,false);assert.equal(live.hand.allInShowdown,true);assert.equal(live.hand.equities.length,2);assert.ok(Math.abs(live.hand.equities.reduce((sum,equity)=>sum+equity.percent,0)-100)<.01);
  e.advance();assert.equal(e.hand.street,'flop');assert.equal(e.hand.board.length,3);assert.ok(e.hand.runoutNextAt>Date.now());assert.equal(e.view().hand.equities.length,2);
  finish(e);assert.equal(e.hand.showdown,true);assert.equal(e.hand.results[1].hole.length,2);
});
test('topups only between hands and abort refunds without affecting stats',()=>{
  const e=make();e.startHand();e.act(0,'raise',50);assert.throws(()=>e.topUp(0,2000));e.abort();assert.deepEqual(e.players.map(p=>p.stack),[1000,1000]);assert.equal(e.players[0].stats.hands,0);assert.equal(e.hand.status,'aborted');assert.equal(e.topUp(0,1500),500);assert.equal(e.players[0].totalBuyIn,1500);assert.throws(()=>e.topUp(0,2500));assert.throws(()=>e.topUp(0,1000));
});
test('live view and bot observation exclude opponents cards and actual deck',()=>{
  const e=make(7);e.startHand();const view=e.view();assert.equal(view.players[0].hole.length,2);assert.ok(view.players.slice(1).every(p=>p.hole.length===0));assert.equal(view.hand.deck,undefined);assert.equal(view.hand.burned,undefined);
  const obs=botObservation(e,e.hand.actor);assert.equal(obs.deck,undefined);assert.ok(obs.players.every(p=>p.hole===undefined));assert.equal(obs.hole.length,2);assert.equal(view.hand.eventCount,e.hand.events.length);
});
test('player turn has a 20 second clock, can extend by 20 seconds, and records thinking time',()=>{
  const e=make();e.startHand();const started=e.hand.actionStartedAt,deadline=e.hand.actionDeadlineAt;assert.equal(e.view().hand.actionTimeLimitMs,PLAYER_ACTION_TIME_MS);assert.ok(deadline-started>=PLAYER_ACTION_TIME_MS);
  e.extendActionTime(0);assert.equal(e.hand.actionExtensions,1);assert.equal(e.hand.actionDeadlineAt,deadline+ACTION_EXTENSION_MS);assert.equal(e.hand.events.at(-1).type,'timebank');
  e.act(0,'call',undefined,{thinkTimeMs:4321});const obs=botObservation(e,e.hand.actor);assert.equal(obs.timing.lastHeroActionMs,4321);assert.equal(obs.actions.find(a=>a.playerId===0).thinkTimeMs,4321);
});
test('expired player action is auto-processed and recorded as a timeout',()=>{
  const e=make();e.startHand();const deadline=e.hand.actionDeadlineAt;e.expireAction(0,deadline+1);const action=e.hand.events.filter(x=>x.type==='action').at(-1);
  assert.equal(action.action,'fold');assert.equal(action.text,`${e.players[0].name} 超时弃牌`);assert.equal(action.thinkTimeMs,PLAYER_ACTION_TIME_MS+1);assert.equal(e.active,false);
});
test('bot timing stays between one and ten seconds and provides quick, thinking and deceptive-slow ranges',()=>{
  const e=make();e.startHand();e.act(0,'call',undefined,{thinkTimeMs:9000});const obs=botObservation(e,1);
  const timings=['fold','check','call','raise'].map(action=>chooseBotTiming(obs,{action},rng(action.length+10)));
  assert.ok(timings.every(t=>t.delayMs>=1000&&t.delayMs<=10000&&t.kind));
  assert.ok(chooseBotTiming(obs,{action:'check'},()=>0).delayMs<2000);
  assert.ok(timings.some(t=>t.kind==='thinking-call'||t.kind==='thinking-raise'||t.kind==='slow-call'||t.kind==='slow-raise'));
});
test('local store keeps a bot action private until its one-to-ten second timer expires',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poker-timing-'));
  try{
    const store=new GameStore({root,random:rng(222)});store.dispatch('start',{config:{seats:2}});const e=store.session.engine;e.act(0,'call',undefined,{thinkTimeMs:3200});
    const payload={sessionId:store.session.id,handNumber:e.hand.number,eventCount:e.hand.events.length,botTiming:true},before=e.hand.events.length,waiting=store.dispatch('tick',payload);
    assert.equal(e.hand.events.length,before);assert.ok(waiting.session.hand.botTiming);assert.equal(waiting.session.hand.botTiming.playerId,1);assert.equal(waiting.session.hand.botPendingDecision,undefined);
    e.hand.botTiming.dueAt=Date.now()-1;const finished=store.dispatch('tick',payload);assert.ok(e.hand.events.length>before);assert.equal(finished.session.hand.botTiming,null);assert.ok(e.hand.aiDecisions.at(-1).thinkTimeMs>=0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('restored state resumes exactly, report includes each action and all dealt cards',()=>{
  const e=make(3);e.startHand();e.act(e.hand.actor,'call');e.act(e.hand.actor,'call');const partial=buildReport({id:'partial',engine:e,walletBefore:20000,wallet:19000});assert.equal(partial.json.accounting.heroProfit,0);assert.equal(partial.json.accounting.heroUnsettledCommitment,10);const restored=HoldemEngine.restore(e.serialize());assert.deepEqual(restored.view(),e.view());finish(restored);
  const report=buildReport({id:'test',engine:restored,walletBefore:20000,wallet:19000});assert.equal(report.json.hands.length,1);assert.equal(report.json.hands[0].deck.length,52);assert.ok(report.markdown.includes('烧牌'));assert.ok(report.markdown.includes('原始牌堆'));assert.ok(report.json.hands[0].events.every((x,i)=>x.seq===i));
});
test('1200 random hands across all table modes conserve every chip and always finish',()=>{
  const random=rng(9001);
  for(const seats of [2,3,5,7]) {
    const e=make(seats);
    for(let hand=0;hand<300;hand++) {
      if(e.players[0].stack<10)e.topUp(0,1000);
      e.startHand();let iterations=0;
      while(e.active) {
        assert.ok(++iterations<160,`stalled ${seats} seats ${hand}`);
        const total=e.players.reduce((sum,p)=>sum+p.stack+p.totalBet,0),buy=e.players.reduce((sum,p)=>sum+p.totalBuyIn,0);assert.equal(total,buy);
        if(e.hand.actor===null){e.advance();continue;}
        const id=e.hand.actor,l=e.legal(id),r=random();
        if(r<0.17&&!l.canCheck)e.act(id,'fold');
        else if(r>0.80&&l.canRaise){const amount=r>0.97?l.maxRaiseTo:Math.min(l.maxRaiseTo,l.minRaiseTo+Math.floor(random()*5)*10);e.act(id,'raise',amount);}
        else e.act(id,l.canCheck?'check':'call');
      }
      assert.equal(e.players.reduce((sum,p)=>sum+p.stack,0),e.players.reduce((sum,p)=>sum+p.totalBuyIn,0));assert.ok(e.players.every(p=>Number.isInteger(p.stack)&&p.stack>=0));
      for(const ev of e.hand.events)assert.equal(ev.snapshot.pot+ev.snapshot.players.reduce((sum,p)=>sum+p.stack,0),e.hand.initialStacks.reduce((sum,n)=>sum+n,0),`snapshot accounting at ${ev.type}`);
    }
  }
});
test('all seven bot profiles produce legal actions; distinct tight/loose and passive/aggressive rates',()=>{
  const random=rng(712),rates={};
  for(const style of Object.keys(STYLES)) {
    let entered=0,raised=0;
    for(let i=0;i<400;i++) {
      const e=new HoldemEngine({seats:3,styles:[style,'TAG']},{random});e.startHand();const actor=e.hand.actor;
      const d=chooseBotAction(botObservation(e,actor),random);if(d.action!=='fold')entered++;if(d.action==='raise')raised++;e.act(actor,d.action,d.amount);
    }
    rates[style]={entered,raised};
  }
  assert.ok(rates.NIT.entered<rates.TAG.entered);assert.ok(rates.TAG.entered<rates.LAG.entered);assert.ok(rates.LAG.entered<rates.MANIAC.entered);assert.ok(rates.LP.raised<rates.LAG.raised);assert.ok(rates.TP.raised<rates.TAG.raised);
});
test('direct flush and straight draws use outs and pot odds instead of generic passive calls',()=>{
  const direct={id:1,style:'TAG',level:.8,stack:900,streetBet:0,street:'flop',button:0,bb:10,pot:100,memory:{},actions:[{playerId:0,action:'raise',street:'flop'}],players:[{id:0,stack:900,folded:false,allIn:false,totalBet:100,stats:{hands:20,vpip:8,pfr:4}},{id:1,stack:900,folded:false,allIn:false,totalBet:0,stats:{hands:20,vpip:7,pfr:3}}],legal:{toCall:20,fullToCall:20,eligiblePotAfterCall:140,canCheck:false,canRaise:false,canAllIn:true,minRaiseTo:40,maxRaiseTo:900}};
  const flush=drawProfile(['Ah','8h'],['Kh','4c','2h']);assert.equal(flush.flushOuts,9);assert.equal(flush.outs,9);assert.deepEqual(flush.kinds,['flush']);
  assert.equal(chooseBotAction({...direct,hole:['Ah','8h'],board:['Kh','4c','2h']},()=>.99).action,'call');
  const open=drawProfile(['9s','8d'],['7c','6h','Kd']);assert.equal(open.straightOuts,8);assert.ok(open.kinds.includes('open_ended_straight'));
  assert.equal(chooseBotAction({...direct,hole:['9s','8d'],board:['7c','6h','Kd']},()=>.99).action,'call');
  const gutshot=drawProfile(['9s','7d'],['8c','5h','Kd']);assert.equal(gutshot.straightOuts,4);assert.ok(gutshot.kinds.includes('gutshot'));
  assert.equal(chooseBotAction({...direct,hole:['9s','7d'],board:['8c','5h','Kd'],pot:250,legal:{...direct.legal,toCall:10,fullToCall:10,eligiblePotAfterCall:270}},()=>.99).action,'call');
  assert.equal(chooseBotAction({...direct,hole:['9s','7d'],board:['8c','5h','Kd'],pot:20,legal:{...direct.legal,toCall:60,fullToCall:60,eligiblePotAfterCall:80}},()=>.99).action,'fold');
});
test('bots use public stack depth, position, board texture and opponent rates for real cash-game choices',()=>{
  const setMine={id:1,style:'TAG',level:.8,hole:['5s','5d'],stack:400,streetBet:0,board:[],street:'preflop',button:0,bb:10,pot:30,memory:{},actions:[{playerId:0,action:'raise',street:'preflop',raiseTo:20}],players:[{id:0,stack:400,folded:false,allIn:false,status:'active',stats:{hands:40,vpip:7,pfr:4}},{id:1,stack:400,folded:false,allIn:false,status:'active',stats:{hands:40,vpip:10,pfr:6}},{id:2,stack:400,folded:true,allIn:false,status:'active',stats:{hands:40,vpip:7,pfr:3}}],legal:{toCall:20,fullToCall:20,eligiblePotAfterCall:50,canCheck:false,canRaise:true,canAllIn:true,minRaiseTo:40,maxRaiseTo:400}};
  const context=decisionContext(setMine);assert.equal(context.position.label,'cutoff');assert.equal(context.opponents.tight,true);assert.ok(context.spr>10);assert.equal(chooseBotAction(setMine,()=>.99).action,'call','deep stacks permit a priced small-pair set mine');
  assert.equal(chooseBotAction({...setMine,stack:200,players:setMine.players.map(player=>({...player,stack:200}))},()=>.99).action,'fold','the same pair is not mined at shallow effective depth');
  const post=decisionContext({...setMine,street:'flop',hole:['Ah','Qs'],board:['Kh','Jh','3c'],pot:80,actions:[]});assert.equal(post.texture.nutFlushBlocker,true);assert.equal(post.texture.broadwayBlockers,2);assert.equal(post.initiative,false);
});
test('complete bot games traverse all streets without illegal actions',()=>{
  const random=rng(876);
  for(const style of Object.keys(STYLES)) {
    const e=new HoldemEngine({seats:3,styles:[style,style]},{random});
    for(let i=0;i<15;i++){
      if(e.players[0].stack<10)e.topUp(0,1000);e.startHand();let steps=0;
      while(e.active){assert.ok(++steps<150);if(e.hand.actor===null)e.advance();else {const id=e.hand.actor;if(id===0){const l=e.legal(id);e.act(id,l.canCheck?'check':'call');}else{const d=chooseBotAction(botObservation(e,id),random);e.act(id,d.action,d.amount);}}}
      assert.equal(e.players.reduce((n,p)=>n+p.stack,0),e.players.reduce((n,p)=>n+p.totalBuyIn,0));
    }
  }
});

test('a human fold in a multiway hand fast-forwards every remaining bot',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poker-fast-fold-'));
  try{
    const store=new GameStore({root,random:rng(441)});
    const started=store.dispatch('start',{config:{seats:3}}),e=store.session.engine;
    e.hand.actor=0;e.hand.actionStartedAt=Date.now();e.hand.actionDeadlineAt=Date.now()+PLAYER_ACTION_TIME_MS;
    const result=store.dispatch('action',{sessionId:store.session.id,handNumber:e.hand.number,eventCount:e.hand.events.length,action:'fold'});
    assert.equal(result.session.hand.status,'complete');
    assert.ok(e.hand.aiDecisions.some(decision=>decision.timingKind==='fast-after-fold'));
    assert.ok(result.session.hand.events.some(event=>event.type==='action'&&event.playerId!==0&&event.fastForward===true));
  }finally{
    const resolved=path.resolve(root),expected=path.resolve(os.tmpdir())+path.sep;
    if(!resolved.startsWith(expected)||!path.basename(resolved).startsWith('poker-fast-fold-'))throw new Error('Unsafe test cleanup path');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});

test('preflop quick fold settles immediately before the hero turn',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poker-preturn-fold-'));
  try{
    const store=new GameStore({root,random:rng(442)});
    store.dispatch('start',{config:{seats:3}});const e=store.session.engine;
    const botActor=e.hand.pending.find(id=>id!==0);assert.notEqual(botActor,undefined);
    e.hand.actor=botActor;e.hand.actionStartedAt=Date.now();e.hand.actionDeadlineAt=null;
    const result=store.dispatch('action',{sessionId:store.session.id,handNumber:e.hand.number,eventCount:e.hand.events.length,action:'fold',fastFold:true});
    assert.equal(result.session.hand.status,'complete');assert.equal(e.players[0].folded,true);
    assert.ok(e.hand.events.some(event=>event.fastFold===true));
    assert.ok(e.hand.aiDecisions.some(decision=>decision.timingKind==='fast-after-fold'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
