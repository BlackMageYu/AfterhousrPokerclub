export const SUITS = ['s', 'h', 'd', 'c'];
export const RANKS = '23456789TJQKA';
export const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
export function newDeck() { return SUITS.flatMap(s => [...RANKS].map(r => r + s)); }
export function shuffle(cards, random = Math.random) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function cardText(c) { return c ? ({s:'♠', h:'♥', d:'♦', c:'♣'}[c[1]] + (c[0] === 'T' ? '10' : c[0])) : '—'; }
// Keep the fast evaluator for simulations; enumerate only when displaying a made hand.
// Put board cards first to prefer playing the board when several best fives tie.
export function bestFive(cards) {
  const rank=evaluate(cards);
  for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let f=d+1;f<cards.length;f++){
    const five=[cards[a],cards[b],cards[c],cards[d],cards[f]];
    if(evaluate(five).score===rank.score)return {...rank,cards:five};
  }
  throw new Error('无法提取最佳五张牌');
}
// Evaluates any 5–7 cards directly; category and kickers share a comparable base-15 score.
export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length) throw new Error('需要 5–7 张不重复的牌');
  const counts = Array(15).fill(0), suits = {s:[], h:[], d:[], c:[]};
  for (const c of cards) { const r = RANKS.indexOf(c[0]) + 2; if (r < 2 || !suits[c[1]]) throw new Error('无效牌'); counts[r]++; suits[c[1]].push(r); }
  const ranks = []; for (let r = 14; r >= 2; r--) if (counts[r]) ranks.push(r);
  const straight = arr => { const set = new Set(arr); if (set.has(14)) set.add(1); for (let hi = 14; hi >= 5; hi--) if ([0,1,2,3,4].every(d => set.has(hi-d))) return hi; return 0; };
  const flush = Object.values(suits).find(a => a.length >= 5)?.sort((a,b)=>b-a);
  const quads = ranks.filter(r=>counts[r]===4), trips = ranks.filter(r=>counts[r]===3), pairs = ranks.filter(r=>counts[r]>=2);
  let category, kickers;
  if (flush && straight(flush)) { category=8; kickers=[straight(flush)]; }
  else if (quads.length) { category=7; kickers=[quads[0], ...ranks.filter(r=>r!==quads[0]).slice(0,1)]; }
  else if (trips.length && pairs.some(r=>r!==trips[0])) { category=6; kickers=[trips[0], pairs.find(r=>r!==trips[0])]; }
  else if (flush) { category=5; kickers=flush.slice(0,5); }
  else if (straight(ranks)) { category=4; kickers=[straight(ranks)]; }
  else if (trips.length) { category=3; kickers=[trips[0],...ranks.filter(r=>r!==trips[0]).slice(0,2)]; }
  else if (pairs.length>=2) { category=2; kickers=[...pairs.slice(0,2),ranks.find(r=>!pairs.slice(0,2).includes(r))]; }
  else if (pairs.length) { category=1; kickers=[pairs[0],...ranks.filter(r=>r!==pairs[0]).slice(0,3)]; }
  else { category=0; kickers=ranks.slice(0,5); }
  const score = [category,...kickers,...Array(5-kickers.length).fill(0)].reduce((n,r)=>n*15+r,0);
  return { category, kickers, score, name:category===8&&kickers[0]===14?'皇家同花顺':HAND_NAMES[category] };
}
