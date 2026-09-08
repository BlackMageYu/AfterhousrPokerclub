import test from 'node:test';
import assert from 'node:assert/strict';
import {LOCAL_ROSTER,AI_ROSTER,CLUB_ROSTER,drawCharacters} from '../src/roster.js';
import {permanentStyle} from '../src/character-profiles.js';
import {registerEncounter,submitGuess,visibleCharacter} from '../src/discovery.js';
import {STYLES} from '../src/styles.js';
const empty=()=>({characters:{},sessions:{}});
function guess(d,p,session,correct){registerEncounter(d,session,[{...p,id:1}],1);const truth=permanentStyle(p.characterId),style=correct?truth:Object.keys(STYLES).find(x=>x!==truth);return submitGuess(d,{sessionId:session,characterId:p.characterId,style},STYLES);}
test('all 155 identities retain deterministic profiles',()=>{assert.equal(LOCAL_ROSTER.length,38);assert.equal(AI_ROSTER.length,117);for(const p of [...LOCAL_ROSTER,...AI_ROSTER]){assert.ok(STYLES[permanentStyle(p.characterId)]);assert.ok(p.avatar);}});
test('local and external decision engines draw from one unlabelled club player pool',()=>{
  assert.equal(CLUB_ROSTER.length,155);assert.equal(new Set(CLUB_ROSTER.map(player=>player.characterId)).size,155);assert.ok(CLUB_ROSTER.every(player=>!player.name.startsWith('[AI]')));
  const seeded=value=>()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
  const local=drawCharacters('local',6,seeded(71),'low'),external=drawCharacters('external',6,seeded(71),'low');
  assert.deepEqual(local.map(player=>player.characterId),external.map(player=>player.characterId));assert.ok(local.every(player=>CLUB_ROSTER.some(club=>club.characterId===player.characterId)));
});
test('two correct guesses reveal identity and one correct stays private',()=>{const d=empty(),p=LOCAL_ROSTER[0];const one=guess(d,p,'a',true);assert.equal(one.revealed,false);assert.equal(one.correct,undefined);assert.equal(one.character.style,'UNKNOWN');const two=guess(d,p,'b',true);assert.equal(two.revealed,true);assert.equal(two.character.style,permanentStyle(p.characterId));assert.ok(two.character.dossier.every(x=>!x.locked));});
test('one correct plus two wrong guesses reveals only after the third encounter',()=>{const d=empty(),p=LOCAL_ROSTER[1];assert.equal(guess(d,p,'a',true).revealed,false);assert.equal(guess(d,p,'b',false).revealed,false);assert.equal(guess(d,p,'c',false).revealed,true);});
test('three wrong guesses reveal identity and duplicate or forged tickets cannot advance it',()=>{const d=empty(),p=LOCAL_ROSTER[2];assert.equal(guess(d,p,'a',false).revealed,false);assert.throws(()=>guess(d,p,'a',false),/已经判断/);assert.equal(guess(d,p,'b',false).revealed,false);assert.equal(guess(d,p,'c',false).revealed,true);assert.equal(visibleCharacter(d,p).discovery.attempts,3);assert.throws(()=>submitGuess(d,{sessionId:'none',characterId:'__proto__',style:'TAG'},STYLES));});
