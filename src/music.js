import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';

export class MusicLibrary {
 constructor(root){this.dir=path.join(root,'music');fs.mkdirSync(this.dir,{recursive:true});}
 entries(){return fs.readdirSync(this.dir,{withFileTypes:true}).filter(e=>e.isFile()&&/\.mp3$/i.test(e.name)).map(e=>({id:createHash('sha256').update(e.name).digest('hex'),name:e.name.replace(/\.mp3$/i,''),file:e.name})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));}
 list(){return {tracks:this.entries().map(({id,name})=>({id,name,url:'/music/'+id}))};}
 response(id,range){
  const entry=this.entries().find(e=>e.id===id);if(!entry)return new Response(null,{status:404});
  const file=path.join(this.dir,entry.file),size=fs.statSync(file).size;
  const headers={'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
  let start=0,end=size-1,status=200;
  if(range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);
   if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${size}`}});
   start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${size}`}});
   status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length']=String(Math.max(0,end-start+1));
  return new Response(size?Readable.toWeb(fs.createReadStream(file,{start,end})):null,{status,headers});
 }
}
