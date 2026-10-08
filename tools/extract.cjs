// Albion Wolf Database v3 — extractor.
// Run from the repo root:  node tools/extract.cjs
// Inputs : ../ao-bin-dumps-master/{items.json,formatted/items.json,spells.json,localization.json}
//          tools/vendor/{item-classes.json,filters-ar.json}, taxonomy-source.txt
// Outputs: taxonomy.json, index.json, spells.json, families/**, meta.json, README.md
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DUMPS = path.resolve(ROOT, '..', 'ao-bin-dumps-master');
const VENDOR = path.join(ROOT, 'tools', 'vendor');
const log = (...a) => console.log('[v3]', ...a);
const asArr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const t0 = Date.now();

/* ================= 1. taxonomy ================= */
const TYPO = {
  'Dogger': 'Dagger', 'Coerleon': 'Caerleon', 'Morgona': 'Morgana',
  'Avalonion': 'Avalonian', 'Mount Upgrodes': 'Mount Upgrades',
  'Rayal Sigil': 'Royal Sigil', 'Shadawheart': 'Shadowheart',
  'Comman': 'Common', 'rare': 'Rare', 'Edds': 'Eggs',
  'Contocts': 'Contracts', 'Iteds': 'Items',
  'Crystal League Tokem': 'Crystal League Token',
  'Randomiwed Dungeons': 'Randomized Dungeons',
  'Comupoed Dungeans': 'Compound Dungeons',
  'Fishy Busines': 'Fishy Business', 'Lumber Lunocy': 'Lumber Lunacy',
  'preaching to the Deod': 'Preaching to the Dead',
  'Luking Undermeah': 'Lurking Underneath',
  'Three Sisoers': 'Three Sisters',
  'In the Ravens Ckaws': 'In the Ravens Claws'
};
const typoUsed = [];
function fixTypo(v) {
  v = String(v).trim();
  if (TYPO[v] && !typoUsed.includes(v)) typoUsed.push(v);
  return TYPO[v] || v;
}
function parseTaxonomy(file) {
  const roots = [];
  const stack = [{ children: roots, depth: -1 }];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*\|{3}/.test(raw)) {
      const v = fixTypo(raw.replace(/^\s*\|{3}/, ''));
      const node = { v, children: [] };
      roots.push(node);
      stack.length = 0;
      stack.push({ children: roots, depth: -1 }, { node, children: node.children, depth: 0 });
      continue;
    }
    const m = raw.match(/^(\s*)\|----(.*)$/);
    if (!m) continue;
    const depth = 1 + Math.round(m[1].length / 5);
    const v = fixTypo(m[2]);
    if (!v) continue;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const node = { v, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ node, children: node.children, depth });
  }
  return roots;
}
const TAX = parseTaxonomy(path.join(ROOT, 'taxonomy-source.txt'));
log('taxonomy groups:', TAX.map((g) => g.v).join(', '));
function findNode(pathArr) {
  let kids = TAX;
  let node = null;
  for (const seg of pathArr) {
    node = kids.find((k) => k.v === seg);
    if (!node) return null;
    kids = node.children;
  }
  return node;
}
// Resolve [cat, sub, s3] to a full valid tree path (DFS for nested nodes
// like Quest Items → Cities → Thetford, or Consumable → Other → Fireworks).
function resolvePath(cat, sub, s3) {
  const root = TAX.find((g) => g.v === cat);
  if (!root) return { path: [cat, sub, s3].filter((x) => x !== ''), ok: false };
  const segs = [sub, s3].filter((x) => x !== '');
  let kids = root.children;
  const out = [cat];
  for (const seg of segs) {
    let node = kids.find((k) => k.v === seg);
    if (!node) {
      // deep search within current subtree
      const stack = [...kids];
      node = null;
      while (stack.length) {
        const n = stack.pop();
        if (n.v === seg) { node = n; break; }
        stack.push(...(n.children || []));
      }
      if (!node) return { path: [cat, sub, s3].filter((x) => x !== ''), ok: false };
      // rebuild ancestor chain for the found node
      const chain = [];
      const find = (nodes, trail) => {
        for (const n of nodes) {
          if (n === node) { chain.push(...trail, n.v); return true; }
          if (find(n.children || [], [...trail, n.v])) return true;
        }
        return false;
      };
      find(kids, []);
      return { path: [...out, ...chain], ok: true };
    }
    out.push(node.v);
    kids = node.children;
  }
  return { path: out, ok: true };
}
const badPathLog = [];

