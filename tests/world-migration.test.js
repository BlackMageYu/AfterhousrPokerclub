import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scheduledActivity} from '../src/schedules.js';
import {createWorld,refreshWorld,publicWorld} from '../src/world.js';
import {GameStore} from '../src/store.js';
import {AIGameService} from '../src/external-ai.js';
import {AISettings} from '../src/ai-settings.js';

test('missing schedule means rest, while valid schedules retain their activity',()=>{
  const noon=new Date(2026,8,7,12,0).getTime();
  for(const value of [undefined,null,{},''])assert.equal(scheduledActivity(value,noon),'rest');
  assert.equal(scheduledActivity('工作 08:00–16:00｜打牌 20:00–22:00',noon),'work');
});

test('retired identities without schedules retain balances and cannot break world refresh',()=>{
  const now=new Date(2026,8,7,12,0).getTime(),world=createWorld(now-60000),count=Object.keys(world.players).length;
  const current=Object.values(world.players)[0];delete current.windows;
  const legacy={characterId:'retired-test-1',name:'旧牌友',activity:'play',online:true,bankroll:12345,incomePerHour:100,workMinutes:20,playMinutes:10,playHands:5,earnings:50,dailyDate:world.dailyDate,lastUpdated:now-60000};
  world.players[legacy.characterId]=legacy;
  refreshWorld(world,now,()=>.5);
  assert.equal(legacy.bankroll,12345);assert.equal(legacy.playHands,5);assert.equal(legacy.earnings,50);
  assert.equal(legacy.online,false);assert.equal(legacy.activity,'rest');assert.ok(current.windows);
  assert.equal(publicWorld(world).totalCount,count);assert.ok(!publicWorld(world).players.some(p=>p.characterId===legacy.characterId));
});

test('desktop state request and restart accept an old world without losing account or discovery',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poker-world-migration-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('poker-world-migration-'));fs.rmSync(root,{recursive:true,force:true});});
  const store=new GameStore({root});store.profile.wallet=86034;store.profile.lifetimeHands=100;
  store.discovery.characters['retired-test-1']={correct:1,wrong:0,attempts:1,revealed:false};
  store.world.players['retired-test-1']={characterId:'retired-test-1',name:'旧牌友',bankroll:999,lastUpdated:Date.now()-60000};store.save();
  for(let i=0;i<2;i++){
    const restored=new GameStore({root}),service=new AIGameService(restored,new AISettings({root}));
    const state=await service.dispatch('state');
    assert.equal(state.profile.wallet,86034);assert.equal(state.profile.lifetimeHands,100);
    assert.equal(restored.discovery.characters['retired-test-1'].correct,1);
    assert.equal(restored.world.players['retired-test-1'].bankroll,999);
    assert.equal(state.world.totalCount,state.rosterCounts.local+state.rosterCounts.external);
  }
});
