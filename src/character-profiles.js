import {SOURCE_ROLE_PROFILES} from './role-library-index.js';
import {buildPlayerCard,cardTraits} from './player-cards.js';

// The source library contains 145 characters (95 original + 50 supplied). A seeded
// shuffle makes the requested 40% local split reproducible across restarts.
const LOCAL_SELECTION_SEED=0xAF7E2026;
function shuffled(list,seed){
  const result=[...list];let x=seed>>>0;
  for(let i=result.length-1;i>0;i--){x=(Math.imul(x,1664525)+1013904223)>>>0;const j=x%(i+1);[result[i],result[j]]=[result[j],result[i]];}
  return result;
}
// The requested 50 new characters belong to the external-AI pool. Preserve
// the original 95-character local/AI split so switching control mode remains
// meaningful and the new AI roster grows by exactly fifty.
const legacy=SOURCE_ROLE_PROFILES.filter(p=>Number(p.id.slice(5))<=95);
const chinese=legacy.filter(p=>p.nationality==='中国');
const foreign=legacy.filter(p=>p.nationality!=='中国');
const localIds=new Set([
  ...shuffled(chinese,LOCAL_SELECTION_SEED).slice(0,Math.floor(chinese.length*.4)).map(p=>p.id),
  ...shuffled(foreign,LOCAL_SELECTION_SEED^0x5A17).slice(0,Math.floor(foreign.length*.4)).map(p=>p.id)
]);

const roleProfiles=SOURCE_ROLE_PROFILES.map((profile,index)=>{
  const {id,...rest}=profile;
  const card=buildPlayerCard({...rest,id});
  return {...rest,characterId:id,pool:localIds.has(id)?'local':'ai',sourceIndex:index+1,card};
});
// Assign a stable cell in a region/gender-specific portrait pool. This keeps
// every roster entry on a different face instead of reusing one crop for an
// entire demographic group.
const portraitCounts=new Map();
for(const profile of roleProfiles){
  const region=avatarRegion(profile),gender=profile.gender==='女'?'f':'m',key=(gender==='m'&&['europe','latin','global'].includes(region))?'m|western':(gender==='f'&&['europe','latin','global'].includes(region))?'f|western':gender+'|'+region;
  profile.portraitIndex=portraitCounts.get(key)??0;
  portraitCounts.set(key,profile.portraitIndex+1);
}
export const ROLE_PROFILES=roleProfiles;
export const LOCAL_PROFILES=ROLE_PROFILES.filter(p=>p.pool==='local');
export const AI_PROFILES=ROLE_PROFILES.filter(p=>p.pool==='ai');
export const roleProfile=id=>ROLE_PROFILES.find(p=>p.characterId===id);

const avatarSeed=value=>[...String(value??'')].reduce((n,c)=>(Math.imul(n,33)+c.codePointAt(0))>>>0,0xA71A5EED);
function avatarRegion(profile){
  const nationality=profile?.nationality;
  return nationality==='中国'||nationality==='日本'||nationality==='韩国'?'east-asia':
    ['印度','伊朗','沙特阿拉伯','埃及','土耳其'].includes(nationality)?'south-west-asia':
    ['尼日利亚','肯尼亚'].includes(nationality)||String(profile?.ethnicity??'').includes('非裔')?'africa':
    ['墨西哥','巴西','阿根廷'].includes(nationality)?'latin':
    ['法国','德国','英国','意大利','西班牙','希腊','波兰','瑞典','葡萄牙','塞尔维亚','澳大利亚'].includes(nationality)?'europe':'global';
}
function avatarScene(profile,region){
  const seed=avatarSeed(profile.characterId),occupation=String(profile.occupation??''),childRoll=seed%100;
  // Childhood photos are deliberately common but not dominant. The remaining
  // roles are spread across unrelated real-life capture situations.
  if(childRoll<30){
    if(region==='east-asia'&&seed%3!==0)return 'child-east';
    return seed%2?'child-global':'child-life';
  }
  // Occupation nudges a role toward an environmental work photo without
  // forcing every lawyer, teacher or engineer into the same composition.
  if(/律师|公证|法官|医|护士|教师|教授|工程|技师|机械|记者|摄影|设计|音乐|艺术|馆员/.test(occupation)&&seed%4===0)return 'work';
  return ['life','selfie','work','art'][(seed>>>5)%4];
}

