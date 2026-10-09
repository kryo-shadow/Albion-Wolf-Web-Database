# Albion Wolf Database v4

Generated item database for the Albion Wolf site. Rebuilt from game dumps with full spell-chain resolution, per-enchant crafting/IP and a 3-level taxonomy.

- **families:** 4641 base items → 4641 files under `families/<Group>/<BASE>.json`
- **records:** 10819 (every tier × enchant variant)
- **spells:** 4731 resolved (names + descriptions + stats + effects)
- **taxonomy:** 3–4 levels from `taxonomy-source.txt` (user spec) → `taxonomy.json` with counts
- **junk dropped:** 705 (non-tradable internals, placeholders, templates)
- **hidden dropped:** 502 (everything the site used to hide at runtime)
- **sound/fx dropped:** 18 (kill emotes, fireworks, vanity trumpet/horn)
- **order:** identical to v3 index minus dropped (OK (10819 records, same order as v3, 0 added))
- **new fields:** tier `value/fame/weight/tradable/stack/unlock/showmarket`, variant `v` (item value), index `v`

## Layout
- `index.json` — flat variant records: `{id, b, n{7 langs}, g, s, s3, s4, slot, t, e, art, tr, f, v}`
- `families/<Group>/<BASE>.json` — per family: path, slot, spells (resolved Q/W/E/passives), tiers → names/desc/value/fame/weight/tradable/stack/unlock/showmarket/combat/variants (v, ip, dura, craft, upgrade)
- `taxonomy.json` — tree with record counts + Arabic group labels
- `spells.json` — skill dictionary `{name, desc, stats, effects}`
- `meta.json` — version + counts

## Regenerate
```
node tools/extract.cjs
```
Inputs: `../ao-bin-dumps-master`, `tools/vendor/*`, `taxonomy-source.txt`.
