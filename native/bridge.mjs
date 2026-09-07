import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GameStore} from '../src/store.js';
import {AISettings} from '../src/ai-settings.js';
import {AIGameService} from '../src/external-ai.js';
import {LOCAL_ROSTER,AI_ROSTER} from '../src/roster.js';
import {mergeCareerStats} from '../src/career.js';
const root=process.argv[2]||process.env.AFTERHOURS_DATA_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const store=new GameStore({root});
const settings=new AISettings({root});
// Windows DPAPI is owned by the native client. Only ciphertext goes to disk.
settings.protect=()=>settings.nativeCipher||settings.encryptedKey||'';
const service=new AIGameService(store,settings);
const commands=new Set(['state','contacts','archives','archive','history','start','action','tick','next','show','extend','timeout','rebuy','cashout','export','end','claim-daily','guess','profile-settings','ai-settings','ai-test','ai-cancel','music']);
let chain=Promise.resolve();
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
async function dispatch(command,body){
  if(body===null)body=undefined;
  if(command==='shutdown'){service.cancel();store.save();return {closed:true};}
  if(command==='pause'){
    if(store.session?.engine.active){const h=store.session.engine.hand;const next=body.paused===true;if(next&&!h.nativePaused)h.nativePausedAt=Date.now();if(!next&&h.nativePaused){const elapsed=Math.max(0,Date.now()-(h.nativePausedAt||Date.now()));if(h.actionDeadlineAt)h.actionDeadlineAt+=elapsed;if(h.actionStartedAt)h.actionStartedAt+=elapsed;if(h.botTiming){h.botTiming.startedAt+=elapsed;h.botTiming.dueAt+=elapsed;}}h.nativePaused=next;store.save();}
    return service.state();
  }
  if(command==='key-init'){settings.key=String(body.key||'');return {ok:true};}
  if(command==='ai-settings'&&body){settings.nativeCipher=body.encryptedKey??settings.encryptedKey;}
  if(command==='mark'){
    if(![...LOCAL_ROSTER,...AI_ROSTER].some(p=>p.characterId===body.characterId))throw new Error('未知牌友');
    store.profile.marks??={};store.profile.marks[body.characterId]=String(body.mark||'').slice(0,100);store.save();return service.state();
  }
  if(command==='contacts'){
    return {players:[...LOCAL_ROSTER,...AI_ROSTER].map(p=>{const copy=structuredClone(p);mergeCareerStats(copy,store.careerStats);return store.publicOpponent(copy,store.lastSummary?.id);})};
  }
  if(command==='history'&&store.session)throw new Error('详细回放仅可在大厅打开');
  if(!commands.has(command.split('?')[0]))throw new Error('未知程序命令');
  if(command.startsWith('history')&&store.session)throw new Error('详细回放仅可在大厅打开');
  if(['action','tick','timeout','extend'].includes(command)&&store.session?.engine.hand?.nativePaused)throw new Error('牌局已暂停');
  return service.dispatch(command,body);
}
async function reply(request){
  try{const value=await dispatch(request.command,request.body);process.stdout.write(JSON.stringify({id:request.id,value})+'\n');if(request.command==='shutdown')lines.close();}
  catch(error){process.stdout.write(JSON.stringify({id:request?.id,error:error.message})+'\n');}
}
// Network-backed AI turns must never make an emergency player action wait in
// the command queue. These calls cancel the outstanding request before they
// mutate the table, so a late response cannot apply to a newer game state.
const interruptsAI=request=>request.command==='ai-cancel'||request.command==='end'||request.command==='shutdown'||(request.command==='action'&&request.body?.fastFold===true);
lines.on('line',line=>{
  let request;
  try{if(line.length>2000000)throw new Error('命令过大');request=JSON.parse(line);}
  catch(error){process.stdout.write(JSON.stringify({id:request?.id,error:error.message})+'\n');return;}
  if(interruptsAI(request)){void reply(request);return;}
  chain=chain.then(()=>reply(request));
});
lines.on('close',()=>{chain.finally(()=>{service.cancel();store.save();process.exit(0);});});