export function roleTraits(profile){
  const p=typeof profile==='string'?roleProfile(profile):profile;
  if(!p){
    const id=typeof profile==='string'?profile:'';
    if(!id.startsWith('legend-'))return null;
    return cardTraits({style:permanentStyle(id),occupation:'职业牌手',tagline:'长期职业牌局经验',pokerClues:'范围、位置、赔率、价值下注与资金管理',age:45,schedule:'打牌 8 小时'});
  }
  return cardTraits(p);
}

export function permanentStyle(id){
  const profile=roleProfile(id);
  if(profile)return profile.style;
  const legendStyles=['TAG','LAG','TAG','LAG','LAG','LAG','TAG','TAG','LAG','LAG'];
  return id?.startsWith('legend-')?legendStyles[Number(id.slice(7))-1]:undefined;
}

export function avatarDescriptor(profile){
  const p=typeof profile==='string'?roleProfile(profile):profile;
  if(!p)return 'role|unknown|m|europe|45|general|life';
  const region=avatarRegion(p);
  const occupation=p.occupation;
  const job=occupation.includes('律师')||occupation.includes('公证')||occupation.includes('法官')?'law':
    occupation.includes('医')||occupation.includes('护士')?'medical':
    occupation.includes('工程')||occupation.includes('技师')||occupation.includes('机械')?'technical':
    occupation.includes('教师')||occupation.includes('教授')||occupation.includes('馆员')?'education':
    occupation.includes('牌手')||occupation.includes('投资')||occupation.includes('精算')||occupation.includes('会计')||occupation.includes('金融')||occupation.includes('交易')?'finance':
    occupation.includes('记者')||occupation.includes('摄影')||occupation.includes('设计')||occupation.includes('音乐')||occupation.includes('艺术')?'creative':
    occupation.includes('向导')||occupation.includes('户外')||occupation.includes('牧民')||occupation.includes('航海')?'outdoor':'service';
  return 'atlas|'+p.characterId+'|'+(p.gender==='女'?'f':'m')+'|'+region+'|'+(p.age??45)+'|'+job+'|'+avatarScene(p,region)+'|'+(p.portraitIndex??0);
}

export function dossier(character){
  const profile=roleProfile(character.characterId);
  if(profile)return [
    {label:'年龄与身份',text:profile.age+' 岁 · '+profile.gender+' · '+profile.nationality+(profile.ethnicity?' · '+profile.ethnicity:'')},
    {label:'现居与职业',text:profile.location+' · '+profile.occupation+' · 平均时薪约 $'+profile.wageUSD+'/小时'},
    {label:'牌手卡片',text:'决策风格参数已用于塑造该角色的牌桌行为，具体数值不公开。'},
    {label:'出身故事',text:profile.background},
    {label:'牌风养成',text:profile.pokerClues},
    {label:'生活节奏',text:profile.schedule},
    {label:'一句话人设',text:profile.tagline}
  ];
  const card=character.playerCard;
  return [
    {label:'身份',text:character.kind==='inspired'?'人物原型 · '+(character.alias??character.name):'原创人物'},
    ...(card?[{label:'牌手卡片',text:'决策风格参数已用于塑造该角色的牌桌行为，具体数值不公开。'}]:[]),
    {label:'经历',text:character.bio??'等待更多相遇。'},
    {label:'性格线索',text:(character.personality??'仍在观察中。').split('；')[0]},
    {label:'完整人物设定',text:character.personality??character.bio??'档案已解锁。'}
  ];
}
