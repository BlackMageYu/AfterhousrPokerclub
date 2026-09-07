import {evaluate,RANKS} from './cards.js';

export const MEMORY_DECAY=0.94;
const SENSITIVITY={TAG:0.80,TP:0.45,LAG:0.75,LP:0.35,NIT:0.30,MANIAC:0.20,GRINDER:1.00};
const empty=()=>({observedHands:0,bluffWeight:0,valueWeight:0,wideWeight:0,folds:0,foldOpportunities:0,shownHands:0,shownBluffs:0,notes:[]});

// Called only with publicly exposed hole cards. Evaluate the board at the time of the bet,
// not a later board and never the undealt deck. These labels describe evidence, not intent.
export function classifyExposure(cards, actions) {
  const bet=[...actions].reverse().find(a=>a.action==='raise');
  if(!bet)return null;
  const ranks=cards.map(c=>RANKS.indexOf(c[0])+2),board=bet.board??[];
  if(board.length<3){
    const pair=ranks[0]===ranks[1];
    if(!pair && Math.max(...ranks)<=10)return {kind:'wide_open',label:'弱起手牌进攻',weight:0.7,street:bet.street,seq:bet.seq};
    if((pair&&ranks[0]>=11)||Math.min(...ranks)>=12)return {kind:'value',label:'强起手牌进攻',weight:0.45,street:bet.street,seq:bet.seq};
    return null;
  }
  const rank=evaluate([...cards,...board]);
  if(board.length===5&&evaluate(board).score===rank.score)return null;
  const boardRanks=board.map(c=>RANKS.indexOf(c[0])+2);
  const hasPair=ranks[0]===ranks[1]||ranks.some(r=>boardRanks.includes(r));
  const topPair=ranks.some(r=>r===Math.max(...boardRanks)),overPair=ranks[0]===ranks[1]&&ranks[0]>=Math.max(...boardRanks);
  if((rank.category>=2&&(hasPair||rank.category>=4))||topPair||overPair)return {kind:'value',label:'成牌进攻',weight:rank.category>=3?1:0.65,street:bet.street,seq:bet.seq};
  if(hasPair)return null;
  const all=[...cards,...board],set=new Set(all.map(c=>RANKS.indexOf(c[0])+2));if(set.has(14))set.add(1);
  const flushDraw=board.length<5&&cards.some(c=>all.filter(o=>o[1]===c[1]).length===4);
  const straightDraw=board.length<5&&Array.from({length:10},(_,i)=>i+5).some(hi=>[0,1,2,3,4].filter(d=>set.has(hi-d)).length===4&&ranks.some(r=>r>=hi-4&&r<=hi));
  const draw=flushDraw||straightDraw;
  return {kind:draw?'draw_bluff':'air_bluff',label:draw?'听牌进攻':'未成牌进攻',weight:draw?0.35:board.length===5?1:0.80,street:bet.street,seq:bet.seq};
}

export function observePublicHand(engine) {
  const h=engine.hand;if(h.status!=='complete')return;
  engine.memories??={};h.memoryUpdates??=[];
  for(const observer of engine.players.filter(p=>p.id!==0)) {
    const memory=engine.memories[observer.id]??={};
    for(const opponent of engine.players.filter(p=>p.id!==observer.id)) {
      const m=memory[opponent.id]??=empty();
      if(m.lastObservedHand===h.number)continue;
      for(const key of ['bluffWeight','valueWeight','wideWeight','folds','foldOpportunities'])m[key]*=MEMORY_DECAY;
      m.observedHands++;m.lastObservedHand=h.number;
      const faced=h.events.filter(a=>a.type==='action'&&a.playerId===opponent.id&&a.toCallBefore>0);
      if(faced.length){m.foldOpportunities++;if(faced.some(a=>a.action==='fold'))m.folds++;}
    }
  }
  for(const id of h.shownPlayers??[])observeShownCards(engine,id,'showdown');
}

export function observeShownCards(engine,playerId,source='voluntary') {
  const h=engine.hand;
  if(h.status!=='complete'||!h.shownPlayers?.includes(playerId))throw new Error('尚未公开的底牌不能写入对手记忆');
  const player=engine.players[playerId],actions=h.events.filter(a=>a.type==='action'&&a.playerId===playerId);
  const evidence=classifyExposure(player.hole,actions);
  engine.memories??={};h.memoryUpdates??=[];
  for(const observer of engine.players.filter(p=>p.id!==0&&p.id!==playerId)) {
    const memory=engine.memories[observer.id]??={},m=memory[playerId]??=empty();
    if(m.lastShownHand===h.number)continue;
    m.lastShownHand=h.number;m.shownHands++;
    if(evidence?.kind==='value')m.valueWeight+=evidence.weight;
    else if(evidence?.kind==='wide_open'){m.wideWeight+=evidence.weight;m.bluffWeight+=evidence.weight*0.35;}
    else if(evidence){m.bluffWeight+=evidence.weight;m.shownBluffs++;}
    const note={hand:h.number,source,opponentId:playerId,cards:[...player.hole],evidence:evidence??{kind:'neutral',label:'公开底牌，未增加诈唬或价值证据'}};
    m.notes.push(note);if(m.notes.length>24)m.notes.shift();
    h.memoryUpdates.push({observerId:observer.id,...note,weightsAfter:{bluff:m.bluffWeight,value:m.valueWeight,wide:m.wideWeight},response:memoryResponse(observer.style,m)});
  }
}

export function memoryResponse(style, memory) {
  if(!memory)return {callAdjustment:0,preflopAdjustment:0,bluffMultiplier:1};
  const sensitivity=SENSITIVITY[style]??0.5,denominator=4+memory.bluffWeight+memory.valueWeight;
  const callAdjustment=sensitivity*(0.18*memory.bluffWeight-0.12*memory.valueWeight)/denominator;
  const preflopAdjustment=sensitivity*(0.09*memory.wideWeight+0.05*memory.bluffWeight-0.04*memory.valueWeight)/(4+memory.wideWeight+memory.bluffWeight+memory.valueWeight);
  const foldRate=(memory.folds+2)/(memory.foldOpportunities+4),confidence=Math.min(1,memory.foldOpportunities/8);
  const bluffMultiplier=1+sensitivity*confidence*(foldRate-0.5)*0.8;
  return {callAdjustment,preflopAdjustment,bluffMultiplier};
}

export function memorySummary(engine) {
  return engine.players.filter(p=>p.id!==0).map(p=>{
    const m=engine.memories?.[p.id]?.[0];
    return {playerId:p.id,observedHands:m?.observedHands??0,shownHands:m?.shownHands??0,shownBluffs:m?.shownBluffs??0,...memoryResponse(p.style,m)};
  });
}
