import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HoldemEngine} from '../src/engine.js';
import {GameStore} from '../src/store.js';
import {createWorld,refreshWorld} from '../src/world.js';
import {parseDailySchedule,scheduledActivity} from '../src/schedules.js';
import {ROLE_PROFILES,dossier} from '../src/character-profiles.js';
import {AI_ROSTER} from '../src/roster.js';

const rng=value=>()=>value;
const tempRoot=prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix));

test('new USD stake presets support optional straddle and 50–500BB buy-ins',()=>{
  const e=new HoldemEngine({seats:3,stakeLevel:'low',buyBB:500,straddleEnabled:true,styles:['TAG','LAG']},{random:rng(.5)});
  e.startHand();
  assert.deepEqual([e.config.sb,e.config.bb,e.config.straddle],[1,2,4]);
  assert.equal(e.hand.currentBet,2);assert.equal(e.hand.straddle,null);
  assert.equal(e.players[0].totalBuyIn,1000);
});

test('an enabled straddle is chosen only occasionally by a qualifying bot and records its motive',()=>{
  const e=new HoldemEngine({seats:3,stakeLevel:'low',buyBB:100,straddleEnabled:true,styles:['TAG','LAG']},{random:rng(.5)});
  e.random=()=>0;e.startHand();
  assert.notEqual(e.hand.straddle,null);assert.notEqual(e.hand.straddle,0);assert.match(e.hand.straddleReason,/疯松|活跃牌局|社交娱乐/);
});

test('player straddle can be queued only between hands and is consumed on the next deal',()=>{
  const e=new HoldemEngine({seats:3,stakeLevel:'low',buyBB:100,straddleEnabled:true,styles:['TAG','LAG']},{random:rng(.99)});
  e.startHand();e.abort();assert.equal(e.queuePlayerStraddle(),true);e.startHand();
  assert.equal(e.hand.straddle,0);assert.equal(e.hand.straddleReason,'玩家主动选择');assert.equal(e.playerStraddleNext,false);
  assert.throws(()=>e.queuePlayerStraddle(),/两手牌之间/);
});

test('player timebank is one extension per hand',()=>{
  const e=new HoldemEngine({seats:2,stakeLevel:'low',buyBB:100},{random:rng(.5)});e.startHand();e.extendActionTime();assert.throws(()=>e.extendActionTime(),/已用完/);
});

