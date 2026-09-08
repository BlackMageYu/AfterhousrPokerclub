import {newDeck, shuffle, evaluate, RANKS} from './cards.js';
import {STYLES} from './styles.js';
import {memoryResponse} from './memory.js';

// Explicit information boundary: neither opponent hole cards nor the real deck enter this object.
export function botObservation(engine, id) {
  const p=engine.players[id],h=engine.hand;
  const actions=h.events.filter(e=>e.type==='action'),lastHeroAction=[...actions].reverse().find(e=>e.playerId===0&&Number.isSafeInteger(e.thinkTimeMs));
  // Important hands contain only public results and voluntarily exposed-card
  // signals.  They are a short-lived table-image input, never hidden cards.
  return {id,handNumber:h.number,style:p.style,level:Number(p.level??p.playerCard?.level??p.skill??.5),playerCard:p.playerCard?{...p.playerCard}:undefined,stakeLevel:engine.config.stakeLevel,traits:{...engine.botTraits?.[id]},plan:{...h.botPlans?.[id]},tilt:p.tilt?{...p.tilt}:null,hole:[...p.hole],stack:p.stack,streetBet:p.streetBet,board:[...h.board],street:h.street,button:h.button,bb:engine.config.bb,pot:engine.pot(),legal:engine.legal(id),memory:structuredClone(engine.memories?.[id]??{}),importantHands:structuredClone((engine.importantHands??[]).slice(-8)),timing:{lastHeroActionMs:lastHeroAction?.thinkTimeMs??null},players:engine.players.map(o=>({id:o.id,stack:o.stack,folded:o.folded,allIn:o.allIn,totalBet:o.totalBet,status:o.status,stats:{...o.stats}})),actions:actions.map(e=>({playerId:e.playerId,action:e.action,street:e.street,amount:e.amount,raiseTo:e.raiseTo,thinkTimeMs:e.thinkTimeMs??null}))};
}
export function preflopStrength(hole) {
  const r=hole.map(c=>RANKS.indexOf(c[0])+2).sort((a,b)=>b-a),[a,b]=r;
  if (a===b) return 0.48+(a-2)*0.041;
  return Math.min(0.96,0.10+a/24+b/48+(hole[0][1]===hole[1][1]?0.065:0)+(a-b===1?0.045:a-b===2?0.02:0)-(a-b>4?0.05:0));
}
export function estimateEquity(obs, random=Math.random, samples=90) {
  const opponents=obs.players.filter(p=>p.id!==obs.id&&!p.folded);
  if (!opponents.length) return 1;
  const known=new Set([...obs.hole,...obs.board]),unknown=newDeck().filter(c=>!known.has(c));let wins=0;
  for (let i=0;i<samples;i++) {
    // Opponent cards are sampled from a range reconstructed only from public
    // actions, position and observed tendencies.  They are dealt before the
    // unseen board, so this cannot learn the real hidden cards or future runout.
    let deck=[...unknown],opponentHoles=[];
    for(const opponent of opponents){
      const hole=sampleOpponentRange(obs,opponent.id,deck,random);opponentHoles.push(hole);
      const removed=new Set(hole);deck=deck.filter(card=>!removed.has(card));
    }
    const board=[...obs.board],runout=shuffle(deck,random);while(board.length<5)board.push(runout.pop());
    const score=evaluate([...obs.hole,...board]).score;let tied=1,lost=false;
    for(const hole of opponentHoles){const other=evaluate([...hole,...board]).score;if(other>score){lost=true;break;}if(other===score)tied++;}
    if (!lost) wins+=1/tied;
  }
  return wins/samples;
}
const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
const sigmoid=n=>1/(1+Math.exp(-n));
const rankOf=card=>RANKS.indexOf(card?.[0])+2;
const straightWindows=()=>Array.from({length:10},(_,i)=>{
  const high=i+5;
  return high===5?[5,4,3,2,1]:[high,high-1,high-2,high-3,high-4];
});
const rankSet=cards=>{
  const ranks=new Set(cards.map(rankOf).filter(rank=>rank>=2));
  if(ranks.has(14))ranks.add(1);
  return ranks;
};
const containsStraight=ranks=>straightWindows().some(window=>window.every(rank=>ranks.has(rank)));

