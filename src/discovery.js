import {CLUB_ROSTER} from './roster.js';
import {permanentStyle,dossier} from './character-profiles.js';
const roster=CLUB_ROSTER;
export const findCharacter=id=>roster.find(p=>p.characterId===id);
export function progressFor(discovery,id){
 const saved=discovery?.characters&&Object.hasOwn(discovery.characters,id)?discovery.characters[id]:null;
 return {
  correct:Number.isSafeInteger(saved?.correct)?saved.correct:0,
  wrong:Number.isSafeInteger(saved?.wrong)?saved.wrong:0,
  attempts:Number.isSafeInteger(saved?.attempts)?saved.attempts:0,
  revealed:!!saved?.revealed,
  guesses:Array.isArray(saved?.guesses)?saved.guesses.filter(style=>typeof style==='string'):[]
 };
}
export function visibleCharacter(discovery,player){
 const character=findCharacter(player.characterId),progress=progressFor(discovery,player.characterId),revealed=!!progress.revealed;
 const {bio,personality,age,birthYear,nationality,ethnicity,location,occupation,wageUSD,schedule,tagline,background,pokerClues,nickname,sourceIndex,pool,education,achievement,alias,profile,styleName,...safe}=structuredClone(player);
 return {...safe,style:player.id===0?'HERO':revealed?(permanentStyle(player.characterId)??player.style):'UNKNOWN',discovery:{attempts:progress.attempts,revealed:progress.revealed,previousGuesses:[...new Set(progress.guesses)]},dossier:character?dossier(character).map((part,i)=>revealed||i<progress.attempts?part:{label:part.label,locked:true}):[],kind:character?.kind??player.kind};
}
export function registerEncounter(discovery,sessionId,players,completedHands){
 if(!completedHands)return;
 discovery.sessions[sessionId]??={};for(const p of players.filter(p=>p.id&&findCharacter(p.characterId)))discovery.sessions[sessionId][p.characterId]??={used:false};
}
export function submitGuess(discovery,{sessionId,characterId,style},styles){
 const character=findCharacter(characterId),ticket=discovery.sessions[sessionId]?.[characterId];
 if(!character||!ticket)throw new Error('完成至少一手并下桌后，才能判断本场对手');
 if(ticket.used)throw new Error('本场已经判断过这位牌友，请再次同桌后再试');
 if(!Object.hasOwn(styles,style))throw new Error('请选择有效的打法类型');
 const progress=progressFor(discovery,characterId);if(progress.revealed)throw new Error('这位牌友的类型已经永久公开');
 const correct=style===permanentStyle(characterId);progress.attempts++;progress[correct?'correct':'wrong']++;
 progress.guesses.push(style);
 progress.revealed=progress.correct>=2||(progress.correct>=1&&progress.wrong>=2)||progress.wrong>=3;ticket.used=true;ticket.choice=style;ticket.correct=correct;
 discovery.characters[characterId]=progress;
 // The answer is deliberately not part of the public result. A correct guess
 // still reveals the character through the refreshed public projection.
 return {revealed:progress.revealed,character:visibleCharacter(discovery,{...character,style:permanentStyle(characterId)})};
}
// Reports remain rich in cards/actions but exclude hidden identity answers and private strategy parameters.
export function redactReport(report,discovery){
 const clone=structuredClone(report),identities=new Map((clone.players??[]).map(p=>[p.id,p]));
 function walk(value){
  if(Array.isArray(value))return value.map(walk);
  if(!value||typeof value!=='object')return value;
  const out={};for(const [key,item]of Object.entries(value)){
   if(['botTraits','botPlans','personality','bio','age','birthYear','nationality','ethnicity','location','occupation','wageUSD','schedule','tagline','background','pokerClues','education','achievement','styleName','styleDescription','styles','traits','plan'].includes(key))continue;
   if(key==='style'){const p=value.characterId?value:identities.get(value.id??value.playerId);out.style=p?.id===0?'HERO':p&&progressFor(discovery,p.characterId).revealed?permanentStyle(p.characterId)??item:'UNKNOWN';}
   else out[key]=walk(item);
  }return out;
 }
 const result=walk(clone);result.players=(clone.players??[]).map(p=>visibleCharacter(discovery,p));
 result.notes??=[];result.notes.push('人物类型与档案按导出时的竞猜进度公开；未解锁的类型和私有策略参数不写入本报告。');return result;
}

