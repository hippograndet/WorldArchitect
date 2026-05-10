import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType = 'person' | 'place' | 'faction' | 'concept';
export type Gender = 'male' | 'female' | 'neutral';
export type SocialClass = 'common' | 'noble';
export type NameComponent = 'full' | 'first' | 'family';

export interface NameEntry {
  id: string;
  worldId: string;
  name: string;
  profileId: string;
  entityType: EntityType;
  gender: Gender;
  socialClass: SocialClass;
  nameComponent: NameComponent;
  tags: string[];
  source: 'generated' | 'user';
  createdAt: number;
}

interface PersonEndings {
  male: string[];
  female: string[];
  neutral: string[];
}

interface PhonemeProfile {
  label: string;
  feel: string;
  onsets: string[];
  nuclei: string[];
  codas: string[];
  endings: {
    person: PersonEndings;
    place: string[];
    faction: string[];
    concept: string[];
  };
  nobilityPrefixes: string[];
  familySuffixes: string[];
  syllableWeights: number[]; // weights for 1, 2, 3, 4 syllables
}

// ---------------------------------------------------------------------------
// Cultural profiles — deterministic phoneme tables
// ---------------------------------------------------------------------------

export const CULTURAL_PROFILES: Record<string, PhonemeProfile> = {
  roman: {
    label: 'Roman',
    feel: 'Latin cadence, clean vowels',
    onsets: ['m', 'c', 'l', 'v', 'f', 'p', 'r', 's', 't', 'b', 'g', 'n', 'qu', 'au'],
    nuclei: ['a', 'e', 'i', 'o', 'u', 'ae', 'ia'],
    codas: ['', '', '', 'r', 's', 'n'],
    endings: {
      person: {
        male:    ['us', 'ius', 'inus', 'or', 'er', 'ax'],
        female:  ['a', 'ia', 'ina', 'ix', 'ella'],
        neutral: ['is', 'e', 'ar'],
      },
      place:   ['um', 'ia', 'ium', 'a', 'ae'],
      faction: ['ii', 'ates', 'enses', 'ani'],
      concept: ['itas', 'udo', 'io', 'or'],
    },
    nobilityPrefixes: ['de', 'von', 'van'],
    familySuffixes:   ['ius', 'ia', 'ani', 'enses'],
    syllableWeights: [0.05, 0.45, 0.40, 0.10],
  },
  norse: {
    label: 'Norse',
    feel: 'Hard consonants, compound words',
    onsets: ['th', 'bl', 'br', 'dr', 'fr', 'gr', 'h', 'hj', 'hr', 'j', 'k', 'kj', 'l', 'r', 's', 'sk', 'sn', 'st', 'sv', 'tr', 'v'],
    nuclei: ['a', 'e', 'i', 'o', 'u', 'ei', 'au', 'y'],
    codas: ['', 'r', 'n', 'ld', 'rn', 'nd', 'l', 'k'],
    endings: {
      person: {
        male:    ['ulf', 'orn', 'varr', 'leif', 'bjorn', 'ald', 'rik'],
        female:  ['dis', 'hildur', 'run', 'wyn', 'borg', 'fridr'],
        neutral: ['r', 'in', 'an'],
      },
      place:   ['heim', 'vik', 'fjord', 'dal', 'berg', 'ness', 'garde'],
      faction: ['ing', 'ung', 'folk', 'lith'],
      concept: ['r', 'ing', 'nad'],
    },
    nobilityPrefixes: ['af', 'av'],
    familySuffixes:   ['son', 'dottir', 'ung', 'ling'],
    syllableWeights: [0.10, 0.50, 0.30, 0.10],
  },
  arabic: {
    label: 'Arabic',
    feel: 'Guttural stops, flowing vowels',
    onsets: ['al', 'abd', 'ab', 'kh', 'sh', 'j', 'z', 'q', 'gh', 'b', 'd', 'f', 'h', 'k', 'm', 'n', 'r', 's', 't', 'w', 'y'],
    nuclei: ['a', 'i', 'u', 'aa', 'ii', 'uu', 'ai', 'au'],
    codas: ['', '', 'r', 'n', 'd', 'l', 'm'],
    endings: {
      person: {
        male:    ['an', 'in', 'un', 'al-din', 'ar'],
        female:  ['ah', 'iyya', 'a', 'at'],
        neutral: ['i', 'u', 'al'],
      },
      place:   ['abad', 'iyya', 'an', 'a', 'at'],
      faction: ['iyyin', 'iyya', 'un'],
      concept: ['iyya', 'at', 'an'],
    },
    nobilityPrefixes: ['al-', 'ibn', 'bint'],
    familySuffixes:   ['iyya', 'abad', 'an'],
    syllableWeights: [0.05, 0.40, 0.40, 0.15],
  },
  east_asian: {
    label: 'East Asian',
    feel: 'Short syllables, tonal endings',
    onsets: ['b', 'ch', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 'sh', 't', 'w', 'x', 'y', 'zh'],
    nuclei: ['a', 'e', 'i', 'o', 'u', 'ao', 'ei', 'ou', 'ia', 'iao', 'ie', 'iu'],
    codas: ['', '', '', 'n', 'ng'],
    endings: {
      person: {
        male:    ['wei', 'jun', 'long', 'fang', 'hao'],
        female:  ['mei', 'lei', 'xiu', 'li', 'ying'],
        neutral: ['an', 'en', 'in'],
      },
      place:   ['shan', 'hu', 'zhou', 'cheng', 'jing', 'dao'],
      faction: ['men', 'tang', 'zong', 'pai'],
      concept: ['dao', 'li', 'qi', 'yi'],
    },
    nobilityPrefixes: [],
    familySuffixes:   ['shi', 'jia', 'men'],
    syllableWeights: [0.15, 0.55, 0.25, 0.05],
  },
  slavic: {
    label: 'Slavic',
    feel: 'Consonant clusters, soft endings',
    onsets: ['bl', 'br', 'ch', 'dr', 'gl', 'gr', 'j', 'k', 'kh', 'kr', 'l', 'm', 'n', 'p', 'pl', 'pr', 'r', 's', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'str', 'sv', 'tr', 'v', 'vl', 'vr', 'z', 'zh', 'zv'],
    nuclei: ['a', 'e', 'i', 'o', 'u', 'ia', 'io', 'ye'],
    codas: ['', '', 'k', 'v', 'n', 'r', 'l', 'sh'],
    endings: {
      person: {
        male:    ['ov', 'ev', 'in', 'slav', 'mir', 'vich'],
        female:  ['a', 'ia', 'mil', 'slava', 'ka'],
        neutral: ['ski', 'enko', 'uk'],
      },
      place:   ['ov', 'ev', 'sk', 'grad', 'pol', 'gorod'],
      faction: ['ichi', 'tsy', 'ane'],
      concept: ['ost', 'stvo', 'ie'],
    },
    nobilityPrefixes: ['von', 'de'],
    familySuffixes:   ['ov', 'ev', 'ski', 'sky'],
    syllableWeights: [0.05, 0.45, 0.35, 0.15],
  },
  high_elvish: {
    label: 'High Elvish',
    feel: 'Liquid consonants, long vowels',
    onsets: ['l', 'el', 'al', 'aer', 'ar', 'il', 'ir', 'f', 'g', 'n', 'r', 's', 'th', 'v', 'ael', 'cel', 'ser'],
    nuclei: ['ae', 'ai', 'el', 'il', 'ia', 'ie', 'a', 'e', 'i', 'o', 'u'],
    codas: ['', '', '', 'r', 'l', 'n', 'th'],
    endings: {
      person: {
        male:    ['ion', 'dir', 'nor', 'las', 'orn'],
        female:  ['iel', 'wen', 'thiel', 'ril', 'lien'],
        neutral: ['el', 'il', 'ar'],
      },
      place:   ['dor', 'del', 'rath', 'lin', 'mar', 'thal', 'nore'],
      faction: ['rim', 'lim', 'dal', 'drim'],
      concept: ['ith', 'mae', 'gul', 'nar'],
    },
    nobilityPrefixes: ['aer', 'cel'],
    familySuffixes:   ['iel', 'nor', 'dor', 'lim'],
    syllableWeights: [0.05, 0.35, 0.45, 0.15],
  },
  guttural: {
    label: 'Guttural',
    feel: 'Harsh stops, minimal vowels',
    onsets: ['gr', 'kr', 'br', 'dr', 'zg', 'kg', 'rg', 'bh', 'gh', 'kh', 'th', 'tr', 'sh', 'ur', 'ak', 'og', 'ug'],
    nuclei: ['a', 'o', 'u', 'ag', 'ok', 'uk'],
    codas: ['', 'k', 'g', 'r', 'sh', 'th', 'kh', 'rg'],
    endings: {
      person: {
        male:    ['ak', 'ok', 'ug', 'arg', 'rak'],
        female:  ['ash', 'uka', 'ogga'],
        neutral: ['gash', 'ruk', 'thok'],
      },
      place:   ['kur', 'gash', 'drak', 'thul', 'mor', 'groth'],
      faction: ['kagh', 'urk', 'grath', 'rok'],
      concept: ['gor', 'krag', 'thok'],
    },
    nobilityPrefixes: ['ur', 'og'],
    familySuffixes:   ['krath', 'gash', 'urk'],
    syllableWeights: [0.15, 0.50, 0.30, 0.05],
  },
};