test('player voice gender and career memory persist in the desktop store',()=>{
  const root=tempRoot('poker-v3-career-');try{
    const store=new GameStore({root,random:rng(.5)});store.dispatch('profile-settings',{gender:'f'});const started=store.dispatch('start',{config:{seats:2,stakeLevel:'low',buyBB:50,durationMinutes:15}});
    assert.equal(started.session.players[0].gender,'f');const bot=store.session.engine.players[1];bot.stats={hands:12,vpip:5,pfr:3,won:4,showdowns:6,maxWon:88};store.save();
    const restored=new GameStore({root});assert.equal(restored.profile.gender,'f');assert.equal(restored.careerStats[bot.characterId].maxWon,88);assert.equal(restored.session.engine.players[1].stats.hands,12);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('corrupt active hand is repaired before expiry handling and cannot block startup',()=>{
  const root=tempRoot('poker-v3-repair-');try{
    const store=new GameStore({root,random:rng(.5)}),started=store.dispatch('start',{config:{seats:2,stakeLevel:'low',buyBB:50,durationMinutes:15}}),e=store.session.engine;
    e.hand.street='showdown';e.hand.board=Array.from({length:6},()=> 'As');e.hand.dealIndex=53;store.session.expiresAt=new Date(Date.now()-1000).toISOString();store.save();
    const restored=new GameStore({root,random:rng(.5)}),state=restored.dispatch('state');
    assert.equal(state.session,null);assert.equal(state.lastSummary.reason,'房间时间到');assert.ok(state.lastSummary.completedHands>=0);assert.ok(fs.existsSync(path.join(root,'日志',state.lastSummary.reports.json)));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('new-table exit folds the player and preserves a completed hand',()=>{
  const root=tempRoot('poker-v3-end-');try{
    const store=new GameStore({root,random:rng(.5)}),started=store.dispatch('start',{config:{seats:2,stakeLevel:'low',buyBB:50,durationMinutes:15}});
    const ended=store.dispatch('end',{sessionId:started.session.id,reason:'测试强退'});
    assert.equal(ended.session,null);assert.ok(ended.lastSummary.completedHands>=1);
    const report=JSON.parse(fs.readFileSync(path.join(root,'日志',ended.lastSummary.reports.json),'utf8'));
    assert.ok(report.hands.length>=1);assert.ok(report.hands.every(hand=>hand.status==='complete'));assert.equal(report.config.stakeLevel,'low');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('bot can sit out without cashing out and a busted seat may be replaced in the gap',()=>{
  const e=new HoldemEngine({seats:2,stakeLevel:'low',buyBB:50,styles:['TAG']},{random:rng(0)});e.startHand();e.act(0,'fold');assert.equal(e.players[1].status,'active','heads up never sits out');assert.ok(e.players[1].stack>0);
  e.players[1].status='busted';e.players[1].stack=0;e.startHand();assert.notEqual(e.players[1].status,'busted');assert.ok(e.players[1].characterId);
});

test('stale commitments from an empty seat never inflate the current pot',()=>{
  const e=new HoldemEngine({seats:3,stakeLevel:'low',buyBB:100,styles:['TAG','LAG']},{random:rng(.5)});
  const empty=e.players[2];empty.status='empty';empty.stack=0;empty.streetBet=274;empty.totalBet=274;
  e.startHand();assert.equal(empty.streetBet,0);assert.equal(empty.totalBet,0);
  const activeTotal=e.players.filter(p=>p.status!=='empty'&&p.status!=='busted').reduce((sum,p)=>sum+p.totalBet,0);
  empty.totalBet=274;assert.equal(e.pot(),activeTotal);
});

test('revealed dossiers do not expose private player-card numbers',()=>{
  const cardSection=dossier(ROLE_PROFILES[0]).find(part=>part.label==='牌手卡片');
  assert.ok(cardSection);assert.doesNotMatch(cardSection.text,/\d+\.\d{3}/);
});

test('daily USD claims give one login grant and five post-bust grants',()=>{
  const root=tempRoot('poker-v3-claims-');try{
    const store=new GameStore({root,random:rng(.5)});
    const login=store.dispatch('claim-daily',{});
    assert.equal(login.profile.wallet,21000);
    assert.equal(login.profile.dailyClaims.login,true);
    assert.equal(login.profile.dailyClaims.bust,0);
    assert.throws(()=>store.dispatch('claim-daily',{}),/输光后才能领取/);
    store.profile.wallet=0;
    for(let i=0;i<5;i++){
      const after=store.dispatch('claim-daily',{});
      assert.equal(after.profile.wallet,300*(i+1));
      assert.equal(after.profile.dailyClaims.bust,i+1);
      assert.equal(after.profile.dailyClaims.bustUnlocked,true);
    }
    assert.throws(()=>store.dispatch('claim-daily',{}),/次数已用完/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('an all-in table stack does not unlock bust relief while account funds remain',()=>{
  const root=tempRoot('poker-v3-claims-allin-');try{
    const store=new GameStore({root,random:rng(.5)});
    store.dispatch('start',{config:{seats:2,buyBB:50,durationMinutes:15}});
    store.profile.dailyClaims={date:new Date().toLocaleDateString('sv-SE'),login:true,bust:0,bustUnlocked:false};
    store.profile.wallet=100;
    store.session.engine.players[0].stack=0;
    store.save();
    assert.throws(()=>store.dispatch('claim-daily',{}),/输光后才能领取/);
    store.profile.wallet=0;store.save();
    const grant=store.dispatch('claim-daily',{});
    assert.equal(grant.profile.dailyClaims.bust,1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('room expiry returns a settlement summary after the final hand',()=>{
  const root=tempRoot('poker-v3-expiry-');try{
    const store=new GameStore({root,random:rng(.5)}),started=store.dispatch('start',{config:{seats:2,stakeLevel:'low',buyBB:50,durationMinutes:15}}),sessionId=started.session.id;
    store.session.expiresAt=new Date(Date.now()-1).toISOString();store.save();
    const waiting=store.dispatch('state');
    assert.equal(waiting.session.id,sessionId,'expiry must not interrupt a live hand');
    const e=store.session.engine;
    while(e.active){if(e.hand.actor===null)e.advance();else e.act(e.hand.actor,e.legal().canCheck?'check':'call');}
    const ended=store.dispatch('state');
    assert.equal(ended.session,null);assert.equal(ended.lastSummary.id,sessionId);assert.equal(ended.lastSummary.reason,'房间时间到');assert.ok(ended.lastSummary.completedHands>=1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a bust before the first daily claim keeps the five-grant eligibility',()=>{
  const root=tempRoot('poker-v3-claims-bust-first-');try{
    const store=new GameStore({root,random:rng(.5)});
    store.profile.wallet=0;
    const login=store.dispatch('claim-daily',{});
    assert.equal(login.profile.wallet,1000);
    assert.equal(login.profile.dailyClaims.login,true);
    assert.equal(login.profile.dailyClaims.bustUnlocked,true);
    const bustGrant=store.dispatch('claim-daily',{});
    assert.equal(bustGrant.profile.wallet,1300);
    assert.equal(bustGrant.profile.dailyClaims.bust,1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('legacy daily claim records migrate without granting an extra login claim',()=>{
  const root=tempRoot('poker-v3-claims-migrate-');try{
    const store=new GameStore({root,random:rng(.5)});
    store.profile.dailyClaims={date:new Date().toLocaleDateString('sv-SE'),normal:5,bust:true};
    store.save();
    const restored=new GameStore({root,random:rng(.5)});
    assert.equal(restored.profile.dailyClaims.login,true);
    assert.equal(restored.profile.dailyClaims.bust,1);
    assert.equal(restored.profile.dailyClaims.bustUnlocked,true);
    const after=restored.dispatch('claim-daily',{});
    assert.equal(after.profile.wallet,20300);
    assert.equal(after.profile.dailyClaims.login,true);
    assert.equal(after.profile.dailyClaims.bust,2);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('world status keeps work/play/rest mutually exclusive and caps background play at two hours',()=>{
  const world=createWorld(0);refreshWorld(world,180*60000,rng(.1));for(const p of Object.values(world.players)){assert.ok(['work','play','rest'].includes(p.activity));assert.ok(p.playMinutes<=120);assert.ok(p.workMinutes<=720);}
});

test('role cards are deterministic to three decimals and schedules drive online/work state',()=>{
  assert.equal(ROLE_PROFILES.length,145);
  const fields=['looseness','aggression','bluff','discipline','sizing','patience','position','callCaution','level'];
  for(const profile of ROLE_PROFILES)for(const field of fields)assert.equal(Number.isInteger(profile.card[field]*1000),true,`${profile.characterId}.${field}`);
  assert.ok(AI_ROSTER.slice(0,10).every(player=>player.playerCard.level===1));
  const schedule=parseDailySchedule(ROLE_PROFILES.find(p=>p.characterId==='role-96').schedule);
  assert.equal(scheduledActivity(schedule,new Date(2026,0,1,9,0).getTime()),'play');
  const world=createWorld(new Date(2026,0,1,22,0).getTime()),player=world.players['role-96'];
  refreshWorld(world,new Date(2026,0,1,22,30).getTime(),rng(.5));
  assert.equal(player.activity,'work');assert.equal(player.workMinutes,30);assert.equal(player.online,false);
  const onlineWorld=createWorld(new Date(2026,0,1,9,0).getTime());refreshWorld(onlineWorld,new Date(2026,0,1,9,0).getTime(),rng(.5));
  assert.ok(onlineWorld.players['role-96'].online);assert.ok(Object.values(onlineWorld.players).some(p=>p.online));
});
