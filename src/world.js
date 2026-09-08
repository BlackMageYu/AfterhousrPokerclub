import {CLUB_ROSTER,financialProfile} from './roster.js';
import {parseDailySchedule,scheduledActivity} from './schedules.js';

export const WORLD_DAY_MS=24*60*60*1000;
const roster=CLUB_ROSTER;
const rosterById=new Map(roster.map(character=>[character.characterId,character]));
const dayKey=now=>new Date(now).toLocaleDateString('sv-SE');
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const activityLabel={work:'工作中',rest:'休息中',play:'后台牌局'};
const defaultLegendSchedule='工作 8 小时（12:00–20:00）｜打牌 4 小时（20:00–00:00）｜其余为休息';

function characterData(characterId){
  const character=rosterById.get(characterId);if(!character)return null;
  return {...character,schedule:character.schedule??defaultLegendSchedule};
}
function newWorldPlayer(character,now,date){
  const money=financialProfile(character),schedule=character.schedule??defaultLegendSchedule;
  return {characterId:character.characterId,name:character.name,career:character.occupation??money.career,schedule,windows:parseDailySchedule(schedule),pool:'club',level:Number(character.level??character.playerCard?.level??money.level??.5),bankroll:money.bankroll,incomePerHour:money.incomePerHour,activity:'rest',online:false,activityStartedAt:now,lastUpdated:now,dailyDate:date,workMinutes:0,playMinutes:0,playHands:0,earnings:0,targetWorkMinutes:null};
}
function applyCharacterData(player){
  const character=characterData(player.characterId);if(!character)return player;
  const money=financialProfile(character);
  player.name??=character.name;player.career??=character.occupation??money.career;
  player.schedule??=character.schedule;player.windows??=parseDailySchedule(player.schedule);
  player.pool='club';
  player.level??=Number(character.level??character.playerCard?.level??money.level??.5);
  player.incomePerHour??=money.incomePerHour;player.bankroll??=money.bankroll;
  return player;
}

export function createWorld(now=Date.now()) {
  const date=dayKey(now),players={};
  for(const character of roster)players[character.characterId]=newWorldPlayer(character,now,date);
  return {schemaVersion:3,lastUpdated:now,dailyDate:date,players,refreshIntervalMs:1800000};
}

function resetDay(p,date){
  p.dailyDate=date;p.workMinutes=0;p.playMinutes=0;p.playHands=0;p.earnings=0;p.activity='rest';p.online=false;p.activityStartedAt=p.lastUpdated;
}

export function refreshWorld(world,now=Date.now(),random=Math.random) {
  world??=createWorld(now);world.players??={};const date=dayKey(now);
  for(const character of roster)if(!world.players[character.characterId])world.players[character.characterId]=newWorldPlayer(character,now,date);
  world.schemaVersion=3;
  if(world.dailyDate!==date){world.dailyDate=date;for(const p of Object.values(world.players))resetDay(p,date);}
  const last=Number.isFinite(Number(world.lastUpdated))?Number(world.lastUpdated):now;
  const elapsed=clamp((now-last)/60000,0,1440);
  for(const p of Object.values(world.players)){
    // Keep historical balances, but retired identities no longer have a live schedule.
    if(!rosterById.has(p.characterId)){p.activity='rest';p.online=false;p.lastUpdated=now;continue;}
    applyCharacterData(p);if(p.dailyDate!==date)resetDay(p,date);
    const previous=p.activity,workCap=p.windows?.work?.duration??720,playCap=p.windows?.play?.duration??120;
    const start=Number.isFinite(Number(p.lastUpdated))?Number(p.lastUpdated):now-elapsed*60000,minutes=Math.max(0,Math.min(1440,Math.floor((now-start)/60000))),level=Number(p.level??.5),volatility=.55+(1-level)*.65;
    for(let minute=0;minute<minutes;minute++){
      const activity=scheduledActivity(p.windows??p.schedule,start+minute*60000+30000);
      if(activity==='work'&&p.workMinutes<workCap){p.workMinutes++;const income=p.incomePerHour/60;p.bankroll+=income;p.earnings+=income;if(p.bankroll>0)p.busted=false;}
      else if(activity==='play'&&p.bankroll>0&&p.playMinutes<playCap){p.playMinutes++;if(p.playMinutes%2===0){p.playHands++;const before=p.bankroll;p.bankroll=Math.max(0,p.bankroll+(random()-.48)*p.incomePerHour*.8*volatility);p.earnings+=p.bankroll-before;}if(p.bankroll<=0)p.busted=true;}
    }
    const activity=scheduledActivity(p.windows??p.schedule,now);p.activity=activity;p.online=activity==='play'&&p.bankroll>0;
    if(previous!==activity)p.activityStartedAt=now;
    p.lastUpdated=now;
  }
  world.lastUpdated=now;world.refreshIntervalMs??=1800000;return world;
}

export function publicWorld(world){
  const rows=Object.values(world.players).filter(p=>rosterById.has(p.characterId)),online=rows.filter(p=>p.online);
  return {date:world.dailyDate,updatedAt:world.lastUpdated,refreshIntervalMs:world.refreshIntervalMs??1800000,totalCount:rows.length,onlineCount:online.length,clubCount:rows.length,clubOnlineCount:online.length,players:rows.map(p=>({characterId:p.characterId,name:p.name,career:p.career,pool:'club',level:Number(p.level??.5),online:!!p.online,activity:p.busted?'资金耗尽':activityLabel[p.activity]??'休息中',status:p.online?'在线':'离线',statusDetail:p.busted?'资金耗尽':activityLabel[p.activity]??'休息中',workMinutes:Math.round(p.workMinutes),playMinutes:Math.round(p.playMinutes),playHands:p.playHands,earnings:Math.round(p.earnings)}))};
}
