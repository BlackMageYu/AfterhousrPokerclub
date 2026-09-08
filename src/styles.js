export const STYLES = {
  TAG: {name:'紧凶型', en:'Tight Aggressive', short:'TAG', color:'#72bcb0', icon:'◆', description:'选择较优范围入池，以价值下注和位置施压。', looseness:0.34, aggression:0.64, bluff:0.10, discipline:0.80, sizing:0.64},
  TP: {name:'紧弱型', en:'Tight Passive', short:'TP', color:'#91a8cb', icon:'◈', description:'入池谨慎，但会用合适的价值牌主动下注。', looseness:0.30, aggression:0.42, bluff:0.05, discipline:0.74, sizing:0.52},
  LAG: {name:'松凶型', en:'Loose Aggressive', short:'LAG', color:'#d28c6f', icon:'✦', description:'较宽范围争夺底池，适度偷盲、半诈唬和再加注。', looseness:0.57, aggression:0.68, bluff:0.17, discipline:0.66, sizing:0.73},
  LP: {name:'松弱型', en:'Loose Passive', short:'LP', color:'#bea0cd', icon:'♧', description:'愿意看翻牌，也会在优势局面争取价值。', looseness:0.53, aggression:0.42, bluff:0.05, discipline:0.56, sizing:0.54},
  NIT: {name:'超级紧人', en:'Ultra NIT', short:'NIT', color:'#a3b2b8', icon:'⬡', description:'耐心筛选牌力，但不再只用顶端范围行动。', looseness:0.20, aggression:0.50, bluff:0.025, discipline:0.88, sizing:0.60},
  MANIAC: {name:'极致松凶', en:'Maniac', short:'MANIAC', color:'#d17c84', icon:'ϟ', description:'更愿意主动争夺底池，但会控制不必要的大波动。', looseness:0.67, aggression:0.72, bluff:0.20, discipline:0.48, sizing:0.82},
  GRINDER: {name:'磨桌玩家', en:'Grinder', short:'GRINDER', color:'#c4af72', icon:'▥', description:'重视位置、赔率与薄价值，根据公开行动调整。', looseness:0.41, aggression:0.59, bluff:0.09, discipline:0.87, sizing:0.58}
};
import {CLUB_ROSTER,localIdentityTraits} from './roster.js';
export const BOT_NAMES = CLUB_ROSTER.map(p=>p.name);
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
