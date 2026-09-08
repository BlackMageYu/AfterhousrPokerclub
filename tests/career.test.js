import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCareerStats,syncCareerStats} from '../src/career.js';

test('a returning player keeps accumulated VPIP/PFR instead of fresh-seat zeros',()=>{
  const career={opponent:{hands:48,vpip:14,pfr:9,won:12,showdowns:8,maxWon:1600}},player={id:1,characterId:'opponent',stats:{hands:0,vpip:0,pfr:0,won:0,showdowns:0,maxWon:0}};
  mergeCareerStats(player,career);assert.deepEqual(player.stats,career.opponent);
  player.stats.hands=49;player.stats.vpip=15;syncCareerStats({players:[player]},career);assert.equal(career.opponent.hands,49);assert.equal(career.opponent.vpip,15);
});
