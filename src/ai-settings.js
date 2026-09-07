import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_AI_SETTINGS={mode:'local',baseUrl:'',model:'',timeoutSeconds:30};
export function completionEndpoint(value){
  let url;try{url=new URL(value);}catch{throw new Error('请填写完整的 API 地址');}
  if(url.username||url.password||url.search||url.hash)throw new Error('API 地址不能包含账号、密码、查询参数或片段');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('远程 API 请使用 HTTPS；本机模型可使用 HTTP');
  const basePath=url.pathname.replace(/\/+$/,'');
  url.pathname=basePath.endsWith('/chat/completions')?basePath:(basePath||'/v1')+'/chat/completions';
  return url.href;
}
export class AISettings {
  constructor({root,protect,unprotect}={}){
    this.file=path.join(root,'.poker-data','ai-settings.json');this.protect=protect;this.unprotect=unprotect;this.key='';this.encryptedKey='';this.revision=0;this.config={...DEFAULT_AI_SETTINGS};
    if(fs.existsSync(this.file)){
      const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
      this.config=this.normalize(saved);this.encryptedKey=typeof saved.encryptedKey==='string'?saved.encryptedKey:'';
      if(this.encryptedKey&&unprotect)try{this.key=unprotect(this.encryptedKey);}catch{/* A portable folder moved to another Windows account needs its key re-entered. */}
    }
  }
  normalize(input){
    const config={mode:input.mode??this.config.mode,baseUrl:String(input.baseUrl??this.config.baseUrl).trim(),model:String(input.model??this.config.model).trim(),timeoutSeconds:Number(input.timeoutSeconds??this.config.timeoutSeconds)};
    if(!['local','external'].includes(config.mode))throw new Error('请选择本地机器人或外部 AI');
    if(config.baseUrl.length>1000||config.model.length>160||/[\r\n]/.test(config.model))throw new Error('API 地址或模型名格式不正确');
    if(!Number.isInteger(config.timeoutSeconds)||config.timeoutSeconds<5||config.timeoutSeconds>120)throw new Error('等待时间需为 5–120 秒');
    if(config.baseUrl)completionEndpoint(config.baseUrl);
    if(config.mode==='external'&&(!config.baseUrl||!config.model))throw new Error('外部 AI 需要 API 地址和模型名');
    return config;
  }
  preview(input={}){
    const config=this.normalize(input),sameEndpoint=!!config.baseUrl&&!!this.config.baseUrl&&completionEndpoint(config.baseUrl)===completionEndpoint(this.config.baseUrl);
    const entered=input.apiKey===undefined?'':String(input.apiKey).trim();
    if(entered.length>4096||/[\r\n]/.test(entered))throw new Error('API Key 格式不正确');
    const apiKey=input.clearKey?'':entered||(sameEndpoint?this.key:'');
    return {...config,apiKey};
  }
  update(input){
    const {apiKey,...config}=this.preview(input);
    const encryptedKey=apiKey&&this.protect?this.protect(apiKey):'';
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    fs.writeFileSync(this.file+'.tmp',JSON.stringify({...config,encryptedKey}),{encoding:'utf8',mode:0o600});fs.renameSync(this.file+'.tmp',this.file);
    this.config=config;this.key=apiKey;this.encryptedKey=encryptedKey;this.revision++;return this.public();
  }
  credentials(){return {...this.config,apiKey:this.key};}
  public(){return {...this.config,hasKey:!!this.key,keyStorage:this.protect?'encrypted':'session',keyNeedsUpdate:!!this.encryptedKey&&!this.key};}
}
