import {HoldemEngine} from './engine.js';
import {botObservation,chooseBotAction,chooseBotTiming} from './bot.js';
import {bestFive} from './cards.js';
import {STYLES} from './styles.js';
import {buildReport} from './report.js';
import {CLUB_ROSTER} from './roster.js';
import {memorySummary} from './memory.js';
import {visibleCharacter,registerEncounter,submitGuess} from './discovery.js';
import {createWorld,refreshWorld,publicWorld} from './world.js';
import {mergeCareerStats,normalizeStats,syncCareerStats,hydrateMemories,syncMemories,memoryFor} from './career.js';

// The Android build has no Node.js filesystem.  This store keeps the same
// route contract as the desktop GameStore, while persisting JSON in the
// WebView's app-private localStorage area.
const STORAGE_KEY='afterhours-poker-mobile-v1';
const REPORTS_KEY='afterhours-poker-mobile-reports-v1';
const MUSIC_FILES=[
  'StudioEIM - MapleStory.mp3',
  'StudioEIM - 冒险者讲习所.mp3',
  'StudioEIM - 天空之城.mp3',
  'StudioEIM - 想念你.mp3',
  'StudioEIM - 明珠港.mp3',
  'StudioEIM - 游戏商城.mp3',
  'StudioEIM - 废弃部曲.mp3'
];
const AI_PROTOCOL='afterhours-decision/1';
const EXTERNAL_AI_TIMEOUT_SECONDS=20;
const BOT_ACTION_WINDOW_MS=20000;
const INVALID_RESPONSE_LOG_LIMIT=12000;
const AI_SYSTEM_PROMPT='You control one opponent in a no-limit Texas Hold\'em practice game. Decide using only the supplied observation: your own hole cards, public actions, public board and memories of openly shown cards. Other players\' hidden cards and future cards are unknown. Keep the assigned style as a tendency, mix actions naturally, and return ONLY one JSON object: {"action":"fold|check|call|raise|allin","raiseTo":integer}. raiseTo is the total committed on this betting street.';
const clone=value=>structuredClone(value);
const invalidMobileResponseDiagnostic=(content,apiKey='')=>{
  const raw=String(content??''),key=typeof apiKey==='string'?apiKey:'';let safe=key?raw.split(key).join('[REDACTED]'):raw;
  safe=safe.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]').replace(/(\b(?:api[_-]?key|authorization|token|secret)\b\s*[:=]\s*["']?)([^\s"',}\]]+)/gi,'$1[REDACTED]').replace(/\u0000/g,'\\u0000');
  return {content:safe.slice(0,INVALID_RESPONSE_LOG_LIMIT),originalLength:raw.length,truncated:safe.length>INVALID_RESPONSE_LOG_LIMIT,redacted:safe!==raw};
};
const normalizeDailyClaims=value=>{
  const source=value&&typeof value==='object'?value:{};
  const legacyBust=source.bust===true?1:Number(source.bust);
  const bust=Number.isFinite(legacyBust)?Math.min(5,Math.max(0,Math.trunc(legacyBust))):0;
  return {date:source.date??null,login:source.login===true||Number(source.normal??0)>0,bust,bustUnlocked:source.bustUnlocked===true||source.bust===true||bust>0};
};
const nowIso=()=>new Date().toISOString();
const sessionId=()=>nowIso().replace(/[-:.]/g,'').replace('T','-').replace('Z','')+'-'+Math.random().toString(36).slice(2,8);
const readJSON=(key,fallback)=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch{return fallback;}};
const writeJSON=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{ /* quota is non-fatal; the current table remains usable */ }};
const completionEndpoint=base=>{const value=String(base??'').trim().replace(/\/+$/,'');if(!value)throw new Error('请填写 AI API 地址');return /\/chat\/completions$/i.test(value)?value:value+'/chat/completions';};
function validateMobileDecision(value,observation){
  const l=observation.legal;if(!value||typeof value!=='object'||Array.isArray(value)||!l)throw new Error('AI 返回了不合法的行动');
  const action=value.action;if(!['fold','check','call','raise','allin'].includes(action))throw new Error('AI 返回了不合法的行动');
  if(action==='check'&&!l.canCheck||action==='call'&&l.canCheck||action==='allin'&&!l.canAllIn)throw new Error('AI 返回了不合法的行动');
  if(action==='raise'){const amount=value.raiseTo,current=observation.streetBet+l.fullToCall;if(!l.canRaise||!Number.isSafeInteger(amount)||amount<=current||amount>l.maxRaiseTo||(amount<l.minRaiseTo&&amount!==l.maxRaiseTo))throw new Error('AI 返回了不合法的行动');return {action,amount};}
  return {action};
}
async function requestMobileAI(config,observation,{signal}={}){
  const started=Date.now(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),EXTERNAL_AI_TIMEOUT_SECONDS*1000),abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  try{
    const response=await fetch(completionEndpoint(config.baseUrl),{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',...(config.apiKey?{Authorization:'Bearer '+config.apiKey}:{})},body:JSON.stringify({model:config.model,stream:false,messages:[{role:'system',content:AI_SYSTEM_PROMPT},{role:'user',content:JSON.stringify({protocol:AI_PROTOCOL,requestId:'android:'+Date.now(),...observation})}]})});
    if(!response.ok)throw new Error(`AI 请求失败（${response.status}）`);
    const text=await response.text();if(text.length>262144)throw new Error('AI 返回内容过大');
    const body=JSON.parse(text),content=body?.choices?.[0]?.message?.content;if(typeof content!=='string')throw new Error('AI 未返回可用的决策 JSON');
    const clean=content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let value;try{value=JSON.parse(clean);}catch{throw Object.assign(new Error('AI 返回格式不是决策 JSON'),{code:'invalid_response',responseDiagnostic:invalidMobileResponseDiagnostic(content,config.apiKey)});}return {decision:validateMobileDecision(value,observation),elapsedMs:Date.now()-started,usage:body.usage??{}};
  }catch(error){if(signal?.aborted)throw Object.assign(new Error('外部 AI 请求已取消'),{code:'cancelled'});if(error?.name==='AbortError')throw Object.assign(new Error('外部 AI 等待超时'),{code:'timeout'});throw error;}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}

export class MobileGameStore {
  constructor({random=Math.random}={}) {
    this.random=random;
    this.profile={wallet:20000,currency:'USD',gender:'m',lifetimeHands:0,lifetimeProfit:0,dailyClaims:{date:null,login:false,bust:0,bustUnlocked:false}};
    this.session=null;this.lastSummary=null;this.discovery={characters:{},sessions:{}};this.world=createWorld();this.careerStats={};this.memoryBank={};
    this.ai={mode:'local',baseUrl:'',model:'',timeoutSeconds:EXTERNAL_AI_TIMEOUT_SECONDS,apiKey:''};
    this.reports=readJSON(REPORTS_KEY,{});
    const saved=readJSON(STORAGE_KEY,null);
    if(saved){
      if(saved.profile)this.profile=saved.profile;
      this.lastSummary=saved.lastSummary??null;this.discovery=saved.discovery??this.discovery;this.world=saved.world??this.world;this.ai={...this.ai,...(saved.ai??{}),timeoutSeconds:EXTERNAL_AI_TIMEOUT_SECONDS};this.careerStats=saved.careerStats??{};this.memoryBank=saved.memoryBank??{};
      if(saved.session){this.session=saved.session;this.session.engine=HoldemEngine.restore(saved.session.engine);this.session.engine.random=random;this.restoreKnowledge(this.session.engine);}
    }
    this.profile.currency??='USD';this.profile.gender=this.profile.gender==='f'?'f':'m';this.profile.dailyClaims=normalizeDailyClaims(this.profile.dailyClaims);
  }
  names(s=this.session){return {markdown:`poker-session-${s.id}.md`,json:`poker-session-${s.id}.json`};}
  save(){
    if(this.session)this.syncKnowledge(this.session.engine);
    writeJSON(STORAGE_KEY,{profile:this.profile,discovery:this.discovery,lastSummary:this.lastSummary,world:this.world,careerStats:this.careerStats,memoryBank:this.memoryBank,ai:{...this.ai,apiKey:this.ai.apiKey??''},session:this.session?{...this.session,engine:this.session.engine.serialize()}:null});
    writeJSON(REPORTS_KEY,this.reports);
  }
  restoreKnowledge(engine,preserveSessionKeys=true){for(const player of engine?.players??[])mergeCareerStats(player,this.careerStats);hydrateMemories(engine,this.memoryBank,preserveSessionKeys);return engine;}
  syncKnowledge(engine){syncCareerStats(engine,this.careerStats);syncMemories(engine,this.memoryBank);return engine;}
  publicOpponent(player,sessionIdValue){
    const safe=visibleCharacter(this.discovery,player),ticket=this.discovery.sessions[sessionIdValue]?.[player.characterId];
    return {...safe,guessEligible:!!ticket&&!ticket.used&&!safe.discovery.revealed,guess:ticket?.used?{choice:ticket.choice}:null,memory:memoryFor(this.memoryBank,player)};
  }
  ensureDailyClaims(now=Date.now()){
    const today=new Date(now).toLocaleDateString('sv-SE'),claims=normalizeDailyClaims(this.profile.dailyClaims);
    if(claims.date!==today)this.profile.dailyClaims={date:today,login:false,bust:0,bustUnlocked:false};
    else this.profile.dailyClaims=claims;
  }
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
    if(this.session?.expiresAt&&Date.now()>=new Date(this.session.expiresAt).getTime()){this.end('房间时间到');}
    const session=this.session?{id:this.session.id,wallet:this.profile.wallet,durationMinutes:this.session.durationMinutes,expiresAt:this.session.expiresAt,...this.session.engine.view()}:null;
    if(session)session.players=session.players.map(p=>this.publicOpponent(p,this.session.id));
    const lastSummary=this.lastSummary?{...this.lastSummary,opponents:this.lastSummary.opponents.map(p=>this.publicOpponent(p,this.lastSummary.id))}:null;
    const pokerStats=normalizeStats(this.careerStats.player??this.session?.engine.players?.[0]?.stats);
    return clone({app:'afterhours-poker',currency:'USD',profile:{...this.profile,pokerStats},styles:STYLES,rosterCounts:{club:CLUB_ROSTER.length},world:publicWorld(this.world),ai:{...this.ai,apiKey:undefined},session,lastSummary});
  }
  checkTurn(body){
    if(!this.session||body?.sessionId!==this.session.id)throw new Error('场次已变化，请以当前牌桌为准');
    const h=this.session.engine.hand;if(body.handNumber!==h?.number||body.eventCount!==h?.events.length)throw new Error('牌局已更新，请以当前牌局为准');
  }
  applyBotDecision(body,decision,metadata={source:'local'}){
    this.checkTurn(body);const e=this.session.engine,h=e.hand,id=h.actor;
    if(id===null||id===0||!e.active)throw new Error('尚未轮到电脑行动');
    if(metadata.source==='fallback')e.players[id].localManaged='本地托管';
    else if(metadata.source==='external')delete e.players[id].localManaged;
    const elapsedMs=Number.isSafeInteger(metadata.thinkTimeMs)&&metadata.thinkTimeMs>=0?metadata.thinkTimeMs:h.botTiming?Math.max(0,Date.now()-h.botTiming.startedAt):undefined;
    h.aiDecisions??=[];h.aiDecisions.push({seq:h.events.length,playerId:id,time:nowIso(),...metadata,...(elapsedMs!==undefined?{thinkTimeMs:elapsedMs}:{}),action:decision.action,...(decision.amount!==undefined?{raiseTo:decision.amount}:{})});
    try{e.act(id,decision.action,decision.amount,{thinkTimeMs:elapsedMs});}catch(error){h.aiDecisions.pop();throw error;}
    this.session.wallet=this.profile.wallet;this.save();return this.state();
  }
  localBotTick(body){
    this.checkTurn(body);const e=this.session.engine,h=e.hand;
    if(!e.active)return this.state();
    if(h.actor===null){if(h.allInShowdown&&Number(h.runoutNextAt)>Date.now())return this.state();e.advance();this.session.wallet=this.profile.wallet;this.save();return this.state();}
    if(h.actor===0)throw new Error('尚未轮到电脑行动');
    const acting=e.players[h.actor];
    if(acting?.status==='sittingOut')return this.applyBotDecision(body,{action:e.legal(h.actor)?.canCheck?'check':'fold'},{source:'local',thinkTimeMs:0,timingKind:'sitting-out'});
    if(!h.botPendingDecision){
      const observation=botObservation(e,h.actor),decision=chooseBotAction(observation,this.random),timing=chooseBotTiming(observation,decision,this.random),startedAt=Date.now();
      h.botPendingDecision=decision;h.botTiming={playerId:h.actor,startedAt,dueAt:startedAt+timing.delayMs,kind:timing.kind};this.save();return this.state();
    }
    if(Date.now()<h.botTiming.dueAt)return this.state();
    const decision=h.botPendingDecision,elapsedMs=Math.max(0,Date.now()-h.botTiming.startedAt),timingKind=h.botTiming.kind;
    return this.applyBotDecision(body,decision,{source:'local',thinkTimeMs:elapsedMs,timingKind});
  }
  async externalBotTick(body){
    this.checkTurn(body);const e=this.session.engine;if(!e.active||e.hand.actor===null||e.hand.actor===0)return this.state();
    const observation=botObservation(e,e.hand.actor),started=Date.now(),controller=new AbortController();let decision,metadata,actionWindowExpired=false;const actionWindow=setTimeout(()=>{actionWindowExpired=true;controller.abort();},BOT_ACTION_WINDOW_MS);
    try{const result=await requestMobileAI(this.ai,observation,{signal:controller.signal});decision=result.decision;metadata={source:'external',model:this.ai.model,elapsedMs:result.elapsedMs,usage:result.usage};this.ai.lastSource='external';this.ai.lastError='';}
    catch(error){decision=chooseBotAction(observation,this.random);metadata={source:'fallback',model:this.ai.model,elapsedMs:Date.now()-started,errorCode:actionWindowExpired?'action_window':error.code??'external_error',error:actionWindowExpired?'外部 AI 未在 20 秒内完成，本地策略已接管':error.message,...(error?.responseDiagnostic?{responseDiagnostic:error.responseDiagnostic}:{})};this.ai.lastSource='fallback';this.ai.lastError=metadata.error;}
    finally{clearTimeout(actionWindow);}
    try{const result=this.applyBotDecision(body,decision,metadata);this.save();return result;}catch{return this.state();}
  }
  finishHandFast(e){
    let steps=0;
    while(e.active){
      if(++steps>240)throw new Error('结束牌局超时');
      if(e.hand.actor===null){e.advance();continue;}
      const id=e.hand.actor,l=e.legal(id);if(!l)break;
      if(id===0){e.act(0,'fold',undefined,{timedOut:true,forcedExit:true,thinkTimeMs:0});continue;}
      const p=e.players[id];if(p.status==='sittingOut'){const action=l.canCheck?'check':'fold';e.act(id,action,undefined,{thinkTimeMs:0,forcedExit:true});continue;}
      const d=chooseBotAction(botObservation(e,id),this.random);try{e.act(id,d.action,d.amount,{thinkTimeMs:0,forcedExit:true});}catch{e.act(id,l.canCheck?'check':'call',undefined,{thinkTimeMs:0,forcedExit:true});}
    }
  }
  end(reason='用户下桌'){
    if(!this.session)return this.lastSummary;
    const s=this.session,e=s.engine;if(e.active){if(e.config.legacy)e.abort();else this.finishHandFast(e);}
    const remaining=!e.config.legacy&&s.expiresAt?Math.max(0,Math.floor((new Date(s.expiresAt).getTime()-Date.now())/120000)):0;
    for(let i=0;i<Math.min(60,remaining);i++){if(e.players[0].stack<e.config.bb)break;try{e.startHand();this.finishHandFast(e);}catch{break;}}
    e.endedAt=nowIso();const hero=e.players[0],profit=hero.stack-hero.totalBuyIn,completed=e.hands.filter(h=>h.status==='complete').length;
    s.cashout=hero.stack;s.wallet=this.profile.wallet+hero.stack;s.endReason=String(reason).slice(0,160);
    if(e.config.characterVersion===2)registerEncounter(this.discovery,s.id,e.players,completed);
    const report=buildReport(s,{discovery:this.discovery}),names=this.names(s);this.reports[names.markdown]={content:report.markdown,type:'text/markdown;charset=utf-8'};this.reports[names.json]={content:JSON.stringify(report.json,null,2),type:'application/json;charset=utf-8'};
    this.profile.wallet=s.wallet;this.profile.lifetimeHands+=completed;this.profile.lifetimeProfit+=profit;
    this.lastSummary={id:s.id,completedHands:completed,profit,buyIns:hero.totalBuyIn,cashout:hero.stack,wallet:this.profile.wallet,reports:names,reason:s.endReason,opponents:e.players.slice(1).map(p=>({id:p.id,characterId:p.characterId,name:p.name,avatar:p.avatar,kind:p.kind,style:p.style,net:p.stack-p.totalBuyIn,stats:p.stats})),memory:memorySummary(e)};
    this.session=null;this.save();return this.lastSummary;
  }
  archive(id){
    if(id==='current'||id===this.session?.id)return {hands:this.session?.engine.hands??[],players:this.session?.engine.players??[],revealed:false};
    if(!id)return {hands:[],players:[],revealed:false};
    const data=this.reports[`poker-session-${id}.json`];if(!data)throw new Error('报告将在下桌后生成');const report=JSON.parse(data.content);if(report.status!=='ended')throw new Error('本场尚未结束');return {hands:report.hands,players:report.players,revealed:true};
  }
  dispatch(route,body){
    const url=new URL('/api/'+route,'https://afterhours.mobile'),name=url.pathname.slice(5);
    if(body===undefined){
      if(name==='music')return {tracks:MUSIC_FILES.map(file=>({id:file,name:file.replace(/\.mp3$/i,''),url:'/music/'+encodeURIComponent(file)}))};
      if(name==='contacts')return {players:CLUB_ROSTER.map(p=>this.publicOpponent(p,this.lastSummary?.id))};
      if(name==='health')return {app:'afterhours-poker',platform:'android'};
      if(name==='state')return this.state();
      if(name==='ai-settings')return {...this.ai,apiKey:undefined};
      if(name==='archives')return {sessions:Object.entries(this.reports).filter(([n])=>n.endsWith('.json')).map(([n,v])=>{try{const r=JSON.parse(v.content);return r.status==='ended'?{id:r.sessionId,label:new Date(r.startedAt).toLocaleString('zh-CN',{hour12:false})+` / ${r.config.seats} 人桌`,hands:r.hands.filter(h=>h.status==='complete').length}:null;}catch{return null;}}).filter(Boolean).sort((a,b)=>b.id.localeCompare(a.id))};
      if(name==='archive'){const d=this.archive(url.searchParams.get('session'));return {hands:d.hands.map(h=>({number:h.number,status:h.status,board:h.board,hole:h.results.find(r=>r.playerId===0)?.hole,net:h.results.find(r=>r.playerId===0)?.net??0,showdown:h.showdown}))};}
      if(name==='history'){const d=this.archive(url.searchParams.get('session')??'current'),h=d.hands.find(x=>x.number===Number(url.searchParams.get('hand'))),hand=h?clone(h):null;if(hand){delete hand.finalPlayers;delete hand.memoryUpdates;delete hand.botPlans;delete hand.aiDecisions;}if(hand?.showdown)for(const r of hand.results)if(r.rank&&!r.rank.cards)r.rank=bestFive([...hand.board,...r.hole]);return {hand,players:d.players.map(p=>this.publicOpponent({id:p.id,characterId:p.characterId,name:p.name,avatar:p.avatar,style:p.style},this.lastSummary?.id))};}
      if(name==='report'){const value=this.reports[url.searchParams.get('name')];if(!value)throw new Error('报告不存在');return value;}
      throw new Error('接口不存在');
    }
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('无效请求');
    if(name==='ai-cancel')return this.state();
    if(name==='ai-test')return requestMobileAI({...this.ai,...body,mode:'external'}, {protocol:AI_PROTOCOL,requestId:'connection-test',handNumber:0,id:1,style:'TAG',hole:['As','Kd'],board:['2h','7c','Ts'],street:'flop',button:0,bb:10,sb:5,stack:990,streetBet:0,pot:20,timing:{lastHeroActionMs:null},players:[{id:0,stack:990,folded:false,allIn:false,stats:{}},{id:1,stack:990,folded:false,allIn:false,stats:{}}],memory:{},actions:[],legal:{canCheck:true,canRaise:true,canAllIn:true,toCall:0,fullToCall:0,minRaiseTo:10,maxRaiseTo:990,eligiblePotAfterCall:20}}).then(result=>({ok:true,elapsedMs:result.elapsedMs,action:result.decision.action}));
    if(name==='ai-settings'){if(this.session&&body.mode&&body.mode!==this.ai.mode)throw new Error('请先下桌再切换 AI 模式');this.ai={...this.ai,...body,timeoutSeconds:EXTERNAL_AI_TIMEOUT_SECONDS};this.save();return this.state();}
    if(name==='profile-settings'){if(!['m','f'].includes(body.gender))throw new Error('请选择有效的玩家性别');this.profile.gender=body.gender;this.save();return this.state();}
    if(name==='guess'){if(this.session)throw new Error('请先下桌再判断牌友类型');const result=submitGuess(this.discovery,body,STYLES);this.save();return {...this.state(),guessResult:result};}
    if(name==='start'){
      if(this.session)throw new Error('当前牌桌尚未结束');const config={...body.config,fixedCharacters:true,controlMode:this.ai.mode,playerGender:this.profile.gender},e=new HoldemEngine(config,{random:this.random});this.memoryBank={};this.restoreKnowledge(e,false);const buyIn=e.players[0].stack;
      if(this.profile.wallet<buyIn)throw new Error('美元余额不足，请在大厅领取练习余额');e.startHand();const walletBefore=this.profile.wallet;this.profile.wallet-=buyIn;const durationMinutes=Number(config.durationMinutes??60);if(![15,30,60,120].includes(durationMinutes))throw new Error('房间时长必须为 15、30、60 或 120 分钟');
      this.session={id:sessionId(),engine:e,walletBefore,wallet:this.profile.wallet,grants:0,cashout:0,durationMinutes,expiresAt:new Date(Date.now()+durationMinutes*60000).toISOString()};this.refreshWorld();this.save();return this.state();
    }
    if(name==='grant'){if(this.session?.engine.active)throw new Error('请在手牌结束后领取余额');this.profile.wallet+=20000;if(this.session){this.session.grants=(this.session.grants??0)+20000;this.session.wallet=this.profile.wallet;}this.save();return this.state();}
    if(name==='claim-daily'){this.ensureDailyClaims();const claims=this.profile.dailyClaims,hero=this.session?.engine.players[0],bust=this.profile.wallet<=0||!!hero&&hero.stack<=0;let amount;if(bust)claims.bustUnlocked=true;if(!claims.login){amount=1000;claims.login=true;}else{if(!claims.bustUnlocked)throw new Error('输光后才能领取 300 美元');if(claims.bust>=5)throw new Error('今日输光补助次数已用完');amount=300;claims.bust++;}this.profile.wallet+=amount;if(this.session){this.session.grants=(this.session.grants??0)+amount;this.session.wallet=this.profile.wallet;}this.save();return this.state();}
    if(!this.session)throw new Error('请先创建牌桌');if(body.sessionId!==this.session.id)throw new Error('场次已变化，请以当前牌桌为准');const e=this.session.engine;
    if(name!=='end'&&this.session.expiresAt&&Date.now()>=new Date(this.session.expiresAt).getTime()){this.end('房间时间到');return this.state();}
    if(['action','tick','show','next','extend','timeout'].includes(name))this.checkTurn(body);
    if(name==='action')e.act(0,body.action,body.amount,{thinkTimeMs:body.thinkTimeMs});
    else if(name==='extend')e.extendActionTime(0);
    else if(name==='timeout')e.expireAction(0);
    else if(name==='tick'){if(e.active){if(e.hand.actor===null){if(!(e.hand.allInShowdown&&Number(e.hand.runoutNextAt)>Date.now()))e.advance();}else if(e.hand.actor!==0)return this.ai.mode==='external'?this.externalBotTick(body):this.localBotTick(body);}}
    else if(name==='next')e.startHand();
    else if(name==='show')e.showCards();
    else if(name==='rebuy'){const target=Number(body.target),amount=target-e.players[0].stack;if(amount>this.profile.wallet)throw new Error('账户余额不足，请领取每日补助');e.topUp(0,target);this.profile.wallet-=amount;}
    else if(name==='cashout'){const amount=Number(body.amount);e.cashOut(0,amount);this.profile.wallet+=amount;}
    else if(name==='export'){this.save();return {...this.state(),message:'进度已保存；完整报告在下桌后生成'};}
    else if(name==='end'){this.end(body.reason);return this.state();}
    else throw new Error('接口不存在');
    this.session.wallet=this.profile.wallet;this.save();return this.state();
  }
}

export function createMobileApi(){
  const store=new MobileGameStore();
  return {request:async(route,body)=>store.dispatch(route,body)};
}