// ---------------------------------------------------------------------------
// Deterministic name generation (no LLM)
// ---------------------------------------------------------------------------

function weightedRandom(weights: number[], seed: number): number {
  let r = ((seed * 1664525 + 1013904223) & 0xffffffff) / 0x100000000;
  r = Math.abs(r);
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) return i;
  }
  return weights.length - 1;
}

function pickFrom<T>(arr: T[], seed: number): T {
  const idx = Math.abs((seed * 2654435761) >>> 0) % arr.length;
  return arr[idx];
}

function generateOneName(
  profile: PhonemeProfile,
  entityType: EntityType,
  seed: number,
  gender: Gender = 'neutral',
  socialClass: SocialClass = 'common',
  nameComponent: NameComponent = 'full',
): string {
  // Family name: use familySuffixes for the ending
  if (nameComponent === 'family') {
    const syllableCount = weightedRandom(profile.syllableWeights, seed) + 1;
    let base = '';
    for (let s = 0; s < syllableCount; s++) {
      const sSeed = seed + s * 7919;
      base += pickFrom(profile.onsets, sSeed) + pickFrom(profile.nuclei, sSeed + 1);
    }
    const suffix = profile.familySuffixes.length > 0 ? pickFrom(profile.familySuffixes, seed + 888) : '';
    const name = base.slice(0, -1) + suffix;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  const syllableCount = weightedRandom(profile.syllableWeights, seed) + 1;
  let name = '';

  for (let s = 0; s < syllableCount; s++) {
    const sSeed = seed + s * 7919;
    const onset = pickFrom(profile.onsets, sSeed);
    const nucleus = pickFrom(profile.nuclei, sSeed + 1);
    const coda = s < syllableCount - 1 ? pickFrom(profile.codas, sSeed + 2) : '';
    name += onset + nucleus + coda;
  }

  // Pick ending based on entity type and gender
  let endings: string[];
  if (entityType === 'person') {
    endings = profile.endings.person[gender] ?? profile.endings.person.neutral;
  } else {
    endings = profile.endings[entityType] ?? profile.endings.person.neutral;
  }

  if (endings.length > 0) {
    const ending = pickFrom(endings, seed + 999);
    const base = name.length > 2 ? name.slice(0, -1) : name;
    name = base + ending;
  }

  // Noble prefix for person names
  if (socialClass === 'noble' && entityType === 'person' && profile.nobilityPrefixes.length > 0) {
    const prefix = pickFrom(profile.nobilityPrefixes, seed + 1234);
    const capitalised = name.charAt(0).toUpperCase() + name.slice(1);
    return prefix.endsWith('-') ? prefix + capitalised : prefix + ' ' + capitalised;
  }

  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface GenerateOptions {
  gender?: Gender;
  socialClass?: SocialClass;
  nameComponent?: NameComponent;
}

export function generateNames(
  profileId: string,
  entityType: EntityType,
  worldId: string,
  count = 8,
  opts: GenerateOptions = {},
): string[] {
  const profile = CULTURAL_PROFILES[profileId];
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);

  const { gender = 'neutral', socialClass = 'common', nameComponent = 'full' } = opts;

  const existing = listNames(worldId).map((e) => e.name.toLowerCase());
  const results: string[] = [];
  let attempt = 0;

  while (results.length < count && attempt < count * 10) {
    const seed = Date.now() + attempt * 31337 + worldId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const name = generateOneName(profile, entityType, seed + attempt, gender, socialClass, nameComponent);
    if (!existing.includes(name.toLowerCase()) && !results.map((n) => n.toLowerCase()).includes(name.toLowerCase())) {
      results.push(name);
    }
    attempt++;
  }

  return results;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function parseEntry(row: Record<string, unknown>): NameEntry {
  return {
    id: row.id as string,
    worldId: row.world_id as string,
    name: row.name as string,
    profileId: row.profile_id as string,
    entityType: row.entity_type as EntityType,
    gender: (row.gender as Gender | undefined) ?? 'neutral',
    socialClass: (row.social_class as SocialClass | undefined) ?? 'common',
    nameComponent: (row.name_component as NameComponent | undefined) ?? 'full',
    tags: JSON.parse((row.tags as string) || '[]') as string[],
    source: row.source as 'generated' | 'user',
    createdAt: row.created_at as number,
  };
}

export interface ListNamesFilter {
  entityType?: EntityType;
  gender?: Gender;
  socialClass?: SocialClass;
  nameComponent?: NameComponent;
  tags?: string[];
}

export function listNames(worldId: string, entityType?: EntityType, tags?: string[]): NameEntry[];
export function listNames(worldId: string, filter?: ListNamesFilter): NameEntry[];
export function listNames(worldId: string, entityTypeOrFilter?: EntityType | ListNamesFilter, tags?: string[]): NameEntry[] {
  const db = getDb();
  let query = `SELECT * FROM name_bank WHERE world_id = ?`;
  const params: unknown[] = [worldId];

  let filter: ListNamesFilter = {};
  if (typeof entityTypeOrFilter === 'string') {
    filter = { entityType: entityTypeOrFilter, tags };
  } else if (entityTypeOrFilter) {
    filter = entityTypeOrFilter;
  }

  if (filter.entityType) {
    query += ` AND entity_type = ?`;
    params.push(filter.entityType);
  }
  if (filter.gender) {
    query += ` AND gender = ?`;
    params.push(filter.gender);
  }
  if (filter.socialClass) {
    query += ` AND social_class = ?`;
    params.push(filter.socialClass);
  }
  if (filter.nameComponent) {
    query += ` AND name_component = ?`;
    params.push(filter.nameComponent);
  }

  query += ` ORDER BY created_at DESC`;
  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  let entries = rows.map(parseEntry);

  const tagFilter = filter.tags ?? tags;
  if (tagFilter && tagFilter.length > 0) {
    entries = entries.filter((e) => tagFilter.some((t) => e.tags.includes(t)));
  }

  return entries;
}

export function addNames(
  worldId: string,
  entries: Array<{
    name: string;
    profileId: string;
    entityType: EntityType;
    gender?: Gender;
    socialClass?: SocialClass;
    nameComponent?: NameComponent;
    tags: string[];
    source?: 'generated' | 'user';
  }>,
): NameEntry[] {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO name_bank (id, world_id, name, profile_id, entity_type, gender, social_class, name_component, tags, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return db.transaction(() => {
    return entries.map((e) => {
      const id = nanoid();
      const gender = e.gender ?? 'neutral';
      const socialClass = e.socialClass ?? 'common';
      const nameComponent = e.nameComponent ?? 'full';
      stmt.run(id, worldId, e.name, e.profileId, e.entityType, gender, socialClass, nameComponent, JSON.stringify(e.tags), e.source ?? 'generated', now);
      return {
        id,
        worldId,
        name: e.name,
        profileId: e.profileId,
        entityType: e.entityType,
        gender,
        socialClass,
        nameComponent,
        tags: e.tags,
        source: e.source ?? 'generated',
        createdAt: now,
      } as NameEntry;
    });
  })();
}

export function deleteName(nameId: string): void {
  getDb().prepare(`DELETE FROM name_bank WHERE id = ?`).run(nameId);
}
