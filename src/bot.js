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
  return {looseness:clamp(base.looseness*.72+.42*.28+(t.rangeShift??0)+(p.rangeShift??0)+(weak?-.10:over?.08:0),.08,.91),aggression:clamp(base.aggression*.72+.5*.28+(t.aggressionShift??0)+(p.aggressionShift??0)+(weak?-.16:over?.12:0),.12,.9),bluff:clamp(base.bluff*.68+.10*.32+(t.bluffShift??0)+(weak?-.035:over?.04:0),.018,.35),discipline:clamp(base.discipline*.8+.65*.2+(weak?-.08:over?-.04:0)+(level-.5)*.12,.16,.97),sizing:base.sizing*.45+.66*.55+(t.sizingShift??0)+(over?.08:0),patience:clamp((t.patience??.18)+(level-.5)*.06,.04,.4),level};
}
export function chooseBotAction(obs,random=Math.random){
  const s=decisionProfile(obs),l=obs.legal;if(!l)throw new Error('电脑没有合法行动');
  const fishMode=s.level>=.86&&['low','mid'].includes(obs.stakeLevel)&&random()<.08;
  if(fishMode){s.looseness=clamp(s.looseness+.07,.08,.95);s.aggression=clamp(s.aggression+.06,.12,.95);s.bluff=clamp(s.bluff+.035,.018,.4);}
  const count=obs.players.length,distance=(obs.id-obs.button+count)%count,late=distance===0||distance===count-1,headsUp=count===2;
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
  // Low-level profiles occasionally take an action that is visibly outside
  // their normal card range. This is bounded, legal, and makes “不理智” a
  // consequence of level rather than an uncontrolled random crash.
  const irrationalChance=clamp((.56-s.level)*.20,0,.11);
  if(irrationalChance&&random()<irrationalChance){
    const choices=[];if(l.canCheck)choices.push({action:'check'});else choices.push({action:'fold'},{action:'call'});if(l.canRaise)choices.push(raise());
    return choices[Math.floor(random()*choices.length)];
  }
  if(obs.street==='preflop'){
    const strength=preflopStrength(obs.hole),threshold=.80-s.looseness*.36-(late?.06+(obs.traits?.positionShift??0):0)-(headsUp?.11:0)-response.preflopAdjustment;
    const pressure=Math.min(.29,Math.max(0,callBB-2)*.012)+raises*.032;
    let enter=sigmoid((strength-threshold-pressure*s.discipline)/.055);
    if(callBB>18&&strength<.89)enter*=1-s.discipline*.72;
    const bluff=s.bluff*(late||headsUp?1:.48)*bluffMemory/(1+raises*.85+Math.max(0,callBB-4)*.06);
    if(random()>clamp(enter+bluff,0,.995))return fallback();
    const premium=strength>.88,slowPlay=(obs.plan?.slowPlay??random())<s.patience;
    const raiseChance=premium?(slowPlay?.24:.68+s.aggression*.18):s.aggression*(raises?.52:.8);
    if(l.canRaise&&random()<raiseChance)return raise();
    return {action:l.canCheck?'check':'call'};
  }
  const equity=estimateEquity(obs,random,obs.style==='GRINDER'?140:100);
  const perceived=clamp(equity+(random()-.5)*((1-s.discipline)*.16+(1-s.level)*.12)),multiway=live.length>1;
  const ranks=obs.hole.map(c=>RANKS.indexOf(c[0])+2),known=[...obs.hole,...obs.board],unique=new Set(known.map(c=>RANKS.indexOf(c[0])+2));if(unique.has(14))unique.add(1);
  const flushDraw=obs.board.length<5&&obs.hole.some(c=>known.filter(x=>x[1]===c[1]).length===4);
  const straightDraw=obs.board.length<5&&Array.from({length:10},(_,i)=>i+5).some(hi=>[0,1,2,3,4].filter(d=>unique.has(hi-d)).length===4&&ranks.some(r=>r>=hi-4&&r<=hi));
  const hasDraw=flushDraw||straightDraw,callMargin=(.5-s.looseness)*.16+raises*.018*s.discipline+(obs.traits?.callCaution??0);
  const opponent=obs.players.find(p=>p.id===aggressor),loose=opponent?.stats.hands>=10&&opponent.stats.vpip/opponent.stats.hands>.50;
  // Treat the player's thinking time as a noisy public tell. A long pause
  // before a bet/call can mean strength, while a snap action can invite a
  // little more pressure; neither signal is allowed to dominate the cards.
  const heroThink=obs.timing?.lastHeroActionMs,heroTimingRead=heroThink===null||heroThink===undefined?0:heroThink>=8000?.035:heroThink<=1500?-.025:0;
  const gap=perceived+response.callAdjustment+(loose&&obs.style==='GRINDER'?.04:0)-potOdds-callMargin-heroTimingRead;
  const continueChance=sigmoid(gap/.048);
  // Value hands, draws and occasional air share actions; pressure controls the air frequency.
  const bluff=s.bluff*bluffMemory*(hasDraw?1.25:obs.board.length===5?.45:.65)*(multiway?.5:1)/(1+raises*.8);
  const continueRoll=random(),raiseRoll=random();
  if(!l.canCheck&&continueRoll>clamp(continueChance+bluff*.4,0,.998))return {action:'fold'};
  const value=sigmoid((perceived-(.57+(.5-s.aggression)*.17))/.07);
  const slowPlay=perceived>.74&&(obs.plan?.slowPlay??.5)<s.patience;
  let raiseChance=value*(.24+s.aggression*.6)+bluff*(1-value);
  if(slowPlay)raiseChance*=.35;
  if(raises>=2&&perceived<.65)raiseChance*=1-s.discipline*.8;
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