// Finds draws which can complete with the very next public card. The equity
// simulator still values made hands and backdoor possibilities; this helper
// is deliberately narrower so a bot can make a clear pot-odds decision when
// it is genuinely buying a flush or a straight.
export function drawProfile(hole=[],board=[]){
  const known=[...hole,...board],canCompleteNext=board.length===3||board.length===4;
  if(!canCompleteNext||known.length!==new Set(known).size)return {active:false,kinds:[],outs:0,flushOuts:0,straightOuts:0,nextCardChance:0};
  const unseen=newDeck().filter(card=>!known.includes(card)),outs=new Set(),kinds=[];
  let flushOuts=0;
  for(const suit of ['s','h','d','c']){
    const count=known.filter(card=>card[1]===suit).length,usesHole=hole.some(card=>card[1]===suit);
    if(count===4&&usesHole){
      const cards=unseen.filter(card=>card[1]===suit);for(const card of cards)outs.add(card);
      flushOuts=Math.max(flushOuts,cards.length);
    }
  }
  if(flushOuts)kinds.push('flush');
  const ranks=rankSet(known);
  let straightOutCards=[];
  if(!containsStraight(ranks)){
    straightOutCards=unseen.filter(card=>{
      const after=new Set(ranks),rank=rankOf(card);after.add(rank);if(rank===14)after.add(1);
      return containsStraight(after);
    });
    for(const card of straightOutCards)outs.add(card);
  }
  const straightOutRanks=[...new Set(straightOutCards.map(rankOf))];
  if(straightOutRanks.length){
    const endpointOuts=new Set();
    for(const window of straightWindows()){
      const missing=window.filter(rank=>!ranks.has(rank));
      if(missing.length===1&&(missing[0]===window[0]||missing[0]===window.at(-1)))endpointOuts.add(missing[0]===1?14:missing[0]);
    }
    if(endpointOuts.size>=2&&straightOutRanks.every(rank=>endpointOuts.has(rank)))kinds.push('open_ended_straight');
    else if(straightOutRanks.length>=2)kinds.push('double_gutshot');
    else kinds.push('gutshot');
  }
  return {active:outs.size>0,kinds,outs:outs.size,flushOuts,straightOuts:straightOutCards.length,nextCardChance:outs.size/Math.max(1,unseen.length)};
}
const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
const statRate=(player,key)=>{
  const hands=numeric(player?.stats?.hands);
  return hands>=8?numeric(player.stats?.[key])/hands:null;
};
function boardTexture(hole=[],board=[]){
  const ranks=rankSet(board),boardRanks=board.map(rankOf),suits=['s','h','d','c'].map(suit=>({suit,count:board.filter(card=>card[1]===suit).length})).sort((a,b)=>b.count-a.count),dominant=suits[0]??{suit:'',count:0};
  const straightPressure=Math.max(0,...straightWindows().map(window=>window.filter(rank=>ranks.has(rank)).length));
  const paired=new Set(boardRanks).size<boardRanks.length,monotone=dominant.count>=3,connected=straightPressure>=3;
  const wetness=clamp((dominant.count>=3?.38:dominant.count===2?.15:0)+(straightPressure>=4?.38:straightPressure===3?.20:0)+(paired?.12:0),0,1);
  const made=board.length>=3?evaluate([...hole,...board]).category:null,highest=Math.max(0,...boardRanks),holeRanks=hole.map(rankOf);
  const topPair=board.length>=3&&holeRanks.includes(highest),overpair=board.length>=3&&holeRanks[0]===holeRanks[1]&&holeRanks[0]>highest;
  return {wetness,wet:wetness>=.38,dry:wetness<=.18,paired,monotone,connected,dominantSuit:dominant.suit,dominantSuitCount:dominant.count,madeCategory:made,topPair,overpair,nutFlushBlocker:dominant.count>=2&&hole.some(card=>card[1]===dominant.suit&&rankOf(card)===14),broadwayBlockers:holeRanks.filter(rank=>rank>=12).length};
}
function positionContext(obs){
  const seated=(obs.players??[]).filter(player=>player.status!=='empty'&&player.status!=='busted').length||Math.max(2,(obs.players??[]).length),distance=(obs.button-obs.id+seated)%seated;
  if(seated===2)return {label:'heads_up',openingAdjustment:.07,late:true};
  if(distance===0)return {label:'button',openingAdjustment:.07,late:true};
  if(distance===seated-1)return {label:'cutoff',openingAdjustment:.045,late:true};
  if(distance===seated-2)return {label:'hijack',openingAdjustment:.018,late:false};
  if(distance<=2)return {label:'early',openingAdjustment:-.035,late:false};
  return {label:'middle',openingAdjustment:-.008,late:false};
}
function opponentContext(obs){
  const opponents=(obs.players??[]).filter(player=>player.id!==obs.id&&!player.folded),known=opponents.filter(player=>numeric(player.stats?.hands)>=8),vpip=known.length?known.reduce((sum,player)=>sum+statRate(player,'vpip'),0)/known.length:null,pfr=known.length?known.reduce((sum,player)=>sum+statRate(player,'pfr'),0)/known.length:null;
  return {sampled:known.length>0,vpip,pfr,loose:vpip!==null&&vpip>=.42,tight:vpip!==null&&vpip<=.22,aggressive:pfr!==null&&pfr>=.21,passive:pfr!==null&&pfr<=.10};
}