/* ================= 2. helpers (game data) ================= */
const LANGMAP = { 'EN-US': 'en', 'AR-SA': 'ar', 'DE-DE': 'de', 'FR-FR': 'fr', 'ES-ES': 'es', 'RU-RU': 'ru', 'TR-TR': 'tr' };
const baseOf = (c) => String(c).split('@')[0];
const tierOf = (c) => { const m = String(c).match(/^T(\d+)/); return m ? Number(m[1]) : 0; };
const NOTRADED = /FURNITURE|_RUG|PAVILION|SILVERBAG|^UNIQUE|TOKEN|LABOURER|JOURNAL|LOOTBAG|HELLGATE|SIEGE|^.*BANNER$|TROPHY|ALMANAC|SKILLBOOK|TOTEM|QUESTITEM|KILL_EMOTE|DEBUG|_MERCHANT|^SOLDIER$|_MERCENARY|^GUILD_/;
// True junk only (NOTRADED is for market tradability — the encyclopedia keeps everything else).
const JUNK = /^(TRASH|DEBUG)|PROTOTYPE|FAMEBUFF|GAMEMASTER|WEAPONMASTER|ALTAR_OF_CHEATING|FIRSTREFERRAL|CONQUEROR|_TEMPLATE|NONTRADABLE|NON_TRADABLE|UNTRADEABLE|_HIDDEN|_TEST|_ADC/;
function slotOf(c) {
  const u = String(c).toUpperCase();
  if (/^UNIQUE/.test(u)) return 'Unique';
  if (/FURNITURE|PAVILION|_BED|_RUG|_TABLE|_CHAIR|_BANNER|_TOTEM|_CANDELABRA|_FOUNTAIN|_LAMP|_SHRINE/.test(u)) return 'Furniture';
  if (/FARM_|_SEED|_ANIMAL_|_BABY_|GRAIN|_QUARTERS_|_QUARTERS$|_PASTURE|_HERB_GARDEN|_CROPS/.test(u)) return 'Farming';
  if (/MOUNT/.test(u)) return 'Mount';
  if (/POTION/.test(u)) return 'Potion';
  if (/FOOD_|_COOK|_STEW|_SOUP|_SALAD|_BREAD|_PIE|_PANCAKE|_OMELET|_SANDWICH|_ROAST|_TROUT|_BOAR_BURGER|_ADOBO/.test(u)) return 'Food';
  if (/2H_/.test(u)) return 'Two-handed weapon';
  if (/OFF_|OFFHAND/.test(u)) return 'Offhand';
  if (/1H_|MAIN_|_DAGGER|_SWORD|_MACE|_SPEAR|_AXE|_HAMMER|_BOW|_STAFF|_CROSSBOW|_KNUCKLE|_SICKLE|_CANE|_PICK|_SCYTHE|_ARCHITECT/.test(u)) return 'One-handed weapon';
  if (/HEAD_/.test(u)) return 'Head';
  if (/ARMOR_/.test(u)) return 'Armor';
  if (/SHOES_/.test(u)) return 'Shoes';
  if (/CAPE_/.test(u)) return 'Cape';
  if (/BAG/.test(u)) return 'Bag';
  if (/ARTEFACT/.test(u)) return 'Artifact';
  if (/FISH/.test(u)) return 'Fishing';
  if (/ORE|_PLANK|METALBAR|_STEEL|_TITAN|_BOLT|_CLOTH|_LEATHER|_HIDE|_FIBER|_WOOD|_STONE|_TRAVERTINE|_BASALT|_MARBLE|_LIMESTONE|_SLATE|_ROCK|_SANDSTONE/.test(u)) return 'Material';
  if (/CARROT|BEAN|WHEAT|TURNIP|POTATO|CORN|PUMPKIN|AGARIC|COMFREY|BURDOCK|TEASEL|FOXGLOVE|MULLEIN|YARROW|EGG|MILK|_HONEY|_TILL|_GARLIC|_ONION/.test(u)) return 'Ingredient';
  return 'Other';
}
const classes = JSON.parse(fs.readFileSync(path.join(VENDOR, 'item-classes.json'), 'utf8'));
const arLabels = JSON.parse(fs.readFileSync(path.join(VENDOR, 'filters-ar.json'), 'utf8'));

