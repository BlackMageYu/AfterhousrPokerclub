import {newDeck, shuffle, evaluate, cardText,bestFive} from './cards.js';
import {STYLES, DEFAULT_STYLES,createBotTraits,createHandPlan} from './styles.js';
import {drawCharacters,financialProfile} from './roster.js';
import {permanentStyle} from './character-profiles.js';
import {observePublicHand,observeShownCards} from './memory.js';

export const STREETS = ['preflop','flop','turn','river'];
export const STREET_NAMES = {preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',showdown:'摊牌'};
export const PLAYER_ACTION_TIME_MS = 20000;
export const ACTION_EXTENSION_MS = 20000;
export const STAKE_LEVELS = Object.freeze([
  {id:'low',name:'低级场',sb:1,bb:2,straddle:4},
  {id:'mid',name:'中级场',sb:5,bb:10,straddle:20},
  {id:'high',name:'高级场',sb:25,bb:50,straddle:100},
  {id:'master',name:'大师场',sb:100,bb:200,straddle:400},
  {id:'top',name:'顶级场',sb:500,bb:1000,straddle:2000}
]);
const copy = x => structuredClone(x);
export class HoldemEngine {
  constructor(config = {}, options = {}) {
    const seats=Number(config.seats ?? 5), requestedLevel=STAKE_LEVELS.find(x=>x.id===config.stakeLevel), sb=Number(config.sb ?? requestedLevel?.sb ?? 5), bb=Number(config.bb ?? requestedLevel?.bb ?? 10), buyBB=Number(config.buyBB ?? 100);
    const legacy=!requestedLevel&&[[5,10],[25,50],[50,100]].some(x=>x[0]===sb&&x[1]===bb);
    if (![2,3,5,7].includes(seats) || (!legacy&&!STAKE_LEVELS.some(x=>x.sb===sb&&x.bb===bb)) || (legacy&&![[5,10],[25,50],[50,100]].some(x=>x[0]===sb&&x[1]===bb)) || !Number.isInteger(buyBB)||buyBB<50||buyBB>500) throw new Error('无效的牌桌设置');
    this.random=options.random ?? Math.random;
    const characters=drawCharacters(config.controlMode,seats-1,this.random,config.stakeLevel);
    const styles=config.fixedCharacters?characters.map(p=>permanentStyle(p.characterId)):config.styles ?? DEFAULT_STYLES.slice(0,seats-1);
    if (styles.length!==seats-1 || styles.some(s=>!STYLES[s])) throw new Error('请为每位电脑玩家选择风格');
    this.config={seats,stakeLevel:requestedLevel?.id??(legacy?'legacy':undefined),sb,bb,straddle:requestedLevel?.straddle??bb*2,buyBB,straddleEnabled:!!config.straddleEnabled||!!config.straddle,styles:[...styles],controlMode:config.controlMode==='external'?'external':'local',characterVersion:config.fixedCharacters?2:1,legacy};
    this.players=Array.from({length:seats},(_,id)=>{
      const bot=id===0?null:financialProfile(characters[id-1]),botBB=id===0?buyBB:legacy?buyBB:this.chooseBotBuyBB(bot,styles[id-1],bb),buyIn=bb*botBB;
      if(bot&&Number.isFinite(bot.bankroll)&&!legacy)bot.bankroll=Math.max(0,bot.bankroll-buyIn);
      return {id,...(id===0?{name:'你',avatar:60,gender:config.playerGender==='f'?'f':'m'}:{...characters[id-1],...bot}),style:id===0?'HERO':styles[id-1],stack:id===0?bb*buyBB:buyIn,totalBuyIn:id===0?bb*buyBB:buyIn,stats:{hands:0,vpip:0,pfr:0,won:0,showdowns:0,maxWon:0},hole:[],streetBet:0,totalBet:0,folded:false,allIn:false,lastAction:'',actedAtBet:null,status:botBB>=50?'active':'empty',tilt:null,quitChance:0};
    });
    this.botTraits=Object.fromEntries(this.players.slice(1).map(p=>[p.id,createBotTraits(this.random,p.characterId)]));
    this.hand=null; this.hands=[]; this.button=seats-1; this.movements=[];this.memories={}; this.playerStraddleNext=false; this.startedAt=new Date().toISOString(); this.endedAt=null;
  }
  static restore(data) {
    const e=Object.create(HoldemEngine.prototype); Object.assign(e,data); e.random=Math.random;
    e.config.legacy??=[[5,10],[25,50],[50,100]].some(([sb,bb])=>sb===e.config.sb&&bb===e.config.bb);
    e.config.stakeLevel??=(e.config.legacy?'legacy':STAKE_LEVELS.find(x=>x.sb===e.config.sb&&x.bb===e.config.bb)?.id);
    e.config.straddle??=e.config.bb*2;e.config.straddleEnabled??=false;e.playerStraddleNext??=false;
    for(const p of e.players??[]){p.status??='active';p.tilt??=null;p.quitChance??=0;p.gender??='m';p.stats={hands:0,vpip:0,pfr:0,won:0,showdowns:0,maxWon:0,...p.stats};if(p.id){const profile=financialProfile(p);p.career??=profile.career;p.incomePerHour??=profile.incomePerHour;p.bankroll??=profile.bankroll;p.skill??=profile.skill;p.level??=profile.level;}}
    const h=e.hand;
    if(h?.status==='playing'){
      h.actionExtensions??=0;h.botTiming??=null;h.botPendingDecision??=null;h.fastForwardBots??=false;h.actionStartedAt??=Date.now();
      if(h.actor===0)h.actionDeadlineAt??=h.actionStartedAt+PLAYER_ACTION_TIME_MS;else h.actionDeadlineAt??=null;
    }
    return e;
  }
  static isHandRestorable(h) {
    if(!h)return true;
    if(!['playing','complete','aborted'].includes(h.status))return false;
    if(h.status==='playing'&&!STREETS.includes(h.street))return false;
    const bounded=(value,max)=>Array.isArray(value)&&value.length<=max&&new Set(value).size===value.length;
    if(!bounded(h.board,5)||!bounded(h.burned,3))return false;
    if(!Array.isArray(h.deck)||h.deck.length!==52||new Set(h.deck).size!==52)return false;
    if(!Number.isSafeInteger(h.dealIndex)||h.dealIndex<0||h.dealIndex>52)return false;
    return true;
  }
  recoverCorruptHand(reason='检测到损坏的当前牌局，本手已作废并退回投入') {
    const h=this.hand;if(!h)return false;
    const initialStacks=Array.isArray(h.initialStacks)&&h.initialStacks.length===this.players.length?[...h.initialStacks]:this.players.map(p=>p.stack+(p.totalBet??0));
    const refunds=this.players.map(p=>Math.max(0,Number(p.totalBet)||0));
    for(const p of this.players){p.stack+=Math.max(0,Number(p.totalBet)||0);p.totalBet=0;p.streetBet=0;p.hole=[];p.folded=false;p.allIn=false;p.lastAction='';p.actedAtBet=null;}
    const endedAt=new Date().toISOString(),snapshotPlayers=this.players.map(p=>({id:p.id,stack:p.stack,streetBet:0,totalBet:0,folded:false,allIn:false,lastAction:''}));
    this.hands.push({number:Number.isSafeInteger(h.number)?h.number:this.hands.length+1,status:'aborted',startedAt:h.startedAt??endedAt,endedAt,button:h.button,sb:h.sb,bb:h.bb,straddle:h.straddle??null,straddleReason:h.straddleReason??null,street:'preflop',board:[],burned:[],deck:[],dealIndex:0,initialStacks,events:[{seq:0,time:endedAt,type:'abort',street:'preflop',board:[],text:reason,refunds:refunds.map((amount,playerId)=>({playerId,amount})),snapshot:{pot:0,currentBet:0,players:snapshotPlayers}}],pending:[],actor:null,currentBet:0,lastFullRaise:this.config.bb,pots:[],results:this.players.map((p,playerId)=>({playerId,hole:[],folded:false,invested:0,won:0,refunded:refunds[playerId],net:p.stack-initialStacks[playerId],stack:p.stack,rank:null})),vpip:[],pfr:[],aiDecisions:[],entrants:[]});
    this.hand=null;return true;
  }
  serialize() { const {random,...data}=this; return copy(data); }
  seatedIds() { return this.players.filter(p=>p.status!=='empty'&&p.status!=='busted').map(p=>p.id); }
  clockwise(after) {
    const ids=this.seatedIds();if(!ids.length)return [];
    const index=ids.indexOf(after);if(index>=0)return ids.slice(index+1).concat(ids.slice(0,index+1));
    return ids.filter(id=>id>after).concat(ids.filter(id=>id<=after));
  }
  live() { return this.players.filter(p=>p.status!=='empty'&&p.status!=='busted'&&!p.folded); }
  actionable() { return this.live().filter(p=>!p.allIn); }
  get active() { return !!this.hand && this.hand.status==='playing'; }
  chooseBotBuyBB(profile,style,bb) {
    const capacity=Math.floor((profile?.bankroll??0)/bb);if(capacity<50)return 0;
    const aggression=STYLES[style]?.aggression??.5,comfort=70+Math.round(this.random()*220+aggression*120);
    // Most entries are bankroll-compatible.  A small tail deliberately buys
    // short or deep for the character's table personality.
    const chosen=this.random()<.12?50+Math.floor(this.random()*80):comfort;
    return Math.max(50,Math.min(500,capacity,chosen));
  }
  chooseStraddlePlayer(bb) {
    if(!this.config.straddleEnabled)return null;
    const candidates=this.clockwise(bb).map(id=>this.players[id]).filter(p=>p&&p.id!==0&&p.status==='active'&&p.stack>=this.config.straddle);
    if(!candidates.length)return null;
    const player=candidates.find(p=>p.skill>=.68)||candidates[0],style=STYLES[player.style]??{};
    const skill=Number(player.skill??.5),aggression=Number(style.aggression??.5),chance=Math.min(.30,.012+skill*.13+aggression*.045);
    if(this.random()>=chance)return null;
    const reasons=skill>=.78&&aggression>=.58
      ?['塑造疯松形象，诱导娱乐玩家更宽跟注','活跃牌局，逼被动松弱玩家进入大底池','社交娱乐，想要更大波动']
      :['社交娱乐，想要更大波动','活跃牌局，逼被动松弱玩家进入大底池'];
    return {id:player.id,reason:reasons[Math.floor(this.random()*reasons.length)]};
  }
  queuePlayerStraddle(enabled=true) {
    if(this.active)throw new Error('只能在两手牌之间选择 Straddle');
    this.playerStraddleNext=Boolean(enabled);return this.playerStraddleNext;
  }
  topUp(id, target) {
    if(this.active&&this.config.legacy)throw new Error('请在本手结束后补码');
    const p=this.players[id];
    const maxBB=this.config.legacy?200:500;
    if (!p || p.status==='busted'||p.status==='empty' || !Number.isSafeInteger(target) || target < this.config.bb*50 || target > this.config.bb*maxBB || target<=p.stack) throw new Error(`补码后的筹码需为 50–${maxBB}BB，且高于当前筹码`);
    const amount=target-p.stack;
    if(id!==0&&Number.isFinite(p.bankroll)&&!this.config.legacy&&p.bankroll<amount)throw new Error('这位牌友的后手资金不足');
    if(id!==0&&Number.isFinite(p.bankroll)&&!this.config.legacy)p.bankroll-=amount;
    p.stack=target; p.totalBuyIn+=amount;
    if(this.active){this.hand.stackAdjustments??={};this.hand.stackAdjustments[id]=(this.hand.stackAdjustments[id]??0)+amount;}
    this.movements.push({time:new Date().toISOString(),afterHand:this.hands.length,playerId:id,type:'rebuy',amount,target,midHand:this.active});
    return amount;
  }
  cashOut(id,amount) {
    const p=this.players[id];if(!p||p.status==='busted'||p.status==='empty'||!Number.isSafeInteger(amount)||amount<=0||amount>p.stack)throw new Error('退码金额无效');
    p.stack-=amount;p.totalCashOut=(p.totalCashOut??0)+amount;if(id!==0&&Number.isFinite(p.bankroll))p.bankroll+=amount;
    if(this.active){this.hand.stackAdjustments??={};this.hand.stackAdjustments[id]=(this.hand.stackAdjustments[id]??0)-amount;}
    this.movements.push({time:new Date().toISOString(),afterHand:this.hands.length,playerId:id,type:'cashout',amount,target:p.stack,midHand:this.active});return amount;
  }
  prepareSeats() {
    const entrants=[];
    for(const p of this.players.slice(1)) {
      if(p.status==='sittingOut'&&p.returnAfterHand&&this.hands.length>=p.returnAfterHand){p.status='active';p.quitReason='';}
      if(p.status==='busted'&&p.reloadPending&&p.bankroll>=this.config.bb*50){p.status='active';p.reloadPending=false;this.topUp(p.id,Math.min(this.config.bb*this.config.buyBB,Math.floor(p.bankroll)));continue;}
      if(!['busted','empty'].includes(p.status))continue;
      // Vacancies are retried between hands, including seats left empty earlier.
      if(this.random()<.4) {
        const occupied=new Set(this.players.filter(x=>x.id!==p.id&&x.status!=='empty'&&x.status!=='busted').map(x=>x.characterId));
        const character=drawCharacters(this.config.controlMode,6,this.random,this.config.stakeLevel).find(x=>!occupied.has(x.characterId));if(!character)continue;
        const profile=financialProfile(character),style=this.config.characterVersion===2?permanentStyle(character.characterId):this.config.styles[p.id-1]??permanentStyle(character.characterId);
        const botBB=this.chooseBotBuyBB(profile,style,this.config.bb);if(botBB<50){p.status='empty';continue;}profile.bankroll=Math.max(0,profile.bankroll-this.config.bb*botBB);
        Object.assign(p,{...character,...profile,style,stack:this.config.bb*botBB,totalBuyIn:this.config.bb*botBB,totalCashOut:0,reloadPending:false,stats:{hands:0,vpip:0,pfr:0,won:0,showdowns:0,maxWon:0},hole:[],streetBet:0,totalBet:0,folded:false,allIn:false,lastAction:'',actedAtBet:null,status:'active',tilt:null,quitChance:0});
        this.botTraits[p.id]=createBotTraits(this.random,p.characterId);entrants.push({playerId:p.id,characterId:p.characterId,name:p.name});
      } else {
        // An empty seat must not carry commitments from the previous hand.
        // Keep the seat unavailable, but clear every hand-local accounting
        // field so it can never inflate the next pot.
        Object.assign(p,{status:'empty',folded:true,hole:[],stack:0,streetBet:0,totalBet:0,allIn:false,actedAtBet:null,lastAction:''});
      }
    }
    if(this.seatedIds().length<2)throw new Error('桌上没有足够的牌友继续发牌');
    return entrants;
  }
  startHand(deckOverride) {
    if (this.endedAt) throw new Error('本场游戏已结束');
    if (this.active) throw new Error('上一手尚未结束');
    const entrants=this.prepareSeats();
    if (this.players[0].stack < this.config.bb) throw new Error('筹码不足 1BB，请先补码');
    if(this.config.legacy)for (const p of this.players.slice(1)) if (p.status!=='empty'&&p.stack<this.config.bb*20) this.topUp(p.id, this.config.bb*this.config.buyBB);
    this.button=this.clockwise(this.button)[0]??this.seatedIds()[0];
    const deck=deckOverride ? [...deckOverride] : shuffle(newDeck(),this.random);
    if (deck.length!==52 || new Set(deck).size!==52 || deck.some(c=>!newDeck().includes(c))) throw new Error('牌堆必须包含完整的 52 张牌');
    const order=this.clockwise(this.button), headsUp=this.seatedIds().length===2, sb=headsUp?this.button:order[0],bb=headsUp?order[0]:order[1],playerStraddle=this.config.straddleEnabled&&this.playerStraddleNext&&this.players[0]?.status==='active'&&this.players[0].stack>=this.config.straddle;this.playerStraddleNext=false;const straddleChoice=playerStraddle?{id:0,reason:'玩家主动选择'}:this.chooseStraddlePlayer(bb),straddle=straddleChoice?.id??null;
    const h=this.hand={number:this.hands.length+1,status:'playing',startedAt:new Date().toISOString(),button:this.button,sb,bb,straddle,straddleReason:straddleChoice?.reason??null,street:'preflop',board:[],burned:[],deck,dealIndex:0,initialStacks:this.players.map(p=>p.stack),events:[],pending:[],actor:null,currentBet:straddle===null?this.config.bb:this.config.straddle,lastFullRaise:this.config.bb,pots:[],results:[],vpip:[],pfr:[],actionStartedAt:null,actionDeadlineAt:null,actionExtensions:0,botTiming:null,botPendingDecision:null,fastForwardBots:false,entrants};
    h.botPlans=Object.fromEntries(this.players.filter(p=>p.id&&p.status!=='empty').map(p=>[p.id,createHandPlan(this.random)]));
    for (const p of this.players) {
      if (p.status==='empty') {
        Object.assign(p,{hole:[],streetBet:0,totalBet:0,folded:true,allIn:false,lastAction:'',actedAtBet:null});
        continue;
      }
      Object.assign(p,{hole:[],streetBet:0,totalBet:0,folded:false,allIn:false,lastAction:'',actedAtBet:null,tilt:p.tilt&&p.tilt.remainingHands>1?{...p.tilt,remainingHands:p.tilt.remainingHands-1}:null});
    }
    this.record('start',{text:`第 ${h.number} 手 · ${this.config.sb}/${this.config.bb}${straddle===null?'':` · straddle ${this.config.straddle}`}`,initialStacks:[...h.initialStacks],entrants});
    for (let i=0;i<2;i++) for (const id of order) this.players[id].hole.push(this.draw());
    this.record('deal',{text:'发放两张底牌',holes:this.players.map(p=>({playerId:p.id,cards:[...p.hole]}))});
    let potBefore=this.pot();this.pay(this.players[h.sb],this.config.sb); this.players[h.sb].lastAction=`小盲 ${this.players[h.sb].streetBet}`;
    this.record('blind',{playerId:h.sb,action:'small_blind',amount:this.players[h.sb].streetBet,potBefore,text:`${this.players[h.sb].name} 下小盲 ${this.players[h.sb].streetBet}`});
    potBefore=this.pot();this.pay(this.players[h.bb],this.config.bb); this.players[h.bb].lastAction=`大盲 ${this.players[h.bb].streetBet}`;
    this.record('blind',{playerId:h.bb,action:'big_blind',amount:this.players[h.bb].streetBet,potBefore,text:`${this.players[h.bb].name} 下大盲 ${this.players[h.bb].streetBet}`});
    if(h.straddle!==null){potBefore=this.pot();this.pay(this.players[h.straddle],this.config.straddle);this.players[h.straddle].lastAction=`Straddle ${this.players[h.straddle].streetBet}`;this.record('blind',{playerId:h.straddle,action:'straddle',amount:this.players[h.straddle].streetBet,potBefore,text:`${this.players[h.straddle].name} 下 Straddle ${this.players[h.straddle].streetBet} · ${h.straddleReason}`});}
    h.pending=this.actionable().map(p=>p.id); this.selectActor(h.straddle??h.bb);
    return this.view();
  }
  draw() { return this.hand.deck[this.hand.dealIndex++]; }
  pay(p, amount) { const paid=Math.min(p.stack,amount); p.stack-=paid; p.streetBet+=paid; p.totalBet+=paid; p.allIn=p.stack===0; return paid; }
  pot() {
    const h=this.hand;
    if (h?.status==='complete' || h?.status==='aborted') {
      if (Number.isFinite(h.finalPot)) return h.finalPot;
      return this.players.reduce((n,p)=>n+(Number(p.totalBet)||0),0)-(h.refundedTotal??0);
    }
    // Empty/busted seats may still exist in a restored save from an older
    // version. Their stale totalBet is not part of the current hand.
    return this.players.filter(p=>p.status!=='empty'&&p.status!=='busted').reduce((n,p)=>n+(Number(p.totalBet)||0),0)-(h?.refundedTotal??0);
  }
  record(type,details={}) {
    const h=this.hand;
    h.events.push({seq:h.events.length,time:new Date().toISOString(),type,street:h.street,board:[...h.board],...details,snapshot:{pot:h.status==='playing'?this.pot():0,...(type==='result'?{awardedPot:this.pot()}:{}),currentBet:h.currentBet,players:this.players.map(p=>({id:p.id,stack:p.stack,streetBet:p.streetBet,totalBet:p.totalBet,folded:p.folded,allIn:p.allIn,lastAction:p.lastAction}))}});
  }
  legal(id=this.hand?.actor) {
    if (!this.active || id!==this.hand.actor || id==null) return null;
    const p=this.players[id], h=this.hand, toCall=Math.max(0,h.currentBet-p.streetBet), maxTo=p.streetBet+p.stack;
    const reopened=p.actedAtBet===null || h.currentBet-p.actedAtBet>=h.lastFullRaise || (p.actedAtBet===0 && h.currentBet>0 && h.currentBet<this.config.bb);
    const canRaise=reopened && maxTo>h.currentBet && this.actionable().some(o=>o.id!==id);
    const paidCall=Math.min(toCall,p.stack),cap=p.totalBet+paidCall;
    const eligiblePotAfterCall=this.players.filter(o=>o.status!=='empty'&&o.status!=='busted').reduce((sum,o)=>sum+Math.min(cap,o.totalBet+(o.id===id?paidCall:0)),0);
    return {toCall:paidCall,fullToCall:toCall,eligiblePotAfterCall,canCheck:toCall===0,canRaise,minRaiseTo:h.currentBet<this.config.bb?this.config.bb:h.currentBet+h.lastFullRaise,maxRaiseTo:maxTo,canAllIn:canRaise||maxTo<=h.currentBet,stack:p.stack};
  }
  selectActor(after) {
    const h=this.hand;
    h.pending=h.pending.filter(id=>!this.players[id].folded&&!this.players[id].allIn);
    if (this.actionable().length===1) {
      const p=this.actionable()[0];
      if (p.streetBet>=h.currentBet) h.pending=[];
    }
    h.actor=this.clockwise(after).find(id=>h.pending.includes(id)) ?? null;
    h.actionStartedAt=h.actor===null?null:Date.now();
    h.actionDeadlineAt=h.actor===0?h.actionStartedAt+PLAYER_ACTION_TIME_MS:null;
    h.actionExtensions=0;h.botTiming=null;h.botPendingDecision=null;
  }
  act(id,action,amount,meta={}) {
    const l=this.legal(id); if (!l) throw new Error('尚未轮到该玩家行动');
    if(id===0&&!meta.timedOut&&Number.isFinite(this.hand.actionDeadlineAt)&&Date.now()>=this.hand.actionDeadlineAt)throw new Error('你的行动时间已结束，请等待自动处理');
    const p=this.players[id],h=this.hand, before=p.stack,potBefore=this.pot();
    let label, raiseTo=null, fullRaise=false;
    if (action==='allin') { if (!l.canAllIn) throw new Error('不足额加注未重新开放加注权'); if (l.maxRaiseTo<=h.currentBet) action='call'; else {action='raise';amount=l.maxRaiseTo;} }
    const timedOut=meta.timedOut===true;
    if (action==='fold') { p.folded=true; label=timedOut?'超时弃牌':'弃牌'; }
    else if (action==='check') { if (!l.canCheck) throw new Error('当前需要跟注，不能过牌'); label=timedOut?'超时过牌':'过牌'; }
    else if (action==='call') { if (l.canCheck) throw new Error('当前无需跟注，请过牌'); this.pay(p,l.toCall); label=p.allIn?'全下跟注':'跟注'; }
    else if (action==='raise') {
      if (!l.canRaise) throw new Error('当前不能加注');
      if (!Number.isSafeInteger(amount)||amount>l.maxRaiseTo||amount<=h.currentBet||(amount<l.minRaiseTo&&amount!==l.maxRaiseTo)) throw new Error(`至少加注到 ${l.minRaiseTo}，筹码不足时可全下`);
      const previous=h.currentBet, increment=amount-previous;
      fullRaise=amount>=l.minRaiseTo;
      if (fullRaise) h.lastFullRaise=previous<this.config.bb?amount:increment;
      this.pay(p,amount-p.streetBet); h.currentBet=amount; raiseTo=amount;
      label=p.allIn?'全下':previous===0?'下注':'加注';
      h.pending=this.actionable().filter(o=>o.id!==id && o.streetBet<h.currentBet).map(o=>o.id);
    } else throw new Error('无效行动');
    const paid=before-p.stack; p.actedAtBet=h.currentBet;
    h.pending=h.pending.filter(x=>x!==id);
    if (h.street==='preflop' && paid>0) { if (!h.vpip.includes(id)) h.vpip.push(id); if (action==='raise'&&!h.pfr.includes(id)) h.pfr.push(id); }
    p.lastAction=label+(raiseTo!==null?` ${raiseTo}`:paid?` ${paid}`:'');
    const voiceAction=p.allIn?'allin':label==='下注'?'bet':action;
    this.record('action',{playerId:id,action,voiceAction,amount:paid,raiseTo,fullRaise,allIn:p.allIn,potBefore,toCallBefore:l.fullToCall,...(Number.isSafeInteger(meta.thinkTimeMs)&&meta.thinkTimeMs>=0?{thinkTimeMs:meta.thinkTimeMs}:{}),...(meta.fastFold===true?{fastFold:true}:{}),...(meta.fastForward===true?{fastForward:true}:{}),text:`${p.name} ${label}${raiseTo!==null?`到 ${raiseTo}`:paid?` ${paid}`:''}`});
    if (this.live().length===1) this.settle(false);
    else {
      // Once the human folds in a multiway hand, finish the remaining
      // computer actions immediately instead of showing theatrical think time.
      if (id===0&&action==='fold'&&this.live().length>=2)this.hand.fastForwardBots=true;
      this.selectActor(id);
    }
    return this.view();
  }
  // A pre-flop quick fold is intentionally allowed before the action returns
  // to the human seat. It is still an ordinary fold for accounting purposes,
  // but it hands the remaining seats to the fast settlement path immediately.
  fastFold(id=0) {
    const h=this.hand,p=this.players[id];
    if(!this.active||!p||h.street!=='preflop'||p.folded||p.allIn||!h.pending.includes(id))throw new Error('当前不能快速弃牌');
    p.folded=true;p.lastAction='快速弃牌';
    h.pending=h.pending.filter(x=>x!==id);
    this.record('action',{playerId:id,action:'fold',voiceAction:'fold',amount:0,raiseTo:null,fullRaise:false,allIn:false,potBefore:this.pot(),toCallBefore:Math.max(0,h.currentBet-p.streetBet),fastFold:true,fastForward:true,text:`${p.name} 快速弃牌`});
    if(this.live().length===1)this.settle(false);
    else {this.selectActor(id);h.fastForwardBots=true;}
    return this.view();
  }
  expireAction(id=0,now=Date.now()) {
    const h=this.hand;if(!this.active||h.actor!==id||id!==0)throw new Error('当前不是你的行动回合');
    if(!Number.isFinite(h.actionDeadlineAt)||now<h.actionDeadlineAt)throw new Error('行动时间尚未结束');
    const l=this.legal(id),action=l.canCheck?'check':'fold',elapsed=Math.max(PLAYER_ACTION_TIME_MS,Math.round(now-(h.actionStartedAt??now)));
    return this.act(id,action,undefined,{thinkTimeMs:elapsed,timedOut:true});
  }
  extendActionTime(id=0,amount=ACTION_EXTENSION_MS) {
    const h=this.hand;if(!this.active||h.actor!==id||id!==0)throw new Error('只能在你的行动回合延时');
    if(!Number.isSafeInteger(amount)||amount!==ACTION_EXTENSION_MS)throw new Error('每次只能延时 20 秒');
    if((h.actionExtensions??0)>=1)throw new Error('本手延时次数已用完');
    const now=Date.now();h.actionDeadlineAt=Math.max(Number(h.actionDeadlineAt)||now,now)+amount;h.actionExtensions=(h.actionExtensions??0)+1;
    this.record('timebank',{playerId:id,amount,extensions:h.actionExtensions,text:'你将行动时间延长 20 秒'});
    return this.view();
  }
  advance() {
    if (!this.active || this.hand.actor!==null) return;
    const h=this.hand;
    if (h.street==='river') { this.settle(true); return; }
    for (const p of this.players) Object.assign(p,{streetBet:0,actedAtBet:null,lastAction:p.folded?'弃牌':p.allIn?'ALL IN':''});
    h.currentBet=0;h.lastFullRaise=this.config.bb;
    h.street=STREETS[STREETS.indexOf(h.street)+1];
    const burned=this.draw();h.burned.push(burned);
    const cards=Array.from({length:h.street==='flop'?3:1},()=>this.draw());h.board.push(...cards);
    this.record('board',{cards,burned,text:`${STREET_NAMES[h.street]} · ${cards.map(cardText).join(' ')}`});
    h.pending=this.actionable().length>=2?this.actionable().map(p=>p.id):[];
    this.selectActor(this.button);
  }
  settle(showdown) {
    const h=this.hand;h.actor=null;h.pending=[];h.actionStartedAt=null;h.actionDeadlineAt=null;h.actionExtensions=0;h.botTiming=null;h.botPendingDecision=null;
    h.shownPlayers=showdown?this.live().map(p=>p.id):[];
    if (showdown) { h.street='showdown'; this.record('showdown',{text:'摊牌',hands:this.live().map(p=>({playerId:p.id,cards:[...p.hole],rank:evaluate([...p.hole,...h.board])}))}); }
    const contributorsPool=this.players.filter(p=>p.status!=='empty'&&p.status!=='busted');
    const levels=[...new Set(contributorsPool.map(p=>p.totalBet).filter(n=>n>0))].sort((a,b)=>a-b);
    const won=Array(this.players.length).fill(0), refunded=Array(this.players.length).fill(0);let previous=0;
    for (const level of levels) {
      const contributors=contributorsPool.filter(p=>p.totalBet>=level), amount=(level-previous)*contributors.length;previous=level;
      if (contributors.length===1) { const p=contributors[0];p.stack+=amount;refunded[p.id]+=amount;h.refundedTotal=(h.refundedTotal??0)+amount;this.record('refund',{playerId:p.id,amount,text:`${p.name} 收回无人跟注的 ${amount}`});continue; }
      const eligible=contributors.filter(p=>!p.folded);
      if (!eligible.length) throw new Error('底池中没有符合资格的玩家');
      let winners;
      if (eligible.length===1) winners=eligible;
      else { const scores=eligible.map(p=>evaluate([...p.hole,...h.board]).score),best=Math.max(...scores);winners=eligible.filter((p,i)=>scores[i]===best); }
      const ordered=this.clockwise(this.button).filter(id=>winners.some(p=>p.id===id)),share=Math.floor(amount/winners.length),remainder=amount%winners.length;
      const awards=ordered.map((id,i)=>({playerId:id,amount:share+(i<remainder?1:0)}));
      for (const a of awards) won[a.playerId]+=a.amount;
      h.pots.push({name:h.pots.length?'边池 '+h.pots.length:'主池',amount,cap:level,eligible:eligible.map(p=>p.id),awards});
    }
    for (const p of this.players) p.stack+=won[p.id];
    h.finalPot=h.pots.reduce((sum,p)=>sum+(Number(p.amount)||0),0);
    h.showdown=showdown;h.status='complete';h.endedAt=new Date().toISOString();
    h.results=this.players.map(p=>({playerId:p.id,hole:[...p.hole],folded:p.folded,invested:p.totalBet,won:won[p.id],refunded:refunded[p.id],net:p.stack-h.initialStacks[p.id]-(h.stackAdjustments?.[p.id]??0),stack:p.stack,rank:showdown&&!p.folded?bestFive([...h.board,...p.hole]):null}));
    for (const p of this.players) {p.stats.hands++;if(h.vpip.includes(p.id))p.stats.vpip++;if(h.pfr.includes(p.id))p.stats.pfr++;if(won[p.id]>0)p.stats.won++;if(showdown&&!p.folded)p.stats.showdowns++;p.stats.maxWon=Math.max(p.stats.maxWon??0,won[p.id]);}
    h.winnerText=h.results.filter(r=>r.won>0).map(r=>`${this.players[r.playerId].name} 赢得 ${r.won}${r.rank?' · '+r.rank.name:''}`).join(' / ');
    this.record('result',{text:h.winnerText,pots:copy(h.pots),results:copy(h.results)});
    observePublicHand(this);
    if(!this.config.legacy)this.applyPsychology(showdown);
    if(!this.config.legacy)this.applyBotLifecycle();
    h.finalPlayers=copy(this.players);this.hands.push(copy(h));
  }
  applyPsychology(showdown) {
    const h=this.hand;if(!showdown||h.board.length!==5||!h.events.some(e=>e.type==='action'&&e.allIn))return;
    const contestants=this.live();if(contestants.length<2)return;
    const scores=contestants.map(p=>({p,final:evaluate([...p.hole,...h.board]).score,pre:evaluate([...p.hole,...h.board.slice(0,4)]).score}));
    const winner=scores.reduce((a,b)=>b.final>a.final?b:a),loser=scores.reduce((a,b)=>b.final<a.final?b:a);
    const kinds=[];
    if(winner.pre<loser.pre&&winner.final>loser.final)kinds.push(['bad-beat',loser,'被反超后短暂收紧']);
    else if(winner.pre>=loser.pre&&winner.final===loser.final)kinds.push(['cooler',loser,'撞上更大的强牌后变得谨慎']);
    if(winner.pre<loser.pre&&winner.final>loser.final)kinds.push(['river-comeback',winner,'河牌反败为胜后变得更有冲劲']);
    for(const [kind,target,text] of kinds) {
      if(target.id===0)continue;
      const skill=Number(target.skill??.5),chance=Math.min(.52,.2+(1-skill)*.26);
      if(this.random()>chance)continue;
      const remaining=Math.max(2,Math.round(8-skill*4+this.random()*4));
      target.tilt={kind,remainingHands:remaining,strength:kind==='river-comeback'?'overconfident':'weakened'};
      h.psychologyEvents??=[];h.psychologyEvents.push({playerId:target.id,kind,remainingHands:remaining,text:`${target.name}${text}`});
      this.record('psychology',{playerId:target.id,kind,remainingHands:remaining,text:`${target.name} 出现心理波动`});
    }
  }
  applyBotLifecycle() {
    const h=this.hand;
    for(const p of this.players.filter(p=>p.id&&p.status!=='empty')) {
      if(p.stack<=0){const leaveChance=.1+.2*(1-Math.max(0,Math.min(1,Number(p.level??.5))));p.reloadPending=p.bankroll>=this.config.bb*50&&this.random()>=leaveChance;p.status='busted';p.folded=true;p.quitReason=p.reloadPending?'准备从后手资金补码':'离开牌桌';continue;}
      if(p.status!=='active')continue;
      const gain=p.stack-(h.initialStacks[p.id]??p.stack),hands=p.stats.hands??0;
      // Sitting out is an exceptional table event, not a routine rotation.
      // Keep only a trace of life-like variance: a normal hand should almost
      // never rotate a player out, while a long session or a sharp result
      // still nudges the chance without making it a routine event.
      const chance=Math.min(.005,.0004+(gain>this.config.bb*15?.0009:0)+(gain<-this.config.bb*15?.0011:0)+(hands>=12?.0006:0)+(1-Number(p.level??.5))*.0008+this.random()*.0004);
      p.quitChance=Number(chance.toFixed(3));
      const cap=this.config.seats===7?3:this.config.seats===5?2:this.config.seats===3?1:0;
      if(this.players.filter(x=>x.status==='sittingOut').length<cap&&this.random()<chance){p.status='sittingOut';p.returnAfterHand=this.hands.length+3+Math.floor(this.random()*4);p.quitReason=gain>this.config.bb*15?'赢得过多，暂时离席':gain<-this.config.bb*15?'连续输牌，暂时离席':'与牌桌节奏不合，暂时离席';}
    }
  }
  showCards(id=0) {
    const h=this.hand;
    if(!h||h.status!=='complete'||this.endedAt)throw new Error('只能在当前手结算后、下一手开始前秀牌');
    h.shownPlayers??=h.showdown?this.live().map(p=>p.id):[];
    if(h.shownPlayers.includes(id))throw new Error('这位玩家本手已经亮牌');
    if(id!==0)throw new Error('只能主动亮出自己的底牌');
    h.shownPlayers.push(id);
    this.record('show',{playerId:id,cards:[...this.players[id].hole],text:`${this.players[id].name} 主动秀牌：${this.players[id].hole.map(cardText).join(' ')}（全桌可见）`});
    observeShownCards(this,id);
    this.hands[this.hands.length-1]=copy(h);
    return this.view();
  }
  abort() {
    if (!this.active) return;
    const h=this.hand;h.actor=null;h.pending=[];h.actionStartedAt=null;h.actionDeadlineAt=null;h.actionExtensions=0;h.botTiming=null;h.botPendingDecision=null;h.status='aborted';h.endedAt=new Date().toISOString();
    const refunds=this.players.map(p=>({playerId:p.id,amount:p.totalBet}));
    for (const p of this.players) {p.stack+=p.totalBet;p.totalBet=0;p.streetBet=0;}
    this.record('abort',{text:'本手中途结束，全部投入退回，不计入有效手数或盈亏',refunds});
    h.results=this.players.map(p=>({playerId:p.id,hole:[...p.hole],folded:p.folded,invested:0,won:0,refunded:refunds[p.id].amount,net:0,stack:p.stack,rank:null}));
    h.finalPlayers=copy(this.players);this.hands.push(copy(h));
  }
  view({revealStyles=!!this.endedAt}={}) {
    const h=this.hand;
    const {styles,...publicConfig}=this.config;
    if(h?.showdown)for(const r of h.results)if(r.rank&&!r.rank.cards)r.rank=bestFive([...h.board,...r.hole]);
    return {config:revealStyles?this.config:publicConfig,startedAt:this.startedAt,endedAt:this.endedAt,completedHands:this.hands.filter(x=>x.status==='complete').length,
      players:this.players.map(p=>{const safe=copy(p);delete safe.bankroll;delete safe.incomePerHour;delete safe.skill;delete safe.tilt;delete safe.quitChance;return {...safe,style:p.id===0?'HERO':revealStyles?p.style:'UNKNOWN',actedAtBet:undefined,hole:p.id===0||(h?.showdown&&!p.folded)||h?.shownPlayers?.includes(p.id)?p.hole:[]};}),
      hand:h?{number:h.number,eventCount:h.events.length,status:h.status,button:h.button,sb:h.sb,bb:h.bb,straddle:h.straddle===null?null:h.straddle,straddleReason:h.straddleReason??null,street:h.street,board:[...h.board],pending:[...(h.pending??[])],actor:h.actor,pot:this.pot(),currentBet:h.currentBet,legal:this.legal(0),actionStartedAt:h.actionStartedAt??null,actionDeadlineAt:h.actionDeadlineAt??null,actionExtensions:h.actionExtensions??0,actionTimeLimitMs:h.actor===0?PLAYER_ACTION_TIME_MS:null,botTiming:h.botTiming?{playerId:h.botTiming.playerId,startedAt:h.botTiming.startedAt,dueAt:h.botTiming.dueAt,kind:h.botTiming.kind}:null,winnerText:h.winnerText,canShow:h.status==='complete'&&!h.shownPlayers?.includes(0)&&!(h.showdown&&!this.players[0].folded),shownPlayers:h.shownPlayers??[],pots:copy(h.pots),results:h.status!=='playing'?copy(h.results).map(r=>({...r,hole:r.playerId===0||(h.showdown&&!r.folded)?r.hole:[]})):[],events:h.events.filter(e=>['action','blind','board','result','refund','show','timebank'].includes(e.type)).map(e=>({seq:e.seq,street:e.street,text:e.text,type:e.type,playerId:e.playerId,action:e.action,voiceAction:e.voiceAction,amount:e.amount,allIn:e.allIn,potBefore:e.potBefore,thinkTimeMs:e.thinkTimeMs,fastFold:e.fastFold===true,fastForward:e.fastForward===true,extensions:e.extensions}))}:null,
      history:this.hands.map(x=>({number:x.number,status:x.status,board:x.board,hole:x.results.find(r=>r.playerId===0)?.hole,net:x.results.find(r=>r.playerId===0)?.net??0,winnerText:x.winnerText,showdown:x.showdown}))};
  }
}