// Large-pot results are memorable at a real table, but one win must never be
// mistaken for proof of a range.  This preserves only a small, decaying public
// image signal: aggression, a voluntarily shown value hand, or a voluntarily
// shown bluff.  The raw cards of unshown folded hands are never present here.
export function importantHandContext(obs){
  const hands=(obs.importantHands??[]).filter(hand=>Number(hand?.potBB)>=100).slice(-8),current=Number(obs.handNumber??0),byPlayer={};
  for(const hand of hands){
    const age=Math.max(0,current-Number(hand.handNumber??current)),weight=Math.pow(.62,Math.max(0,age-1));
    for(const player of hand.players??[]){
      if(!Number.isInteger(player?.playerId))continue;
      const image=byPlayer[player.playerId]??={aggression:0,value:0,bluff:0,wins:0,shows:0,lastPotBB:0};
      image.aggression+=player.aggressive?weight:0;
      image.wins+=player.won?weight:0;
      image.shows+=player.voluntaryShow?weight:0;
      image.value+=player.showTag==='value'?weight:0;
      image.bluff+=['air_bluff','draw_bluff','wide_open'].includes(player.showTag)?weight:0;
      image.lastPotBB=Math.max(image.lastPotBB,Number(hand.potBB)||0);
    }
  }
  return {count:hands.length,lastPotBB:Math.max(0,...hands.map(hand=>Number(hand.potBB)||0)),byPlayer};
}

// Public information only: this is shared by local decisions and the compact
// external-AI prompt. It lets the bots reason about real cash-game factors
// without learning anyone else's cards or the remaining deck.
export function decisionContext(obs){
  const position=positionContext(obs),opponents=(obs.players??[]).filter(player=>player.id!==obs.id&&!player.folded),effectiveStack=Math.min(numeric(obs.stack),...opponents.map(player=>numeric(player.stack)).filter(stack=>stack>0)),pot=Math.max(1,numeric(obs.pot)),texture=boardTexture(obs.hole,obs.board),draw=drawProfile(obs.hole,obs.board),preflopAggressor=[...(obs.actions??[])].reverse().find(action=>action.street==='preflop'&&action.action==='raise')?.playerId;
  const spr=Math.max(0,(Number.isFinite(effectiveStack)?effectiveStack:numeric(obs.stack))/pot),showdownValue=texture.madeCategory!==null&&(texture.madeCategory>=2||texture.topPair||texture.overpair);
  return {position,initiative:preflopAggressor===obs.id,effectiveStack:Number.isFinite(effectiveStack)?effectiveStack:numeric(obs.stack),spr,lowSpr:spr<=3,deepSpr:spr>=7,texture,draw,opponents:opponentContext(obs),important:importantHandContext(obs),showdownValue,potControl:!draw.active&&texture.madeCategory!==null&&texture.madeCategory<=1&&!texture.topPair&&!texture.overpair&&spr>=5};
}