/* ---- L3 rules ---- */
const CITY_OF_BIOME = { CAERLEON: 'Caerleon', SWAMP: 'Thetford', FOREST: 'Lymhurst', STEPPE: 'Martlock', HIGHLAND: 'Bridgewatch', MOUNTAIN: 'Fort Sterling' };
const EXPEDITION = {
  WINTER_EVENT: 'Event', HERETIC_FISHYBUSINESS: 'Fishy Business', KEEPER_STONEWARS: 'Stone Wars',
  HERETIC_LUMBERCAMP: 'Lumber Lunacy', KEEPER_MUSHROOM: 'Fungicide', MORGANA_TRHEESISTERS: 'Three Sisters',
  UNDEAD_ETERNALBATTLE: 'Eternal Battle', HERETIC_FISTFULOFSILVER: 'Fistful of Silver'
};
const CAPE_CITY = { BRIDGEWATCH: 'Bridgewatch', FORTSTERLING: 'Fort Sterling', LYMHURST: 'Lymhurst', MARTLOCK: 'Martlock', THETFORD: 'Thetford', CAERLEON: 'Caerleon', BRECILIEN: 'Brecilien' };
const CAPE_FACTION = { AVALON: 'Avalonian', SMUGGLER: 'Smuggler', HERETIC: 'Heretic', UNDEAD: 'Undead', KEEPER: 'Keeper', MORGANA: 'Morgana', DEMON: 'Demon' };
function sub3(cat, sub, code) {
  const c = String(code);
  if (cat === 'Caps') return '';
  if (cat === 'Consumable' && sub === 'Other') {
    if (/REPAIR_POWDER/.test(c)) return 'Repair Powder';
    if (/FIREWORKS/.test(c)) return 'Fireworks';
    return '';
  }
  if (cat === 'Crafting' && sub === 'Tokens') {
    if (/MOUNTUPGRADE/.test(c)) return 'Mount Upgrades';
    if (/ROYAL_SIGIL/.test(c)) return 'Royal Sigil';
    return 'Other';
  }
  if (cat === 'Crafting' && sub === 'City Resources') return '';
  if (cat === 'Crafting' && sub === 'Fish') {
    if (/_COMMON/.test(c)) return 'Common';
    if (/_RARE/.test(c)) return 'Rare';
    return 'Other';
  }
  if (cat === 'Farming' && sub === 'Farm') return /_SEED/.test(c) ? 'Seeds' : 'Plants';
  if (cat === 'Farming' && sub === 'Herb Garden') return /_SEED/.test(c) ? 'Seeds' : 'Herbs';
  if (cat === 'Farming' && sub === 'Pasture') {
    if (/_BABY/.test(c)) return 'Baby animals';
    if (/_GROWN/.test(c)) return 'Animal';
    if (/EGG/.test(c)) return 'Eggs';
    if (/MILK/.test(c)) return 'Milk';
    return '';
  }
  if (cat === 'Farming' && sub === 'Kennel') return /_BABY/.test(c) ? 'Baby Animals' : /_GROWN/.test(c) ? 'Animal' : '';
  if (cat === 'Farming' && sub === 'Farming Products') {
    if (/MEAT/.test(c)) return 'Meat';
    if (/BUTTER/.test(c)) return 'Butter';
    if (/ALCOHOL/.test(c)) return 'Alcohol';
    if (/BREAD/.test(c)) return 'Bread';
    if (/FLOUR/.test(c)) return 'Flour';
    return '';
  }
  if (cat === 'Furniture' && sub === 'Chest') return /^T\d+_FURNITUREITEM_CHEST$/.test(c) ? 'House' : 'World';
  if (cat === 'Furniture' && sub === 'World') {
    if (/BANNER/.test(c)) return 'Banner';
    if (/STATUE/.test(c) || /KILLTROPHY/.test(c)) return 'Statues';
    return 'Other';
  }
  if (cat === 'Other' && sub === 'Guilds') {
    if (c === 'UNIQUE_HIDEOUT') return 'Hideout';
    if (/SIEGEHAMMER/.test(c)) return 'Siege Hammer';
    if (/SIEGE_BANNER/.test(c)) return 'Siege Banner';
    return '';
  }
  if (cat === 'Other' && sub === 'Laborers') {
    if (/JOURNAL/.test(c)) return 'Journals';
    if (/^TROPHY|^T\d+_TROPHY/.test(c)) return 'Trophies';
    if (/CONTRACT/.test(c)) return 'Contracts';
    return '';
  }
  if (cat === 'Other' && sub === 'Tokens') {
    if (/ANCHOR/.test(c)) return 'Anchor';
    if (/SKIN|VANITY/.test(c)) return 'Vanity';
    if (/CRYSTAL_LEAGUE|CRYSTALLEAGUE/.test(c)) return 'Crystal League Token';
    return 'Other';
  }
  if (cat === 'Other' && sub === 'Luxury Goods') return 'Any';
  if (cat === 'Other' && sub === 'Map') {
    if (/HELLGATE/.test(c)) return 'Hellgates';
    if (/RANDOM_DUNGEON/.test(c)) return 'Randomized Dungeons';
    if (/SHARD_/.test(c)) return 'Map Fragments';
    return '';
  }
  if (cat === 'Other' && sub === 'Hardcore Expeditions') {
    const m = c.match(/EXP_HRD_([A-Z_]+)$/);
    return (m && EXPEDITION[m[1]]) || '';
  }
  if (cat === 'Other' && sub === 'Quest Items') {
    const m = c.match(/TRADEPACK_([A-Z]+)_/);
    if (m && CITY_OF_BIOME[m[1]]) return m[1] === 'CAERLEON' ? 'Caerleon' : CITY_OF_BIOME[m[1]];
    return 'Other';
  }
  return '';
}
/* L1/L2 with fallbacks */
const GAMECAT = {
  'mounts/bascmounts': ['Mount', 'Base Mounts'], 'mounts/raremounts': ['Mount', 'Rare Mounts'],
  'mounts/battlemounts': ['Mount', 'Battle Mount'],
  'other/tokens': ['Other', 'Tokens'], 'other/maps': ['Other', 'Map'],
  'other/lootitem': null, 'other/guilds': ['Other', 'Guilds'],
  'consumables/potions': ['Consumable', 'Potions'], 'consumables/tomes': ['Consumable', 'Tomes'],
  'consumables/food': ['Consumable', 'Food'], 'consumables/other': ['Consumable', 'Other'],
  'consumables/silverbag': ['Other', 'Tokens'],
  'weapons/bow': ['Weapons', 'Bow'], 'weapons/crossbow': ['Weapons', 'Crossbow'],
  'weapons/axe': ['Weapons', 'Axe'], 'weapons/dagger': ['Weapons', 'Dagger'],
  'weapons/hammer': ['Weapons', 'Hammer'], 'weapons/wargloves': ['Weapons', 'War Gloves'],
  'weapons/mace': ['Weapons', 'Mace'], 'weapons/quarterstaff': ['Weapons', 'Quarter Staff'],
  'weapons/spear': ['Weapons', 'Spear'], 'weapons/sword': ['Weapons', 'Sword'],
  'weapons/arcane': ['Weapons', 'Arcane Staff'], 'weapons/cursed': ['Weapons', 'Cursed Staff'],
  'weapons/fire': ['Weapons', 'Fire Staff'], 'weapons/frost': ['Weapons', 'Frost Staff'],
  'weapons/holy': ['Weapons', 'Holy Staff'], 'weapons/nature': ['Weapons', 'Nature Staff'],
  'weapons/shapeshifter': ['Weapons', 'Shapeshifter Staff']
};
function catSub(code, shopCat, shopSub) {
  const hit = classes[code];
  if (hit) {
    let { cat, sub } = hit;
    if (cat === 'Vanity' && !sub) return { cat: 'Other', sub: 'Tokens', sub3: 'Vanity' };
    if (!sub) return { cat, sub: '', sub3: '' };
    return { cat, sub, sub3: null };
  }
  if (/^CAPEITEM_/.test(code)) {
    const x = code.replace(/^CAPEITEM_/, '');
    if (CAPE_CITY[x]) return { cat: 'Caps', sub: CAPE_CITY[x], sub3: null };
    if (CAPE_FACTION[x]) return { cat: 'Caps', sub: CAPE_FACTION[x], sub3: null };
  }
  if (code === 'REPAIR_POWDER') return { cat: 'Consumable', sub: 'Other', sub3: null };
  if (code === 'CAPE_ARENA_BANNER') return { cat: 'Caps', sub: 'Cape', sub3: null };
  if (/^UNIQUE_UNLOCK_|^UNIQUE_AVATAR|^UNIQUE_LORE/.test(code)) return { cat: 'Other', sub: 'Tokens', sub3: 'Vanity' };
  const g = GAMECAT[`${String(shopCat || '').toLowerCase()}/${String(shopSub || '').toLowerCase()}`];
  if (g === null) return { cat: 'Other', sub: '', sub3: '' };
  if (g) return { cat: g[0], sub: g[1], sub3: null };
  return null;
}

