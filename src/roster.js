import {LOCAL_PROFILES,AI_PROFILES,permanentStyle,roleTraits,avatarDescriptor} from './character-profiles.js';
import {legendCard} from './player-cards.js';

// All identities belong to one club roster. The action engine selected for a
// table is separate from the opponent's identity, portrait and play profile.
const inspirations=[
 ['菲尔·艾维','Phil Ivey','职业牌手，高额现金桌人物原型。','冷静、观察细致，均衡价值与诈唬；依据公开行动寻找漏洞。'],
 ['道尔·布朗森','Doyle Brunson','老一代职业牌手与扑克作者人物原型。','老派进攻、经验导向；深筹码愿意缠斗，也懂得尊重强烈反击。'],
 ['菲尔·赫尔穆特','Phil Hellmuth','锦标赛职业牌手人物原型。','自信张扬，擅长观察偏差；偶有竞争心，但不会因此机械追注。'],
 ['丹尼尔·内格里亚努','Daniel Negreanu','职业牌手与扑克传播者人物原型。','亲和灵活，善于根据已见行动调整；小池试探与主动施压交替。'],
 ['汤姆·德万','Tom Dwan / durrrr','线上与高额现金桌职业牌手人物原型。','大胆有创意，能用不同尺度施压；诈唬有牌面依据，允许适时弃牌。'],
 ['丹尼尔·茨','Daniel Cates / Jungleman','线上单挑与混合游戏职业牌手人物原型。','分析与进攻并重，尺度多变；按对手漏洞调整，不无差别频繁全下。'],
 ['陈强尼','Johnny Chan','华裔职业牌手人物原型。','老练、稳健，重视控池与诱导；慢打和主动价值下注交替。'],
 ['帕特里克·安东尼乌斯','Patrik Antonius','芬兰职业牌手人物原型。','冷静严谨，关注范围和赔率；稳定执行混合策略，不受短期输赢支配。'],
 ['谭轩','Tan Xuan','高额现金桌与短牌赛事牌手人物原型。','富于想象力、主动进攻；当前游戏为标准52张德州，严格使用本桌规则。'],
 ['林仁','Ren “Tony” Lin','华裔职业牌手人物原型。','外向、自信、善于寻找可施压的对手；依照行动证据调整而非空想读心。']
];
const legendRegions=['africa','europe','europe','europe','europe','europe','east-asia','europe','east-asia','east-asia'];

const profileForPlay=profile=>({...profile,bio:profile.background,personality:profile.tagline+'；'+profile.pokerClues,avatar:avatarDescriptor(profile),level:profile.card?.level??.5,playerCard:profile.card});
const sourceLocal=LOCAL_PROFILES.map(profile=>({...profileForPlay(profile),kind:'local'}));
const sourceAI=AI_PROFILES.map(profile=>({...profileForPlay(profile),kind:'external'}));
export const LOCAL_ROSTER=sourceLocal;
export const AI_ROSTER=[
  ...inspirations.map(([name,alias,bio,personality],i)=>{const characterId='legend-'+(i+1),style=['TAG','LAG','TAG','LAG','LAG','LAG','TAG','TAG','LAG','LAG'][i],playerCard=legendCard(style,1,bio+'；'+personality);return {characterId,name,alias,bio,personality,avatar:`legend|${characterId}|${30+i}`,kind:'inspired',occupation:'职业牌手',age:45,gender:'男',nationality:legendRegions[i]==='east-asia'?'中国':legendRegions[i]==='africa'?'美国':'美国',ethnicity:legendRegions[i]==='africa'?'非裔':'白人',schedule:'工作 8 小时（12:00–20:00）｜打牌 4 小时（20:00–00:00）｜其余为休息',style,level:1,playerCard};}),
  ...sourceAI
];
export const CLUB_ROSTER=[...LOCAL_ROSTER,...AI_ROSTER];
export const ALL_ROSTER=CLUB_ROSTER;

// Every source character carries a permanent, story-derived card. Small hand
// noise is still added later so a profile does not play identically every hand.
export function localIdentityTraits(characterId){return roleTraits(characterId);}
export function identityTraits(characterId){return roleTraits(characterId);}

const seedOf=value=>[...String(value??'')].reduce((n,c)=>(n*33+c.codePointAt(0))>>>0,17);
const legacyCareer=['普通职业','稳定职业','高收入职业','自由职业','职业牌手'];
export function financialProfile(character){
  const seed=seedOf(character?.characterId),source=character?.characterId?.startsWith('role-');
  const style=permanentStyle(character?.characterId)??character?.style,baseSkill={TAG:.72,TP:.56,LAG:.69,LP:.48,NIT:.82,MANIAC:.61,GRINDER:.78}[style]??.62;
  if(source){
    const wage=Math.max(3,Number(character.wageUSD)||8),level=Number(character.level??character.card?.level??baseSkill),hours=Math.round(900+level*1200),variation=.94+level*.06;
    return {
      career:character.occupation||'自由职业',
      incomePerHour:Math.round(wage*variation),
      bankroll:Math.round(wage*hours),
      skill:Math.round(level*1000)/1000,
      level:Math.round(level*1000)/1000
    };
  }
  const career=legacyCareer[character?.kind==='inspired'?4:seed%4],base=[180000,320000,720000,260000,1200000][legacyCareer.indexOf(career)]??260000,wage=[420,580,960,660,1400][legacyCareer.indexOf(career)]??660,level=Number(character?.level??character?.playerCard?.level??(character?.kind==='inspired'?1:baseSkill)),variation=.92+level*.08;
  return {career,incomePerHour:Math.round(wage*variation),bankroll:Math.round(base*variation),skill:Math.round(level*1000)/1000,level:Math.round(level*1000)/1000};
}

export function drawCharacters(_mode,count,random=Math.random,stakeLevel='low'){
  const pool=[...CLUB_ROSTER];
  if(!Number.isInteger(count)||count<1||count>6)throw new Error('无效的机器人数量');
  // High-level profiles are more likely to choose high-stakes tables. They
  // retain a non-zero low-stakes weight to model occasional recreational
  // “fishing”; low-level profiles are intentionally noisy and low-stakes.
  const target={low:.36,mid:.50,high:.66,master:.80,top:.92}[stakeLevel]??.36;
  const weight=p=>{
    const level=Number(p.level??p.playerCard?.level??.5),distance=Math.abs(level-target);
    return .18+Math.max(.02,1-distance*1.7);
  };
  const ranked=pool.map(character=>({character,key:Math.pow(Math.max(Number.EPSILON,random()),1/weight(character))})).sort((a,b)=>b.key-a.key);
  pool.splice(0,pool.length,...ranked.map(item=>item.character));
  const selected=[];let extreme=false;
  for(const p of pool){
    const rare=['NIT','MANIAC','GRINDER'].includes(permanentStyle(p.characterId));
    if(rare&&extreme)continue;
    selected.push(p);if(rare)extreme=true;if(selected.length===count)break;
  }
  return structuredClone(selected);
}