// Reconstruct a deliberately coarse opponent range using only public actions,
// position and observed VPIP/PFR. It is not a solver range: the purpose is to
// stop local equity from treating a 3-bettor exactly like a limper.
export function opponentRangeProfile(obs,playerId){
  const player=(obs.players??[]).find(entry=>entry.id===playerId)??{},position=positionContext({...obs,id:playerId}),preflopActions=(obs.actions??[]).filter(action=>action.street==='preflop'),preflop=preflopActions.filter(action=>action.playerId===playerId),allActions=(obs.actions??[]).filter(action=>action.playerId===playerId),vpip=statRate(player,'vpip'),pfr=statRate(player,'pfr');
  let floor=.18,raises=0,calls=0;
  for(const action of preflop){
    const earlierRaises=preflopActions.slice(0,preflopActions.indexOf(action)).filter(entry=>entry.action==='raise'||entry.action==='allin').length;
    if(action.action==='raise'||action.action==='allin'){
      raises++;floor=Math.max(floor,earlierRaises===0?.53-position.openingAdjustment*.65:.64+Math.min(.18,earlierRaises*.08));
    }else if(action.action==='call'){
      calls++;floor=Math.max(floor,earlierRaises===0?.25:.42+Math.min(.16,earlierRaises*.07));
    }
  }
  // A low-PFR player who raises is usually stronger; a high-VPIP/PFR player
  // is allowed a somewhat wider public range, but never a random-card range.
  if(pfr!==null)floor+=clamp((.18-pfr)*.14,-.04,.045);
  if(vpip!==null)floor-=clamp((vpip-.28)*.09,-.04,.045);
  const postflop=allActions.filter(action=>action.street!=='preflop'),postflopAggression=postflop.filter(action=>action.action==='raise'||action.action==='allin').length,postflopCalls=postflop.filter(action=>action.action==='call').length;
  return {preflopFloor:Math.round(clamp(floor,.16,.90)*1000)/1000,raises,calls,postflopAggression,postflopCalls,position:position.label,sampled:vpip!==null||pfr!==null};
}

// Weight a hypothetical two-card holding against the public range above. The
// caller supplies only candidate cards from the unseen deck; no actual hidden
// opponent card is ever read here.
export function opponentRangeWeight(obs,playerId,hole){
  const profile=opponentRangeProfile(obs,playerId),ranks=hole.map(rankOf).sort((a,b)=>b-a),pair=ranks[0]===ranks[1],suited=hole[0]?.[1]===hole[1]?.[1],connected=Math.abs(ranks[0]-ranks[1])<=1;
  let weight=Math.pow(sigmoid((preflopStrength(hole)-profile.preflopFloor)/.055),1.3);
  if(pair)weight*=1.14;
  if(suited)weight*=profile.calls>0?1.12:1.05;
  if(connected&&profile.calls>0)weight*=1.08;
  if((obs.board??[]).length>=3){
    const texture=boardTexture(hole,obs.board),draw=drawProfile(hole,obs.board),strong=texture.madeCategory>=2||texture.topPair||texture.overpair,memory=obs.memory?.[playerId]??{},bluffTail=clamp(numeric(memory.bluffWeight)*.14+numeric(memory.wideWeight)*.06,0,.22);
    // A seen bluff does not make a bet weak by default, but it restores a
    // bounded bluff tail to the opponent range for later bluff-catch spots.
    if(profile.postflopAggression>0)weight*=strong?1:draw.active?.66+bluffTail*.35:.20+bluffTail;
    else if(profile.postflopCalls>0)weight*=strong?1:draw.active?.78:.38;
  }
  return clamp(weight,.004,.995);
}

