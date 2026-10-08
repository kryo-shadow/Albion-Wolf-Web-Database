# Albion Wolf Database v3

Generated item database for the Albion Wolf site. Rebuilt from game dumps with full spell-chain resolution, per-enchant crafting/IP and a 3-level taxonomy.

- **families:** 5161 base items → 5161 files under `families/<Group>/<BASE>.json`
- **records:** 11339 (every tier × enchant variant)
- **spells:** 4731 resolved (names + descriptions + stats + effects)
- **taxonomy:** 3–4 levels from `taxonomy-source.txt` (user spec) → `taxonomy.json` with counts
- **junk dropped:** 705 (non-tradable internals, placeholders, templates — see `tools/report.json`)

## Layout
- `index.json` — flat variant records: `{id, b, n{7 langs}, g, s, s3, s4, slot, t, e, art, f}`
- `families/<Group>/<BASE>.json` — per family: path, slot, spells (resolved Q/W/E/passives), tiers → names/desc/combat/variants (ip, dura, craft, upgrade)
- `taxonomy.json` — tree with record counts + Arabic group labels
- `spells.json` — skill dictionary `{name, desc, stats, effects}`
- `meta.json` — version + counts

## Regenerate
```
node tools/extract.cjs
```
Inputs: `../ao-bin-dumps-master`, `tools/vendor/*`, `taxonomy-source.txt`.
