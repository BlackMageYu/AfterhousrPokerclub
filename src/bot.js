import {newDeck, shuffle, evaluate, RANKS} from './cards.js';
import {STYLES} from './styles.js';
import {memoryResponse} from './memory.js';

// Explicit information boundary: neither opponent hole cards nor the real deck enter this object.
export function botObservation(engine, id) {
  const p=engine.players[id],h=engine.hand;
  const actions=h.events.filter(e=>e.type==='action'),lastHeroAction=[...actions].reverse().find(e=>e.playerId===0&&Number.isSafeInteger(e.thinkTimeMs));
  return {id,style:p.style,level:Number(p.level??p.playerCard?.level??p.skill??.5),playerCard:p.playerCard?{...p.playerCard}:undefined,stakeLevel:engine.config.stakeLevel,traits:{...engine.botTraits?.[id]},plan:{...h.botPlans?.[id]},tilt:p.tilt?{...p.tilt}:null,hole:[...p.hole],stack:p.stack,streetBet:p.streetBet,board:[...h.board],street:h.street,button:h.button,bb:engine.config.bb,pot:engine.pot(),legal:engine.legal(id),memory:structuredClone(engine.memories?.[id]??{}),timing:{lastHeroActionMs:lastHeroAction?.thinkTimeMs??null},players:engine.players.map(o=>({id:o.id,stack:o.stack,folded:o.folded,allIn:o.allIn,totalBet:o.totalBet,status:o.status,stats:{...o.stats}})),actions:actions.map(e=>({playerId:e.playerId,action:e.action,street:e.street,amount:e.amount,raiseTo:e.raiseTo,thinkTimeMs:e.thinkTimeMs??null}))};
}
export function preflopStrength(hole) {
  const r=hole.map(c=>RANKS.indexOf(c[0])+2).sort((a,b)=>b-a),[a,b]=r;
  if (a===b) return 0.48+(a-2)*0.041;
  return Math.min(0.96,0.10+a/24+b/48+(hole[0][1]===hole[1][1]?0.065:0)+(a-b===1?0.045:a-b===2?0.02:0)-(a-b>4?0.05:0));
}
export function estimateEquity(obs, random=Math.random, samples=90) {
  const opponents=obs.players.filter(p=>p.id!==obs.id&&!p.folded).length;
  if (!opponents) return 1;
  const known=new Set([...obs.hole,...obs.board]),unknown=newDeck().filter(c=>!known.has(c));let wins=0;
  for (let i=0;i<samples;i++) {
    const deck=shuffle(unknown,random),board=[...obs.board];while(board.length<5)board.push(deck.pop());
    const score=evaluate([...obs.hole,...board]).score;let tied=1,lost=false;
    for (let j=0;j<opponents;j++) {const other=evaluate([deck.pop(),deck.pop(),...board]).score;if(other>score){lost=true;break;}if(other===score)tied++;}
    if (!lost) wins+=1/tied;
  }
  return wins/samples;
}
const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
const sigmoid=n=>1/(1+Math.exp(-n));
export function decisionProfile(obs){
  const base=STYLES[obs.style];if(!base)throw new Error('未知电脑风格');
  const t=obs.traits??{},p=obs.plan??{};
  const tilt=obs.tilt,weak=tilt?.strength==='weakened',over=tilt?.strength==='overconfident';
  const level=clamp(Number(obs.level??(.75+(t.levelShift??-.25))));
  // A style changes marginal choices; it never gives a character license to
  // burn chips. Even the loosest profile keeps a meaningful EV/risk floor.
  return {looseness:clamp(base.looseness*.72+.42*.28+(t.rangeShift??0)+(p.rangeShift??0)+(weak?-.07:over?.05:0),.10,.80),aggression:clamp(base.aggression*.72+.5*.28+(t.aggressionShift??0)+(p.aggressionShift??0)+(weak?-.10:over?.07:0),.12,.84),bluff:clamp(base.bluff*.55+.075*.45+(t.bluffShift??0)+(weak?-.02:over?.02:0),.006,.16),discipline:clamp(base.discipline*.72+.66*.28+(weak?-.04:over?-.025:0)+(level-.5)*.10,.48,.97),sizing:base.sizing*.45+.66*.55+(t.sizingShift??0)+(over?.05:0),patience:clamp((t.patience??.18)+(level-.5)*.06,.04,.4),level};
}
export function chooseBotAction(obs,random=Math.random){
  const s=decisionProfile(obs),l=obs.legal;if(!l)throw new Error('电脑没有合法行动');
  const count=obs.players.length,distance=(obs.button-obs.id+count)%count,late=distance===0||distance===count-1,headsUp=count===2;
  const live=obs.players.filter(p=>p.id!==obs.id&&!p.folded),raises=obs.actions.filter(a=>a.street===obs.street&&a.action==='raise').length;
  const aggressor=[...obs.actions].reverse().find(a=>a.action==='raise'&&live.some(p=>p.id===a.playerId))?.playerId;
  const response=memoryResponse(obs.style,obs.memory?.[aggressor]);
  const bluffMemory=live.length?live.reduce((n,p)=>n+memoryResponse(obs.style,obs.memory?.[p.id]).bluffMultiplier,0)/live.length:1;
  const callBB=l.fullToCall/obs.bb,potOdds=l.toCall/(l.eligiblePotAfterCall||1),fallback=()=>({action:l.canCheck?'check':'fold'});
  const raise=()=>{
    if(!l.canRaise)return {action:l.canCheck?'check':'call'};
    // Shared, overlapping sizes prevent a player's bet amount from advertising its type.
    const mix=random()*.75+(obs.plan?.sizeMix??.5)*.25,fractions=[.33,.5,.66,.75,1],fraction=fractions[Math.min(4,Math.floor(mix*5))]*(.82+s.sizing*.28);
    const limpers=obs.actions.filter(a=>a.street==='preflop'&&a.action==='call').length;
    const open=[2.2,2.5,2.8,3.2][Math.floor(random()*4)]+Math.min(3,limpers)*.7;
    const raw=obs.street==='preflop'&&raises===0?obs.bb*open:obs.streetBet+l.toCall+(obs.pot+l.toCall)*fraction;
    return {action:'raise',amount:Math.min(l.maxRaiseTo,Math.max(l.minRaiseTo,Math.round(raw)))};
  };
  // Every profile occasionally mixes a line outside its usual style.  The
  // mix is deliberately limited to small, non-committing spots: it makes a
  // TAG capable of an unexpected probe and a LAG capable of a patient fold,
  // without turning any character into a frequent negative-EV gambler.
  const pressure=Math.max(l.toCall/Math.max(1,obs.pot),l.toCall/Math.max(1,obs.stack));
  const safeMix=pressure<.16&&raises<2;
  const mixUpChance=clamp(.055+(1-s.level)*.075,.055,.13);
  if(safeMix&&random()<mixUpChance){
    const choices=[fallback()];
    if(!l.canCheck&&l.toCall<=obs.bb*4)choices.push({action:'call'});
    if(l.canRaise&&(l.canCheck||l.toCall<=obs.bb*3))choices.push(raise());
    return choices[Math.floor(random()*choices.length)];
  }
  if(obs.street==='preflop'){
    const strength=preflopStrength(obs.hole),threshold=.80-s.looseness*.36-(late?.06+(obs.traits?.positionShift??0):0)-(headsUp?.11:0)-response.preflopAdjustment;
    const pressure=Math.min(.29,Math.max(0,callBB-2)*.012)+raises*.032;
    const facingRaise=raises>0||callBB>2.5;
    // A character may be loose in unopened pots, but cannot turn that into a
    // routine defence of 3-bets/4-bets or large opens with weak holdings.
    const defendFloor=clamp(.51+raises*.115+Math.min(.17,Math.max(0,callBB-2)*.012)+(live.length>1?.025:0),.51,.86);
    if(facingRaise&&strength<defendFloor)return fallback();
    let enter=sigmoid((strength-threshold-pressure*s.discipline)/.055);
    if(callBB>18&&strength<.89)enter*=1-s.discipline*.72;
    const bluff=facingRaise?0:s.bluff*(late||headsUp?1:.48)*bluffMemory/(1+Math.max(0,callBB-4)*.06);
    if(random()>clamp(enter+bluff,0,.995))return fallback();
    const premium=strength>.88,slowPlay=(obs.plan?.slowPlay??random())<s.patience;
    const raiseChance=facingRaise?(premium?(slowPlay?.10:.24+s.aggression*.22):0):(premium?(slowPlay?.24:.68+s.aggression*.18):s.aggression*.8);
    if(l.canRaise&&random()<raiseChance)return raise();
    return {action:l.canCheck?'check':'call'};
  }
  const equity=estimateEquity(obs,random,obs.style==='GRINDER'?140:100);
  const perceived=clamp(equity+(random()-.5)*(.025+(1-s.discipline)*.05+(1-s.level)*.045)),multiway=live.length>1;
  const ranks=obs.hole.map(c=>RANKS.indexOf(c[0])+2),known=[...obs.hole,...obs.board],unique=new Set(known.map(c=>RANKS.indexOf(c[0])+2));if(unique.has(14))unique.add(1);
  const flushDraw=obs.board.length<5&&obs.hole.some(c=>known.filter(x=>x[1]===c[1]).length===4);
  const straightDraw=obs.board.length<5&&Array.from({length:10},(_,i)=>i+5).some(hi=>[0,1,2,3,4].filter(d=>unique.has(hi-d)).length===4&&ranks.some(r=>r>=hi-4&&r<=hi));
  const hasDraw=flushDraw||straightDraw,callMargin=(.5-s.looseness)*.16+raises*.018*s.discipline+(obs.traits?.callCaution??0);
  const opponent=obs.players.find(p=>p.id===aggressor),loose=opponent?.stats.hands>=10&&opponent.stats.vpip/opponent.stats.hands>.50;
  // Treat the player's thinking time as a noisy public tell. A long pause
  // before a bet/call can mean strength, while a snap action can invite a
  // little more pressure; neither signal is allowed to dominate the cards.
  const heroThink=obs.timing?.lastHeroActionMs,heroTimingRead=heroThink===null||heroThink===undefined?0:heroThink>=8000?.035:heroThink<=1500?-.025:0;
  const priceToPot=l.toCall/Math.max(1,obs.pot),stackRisk=l.toCall/Math.max(1,obs.stack),priceMargin=.02+(1-s.level)*.035+(priceToPot>=.75?.05:0);
  const gap=perceived+response.callAdjustment+(loose&&obs.style==='GRINDER'?.04:0)-potOdds-callMargin-priceMargin-heroTimingRead;
  const continueChance=sigmoid(gap/.048);
  // Large calls and stack-committing decisions need enough direct equity.
  // Draws get only a modest exception and never justify a blind stack-off.
  if(!l.canCheck){
    const minimumEquity=potOdds+priceMargin;
    if(!hasDraw&&perceived<minimumEquity)return {action:'fold'};
    if(priceToPot>=1&&perceived<.60+(multiway?.04:0))return {action:'fold'};
    if(stackRisk>=.50&&perceived<.68)return {action:'fold'};
  }
  // Value hands, draws and occasional air share actions, but pressure and
  // multiway pots sharply constrain bluffs to protect long-run EV.
  const bluff=s.bluff*bluffMemory*(hasDraw?1.15:obs.board.length===5?.32:.52)*(multiway?.35:1)/(1+raises*1.15+priceToPot*.8);
  const continueRoll=random(),raiseRoll=random();
  if(!l.canCheck&&continueRoll>clamp(continueChance+bluff*.4,0,.998))return {action:'fold'};
  const value=sigmoid((perceived-(.57+(.5-s.aggression)*.17))/.07);
  const slowPlay=perceived>.74&&(obs.plan?.slowPlay??.5)<s.patience;
  let raiseChance=value*(.24+s.aggression*.6)+bluff*(1-value);
  if(slowPlay)raiseChance*=.35;
  if(raises>=1&&perceived<.68)raiseChance*=1-s.discipline*.82;
  if(stackRisk>=.40&&perceived<.75)raiseChance*=.18;
  if(l.canRaise&&raiseRoll<clamp(raiseChance,.015,.91))return raise();
  return {action:l.canCheck?'check':'call'};
}

