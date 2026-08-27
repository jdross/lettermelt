#!/usr/bin/env node
'use strict';

/*
 * Build script for the LetterMelt word-list data assets.
 *
 * Generates:
 *   - data/lexicon.js  (one packed copy of every playable word and bit flags
 *                       for required/easy/base pools)
 *
 * Source: data/prevalence-dict.csv (Brysbaert et al. word-prevalence norms).
 * Pknown is the fraction of ~200k people who reported knowing the word.
 *
 * Usage:
 *   node scripts/build_wordlists.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data');
const PREVALENCE_IN = path.join(OUT_DIR, 'prevalence-dict.csv');
const LEXICON_OUT = path.join(OUT_DIR, 'lexicon.js');

const FLAG_HARD_SHORT = 1;
const FLAG_HARD_LONG = 2;
const FLAG_EASY_SHORT = 4;
const FLAG_EASY_LONG = 8;
const FLAG_BASE = 16;
const FLAG_EASY_BASE = 32;

const DICT_MIN_LEN = 4;
const DICT_MAX_LEN = 11;

const COMMON_MIN_LEN = 4;
const COMMON_MAX_LEN = 7;
const COMMON_LONG_MIN_LEN = 8;
const COMMON_LONG_MAX_LEN = 11;

// Required words: a typical player recognises them on sight.
const HARD_MIN_PKNOWN = 0.8;
const EASY_MIN_PKNOWN = 0.9;
// The base word headlines the puzzle; hold it above the hard common floor.
const BASE_MIN_PKNOWN = 0.9;
const EASY_BASE_MIN_PKNOWN = 0.95;

const LOWER_ALPHA_RE = /^[a-z]+$/;

const BLOCKLIST = new Set([
  'nigger', 'nigga', 'faggot', 'fag', 'dyke', 'chink', 'spic', 'kike',
  'gook', 'wetback', 'tranny', 'retard', 'retards', 'coon', 'coons',
  'cunt', 'whore', 'slut', 'rape', 'raped', 'raping', 'rapist',
  'nazi', 'nazis', 'molest', 'molested', 'molester',
  'negro', 'negros', 'negroes', 'jap', 'japs',
]);

const PROFANITY_ALLOWLIST = new Set(['escort', 'snatch', 'suck', 'sucker']);
const BLOCK_SUFFIXES = ['s', 'es', 'y', 'ies', 'er', 'ers', 'ed', 'ing', 'ish'];

const COMMON_ONLY_BLOCKLIST = new Set([
  'sex', 'sexy', 'sexual', 'porn', 'porno', 'nude', 'nudes', 'naked',
  'penis', 'vagina', 'nipple', 'nipples', 'breast', 'breasts', 'boob',
  'boobs', 'tit', 'tits', 'ass', 'asses', 'arse', 'anal', 'anus', 'butt',
  'butts', 'dick', 'dicks', 'cock', 'cocks', 'pussy', 'semen', 'sperm',
  'orgasm', 'erotic', 'erotica', 'hooker', 'stripper', 'condom', 'condoms',
  'shit', 'shits', 'piss', 'pissed', 'fuck', 'fucks', 'fucked', 'fucking',
  'bitch', 'bitches', 'bastard', 'damn', 'hell', 'crap', 'horny', 'kinky',
  'fetish', 'incest', 'pedo', 'viagra', 'heroin', 'cocaine', 'meth',
  'suicide', 'murder', 'murders', 'killer', 'killers', 'corpse', 'corpses',
  'hardcore', 'lesbians', 'phentermine', 'personals', 'gangbang', 'blowjobs',
  'gangbangs', 'blowjob',
  'marijuana', 'cannabis', 'hashish', 'heroin', 'cocaine', 'meth', 'ecstasy',
  'mdma', 'opioid', 'opioids', 'fentanyl', 'overdose', 'drug', 'drugs',
  'drugged', 'druggie', 'druggies', 'drugging', 'druggist', 'drugstore',
  'turd', 'scrotum', 'bugger', 'prick', 'feces', 'faeces', 'urine', 'phallus',
  'jizz', 'schlong', 'pecker', 'wanker', 'tosser', 'arsehole', 'bollock',
  'minge', 'knacker', 'genital', 'genitals', 'genitalia', 'testicle',
  'testicles', 'uterus', 'nipples', 'buttock', 'buttocks', 'rectal',
  'sodomize', 'fondle', 'lewd', 'obscene', 'raunchy', 'skank', 'hussy',
  'harlot', 'floozy', 'strumpet', 'pimp', 'brothel', 'bordello',
]);

/*
 * Early Modern function words everyone *recognises* (high Pknown) but that
 * do not belong as required words in a contemporary puzzle.
 */