/* ================= 3. load dumps ================= */
log('loading dumps…');
const itemsJson = JSON.parse(fs.readFileSync(path.join(DUMPS, 'items.json'), 'utf8')).items;
const formatted = JSON.parse(fs.readFileSync(path.join(DUMPS, 'formatted', 'items.json'), 'utf8'));
const spellsJson = JSON.parse(fs.readFileSync(path.join(DUMPS, 'spells.json'), 'utf8')).spells;
log('items.json types:', Object.keys(itemsJson).filter((k) => !k.startsWith('@')).join(', '));

// formatted names/descs by UniqueName
const fmtMap = new Map();
for (const e of formatted) {
  if (!e || !e.UniqueName) continue;
  if (!fmtMap.has(e.UniqueName)) fmtMap.set(e.UniqueName, e);
}
function pickLang(src, prefix) {
  const o = {};
  for (const [gk, ours] of Object.entries(LANGMAP)) {
    const v = src && src[`${prefix}${gk}`] || src && src[gk];
    if (v) o[ours] = v;
  }
  return o;
}
function namesOf(code) {
  const e = fmtMap.get(code);
  if (!e) return {};
  return pickLang(e.LocalizedNames, '');
}
function descOf(code) {
  const e = fmtMap.get(code);
  if (!e) return {};
  return pickLang(e.LocalizedDescriptions, '');
}

