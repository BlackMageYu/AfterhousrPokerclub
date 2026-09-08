import fs from 'node:fs';
import {CLUB_ROSTER} from '../src/roster.js';
fs.writeFileSync(new URL('../assets/roster-portraits.json',import.meta.url),JSON.stringify(CLUB_ROSTER.map(p=>({id:p.characterId,avatar:p.avatar,name:p.name}))));