const ARCHAIC_FUNCTION = new Set([
  'thee', 'thou', 'thine', 'hath', 'doth', 'dost', 'shalt', 'saith',
  'thyself', 'thither', 'whence', 'thence', 'hither',
]);

const STANDALONE_ING = new Set([
  'morning', 'evening', 'ceiling', 'feeling', 'meeting', 'building', 'painting',
  'drawing', 'clothing', 'pudding', 'wedding', 'blessing', 'greeting', 'offering',
  'opening', 'warning', 'meaning', 'setting', 'housing', 'nothing', 'something',
  'everything', 'anything', 'during', 'spring', 'string', 'herring', 'sterling',
  'viking', 'lightning', 'engineering', 'shilling', 'earring', 'sibling',
  'stocking', 'bearing', 'crossing', 'dressing', 'ending', 'filing', 'finding',
  'footing', 'gathering', 'hearing', 'holding', 'landing', 'listing', 'living',
  'lodging', 'making', 'outing', 'padding', 'parking', 'saving', 'sitting',
  'sting', 'swing', 'thing', 'timing', 'wing', 'king', 'ring', 'sing', 'bring',
  'cling', 'fling', 'wring', 'ginseng'
]);

const NOT_COMPARATIVE = new Set([
  'carrier', 'terrier', 'priest', 'barrier', 'soldier', 'cashier', 'courier',
  'frontier', 'premier', 'glacier', 'brier', 'friar', 'pliers', 'skier'
]);

const PLURAL_ONLY_NOUNS = new Set([
  'scissors', 'trousers', 'pliers', 'tweezers', 'binoculars', 'pajamas',
  'jeans', 'goggles', 'shears', 'suds', 'dregs', 'alms', 'series', 'species',
  'news', 'shorts', 'tongs', 'bellows', 'premises', 'measles', 'mumps',
]);

/*
 * Words that end in -ly but are not manner adverbs of another adjective.
 * Everything else ending in -ly is treated as an adverb and dropped.
 */
const STANDALONE_LY = new Set([
  'anomaly', 'apply', 'assembly', 'belly', 'bubbly', 'bully', 'burly',
  'butterfly', 'chilly', 'comply', 'costly', 'cowardly', 'crinkly', 'cuddly',
  'curly', 'daily', 'deadly', 'dillydally', 'disassembly', 'dolly', 'dragonfly',
  'drizzly', 'early', 'earthly', 'elderly', 'family', 'firefly', 'folly',
  'friendly', 'frilly', 'gadfly', 'ghastly', 'ghostly', 'giggly', 'girly',
  'gnarly', 'golly', 'grisly', 'grizzly', 'grumbly', 'gully', 'heavenly',
  'hillbilly', 'hilly', 'holly', 'holy', 'homely', 'horsefly', 'housefly',
  'imply', 'jelly', 'jolly', 'kingly', 'likely', 'lily', 'lively', 'lonely',
  'lovely', 'mayfly', 'measly', 'melancholy', 'molly', 'monopoly', 'monthly',
  'motherly', 'fatherly', 'brotherly', 'sisterly', 'manly', 'womanly',
  'multiply', 'oily', 'orderly', 'oversupply', 'pearly', 'potbelly', 'princely',
  'quarterly', 'rally', 'reapply', 'reassembly', 'really', 'rely', 'reply', 'resupply',
  'sally', 'scholarly', 'scraggly', 'shapely', 'silly', 'smelly', 'southerly',
  'sprightly', 'squiggly', 'steely', 'stepfamily', 'sully', 'supply', 'surly',
  'swirly', 'tally', 'timely', 'ugly', 'underbelly', 'undersupply', 'unfriendly',
  'ungainly', 'ungodly', 'unholy', 'unruly', 'unseemly', 'unsightly', 'untimely',
  'unworldly', 'westerly', 'weekly', 'wiggly', 'wobbly', 'woolly', 'worldly',
  'wriggly', 'wrinkly', 'yearly', 'yellowbelly',
]);

