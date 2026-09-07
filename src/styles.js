export const STYLES = {
  TAG: {name:'紧凶型', en:'Tight Aggressive', short:'TAG', color:'#72bcb0', icon:'◆', description:'精选起手牌，主动下注。用位置和强牌持续施压。', looseness:0.28, aggression:0.72, bluff:0.12, discipline:0.82, sizing:0.65},
  TP: {name:'紧弱型', en:'Tight Passive', short:'TP', color:'#91a8cb', icon:'◈', description:'入池谨慎，偏好跟注。面对大额加注容易退让。', looseness:0.22, aggression:0.18, bluff:0.02, discipline:0.70, sizing:0.45},
  LAG: {name:'松凶型', en:'Loose Aggressive', short:'LAG', color:'#d28c6f', icon:'✦', description:'宽范围入池，频繁争夺底池。会偷盲、半诈唬和再加注。', looseness:0.65, aggression:0.78, bluff:0.25, discipline:0.58, sizing:0.78},
  LP: {name:'松弱型', en:'Loose Passive', short:'LP', color:'#bea0cd', icon:'♧', description:'爱看翻牌，也爱跟到底。很少诈唬，强牌才主动出击。', looseness:0.76, aggression:0.16, bluff:0.02, discipline:0.25, sizing:0.48},
  NIT: {name:'超级紧人', en:'Ultra NIT', short:'NIT', color:'#a3b2b8', icon:'⬡', description:'耐心等待顶端范围，轻易不入池。突然加注往往很强。', looseness:0.08, aggression:0.40, bluff:0.005, discipline:0.98, sizing:0.62},
  MANIAC: {name:'极致松凶', en:'Maniac', short:'MANIAC', color:'#d17c84', icon:'ϟ', description:'超宽范围、高频加注，敢用空气牌打大底池。波动极高。', looseness:0.94, aggression:0.96, bluff:0.48, discipline:0.12, sizing:1.10},
  GRINDER: {name:'磨桌玩家', en:'Grinder', short:'GRINDER', color:'#c4af72', icon:'▥', description:'重视位置和底池赔率，争取薄价值。根据公开行动调整。', looseness:0.36, aggression:0.58, bluff:0.09, discipline:0.94, sizing:0.53}
};
import {LOCAL_ROSTER,localIdentityTraits} from './roster.js';
export const BOT_NAMES = LOCAL_ROSTER.map(p=>p.name);
export const DEFAULT_STYLES = ['TAG','LAG','LP','NIT','MANIAC','GRINDER'];
export const STYLE_WEIGHTS={TAG:26,TP:20,LAG:24,LP:18,NIT:4,MANIAC:3,GRINDER:5};
export const EXTREME_STYLES=['NIT','MANIAC','GRINDER'];
export function drawTableStyles(count,random=Math.random){
  const result=[];let hasExtreme=false;
  for(let seat=0;seat<count;seat++){
    const pool=Object.entries(STYLE_WEIGHTS).filter(([key])=>!hasExtreme||!EXTREME_STYLES.includes(key));
    let roll=random()*pool.reduce((sum,[,weight])=>sum+weight,0),selected=pool.at(-1)[0];
    for(const [key,weight] of pool){roll-=weight;if(roll<0){selected=key;break;}}
    result.push(selected);if(EXTREME_STYLES.includes(selected))hasExtreme=true;
  }
  // Randomize seat order after applying the cap so seat position gives no clue.
  for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
}
export function createBotTraits(random=Math.random,characterId){
 const fresh={rangeShift:(random()-.5)*.16,aggressionShift:(random()-.5)*.18,bluffShift:(random()-.5)*.045,sizingShift:(random()-.5)*.16,patience:.1+random()*.16},identity=localIdentityTraits(characterId);
 if(!identity)return fresh;
 for(const key of ['rangeShift','aggressionShift','bluffShift','sizingShift'])fresh[key]=fresh[key]*.45+identity[key];
 fresh.patience=.18+(fresh.patience-.18)*.45+identity.patienceShift;
 return {...fresh,positionShift:identity.positionShift,callCaution:identity.callCaution,levelShift:identity.levelShift,identityShift:identity.identityShift};
}
export function createHandPlan(random=Math.random){return {rangeShift:(random()-.5)*.075,aggressionShift:(random()-.5)*.15,slowPlay:random(),sizeMix:random()};}