function sampleOpponentRange(obs,playerId,deck,random){
  if(deck.length<2)throw new Error('范围模拟没有足够的未知牌');
  let best=[deck[0],deck[1]],bestWeight=0;
  // Rejection sampling keeps a range draw inexpensive even in multiway pots.
  for(let attempt=0;attempt<24;attempt++){
    const first=Math.floor(random()*deck.length),second=(first+1+Math.floor(random()*(deck.length-1)))%deck.length,hole=[deck[first],deck[second]],weight=opponentRangeWeight(obs,playerId,hole);
    if(weight>bestWeight){best=hole;bestWeight=weight;}
    if(random()<weight)return hole;
  }
  return best;
}

export function equitySampleCount(obs){
  const opponents=(obs.players??[]).filter(player=>player.id!==obs.id&&!player.folded).length,potBB=numeric(obs.pot)/Math.max(1,numeric(obs.bb)),pressure=numeric(obs.legal?.toCall)/Math.max(1,numeric(obs.pot)),lateStreet=(obs.board??[]).length>=4;
  if(lateStreet&&(potBB>=25||opponents>=2||pressure>=.50))return 700;
  if(lateStreet)return 300;
  return 160;
}
export function decisionProfile(obs){
  const base=STYLES[obs.style];if(!base)throw new Error('未知电脑风格');
  const t=obs.traits??{},p=obs.plan??{};
  const tilt=obs.tilt,weak=tilt?.strength==='weakened',over=tilt?.strength==='overconfident';
  const level=clamp(Number(obs.level??(.75+(t.levelShift??-.25))));
  // The roster is intentionally centred, but the historical style names still
  // need a small, readable difference at low-risk decisions. This is a
  // tendency, not permission to defend bad prices or gamble into big pots.
  const rangeTendency={NIT:-.012,TAG:0,TP:-.008,LAG:.008,LP:.003,MANIAC:.035,GRINDER:-.002}[obs.style]??0;
  const aggressionTendency={NIT:-.018,TAG:0,TP:-.075,LAG:.012,LP:-.012,MANIAC:.018,GRINDER:.004}[obs.style]??0;
  // A style changes marginal choices; it never gives a character license to
  // burn chips. Even the loosest profile keeps a meaningful EV/risk floor.
  return {looseness:clamp(base.looseness*.55+.42*.45+rangeTendency+(t.rangeShift??0)+(p.rangeShift??0)+(weak?-.07:over?.05:0),.16,.74),aggression:clamp(base.aggression*.55+.54*.45+aggressionTendency+(t.aggressionShift??0)+(p.aggressionShift??0)+(weak?-.10:over?.07:0),.32,.76),bluff:clamp(base.bluff*.62+.09*.38+(t.bluffShift??0)+(weak?-.02:over?.02:0),.018,.19),discipline:clamp(base.discipline*.55+.70*.45+(weak?-.04:over?-.025:0)+(level-.5)*.10,.54,.93),sizing:base.sizing*.55+.64*.45+(t.sizingShift??0)+(over?.05:0),patience:clamp((t.patience??.18)+(level-.5)*.06,.04,.4),level};
}
export function chooseBotAction(obs,random=Math.random){
  const s=decisionProfile(obs),l=obs.legal;if(!l)throw new Error('电脑没有合法行动');
  const context=decisionContext(obs),count=obs.players.length,late=context.position.late,headsUp=count===2;
  const live=obs.players.filter(p=>p.id!==obs.id&&!p.folded),raises=obs.actions.filter(a=>a.street===obs.street&&a.action==='raise').length;
  const aggressor=[...obs.actions].reverse().find(a=>a.action==='raise'&&live.some(p=>p.id===a.playerId))?.playerId;
  const response=memoryResponse(obs.style,obs.memory?.[aggressor]);
  const importantImage=context.important.byPlayer[aggressor]??{aggression:0,value:0,bluff:0,wins:0,shows:0};
  // Major-pot history nudges a marginal range only.  A voluntarily revealed
  // bluff loosens a bluff-catch slightly; a revealed value hand or repeated
  // large-pot aggression tightens it.  Pot odds and direct equity remain the
  // dominant terms below.
  const imageCaution=clamp(importantImage.value*.020+importantImage.aggression*.006+importantImage.wins*.003-importantImage.bluff*.016,-.022,.034);
  const imageCallAdjustment=clamp(importantImage.bluff*.024-importantImage.value*.028-importantImage.aggression*.008,-.042,.034);
  const tableValueImage=live.length?live.reduce((sum,player)=>sum+((context.important.byPlayer[player.id]?.value??0)+(context.important.byPlayer[player.id]?.aggression??0)*.25),0)/live.length:0;
  const bluffMemory=live.length?live.reduce((n,p)=>n+memoryResponse(obs.style,obs.memory?.[p.id]).bluffMultiplier,0)/live.length:1;
  const callBB=l.fullToCall/obs.bb,potOdds=l.toCall/(l.eligiblePotAfterCall||1),fallback=()=>({action:l.canCheck?'check':'fold'});
  const raise=()=>{
    if(!l.canRaise)return {action:l.canCheck?'check':'call'};
    // Shared, overlapping sizes prevent a player's bet amount from advertising its type.
    const mix=random()*.75+(obs.plan?.sizeMix??.5)*.25,fractions=[.33,.5,.66,.75,1],textureMultiplier=obs.street==='preflop'?1:context.texture.wet?1.10:context.texture.dry?.94:1,fraction=fractions[Math.min(4,Math.floor(mix*5))]*(.82+s.sizing*.28)*textureMultiplier;
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
    const strength=preflopStrength(obs.hole),holeRanks=obs.hole.map(rankOf),pocketPair=holeRanks[0]===holeRanks[1],threshold=.80-s.looseness*.36-context.position.openingAdjustment-(obs.traits?.positionShift??0)-(headsUp?.11:0)-response.preflopAdjustment+imageCaution;
    const pressure=Math.min(.29,Math.max(0,callBB-2)*.012)+raises*.032;
    const facingRaise=raises>0||callBB>2.5;
    // A character may be loose in unopened pots, but cannot turn that into a
    // routine defence of 3-bets/4-bets or large opens with weak holdings.
    const defendFloor=clamp(.51+raises*.115+Math.min(.17,Math.max(0,callBB-2)*.012)+(live.length>1?.025:0)+(context.position.openingAdjustment<0?.025:0)+imageCaution,.51,.86);
    const setMine=pocketPair&&raises===1&&l.toCall>0&&callBB<=12&&context.effectiveStack/Math.max(1,l.toCall)>=14;
    if(facingRaise&&strength<defendFloor&&!setMine)return fallback();
    if(setMine&&strength<defendFloor)return {action:'call'};
    let enter=sigmoid((strength-threshold-pressure*s.discipline)/.055);
    if(callBB>18&&strength<.89)enter*=1-s.discipline*.72;
    const bluff=facingRaise?0:s.bluff*(late||headsUp?1:.48)*bluffMemory/(1+Math.max(0,callBB-4)*.06);
    if(random()>clamp(enter+bluff,0,.995))return fallback();
    const premium=strength>.88,slowPlay=(obs.plan?.slowPlay??random())<s.patience;
    const raiseChance=facingRaise?(premium?(slowPlay?.10:.24+s.aggression*.22):0):(premium?(slowPlay?.24:.68+s.aggression*.18):s.aggression*.8);
    if(l.canRaise&&random()<raiseChance)return raise();
    return {action:l.canCheck?'check':'call'};
  }
  const equity=estimateEquity(obs,random,equitySampleCount(obs));
  const perceived=clamp(equity+(random()-.5)*(.025+(1-s.discipline)*.05+(1-s.level)*.045)),multiway=live.length>1;
  const draw=context.draw,hasDraw=draw.active,callMargin=(.5-s.looseness)*.16+raises*.018*s.discipline+(obs.traits?.callCaution??0)+(context.texture.wet&&multiway?.018:0);
  const opponent=obs.players.find(p=>p.id===aggressor),loose=opponent?.stats.hands>=10&&opponent.stats.vpip/opponent.stats.hands>.50;
  // Treat the player's thinking time as a noisy public tell. A long pause
  // before a bet/call can mean strength, while a snap action can invite a
  // little more pressure; neither signal is allowed to dominate the cards.
  const heroThink=obs.timing?.lastHeroActionMs,heroTimingRead=heroThink===null||heroThink===undefined?0:heroThink>=8000?.035:heroThink<=1500?-.025:0;
  const priceToPot=l.toCall/Math.max(1,obs.pot),stackRisk=l.toCall/Math.max(1,obs.stack),sizingMargin=priceToPot>=1?.075:priceToPot>=.75?.045:priceToPot<=.34?-.012:0,priceMargin=.02+(1-s.level)*.035+sizingMargin+(context.texture.wet&&multiway?.012:0),opponentRead=(context.opponents.loose?.022:0)-(context.opponents.tight?.024:0)+(context.opponents.aggressive?.012:0)-(context.opponents.passive?.010:0);
  const gap=perceived+response.callAdjustment+imageCallAdjustment+opponentRead+(loose&&obs.style==='GRINDER'?.04:0)-potOdds-callMargin-priceMargin-heroTimingRead-(context.potControl?.018:0);
  const continueChance=sigmoid(gap/.048);
  const facingAllIn=l.toCall>0&&live.some(player=>player.allIn);
  // Compare next-card probability with the immediate price. A small
  // implied-odds allowance is valid only in a non-all-in pot and never turns
  // a large or stack-committing wager into a blind draw call.
  const impliedOdds=(draw.outs>=8?.035:draw.outs>=4?.015:0)-(draw.kinds.includes('flush')&&!context.texture.nutFlushBlocker?.008:0)-(context.texture.paired?.006:0);
  const drawPriceSupported=hasDraw&&!facingAllIn&&draw.nextCardChance+impliedOdds>=potOdds+priceMargin*.35&&priceToPot<.85&&stackRisk<.45;
  // Large calls and stack-committing decisions need enough direct equity.
  // A direct flush/straight draw gets an explicit price check. Equity still
  // governs all-in calls, made hands, and situations with more cards to come.
  if(!l.canCheck){
    const minimumEquity=potOdds+priceMargin;
    // A modest river bluff-catch is allowed only after public bluff evidence,
    // at a favourable price and with some showdown value. This keeps one seen
    // bluff from making the bot spew, while letting table image matter.
    const informedRiverBluffCatch=obs.street==='river'&&!hasDraw&&response.callAdjustment>=.018&&potOdds<=.38&&perceived>=.16;
    if(!hasDraw&&perceived<minimumEquity&&!informedRiverBluffCatch)return {action:'fold'};
    if(priceToPot>=1&&perceived<.60+(multiway?.04:0))return {action:'fold'};
    if(stackRisk>=.50&&perceived<.68)return {action:'fold'};
    if(hasDraw&&drawPriceSupported){
      const semiBluffChance=draw.outs>=8&&!multiway&&raises<2?(.08+s.aggression*.18+s.bluff*.35):0;
      if(l.canRaise&&random()<semiBluffChance)return raise();
      return {action:'call'};
    }
    if(hasDraw&&!facingAllIn&&!drawPriceSupported&&perceived<minimumEquity)return {action:'fold'};
  }
  const streetActions=obs.actions.filter(action=>action.street===obs.street),preflopRaises=obs.actions.filter(action=>action.street==='preflop'&&action.action==='raise'),preflopAggressor=preflopRaises.at(-1)?.playerId;
  const checkedEarlier=streetActions.some(action=>action.playerId===obs.id&&action.action==='check'),cbetSpot=l.canCheck&&obs.street==='flop'&&streetActions.length===0&&preflopAggressor===obs.id;
  const boardWet=context.texture.wet,boardPaired=context.texture.paired;
  // A preflop raiser should not automatically surrender every flop.  This
  // retains multiway and wet-board safeguards while creating genuine c-bets
  // with value, draws and a measured share of credible air.
  if(cbetSpot&&l.canRaise){
    let cbetChance=.29+s.aggression*.34+s.bluff*.55+(perceived>=.56?.18:0)+(hasDraw?.11:0)+(context.texture.dry?.08:0)-(boardWet?.07:0)+(context.opponents.tight?.055:context.opponents.loose?-.06:0)+(context.texture.nutFlushBlocker?.025:0)-(multiway?.18:0);
    if(multiway&&perceived<.38&&!hasDraw)cbetChance*=.42;
    if(random()<clamp(cbetChance,.20,.82))return raise();
  }
  // A limped pot has no c-bet owner, but a clear made hand still needs a
  // value/protection branch.  This is especially important when an external
  // response fails and the local policy takes over: do not turn a six-way
  // checked pot into automatic free cards for top pair or better.
  const madeCategory=context.texture.madeCategory??0,topPairOrOverpair=context.texture.topPair||context.texture.overpair;
  const clearValue=madeCategory>=2||topPairOrOverpair;
  if(l.canCheck&&l.canRaise&&clearValue){
    const madeHandBase=madeCategory>=2?.70:.44;
    let valueBetChance=madeHandBase+s.aggression*.25+(perceived>=.46?.14:0)+(context.texture.dry?.07:0)+(hasDraw?.05:0);
    if(multiway)valueBetChance*=madeCategory>=2?.90:.84;
    if(boardWet&&topPairOrOverpair&&madeCategory<2&&!hasDraw)valueBetChance*=.72;
    if(context.potControl&&madeCategory<2&&!hasDraw)valueBetChance*=.72;
    if(random()<clamp(valueBetChance,.20,.91))return raise();
  }
  // Value hands, draws and occasional air share actions, but pressure and
  // multiway pots sharply constrain bluffs to protect long-run EV.
  const blockerBonus=context.texture.nutFlushBlocker?.06:context.texture.broadwayBlockers>=2?.025:0;
  const bluff=(s.bluff+blockerBonus)*bluffMemory*(hasDraw?1.15:obs.board.length===5?.32:.52)*(context.texture.dry?1.14:boardWet?.68:1)*(context.opponents.tight?1.14:context.opponents.loose?.80:1)*(multiway?.35:1)*clamp(1-tableValueImage*.10,.88,1)/(1+raises*1.15+priceToPot*.8);
  const continueRoll=random(),raiseRoll=random();
  if(!l.canCheck&&continueRoll>clamp(continueChance+bluff*.4,0,.998))return {action:'fold'};
  const value=sigmoid((perceived-(.57+(.5-s.aggression)*.17))/.07);
  const slowPlay=perceived>.74&&(obs.plan?.slowPlay??.5)<s.patience;
  let raiseChance=value*(.30+s.aggression*.62)+bluff*(1-value);
  // After checking first, strong made hands and draws have a distinct
  // check-raise branch instead of degrading into passive calls.
  if(!l.canCheck&&checkedEarlier)raiseChance+=value*(.13+s.aggression*.20)+(hasDraw?.08+s.bluff*.22:0)+bluff*.28;
  if(slowPlay)raiseChance*=.35;
  if(raises>=1&&perceived<.68&&!checkedEarlier)raiseChance*=1-s.discipline*.82;
  if(stackRisk>=.40&&perceived<.75)raiseChance*=.18;
  if(context.lowSpr&&(context.texture.topPair||context.texture.overpair||perceived>=.68))raiseChance+=.08;
  if(context.potControl&&!hasDraw)raiseChance*=.52;
  if(boardWet&&context.texture.madeCategory===1&&!context.texture.topPair&&!hasDraw)raiseChance*=.64;
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