// Prevalence starts at 4 letters; 3-letter stems are needed to catch dogs/cats
// and running/run. These are stems only — never playable.
const THREE_LETTER_STEMS = new Set((
  'ace act add age ago aid aim air ale all and ant any ape apt arc are ark ' +
  'arm art ash ask ate awe axe bad bag ban bar bat bay bed bee beg bet bid ' +
  'big bin bit bog bop bow box boy bud bug bum bun bus but buy cab can cap ' +
  'car cat cop cow cry cub cup cut dad dam day den dew did dig dim dip dog ' +
  'don dot dry dub due dug dye ear eat eel egg ego elf elk elm emu end era ' +
  'eve ewe eye fad fan far fat fax fed fee few fig fin fir fit fix flu fly ' +
  'fog for fox fry fun fur gab gag gap gas gel gem get gig gin god got gum ' +
  'gun gut guy gym had ham has hat hay hem hen her hex hid him hip his hit ' +
  'hog hop hot how hub hue hug hum hut ice icy ilk ill ink inn ion ire irk ' +
  'ivy jab jag jam jar jaw jay jet jig job jog jot joy jug jut keg ken key ' +
  'kid kin kit lab lad lag lap law lay led leg let lid lie lip lit log lot ' +
  'low lye mad man map mat may men met mid mix mob mop mow mud mug nab nag ' +
  'nap net new nip nit nod nor not now nun nut oaf oak oar oat odd ode off ' +
  'oil old one orb ore our out owe owl own pad pal pan par pat paw pay pea ' +
  'pen pep per pet pew pie pig pin pit ply pod pop pot pry pub pug pun pup ' +
  'put rag ram ran rap rat raw ray red rib rid rim rip rob rod rot row rub ' +
  'rug rum run rut rye sad sag sap sat saw say sea see set sew she shy sin ' +
  'sip sir sit six ski sky sly sob sod son sop sow soy spa spy sty sub sum ' +
  'sun sup tab tad tag tan tap tar tax tea ten the tie tin tip toe tog tom ' +
  'ton too top tot tow toy try tub tug tun two ugh ump use van vat vex via ' +
  'vie vim vow wad wag wan war was wax way web wed wet who why wig win wit ' +
  'woe wok won woo wow yak yam yap yaw yea yen yep yes yet yew yip you zag ' +
  'zap zen zip zit zoo'
).split(/\s+/));

function tryRequire(pkg) {
  try {
    return require(pkg);
  } catch (err) {
    return null;
  }
}

function loadProfanityList() {
  const naughty = tryRequire('naughty-words');
  const list = naughty && Array.isArray(naughty.en) ? naughty.en : [];
  return list
    .map((w) => String(w).toLowerCase())
    .filter((w) => LOWER_ALPHA_RE.test(w) && w.length >= 3 && !PROFANITY_ALLOWLIST.has(w));
}

