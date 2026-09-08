import fs from 'node:fs';
import path from 'node:path';
import {randomInt,randomUUID} from 'node:crypto';
import {HoldemEngine} from './engine.js';
import {botObservation,chooseBotAction,chooseBotTiming} from './bot.js';
import {bestFive} from './cards.js';
import {STYLES,drawTableStyles} from './styles.js';
import {buildReport} from './report.js';
import {CLUB_ROSTER} from './roster.js';
import {MusicLibrary} from './music.js';
import {memorySummary} from './memory.js';
import {visibleCharacter,registerEncounter,submitGuess,redactReport} from './discovery.js';
import {createWorld,refreshWorld,publicWorld} from './world.js';
import {mergeCareerStats,normalizeStats,syncCareerStats,hydrateMemories,syncMemories,memoryFor} from './career.js';

const secureRandom=()=>randomInt(0,0x100000000)/0x100000000;
const normalizeDailyClaims=value=>{
  const source=value&&typeof value==='object'?value:{};
  const legacyBust=source.bust===true?1:Number(source.bust);
  const bust=Number.isFinite(legacyBust)?Math.min(5,Math.max(0,Math.trunc(legacyBust))):0;
  return {date:source.date??null,login:source.login===true||Number(source.normal??0)>0,bust,bustUnlocked:source.bustUnlocked===true||source.bust===true||bust>0};
};
const atomicWrite=(file,text)=>{fs.writeFileSync(file+'.tmp',text,'utf8');fs.renameSync(file+'.tmp',file);};
export class GameStore {
  constructor({root=process.cwd(),dataDir=path.join(root,'.poker-data'),reportDir=path.join(root,'日志'),random=secureRandom}={}) {
    Object.assign(this,{root,dataDir,reportDir,random,profile:{wallet:20000,currency:'USD',gender:'m',lifetimeHands:0,lifetimeProfit:0,dailyClaims:{date:null,login:false,bust:0,bustUnlocked:false}},session:null,lastSummary:null,careerStats:{},memoryBank:{}});
    this.music=new MusicLibrary(root);
    this.discovery={characters:{},sessions:{}};
    fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(reportDir,{recursive:true});this.stateFile=path.join(dataDir,'state.json');this.worldFile=path.join(dataDir,'world.json');this.world=createWorld();
    if(fs.existsSync(this.stateFile)) {
      const saved=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      if(!Number.isSafeInteger(saved.profile?.wallet))throw new Error('积分档案损坏，请保留存档后检查');
      this.profile=saved.profile;this.lastSummary=saved.lastSummary??null;
      this.profile.currency??='USD';this.profile.gender=this.profile.gender==='f'?'f':'m';this.profile.dailyClaims=normalizeDailyClaims(this.profile.dailyClaims);
      this.discovery=saved.discovery??this.discovery;this.careerStats=saved.careerStats??{};this.memoryBank=saved.memoryBank??{};
      if(saved.session){this.session=saved.session;this.session.engine=HoldemEngine.restore(saved.session.engine);this.session.engine.random=random;this.restoreKnowledge(this.session.engine);}
    }
    if(fs.existsSync(this.worldFile)){try{this.world=JSON.parse(fs.readFileSync(this.worldFile,'utf8'));}catch{this.world=createWorld();}}
    // Preserve legacy reports while making them available in the dedicated folder.
    for(const name of fs.readdirSync(root).filter(n=>/^poker-session-[\w-]+\.(md|json)$/.test(n))) {
      const destination=path.join(reportDir,name);if(!fs.existsSync(destination))fs.copyFileSync(path.join(root,name),destination);
    }
  }
  names(s=this.session){return {markdown:`poker-session-${s.id}.md`,json:`poker-session-${s.id}.json`};}
  reportFile(name){if(!/^poker-session-[\w-]+\.(md|json)$/.test(name))throw new Error('无效报告文件');const file=path.join(this.reportDir,name);if(!fs.existsSync(file))throw new Error('报告将在下桌后生成');return file;}
  save(){if(this.session)this.syncKnowledge(this.session.engine);atomicWrite(this.stateFile,JSON.stringify({profile:this.profile,discovery:this.discovery,lastSummary:this.lastSummary,careerStats:this.careerStats,memoryBank:this.memoryBank,session:this.session?{...this.session,engine:this.session.engine.serialize()}:null}));atomicWrite(this.worldFile,JSON.stringify(this.world));}
  restoreKnowledge(engine,preserveSessionKeys=true){for(const player of engine?.players??[])mergeCareerStats(player,this.careerStats);hydrateMemories(engine,this.memoryBank,preserveSessionKeys);return engine;}
  syncKnowledge(engine){syncCareerStats(engine,this.careerStats);syncMemories(engine,this.memoryBank);return engine;}
  publicOpponent(player,sessionId){const safe=visibleCharacter(this.discovery,player),ticket=this.discovery.sessions[sessionId]?.[player.characterId];return {...safe,guessEligible:!!ticket&&!ticket.used&&!safe.discovery.revealed,guess:ticket?.used?{choice:ticket.choice}:null,memory:memoryFor(this.memoryBank,player)};}
  ensureDailyClaims(now=Date.now()){const today=new Date(now).toLocaleDateString('sv-SE'),claims=normalizeDailyClaims(this.profile.dailyClaims);if(claims.date!==today)this.profile.dailyClaims={date:today,login:false,bust:0,bustUnlocked:false};else this.profile.dailyClaims=claims;}
  refreshWorld(){refreshWorld(this.world,Date.now(),this.random);this.save();}
  state(){
    this.ensureDailyClaims();
    const expired=!!this.session?.expiresAt&&Date.now()>=new Date(this.session.expiresAt).getTime(),engine=this.session?.engine;
    if(engine?.hand&&!HoldemEngine.isHandRestorable(engine.hand)){
      engine.recoverCorruptHand();
      if(!expired){try{if(engine.players[0]?.stack>=engine.config.bb)engine.startHand();else this.end('已修复损坏牌局')}catch{this.end('已修复损坏牌局');}}
      this.save();
    }
    this.refreshWorld();
    if(this.session?.expiresAt&&Date.now()>=new Date(this.session.expiresAt).getTime()&&!this.session.engine.active)this.end('房间时间到');
    const session=this.session?{id:this.session.id,wallet:this.profile.wallet,durationMinutes:this.session.durationMinutes,expiresAt:this.session.expiresAt,...this.session.engine.view()}:null;if(session)session.players=session.players.map(p=>this.publicOpponent(p,this.session.id));const lastSummary=this.lastSummary?{...this.lastSummary,opponents:this.lastSummary.opponents.map(p=>this.publicOpponent(p,this.lastSummary.id))}:null;const pokerStats=normalizeStats(this.careerStats.player??this.session?.engine.players?.[0]?.stats);return structuredClone({app:'afterhours-poker',currency:'USD',profile:{...this.profile,pokerStats},styles:STYLES,rosterCounts:{club:CLUB_ROSTER.length},world:publicWorld(this.world),ai:{...this.ai,apiKey:undefined},session,lastSummary});}
  checkTurn(body){
    if(!this.session||body?.sessionId!==this.session.id)throw new Error('场次已变化，请以当前牌桌为准');
    const h=this.session.engine.hand;
    if(body.handNumber!==h?.number||body.eventCount!==h?.events.length)throw new Error('牌局已更新，请以当前牌局为准');
  }
  applyBotDecision(body,decision,metadata={source:'local'}){
    this.checkTurn(body);const e=this.session.engine,h=e.hand,id=h.actor;
    if(id===null||id===0||!e.active)throw new Error('尚未轮到电脑行动');
    // Keep a visible, player-level marker until a later external decision
    // succeeds.  This is intentionally not part of the card or strategy data.
    if(metadata.source==='fallback')e.players[id].localManaged='本地托管';
    else if(metadata.source==='external')delete e.players[id].localManaged;
    const elapsedMs=Number.isSafeInteger(metadata.thinkTimeMs)&&metadata.thinkTimeMs>=0?metadata.thinkTimeMs:h.botTiming?Math.max(0,Date.now()-h.botTiming.startedAt):undefined;
    h.aiDecisions??=[];h.aiDecisions.push({seq:h.events.length,playerId:id,time:new Date().toISOString(),...metadata,...(elapsedMs!==undefined?{thinkTimeMs:elapsedMs}:{}),action:decision.action,...(decision.amount!==undefined?{raiseTo:decision.amount}:{})});
    try{e.act(id,decision.action,decision.amount,{thinkTimeMs:elapsedMs});}catch(error){h.aiDecisions.pop();throw error;}
    this.session.wallet=this.profile.wallet;this.save();return this.state();
  }
  localBotTick(body){
    this.checkTurn(body);const e=this.session.engine,h=e.hand;
    if(!e.active)return this.state();
    if(h.fastForwardBots){
      this.finishHandFast(e,{fastAfterFold:true});
      this.session.wallet=this.profile.wallet;this.save();return this.state();
    }
    if(h.actor===null){
      // A normal all-in is deliberately paced for the table animation.  Fast
      // folding and ending a table still use finishHandFast and skip this wait.
      if(h.allInShowdown&&Number(h.runoutNextAt)>Date.now())return this.state();
      e.advance();this.session.wallet=this.profile.wallet;this.save();return this.state();
    }
    if(h.actor===0)throw new Error('尚未轮到电脑行动');
    const acting=e.players[h.actor];
    if(acting?.status==='sittingOut'){
      const l=e.legal(h.actor),decision={action:l.canCheck?'check':'fold'};
      return this.applyBotDecision(body,decision,{source:'local',thinkTimeMs:0,timingKind:'sitting-out'});
    }
    // The desktop UI opts into this two-step path so the action can remain
    // hidden while its human-like thinking delay counts down. Direct callers
    // (including the fast HTTP test adapter) retain the immediate path.
    if(body.botTiming===true){
      if(!h.botPendingDecision){
        const observation=botObservation(e,h.actor),decision=chooseBotAction(observation,this.random),timing=chooseBotTiming(observation,decision,this.random),startedAt=Date.now();
        h.botPendingDecision=decision;h.botTiming={playerId:h.actor,startedAt,dueAt:startedAt+timing.delayMs,kind:timing.kind};this.save();return this.state();
      }
      if(Date.now()<h.botTiming.dueAt)return this.state();
      const decision=h.botPendingDecision,elapsedMs=Math.max(0,Date.now()-h.botTiming.startedAt),timingKind=h.botTiming.kind;
      return this.applyBotDecision(body,decision,{source:'local',thinkTimeMs:elapsedMs,timingKind});
    }
    const decision=chooseBotAction(botObservation(e,h.actor),this.random);return this.applyBotDecision(body,decision);
  }
  finishHandFast(e,{fastAfterFold=false}={}){
    let steps=0;
    while(e.active){
      if(++steps>240)throw new Error('结束牌局超时');
      if(e.hand.actor===null){e.advance();continue;}
      const id=e.hand.actor,l=e.legal(id);if(!l)break;
      if(id===0){e.act(0,'fold',undefined,{timedOut:true,forcedExit:!fastAfterFold,fastForward:fastAfterFold,thinkTimeMs:0});continue;}
      const p=e.players[id];if(p.status==='sittingOut'){const action=l.canCheck?'check':'fold';e.hand.aiDecisions??=[];e.hand.aiDecisions.push({seq:e.hand.events.length,playerId:id,time:new Date().toISOString(),source:'local',timingKind:'sitting-out',thinkTimeMs:0,action});e.act(id,action,undefined,{thinkTimeMs:0,forcedExit:true,fastForward:fastAfterFold});continue;}
      const d=chooseBotAction(botObservation(e,id),this.random),timingKind=fastAfterFold?'fast-after-fold':'forced-exit';e.hand.aiDecisions??=[];e.hand.aiDecisions.push({seq:e.hand.events.length,playerId:id,time:new Date().toISOString(),source:'local',timingKind,thinkTimeMs:0,action:d.action,...(d.amount!==undefined?{raiseTo:d.amount}:{})});try{e.act(id,d.action,d.amount,{thinkTimeMs:0,forcedExit:!fastAfterFold,fastForward:fastAfterFold});}catch{e.act(id,l.canCheck?'check':'call',undefined,{thinkTimeMs:0,forcedExit:!fastAfterFold,fastForward:fastAfterFold});}
    }
  }
  end(reason='用户下桌') {
    if(!this.session)return this.lastSummary;
    const s=this.session,e=s.engine;
    if(e.active){if(e.config.legacy)e.abort();else this.finishHandFast(e);}
    // Native leave settles the current hand; it never invents future hands.
    e.endedAt=new Date().toISOString();
    const hero=e.players[0],profit=hero.stack+(hero.totalCashOut??0)-hero.totalBuyIn,completed=e.hands.filter(h=>h.status==='complete').length;
    s.cashout=hero.stack;s.wallet=this.profile.wallet+hero.stack;s.endReason=String(reason).slice(0,160);
    if(e.config.characterVersion===2)registerEncounter(this.discovery,s.id,e.players,completed);
    const report=buildReport(s,{discovery:this.discovery}),names=this.names(s);
    atomicWrite(path.join(this.reportDir,names.markdown),report.markdown);atomicWrite(path.join(this.reportDir,names.json),JSON.stringify(report.json,null,2));
    this.profile.wallet=s.wallet;this.profile.lifetimeHands+=completed;this.profile.lifetimeProfit+=profit;
    this.lastSummary={id:s.id,completedHands:completed,profit,buyIns:hero.totalBuyIn,cashout:hero.stack,wallet:this.profile.wallet,reports:names,reason:s.endReason,opponents:e.players.slice(1).map(p=>({id:p.id,characterId:p.characterId,name:p.name,avatar:p.avatar,kind:p.kind,style:p.style,net:p.stack-p.totalBuyIn,stats:p.stats})),memory:memorySummary(e)};
    this.session=null;this.save();return this.lastSummary;
  }
  archive(id) {
    if(id==='current'||id===this.session?.id)return {hands:this.session?.engine.hands??[],players:this.session?.engine.players??[],revealed:false};
    if(!id)return {hands:[],players:[],revealed:false};
    if(!/^[\w-]+$/.test(id))throw new Error('无效场次');
    const report=JSON.parse(fs.readFileSync(this.reportFile(`poker-session-${id}.json`),'utf8'));
    if(report.status!=='ended')throw new Error('本场尚未下桌');
    return {hands:report.hands,players:report.players,revealed:true};
  }
  dispatch(route,body) {
    const url=new URL('/api/'+route,'poker://app'),name=url.pathname.slice(5);
    if(body===undefined){
      if(name==='music')return this.music.list();
      if(name==='contacts')return {players:CLUB_ROSTER.map(p=>this.publicOpponent(p,this.lastSummary?.id))};
      if(name==='health')return {app:'afterhours-poker',root:this.root};
      if(name==='state')return this.state();
      if(name==='archives')return {sessions:fs.readdirSync(this.reportDir).filter(n=>/^poker-session-[\w-]+\.json$/.test(n)).sort().reverse().flatMap(n=>{try{const r=JSON.parse(fs.readFileSync(path.join(this.reportDir,n),'utf8'));return r.status==='ended'?[{id:r.sessionId,label:new Date(r.startedAt).toLocaleString('zh-CN',{hour12:false})+` / ${r.config.seats} 人桌`,hands:r.hands.filter(h=>h.status==='complete').length}]:[];}catch{return [];}})};
      if(name==='archive'){const d=this.archive(url.searchParams.get('session'));return {hands:d.hands.map(h=>({number:h.number,status:h.status,board:h.board,hole:h.results.find(r=>r.playerId===0)?.hole,net:h.results.find(r=>r.playerId===0)?.net??0,showdown:h.showdown}))};}
      if(name==='compact-history'){
        if(!this.session)throw new Error('请在牌局内打开本局复盘');
        const handNumber=Number(url.searchParams.get('hand')),current=this.session.engine.hand,source=this.session.engine.hands.find(hand=>hand.number===handNumber&&hand.status==='complete')??(current?.number===handNumber?current:null);
        if(!source)throw new Error('这手牌暂不可复盘');
        const hand=structuredClone(source),live=source===current&&source.status==='playing',shown=new Set(hand.shownPlayers??[]);
        if(live){hand.compactLive=true;hand.finalPot=this.session.engine.pot();hand.results=this.session.engine.players.map(player=>({playerId:player.id,folded:!!player.folded,hole:player.id===0?[...player.hole]:[],rank:null,net:-Number(player.totalBet??0)}));}
        delete hand.finalPlayers;delete hand.memoryUpdates;delete hand.botPlans;delete hand.aiDecisions;delete hand.deck;delete hand.burned;
        for(const result of hand.results??[]){const publicAtShowdown=hand.showdown===true&&!result.folded;if(result.playerId!==0&&!publicAtShowdown&&!shown.has(result.playerId)){result.hole=[];result.rank=null;}}
        if(hand.showdown)for(const result of hand.results??[])if(result.rank&&!result.rank.cards)result.rank=bestFive([...hand.board,...result.hole]);
        const players=(source.finalPlayers??this.session.engine.players).map(player=>this.publicOpponent({id:player.id,characterId:player.characterId,name:player.name,avatar:player.avatar,style:player.style}));
        return {hand,players};
      }
      if(name==='history'){
        const d=this.archive(url.searchParams.get('session')??'current'),h=d.hands.find(h=>h.number===Number(url.searchParams.get('hand'))),hand=h?structuredClone(h):null,replayPlayers=h?.finalPlayers??d.players;
        if(hand){delete hand.finalPlayers;delete hand.memoryUpdates;delete hand.botPlans;delete hand.aiDecisions;}
        if(hand?.showdown)for(const r of hand.results)if(r.rank&&!r.rank.cards)r.rank=bestFive([...hand.board,...r.hole]);
        return {hand,players:replayPlayers.map(p=>this.publicOpponent({id:p.id,characterId:p.characterId,name:p.name,avatar:p.avatar,style:p.style}))};
      }
      throw new Error('接口不存在');
    }
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('无效请求');
    if(name==='guess'){if(this.session)throw new Error('请先下桌再判断牌友类型');const result=submitGuess(this.discovery,body,STYLES);this.save();return {...this.state(),guessResult:result};}
    if(name==='profile-settings'){if(!['m','f'].includes(body.gender))throw new Error('请选择有效的玩家性别');this.profile.gender=body.gender;this.save();return this.state();}
    if(name==='start'){
      if(this.session)throw new Error('当前牌桌尚未结束');
      const config={...body.config,fixedCharacters:true,playerGender:this.profile.gender},e=new HoldemEngine(config,{random:this.random});this.restoreKnowledge(e,false);const buyIn=e.players[0].stack;
      if(this.profile.wallet<buyIn)throw new Error('美元余额不足，请在大厅领取每日补助');
      e.startHand();const walletBefore=this.profile.wallet;this.profile.wallet-=buyIn;
      const durationMinutes=Number(config.durationMinutes??60);if(![15,30,60,120].includes(durationMinutes))throw new Error('房间时长必须为 15、30、60 或 120 分钟');
      this.session={id:new Date().toISOString().replace(/[-:.]/g,'').replace('T','-').replace('Z','')+'-'+randomUUID().slice(0,6),engine:e,walletBefore,wallet:this.profile.wallet,grants:0,cashout:0,durationMinutes,expiresAt:new Date(Date.now()+durationMinutes*60000).toISOString()};this.refreshWorld();this.save();return this.state();
    }
    if(name==='grant'){
      if(this.session?.engine.active)throw new Error('请在手牌结束后领取积分');
      if(this.profile.wallet>1e9)throw new Error('练习积分已经足够');
      this.profile.wallet+=20000;if(this.session){this.session.grants+=20000;this.session.wallet=this.profile.wallet;}this.save();return this.state();
    }
    if(name==='claim-daily'){
      this.ensureDailyClaims();const claims=this.profile.dailyClaims,hero=this.session?.engine.players[0],bust=this.profile.wallet<=0&&(!hero||hero.stack<=0);let amount;
      if(bust)claims.bustUnlocked=true;
      if(!claims.login){amount=1000;claims.login=true;}
      else {if(bust)claims.bustUnlocked=true;if(!claims.bustUnlocked)throw new Error('输光后才能领取 300 美元');if(claims.bust>=5)throw new Error('今日输光补助次数已用完');amount=300;claims.bust++;}
      this.profile.wallet+=amount;
      if(this.session){this.session.grants=(this.session.grants??0)+amount;this.session.wallet=this.profile.wallet;}this.save();return this.state();
    }
    // A terminal leave may overtake a queued UI poll.  Both a duplicate leave
    // and that stale poll should simply confirm the lobby state rather than
    // leave the native client holding an already-closed table snapshot.
    if(!this.session&&(name==='end'||name==='tick'))return this.state();
    if(!this.session)throw new Error('请先创建牌桌');
    if(body.sessionId!==this.session.id)throw new Error('场次已变化，请以当前牌桌为准');
    const e=this.session.engine;
    if(name!=='end'&&!e.active&&this.session.expiresAt&&Date.now()>=new Date(this.session.expiresAt).getTime()){this.end('房间时间到');return this.state();}
    if(['action','tick','show','next','extend','timeout'].includes(name)&&(body.handNumber!==e.hand?.number||body.eventCount!==e.hand?.events.length))throw new Error('牌局已更新，请以当前牌局为准');
    if(name==='action'){
      if(body.fastFold===true&&e.hand.actor!==0)e.fastFold(0);
      else e.act(0,body.action,body.amount,{thinkTimeMs:body.thinkTimeMs,fastFold:body.fastFold===true});
      if(e.active&&e.hand.fastForwardBots)this.finishHandFast(e,{fastAfterFold:true});
    }
    else if(name==='extend')e.extendActionTime(0);
    else if(name==='timeout')e.expireAction(0);
    else if(name==='tick'){if(e.active){if(e.hand.fastForwardBots){this.finishHandFast(e,{fastAfterFold:true});}else if(e.hand.actor===null){if(!(e.hand.allInShowdown&&Number(e.hand.runoutNextAt)>Date.now()))e.advance();}else if(e.hand.actor!==0){if(e.config.controlMode==='local')return this.localBotTick(body);const decision=chooseBotAction(botObservation(e,e.hand.actor),this.random);return this.applyBotDecision(body,decision);}}}
    else if(name==='next'){e.queuePlayerStraddle(body.playerStraddle===true);e.startHand();}
    else if(name==='show')e.showCards();
    else if(name==='rebuy'){const id=Number(body.playerId??0),target=Number(body.target),amount=target-(e.players[id]?.stack??0);if(id===0&&amount>this.profile.wallet)throw new Error('账户余额不足，请领取 300 美元');e.topUp(id,target);if(id===0)this.profile.wallet-=amount;}
    else if(name==='cashout'){const id=Number(body.playerId??0),amount=Number(body.amount);e.cashOut(id,amount);if(id===0)this.profile.wallet+=amount;}
    else if(name==='export'){this.save();return {...this.state(),message:'进度已保存；完整报告在下桌后写入日志文件夹'};}
    else if(name==='end'){this.end(body.reason);return this.state();}
    else throw new Error('接口不存在');
    this.session.wallet=this.profile.wallet;this.save();return this.state();
  }
}


