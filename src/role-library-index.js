import {SOURCE_ROLE_PROFILES as BASE_ROLE_PROFILES} from './role-library.js';
import {EXTRA_ROLE_PROFILES} from './role-library-extra.js';

// Keep the original generated library intact and layer the 50 supplied
// profiles on top. The source order is part of the stable local/AI split.
export const SOURCE_ROLE_PROFILES=[...BASE_ROLE_PROFILES,...EXTRA_ROLE_PROFILES];
