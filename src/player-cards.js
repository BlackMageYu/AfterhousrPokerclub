const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
const round3=n=>Math.round(Number(n)*1000)/1000;

// These are deliberately separate from STYLES: importing styles here would
// create a roster -> profile -> style cycle. They mirror the public style
// anchors and are only used to calculate an individual's permanent card.
const STYLE_CARD_BASE={
  TAG:{looseness:.28,aggression:.72,bluff:.12,discipline:.82,sizing:.65,level:.72,position:.62},
  TP:{looseness:.22,aggression:.18,bluff:.02,discipline:.70,sizing:.45,level:.56,position:.46},
  LAG:{looseness:.65,aggression:.78,bluff:.25,discipline:.58,sizing:.78,level:.69,position:.58},
  LP:{looseness:.76,aggression:.16,bluff:.02,discipline:.25,sizing:.48,level:.48,position:.40},
  NIT:{looseness:.08,aggression:.40,bluff:.005,discipline:.98,sizing:.62,level:.82,position:.56},
  MANIAC:{looseness:.94,aggression:.96,bluff:.48,discipline:.12,sizing:1.10,level:.61,position:.54},
  GRINDER:{looseness:.36,aggression:.58,bluff:.09,discipline:.94,sizing:.53,level:.78,position:.68}
};

const countWords=(text,words)=>words.reduce((sum,word)=>sum+(text.split(word).length-1),0);
const scheduleHours=(schedule,label)=>{
  const match=String(schedule??'').match(new RegExp(`${label}\\s*([\\d.]+)\\s*小时`));
  return Number(match?.[1]??0);
};
const textOf=p=>[p?.occupation,p?.tagline,p?.background,p?.pokerClues].filter(Boolean).join(' ');

export function buildPlayerCard(profile,{legend=false,levelOverride}={}){
  const style=profile?.style??'TP',base=STYLE_CARD_BASE[style]??STYLE_CARD_BASE.TP,text=textOf(profile);
  const analytical=Math.min(6,countWords(text,['精算','量化','概率','赔率','统计','模型','数据','风控','律师','医生','工程','审计','账本','公证','交易','风险']));
  const technical=Math.min(5,countWords(text,['精确','计算','规程','纪律','公式','算法','理性','参数','观察','记录','复盘']));
  const adventurous=Math.min(6,countWords(text,['冒险','战场','街头','赌徒','酒吧','夜场','摔跤','码头','火','刺激','冲','全下','大胆','擂台','战争']));
  const patient=Math.min(6,countWords(text,['耐心','等待','慢','退休','教师','馆员','医生','照料','固定','规矩','稳','谨慎']));
  const conciliatory=Math.min(6,countWords(text,['老好人','调解','和气','不愿','不敢','忍让','跟到底','拒绝冲突','借给','求稳']));
  const impulsive=Math.min(6,countWords(text,['冲动','不理智','追注','输红眼','疯狂','乱来','不怕输','任性','上头','不顾']));
  const creative=Math.min(5,countWords(text,['即兴','艺术','音乐','文学','设计','摄影','想象','灵活','故事','表演']));
  const pokerSkill=Math.min(6,countWords(text,['职业牌手','半职业','高额','正期望','范围','位置','价值下注','持续下注','资金管理','对手数据','牌力','牌面']));
  const age=Number(profile?.age??45),experience=clamp((age-28)/42,0,.12),hours=scheduleHours(profile?.schedule,'打牌');
  // A tiny deterministic tie-breaker keeps similarly described profiles
  // distinguishable at the requested third decimal. It is derived from the
  // stable source index, never from a runtime random draw.
  const sourceMatch=String(profile?.id??profile?.characterId??'').match(/(\d+)$/),sourceIndex=Number(sourceMatch?.[1]??0),tie=sourceMatch?(sourceIndex-73)*.0002:0;
  const regularLevel=clamp(base.level+pokerSkill*.014+analytical*.006+technical*.006+hours*.004+experience-adventurous*.006-impulsive*.014-conciliatory*.003,.32,.94);
  const level=legend?1:levelOverride??regularLevel;
  const card={
    looseness:clamp(base.looseness+adventurous*.012+creative*.009+conciliatory*.006-analytical*.007-patient*.003+tie,.03,.97),
    aggression:clamp(base.aggression+adventurous*.014+analytical*.005+technical*.004-conciliatory*.012-impulsive*.004+tie*.8,.05,.98),
    bluff:clamp(base.bluff+adventurous*.010+creative*.010+analytical*.002-analytical*.004-conciliatory*.008+tie*.3,.002,.55),
    discipline:base.discipline,
    sizing:clamp(base.sizing+analytical*.010+technical*.007+adventurous*.006-conciliatory*.005-tie*.4,.15,1.25),
    patience:clamp(.16+base.discipline*.16+patient*.018+analytical*.010-conciliatory*.006-impulsive*.012+tie*.5,.08,.48),
    position:clamp(base.position+analytical*.014+technical*.010+patient*.004-adventurous*.004+tie*.6,.08,.94),
    callCaution:clamp(.45+base.discipline*.25+analytical*.018+conciliatory*.012-patient*.004-adventurous*.010-impulsive*.018-tie*.3,.08,.94),
    level:clamp(level+tie*.4,0,1),
    preferredStake:level>=.88?'top':level>=.78?'master':level>=.65?'high':level>=.5?'mid':'low'
  };
  // The discipline term above is intentionally expanded here so the formula
  // stays readable while still using only story-derived signals.
  card.discipline=clamp(base.discipline+analytical*.018+technical*.014+patient*.010-adventurous*.006-impulsive*.020-creative*.004+tie*.5,.06,.99);
  for(const key of ['looseness','aggression','bluff','discipline','sizing','patience','position','callCaution','level'])card[key]=round3(card[key]);
  return {style,...card};
}

export function cardTraits(profile){
  const card=profile?.card??buildPlayerCard(profile);
  const base=STYLE_CARD_BASE[profile?.style]??STYLE_CARD_BASE.TP;
  const sourceIndex=Number(String(profile?.id??profile?.characterId??'').match(/(\d+)$/)?.[1]??0);
  return {
    rangeShift:clamp(card.looseness-base.looseness,-.05,.05),
    aggressionShift:clamp(card.aggression-base.aggression,-.085,.085),
    bluffShift:clamp(card.bluff-base.bluff,-.030,.030),
    sizingShift:clamp(card.sizing-base.sizing,-.075,.075),
    patienceShift:clamp(card.patience-.22,-.075,.075),
    positionShift:clamp((card.position-.5)*.04,-.035,.035),
    callCaution:clamp((card.callCaution-.5)*.10,-.055,.055),
    levelShift:clamp(card.level-.75,-.45,.25),
    identityShift:round3((sourceIndex%100)*.001)
  };
}

export function legendCard(style,level=1,context='长期职业牌局与高额现金桌经验；范围、位置、赔率、价值下注与资金管理'){
  return buildPlayerCard({style,occupation:'职业牌手',tagline:context,pokerClues:context+'；长期职业牌局与高额现金桌经验'}, {legend:true,levelOverride:level});
}

export {round3};
