import fs from 'node:fs';
import {LOCAL_ROSTER,AI_ROSTER} from '../src/roster.js';
fs.writeFileSync(new URL('../assets/roster-portraits.json',import.meta.url),JSON.stringify([...LOCAL_ROSTER,...AI_ROSTER].map(p=>({id:p.characterId,avatar:p.avatar,name:p.name}))));