function loadPrevalence() {
  if (!fs.existsSync(PREVALENCE_IN)) {
    throw new Error('missing ' + PREVALENCE_IN);
  }
  const text = fs.readFileSync(PREVALENCE_IN, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const header = (lines[0] || '').split(',');
  const wi = header.indexOf('Word');
  const pi = header.indexOf('Pknown');
  if (wi < 0 || pi < 0) throw new Error('prevalence CSV needs Word and Pknown columns');
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    const word = String(cols[wi] || '').toLowerCase();
    const pknown = Number(cols[pi]);
    if (!LOWER_ALPHA_RE.test(word) || Number.isNaN(pknown)) continue;
    const prev = map.get(word);
    if (prev == null || pknown > prev) map.set(word, pknown);
  }
  if (map.size < 1000) throw new Error('prevalence CSV parsed too few words: ' + map.size);
  return map;
}

function makeBlockTest(extraRoots) {
  const roots = new Set([...BLOCKLIST, ...COMMON_ONLY_BLOCKLIST, ...(extraRoots || [])]);
  return function isBlocked(word) {
    if (PROFANITY_ALLOWLIST.has(word)) return false;
    if (word.includes('sex') || word.includes('drug') ||
        word.includes('porn') || word.includes('fuck')) return true;
    if (roots.has(word)) return true;
    for (const suffix of BLOCK_SUFFIXES) {
      if (!word.endsWith(suffix)) continue;
      const stem = word.slice(0, -suffix.length);
      if (stem.length >= 3 && roots.has(stem)) return true;
      if (stem.length >= 4 && stem[stem.length - 1] === stem[stem.length - 2] &&
          roots.has(stem.slice(0, -1))) {
        return true;
      }
    }
    return false;
  };
}

function isInflectedForm(word, stemSet) {
  if (PLURAL_ONLY_NOUNS.has(word)) return false;
  const has = (s) => s.length >= 2 && stemSet.has(s);

  // Manner adverbs: quickly, happily, reasonably. Length 4 (only, ally) and
  // the standalone set (family, early, apply, really) stay.
  if (word.endsWith('ly') && word.length >= 5 && !STANDALONE_LY.has(word)) {
    return true;
  }

  if (!NOT_COMPARATIVE.has(word)) {
    if (word.endsWith('ier') && has(word.slice(0, -3) + 'y')) return true;
    if (word.endsWith('iest') && has(word.slice(0, -4) + 'y')) return true;
  }

  if (word.endsWith('ing') && word.length >= 5 && !STANDALONE_ING.has(word)) {
    const trunk = word.slice(0, -3);
    const n = trunk.length;
    if (has(trunk)) return true;
    if (has(trunk + 'e')) return true;
    if (n >= 3 && trunk[n - 1] === trunk[n - 2] && has(trunk.slice(0, -1))) {
      return true;
    }
  }

  if (word.endsWith('s') && !word.endsWith('ss')) {
    if (has(word.slice(0, -1))) return true;
    if (word.endsWith('es') && has(word.slice(0, -2))) return true;
    if (word.endsWith('ies') && has(word.slice(0, -3) + 'y')) return true;
  }

  if (word.endsWith('ed') && !word.endsWith('eed')) {
    if (has(word.slice(0, -1))) return true;
    if (has(word.slice(0, -2))) return true;
    if (word.endsWith('ied') && has(word.slice(0, -3) + 'y')) return true;
    const n = word.length;
    if (n >= 5 && word[n - 3] === word[n - 4] && has(word.slice(0, -3))) return true;
  }

  return false;
}

function pickPools(prevalence, stemSet, isBlocked) {
  const shorts = [];
  const longs = [];
  const easyShorts = [];
  const easyLongs = [];
  const base = [];
  const easyBase = [];
  const dict = [];

  for (const [word, pknown] of prevalence) {
    if (word.length < DICT_MIN_LEN || word.length > DICT_MAX_LEN) continue;
    if (isBlocked(word)) continue;
    if (isInflectedForm(word, stemSet)) continue;
    dict.push(word);
    if (ARCHAIC_FUNCTION.has(word)) continue;
    if (pknown < HARD_MIN_PKNOWN) continue;
    if (word.length <= COMMON_MAX_LEN) {
      shorts.push(word);
      if (pknown >= EASY_MIN_PKNOWN) easyShorts.push(word);
    } else {
      longs.push(word);
      if (pknown >= BASE_MIN_PKNOWN) base.push(word);
      if (pknown >= EASY_MIN_PKNOWN) easyLongs.push(word);
      if (pknown >= EASY_BASE_MIN_PKNOWN) easyBase.push(word);
    }
  }

  for (const list of [shorts, longs, easyShorts, easyLongs, base, easyBase, dict]) {
    list.sort();
  }
  return { shorts, longs, easyShorts, easyLongs, base, easyBase, dict };
}

