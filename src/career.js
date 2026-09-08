const STAT_KEYS=['hands','vpip','pfr','won','showdowns','maxWon'];

const clone=value=>structuredClone(value);

export function playerKey(player){
  return player?.id===0?'player':player?.characterId??`seat-${player?.id??'unknown'}`;
}

export function normalizeStats(stats={}){
  const result={};
  for(const key of STAT_KEYS)result[key]=Number.isSafeInteger(stats?.[key])&&stats[key]>=0?stats[key]:0;
  return result;
}

export function mergeCareerStats(player,careerStats={}){
  const saved=normalizeStats(careerStats[playerKey(player)]),current=normalizeStats(player.stats);
  // A fresh seat starts at zero. Keep its returning character's accumulated
  // public tendencies instead of allowing those placeholder zeros to erase
  // the range evidence gathered in earlier sessions.
  player.stats=Object.fromEntries(STAT_KEYS.map(name=>[name,Math.max(saved[name],current[name])]));
  return player;
}

export function syncCareerStats(engine,careerStats={}){
  for(const player of engine?.players??[]){
    const key=playerKey(player),current=normalizeStats(player.stats),saved=normalizeStats(careerStats[key]);
    careerStats[key]=Object.fromEntries(STAT_KEYS.map(name=>[name,Math.max(saved[name],current[name])]));
    player.stats=normalizeStats(careerStats[key]);
  }
  return careerStats;
}

// Engine memories are indexed by seat number. Re-key them by character so a
// returning opponent keeps learning even when they sit in another seat.
export function hydrateMemories(engine,memoryBank={},preserveSessionKeys=false){
  engine.memories??={};
  for(const observer of engine.players.filter(p=>p.id!==0&&p.status!=='empty')){
    const source=memoryBank[playerKey(observer)]??{};
    for(const target of engine.players.filter(p=>p.id!==observer.id)){
      const saved=source[playerKey(target)];
      if(!saved)continue;
      const memory=clone(saved);if(!preserveSessionKeys){delete memory.lastObservedHand;delete memory.lastShownHand;}
      engine.memories[observer.id]??={};
      engine.memories[observer.id][target.id]=memory;
    }
  }
  return engine;
}

export function syncMemories(engine,memoryBank={}){
  for(const observer of engine?.players?.filter(p=>p.id!==0&&p.status!=='empty')??[]){
    const source=memoryBank[playerKey(observer)]??={};
    for(const target of engine.players.filter(p=>p.id!==observer.id)){
      const memory=engine.memories?.[observer.id]?.[target.id];
      if(!memory)continue;
      const saved=clone(memory);
      source[playerKey(target)]=saved;
    }
    memoryBank[playerKey(observer)]=source;
  }
  return memoryBank;
}

export function memoryFor(memoryBank,player){
  const value=memoryBank?.[playerKey(player)]?.player;
  return value?clone(value):null;
}