/* ================= 4. spells dict (names+desc resolved) ================= */
log('building spells dict…');
const spellEntries = new Map();
for (const arr of [spellsJson.activespell || [], spellsJson.passivespell || [], spellsJson.togglespell || []]) {
  for (const s of arr) {
    const u = s && s['@uniquename'];
    if (u && !spellEntries.has(u)) spellEntries.set(u, s);
  }
}
const wantedTags = new Set();
for (const [u, s] of spellEntries) {
  wantedTags.add(s['@namelocatag'] || ('@SPELLS_' + u));
  wantedTags.add(s['@descriptionlocatag'] || ('@SPELLS_' + u + '_DESC'));
}
function extractBlock(text, start) {
  let depth = 0, instr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (instr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') instr = false;
    } else {
      if (ch === '"') instr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
  }
  return null;
}
const locText = fs.readFileSync(path.join(DUMPS, 'localization.json'), 'utf8');
const locDict = new Map();
{
  const re = /\{\s*"@tuid": "([^"]+)",\s*"tuv": \[/g;
  let m;
  while ((m = re.exec(locText)) !== null) {
    if (!wantedTags.has(m[1])) continue;
    const block = extractBlock(locText, m.index);
    if (!block) continue;
    try {
      const tu = JSON.parse(block);
      const rec = {};
      for (const t of tu.tuv || []) {
        const l = LANGMAP[t['@xml:lang']];
        if (l && typeof t.seg === 'string') rec[l] = t.seg;
      }
      if (Object.keys(rec).length) locDict.set(m[1], rec);
    } catch { /* skip */ }
  }
}
log('loc tags kept:', locDict.size);
function segKey(obj, name) {
  if (obj == null || typeof obj !== 'object') return undefined;
  if (name in obj) return obj[name];
  const at = '@' + name;
  if (at in obj) return obj[at];
  return undefined;
}
function walkPath(entry, path) {
  let cur = entry;
  for (const p of String(path).split('.')) {
    const m = p.match(/^([A-Za-z0-9_]+)(?:\[(\d+)\])?$/);
    if (!m) return undefined;
    cur = segKey(cur, m[1]);
    if (cur === undefined) return undefined;
    if (m[2] !== undefined) {
      const i = Number(m[2]);
      cur = Array.isArray(cur) ? cur[i] : (i === 0 ? cur : undefined);
    }
  }
  return (typeof cur === 'string' || typeof cur === 'number') ? String(cur) : undefined;
}
function resolveToken(token, entry) {
  let inner = String(token).replace(/^\$/, '').replace(/\$$/, '');
  if (!inner || /statblock/i.test(inner)) return '';
  if (inner.startsWith('$')) {
    inner = inner.slice(1);
    const dot = inner.indexOf('.');
    if (dot < 0) return '';
    const other = spellEntries.get(inner.slice(0, dot));
    if (!other) return '';
    return walkPath(other, inner.slice(dot + 1)) ?? '';
  }
  return walkPath(entry, inner) ?? '';
}
function locRefsOf(entry) {
  const lr = entry && entry.locareferences && entry.locareferences.description && entry.locareferences.description.locareference;
  if (!lr) return [];
  return asArr(lr).map((r) => resolveToken((r && r['@tag']) || '', entry));
}
const FXNAMES = [['stun', 'Stun'], ['root', 'Root'], ['silence', 'Silence'], ['knockback', 'Knockback'], ['pull', 'Pull'], ['invisibility', 'Invisibility'], ['invincibility', 'Invulnerable'], ['dash', 'Dash'], ['teleport', 'Teleport'], ['healonhit', 'Heal on hit'], ['damageshield', 'Damage shield'], ['pulsingspell', 'Pulsing'], ['aura', 'Aura'], ['channelingspell', 'Channeled'], ['transformation', 'Shapeshift'], ['forcedmovement', 'Forced movement']];
function resolveDesc(raw, entry) {
  if (!raw) return '';
  const refs = locRefsOf(entry);
  let s = String(raw).replace(/\$[^$]+\$/g, (t) => resolveToken(t, entry));
  s = s.replace(/\{(\d+)\}/g, (_m, i) => refs[Number(i)] ?? '');
  s = s.replace(/\{[0-9]+\}/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  return s;
}
const spellDict = {};
for (const [u, s] of spellEntries) {
  const n = locDict.get(s['@namelocatag'] || ('@SPELLS_' + u)) || {};
  const d = locDict.get(s['@descriptionlocatag'] || ('@SPELLS_' + u + '_DESC')) || {};
  if (!n.en) continue;
  const rd = {};
  for (const l of Object.keys(d)) rd[l] = resolveDesc(d[l], s);
  const rec = { n, d: rd };
  const st = {};
  if (s['@recastdelay'] != null && s['@recastdelay'] !== '') st.cd = String(s['@recastdelay']);
  if (s['@energyusage'] != null && s['@energyusage'] !== '') st.en = String(s['@energyusage']);
  if (s['@castrange'] != null && s['@castrange'] !== '') st.rng = String(s['@castrange']);
  if (s['@castingtime'] != null && s['@castingtime'] !== '') st.ct = String(s['@castingtime']);
  if (Object.keys(st).length) rec.s = st;
  const fx = FXNAMES.filter(([k]) => segKey(s, k) !== undefined).map(([, label]) => label);
  if (fx.length) rec.f = fx;
  spellDict[u] = rec;
}
log('spells resolved:', Object.keys(spellDict).length);

/* ================= 5. items ================= */
const elById = new Map();
const ELEMENTS = ['weapon', 'equipmentitem', 'mount', 'consumableitem', 'simpleitem', 'consumablefrominventoryitem', 'farmableitem', 'furnitureitem', 'journalitem', 'labourercontract', 'mountskin', 'crystalleagueitem', 'siegebanner', 'killtrophy', 'transformationweapon', 'trackingitem', 'hideoutitem', 'rewardtoken'];
for (const t of ELEMENTS) {
  for (const el of asArr(itemsJson[t])) {
    const u = el && el['@uniquename'];
    if (u && !elById.has(u)) elById.set(u, el);
  }
}
log('item elements:', elById.size);

const spellMemo = new Map();
function resolveSpells(u, seen = []) {
  if (spellMemo.has(u)) return spellMemo.get(u);
  if (seen.includes(u)) return [];
  const el = elById.get(u);
  if (!el || !el.craftingspelllist) { spellMemo.set(u, []); return []; }
  const sl = el.craftingspelllist;
  let base = [];
  const ref = sl['@reference'];
  if (ref) base = resolveSpells(ref, [...seen, u]);
  const rem = new Set(asArr(sl.removespell).map((x) => x['@uniquename']));
  const merged = base.filter((s) => !rem.has(s.u));
  for (const x of asArr(sl.craftspell)) {
    if (!x || !x['@uniquename']) continue;
    const a = { u: x['@uniquename'], slots: x['@slots'] != null ? Number(x['@slots']) : null, tag: x['@tag'] || null, passive: x['@slots'] == null };
    const i = merged.findIndex((s) => s.u === a.u);
    if (i >= 0) merged[i] = a; else merged.push(a);
  }
  spellMemo.set(u, merged);
  return merged;
}
function craftOf(req) {
  if (!req) return null;
  const res = asArr(req.craftresource).map((r) => ({ id: r['@uniquename'], n: Number(r['@count']) || 0 }));
  if (!res.length && !(req['@silver'] || req['@time'] || req['@craftingfocus'])) return null;
  return {
    silver: Number(req['@silver'] || 0), time: Number(req['@time'] || 0), focus: Number(req['@craftingfocus'] || 0),
    res
  };
}
function upOf(up) {
  if (!up) return null;
  const res = asArr(up.upgraderesource).map((r) => ({ id: r['@uniquename'], n: Number(r['@count']) || 0 }));
  return res.length ? res : null;
}
const COMBAT_KEEP = ['attackdamage', 'attackspeed', 'attackrange', 'abilitypower', 'physicalspelldamagebonus', 'magicspelldamagebonus', 'healmodifier', 'hitpointsmax', 'itempower', 'durability', 'weight', 'masterymodifier', 'canbeovercharged', 'maxqualitylevel', 'twohanded', 'slottype', 'tier', 'physicalattackdamagebonus', 'magicattackdamagebonus', 'hitpointsregenerationbonus', 'attacktype', 'durabilityloss_attack', 'durabilityloss_spelluse', 'durabilityloss_receivedattack', 'durabilityloss_receivedspell'];
const RESFAM = /^(ORE|HIDE|FIBER|WOOD|ROCK|METALBAR|LEATHER|CLOTH|PLANKS|STONEBLOCK)$/;

const families = new Map(); // base -> {base, path, slot, tiers: Map tier -> {...}}
const junk = [];
const missingNames = [];
const missingTax = [];
for (const [u, el] of elById) {
  const code = String(u);
  if (/@\d+$/.test(code)) continue; // fold @variants into base (levels from enchantments[])
  const b = baseOf(code);
  if (JUNK.test(b)) { junk.push(b); continue; }
  const tier = el['@tier'] != null ? Number(el['@tier']) : tierOf(b);
  // taxonomy
  let cs = catSub(b, el['@shopcategory'], el['@shopsubcategory1']);
  if (!cs) {
    const shop = [el['@shopcategory'] || '', el['@shopsubcategory1'] || ''].join('/');
    missingTax.push(`${b} [${shop}]`);
    cs = { cat: 'Other', sub: '', sub3: '' };
  }
  let { cat, sub } = cs;
  let s3 = cs.sub3;
  if (s3 === null || s3 === undefined) s3 = sub3(cat, sub, b);
  // resolve full path in the tree (handles nested nodes like Quest Cities)
  const resolved = resolvePath(cat, sub, s3);
  if (!resolved.ok) { badPathLog.push(`${b} ${JSON.stringify([cat, sub, s3])}`); }
  const path = resolved.path;
  // names/descs
  const nm = namesOf(b);
  const ds = descOf(b);
  if (!nm.en) missingNames.push(b);
  // spells
  const spells = resolveSpells(u);
  // combat
  const combat = {};
  for (const k of COMBAT_KEEP) if (el['@' + k] != null) combat[k] = el['@' + k];
  // variants
  const enchLevels = asArr(el.enchantments && el.enchantments.enchantment).map((e) => Number(e['@enchantmentlevel']));
  let levels = enchLevels.length ? [...new Set(enchLevels)].sort((a, c) => a - c) : [];
  if (!levels.length) {
    const m = b.match(/^T\d+_(.+)$/);
    levels = (m && RESFAM.test(m[1])) ? [0, 1, 2, 3, 4] : [0];
  } else if (!levels.includes(0)) levels.unshift(0);
  const variants = levels.map((lv) => {
    const ed = asArr(el.enchantments && el.enchantments.enchantment).find((e) => Number(e['@enchantmentlevel']) === lv);
    const rest = (b.match(/^T\d+_(.+)$/) || [])[1] || '';
    return {
      e: lv,
      id: lv ? (RESFAM.test(rest) ? `${b}_LEVEL${lv}@${lv}` : `${b}@${lv}`) : b,
      ip: Number((ed && ed['@itempower']) || (lv === 0 ? el['@itempower'] : 0)) || 0,
      dura: Number((ed && ed['@durability']) || (lv === 0 ? el['@durability'] : 0)) || 0,
      craft: craftOf(lv === 0 ? el.craftingrequirements : ed && ed.craftingrequirements),
      up: upOf(ed && ed.upgraderequirements)
    };
  });
  const fam = families.get(b) || { base: b, path, slot: slotOf(b), art: /ARTEFACT/.test(b) ? 1 : 0, traded: NOTRADED.test(b) ? 0 : 1, tiers: {} };
  fam.tiers[String(tier)] = {
    names: nm, desc: ds,
    two_handed: el['@twohanded'] === 'true' ? 1 : 0,
    maxq: Number(el['@maxqualitylevel'] || 0) || 0,
    combat, spells, variants
  };
  families.set(b, fam);
}
log('families:', families.size, '| junk dropped:', junk.length, '| missing names:', missingNames.length, '| missing taxonomy:', missingTax.length);

/* ================= 6. emit ================= */
for (const d of ['families', 'tools']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
for (const g of new Set([...families.values()].map((f) => f.path[0]))) {
  fs.mkdirSync(path.join(ROOT, 'families', g), { recursive: true });
}
const index = [];
let files = 0;
for (const fam of families.values()) {
  const rel = `families/${fam.path[0]}/${fam.base}.json`;
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(fam));
  files++;
  for (const [t, rec] of Object.entries(fam.tiers)) {
    for (const v of rec.variants) {
      index.push({
        id: v.id, b: fam.base, n: rec.names, g: fam.path[0],
        s: fam.path[1] || '', s3: fam.path[2] || '', s4: fam.path[3] || '',
        slot: fam.slot, t: Number(t), e: v.e, art: fam.art, tr: fam.traded, f: rel
      });
    }
  }
}
// taxonomy counts
function countTree(nodes, prefix = []) {
  return nodes.map((n) => {
    const p = [...prefix, n.v];
    const kids = countTree(n.children || [], p);
    const own = index.filter((r) => {
      if (r.g !== p[0]) return false;
      for (let i = 1; i < p.length; i++) {
        const seg = [r.s, r.s3, r.s4][i - 1] || '';
        if (seg !== p[i]) return false;
      }
      return true;
    }).length;
    return { v: n.v, ar: arLabels[n.v] || '', n: own, children: kids };
  });
}
const taxonomy = countTree(TAX);
fs.writeFileSync(path.join(ROOT, 'taxonomy.json'), JSON.stringify(taxonomy));
fs.writeFileSync(path.join(ROOT, 'index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(ROOT, 'spells.json'), JSON.stringify(spellDict));
const meta = {
  version: 3, generated_at: new Date().toISOString(),
  sources: { dumps: 'ao-bin-dumps-master (local)', formatted: 'included', localization: 'included' },
  counts: { families: families.size, records: index.length, spells: Object.keys(spellDict).length, files }
};
fs.writeFileSync(path.join(ROOT, 'meta.json'), JSON.stringify(meta, null, 2));

/* ---- validate ---- */
let badFiles = 0;
for (const r of index) {
  if (!fs.existsSync(path.join(ROOT, r.f))) { badFiles++; console.error('missing file for', r.id); }
}
let badPath = 0;
for (const r of index) {
  const p = [r.g, r.s, r.s3, r.s4].filter((x) => x !== '');
  if (!findNode(p)) { badPath++; if (badPath < 10) console.error('bad path', r.id, JSON.stringify(p)); }
}
let emptyNames = 0;
for (const r of index) if (!r.n.en) emptyNames++;
log('validate: badFiles=' + badFiles, 'badPaths=' + badPath, 'emptyNames=' + emptyNames);
fs.writeFileSync(path.join(ROOT, 'tools', 'report.json'), JSON.stringify({
  meta, typoFixes: typoUsed,
  junkDropped: junk.length, junkSample: junk.slice(0, 40),
  missingNames: missingNames.slice(0, 40), missingNamesCount: missingNames.length,
  missingTaxonomy: missingTax.slice(0, 120), missingTaxonomyCount: missingTax.length,
  badPathLog: badPathLog.slice(0, 120),
  validate: { badFiles, badPath, emptyNames }
}, null, 2));

const readme = `# Albion Wolf Database v3

Generated item database for the Albion Wolf site. Rebuilt from game dumps with full spell-chain resolution, per-enchant crafting/IP and a 3-level taxonomy.

- **families:** ${families.size} base items → ${files} files under \`families/<Group>/<BASE>.json\`
- **records:** ${index.length} (every tier × enchant variant)
- **spells:** ${Object.keys(spellDict).length} resolved (names + descriptions + stats + effects)
- **taxonomy:** 3–4 levels from \`taxonomy-source.txt\` (user spec) → \`taxonomy.json\` with counts
- **junk dropped:** ${junk.length} (non-tradable internals, placeholders, templates — see \`tools/report.json\`)

## Layout
- \`index.json\` — flat variant records: \`{id, b, n{7 langs}, g, s, s3, s4, slot, t, e, art, f}\`
- \`families/<Group>/<BASE>.json\` — per family: path, slot, spells (resolved Q/W/E/passives), tiers → names/desc/combat/variants (ip, dura, craft, upgrade)
- \`taxonomy.json\` — tree with record counts + Arabic group labels
- \`spells.json\` — skill dictionary \`{name, desc, stats, effects}\`
- \`meta.json\` — version + counts

## Regenerate
\`\`\`
node tools/extract.cjs
\`\`\`
Inputs: \`../ao-bin-dumps-master\`, \`tools/vendor/*\`, \`taxonomy-source.txt\`.
`;
fs.writeFileSync(path.join(ROOT, 'README.md'), readme);
log('done in ' + Math.round((Date.now() - t0) / 1000) + 's');