function toJsFileLexicon(pools) {
  const shortSet = new Set(pools.shorts);
  const longSet = new Set(pools.longs);
  const easyShortSet = new Set(pools.easyShorts);
  const easyLongSet = new Set(pools.easyLongs);
  const baseSet = new Set(pools.base);
  const easyBaseSet = new Set(pools.easyBase);
  const flags = Buffer.alloc(pools.dict.length);
  for (let i = 0; i < pools.dict.length; i++) {
    const w = pools.dict[i];
    let f = 0;
    if (shortSet.has(w)) f |= FLAG_HARD_SHORT;
    if (longSet.has(w)) f |= FLAG_HARD_LONG;
    if (easyShortSet.has(w)) f |= FLAG_EASY_SHORT;
    if (easyLongSet.has(w)) f |= FLAG_EASY_LONG;
    if (baseSet.has(w)) f |= FLAG_BASE;
    if (easyBaseSet.has(w)) f |= FLAG_EASY_BASE;
    flags[i] = f;
  }
  return (
    '// Auto-generated packed lexicon — do not edit by hand.\n' +
    '// One copy of each playable word and a flag byte per word.\n' +
    '// Prefixes are derived at load from the words. Flags: 1 hard-short,\n' +
    '// 2 hard-long, 4 easy-short, 8 easy-long, 16 base, 32 easy-base.\n' +
    '(function (root, factory) {\n' +
    '  const data = factory();\n' +
    "  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n" +
    '  if (root) root.LETTER_MELT_LEXICON = data;\n' +
    "})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {\n" +
    '  return {\n' +
    '  w: ' + JSON.stringify(pools.dict.join(' ')) + ',\n' +
    '  f: ' + JSON.stringify(flags.toString('base64')) + '\n' +
    '  };\n' +
    '});\n'
  );
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const prevalence = loadPrevalence();
  const stemSet = new Set(THREE_LETTER_STEMS);
  for (const word of prevalence.keys()) stemSet.add(word);

  const isBlocked = makeBlockTest(loadProfanityList());
  const pools = pickPools(prevalence, stemSet, isBlocked);

  if (pools.shorts.length < 1500) {
    throw new Error('hard short pool too small: ' + pools.shorts.length);
  }
  if (pools.easyShorts.length < 500) {
    throw new Error('easy short pool too small: ' + pools.easyShorts.length);
  }
  if (pools.base.length < 400) {
    throw new Error('base pool too small: ' + pools.base.length);
  }

  fs.writeFileSync(LEXICON_OUT, toJsFileLexicon(pools));
  for (const stale of ['common.js', 'dict.js']) {
    const stalePath = path.join(OUT_DIR, stale);
    if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
  }

  console.log('LetterMelt word list build complete.');
  console.log('  Source     : prevalence-dict.csv (%d lemmas)', prevalence.size);
  console.log('  Ranker     : Pknown (hard >= %s, easy >= %s)', HARD_MIN_PKNOWN, EASY_MIN_PKNOWN);
  console.log('  lexicon.js : dict=%d short=%d long=%d base=%d easy=%d/%d/%d  -> %s',
    pools.dict.length, pools.shorts.length, pools.longs.length, pools.base.length,
    pools.easyShorts.length, pools.easyLongs.length, pools.easyBase.length,
    LEXICON_OUT);
}

main();