const timingRange=(random,min,max)=>Math.min(10000,Math.max(1000,Math.round(min+random()*(max-min))));
export function chooseBotTiming(obs,decision,random=Math.random){
  const action=decision?.action;
  const snap=()=>timingRange(random,1000,1800),normal=()=>timingRange(random,2000,4000);
  if(action==='fold')return random()<.16?{delayMs:snap(),kind:'snap-fold'}:{delayMs:normal(),kind:'thinking-fold'};
  if(action==='check')return random()<.16?{delayMs:snap(),kind:'snap-check'}:{delayMs:normal(),kind:'thinking-check'};
  const strength=obs.street==='preflop'?preflopStrength(obs.hole):estimateEquity(obs,random,18);
  if(action==='call'){
    // A strong hand may deliberately take the long line to disguise a call.
    if(strength>=.78&&random()<.20)return {delayMs:timingRange(random,6500,10000),kind:'slow-call'};
    if(random()<.14)return {delayMs:snap(),kind:'snap-call'};
    return {delayMs:normal(),kind:'thinking-call'};
  }
  if(action==='raise'){
    if(strength>=.82&&random()<.20)return {delayMs:timingRange(random,6500,10000),kind:'slow-raise'};
    if(random()<.12)return {delayMs:snap(),kind:'snap-raise'};
    return {delayMs:normal(),kind:'thinking-raise'};
  }
  return {delayMs:normal(),kind:'thinking-action'};
}
