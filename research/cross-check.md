# Cross-check against community sources

The game files are the authority. This compares them with the two community sources and
records every difference. Row-by-row output: [cross-check.generated.md](cross-check.generated.md)
and [data/cross-check.json](data/cross-check.json), produced by `scripts/extract.ps1`.

## Sources

| Source | URL | Snapshot | Fetched |
|---|---|---|---|
| Steam guide "Nodebuster Full Skill Tree" (Orange Creamsicle, updated Jul 8 2025) | https://steamcommunity.com/sharedfiles/filedetails/?id=3414691532 | [sources/steam-guide-3414691532.txt](sources/steam-guide-3414691532.txt) (body text only) | 2026-09-29 |
| Google Sheet of upgrades and prices (calamity) | https://docs.google.com/spreadsheets/d/1vrLln6hSPshVy47k3fFz4R0q7zNZpgm-72vdAAGI98E | [sources/sheet-upgrades-and-prices.csv](sources/sheet-upgrades-and-prices.csv) (CSV export of the only tab, gid 0) | 2026-09-29 |

**The guide does not link a spreadsheet.** Neither its body nor its four comments contain a
link. The only Nodebuster upgrade spreadsheet I found is linked from a *different* Steam
guide, "Google Sheet with all Upgrades and their prices"
(https://steamcommunity.com/sharedfiles/filedetails/?id=3533964915), so that is the sheet
used here.

The guide lists name, description and level count per node (no costs, currencies,
positions or prerequisites). The sheet lists name, short effect, levels, currency colour,
total and every per-level cost.

## Result

- **Costs: the sheet matches the game on 87 of 88 nodes**, level by level, including the odd
  0.012 at `transplant` level 6. The one mismatch is `pulse bolts`: the sheet says 1 SP,
  the game charges **12 Nodes** (`res://Scripts/Autoloads/Stores/UpgradeStore.gd:219`).
- **Levels: both sources match the game on every node they list.**
- **Coverage:** the guide lists all 97 nodes. The sheet has 88 rows: everything except the
  nine `Infinity` nodes (`to infinity` … `singularity`, 1 Core each).
- **Currencies:** the sheet matches the game everywhere except `pulse bolts` (above).

### Text errors in the guide

| Node | Guide says | Game says | Code does |
|---|---|---|---|
| `Health2` better endurance | +8 max health | +12 max health | +12 |
| `BossDamage1` giant slayer | +50 damage against bosses | +50% damage against bosses | +0.5 boss_damage_mod |
| `Size3` b.i.g. | +100 attack size | +100% attack size | +1 px to base size (see below) |
| `MovingPulserSize2` it's pulsing time | +50% auto-pulser attack **speed** | +50% auto-pulser attack **size** | size |
| `Lifesteal3` extraction | restore 1% health | restore +1% max health | 1% of max HP |
| names | "lighting rod", "swaming", "overloading" | lightning rod, swarming, overloaded | |

The remaining differences are typos or a dropped "+" and don't change meaning.

### Text errors in the sheet

| Node | Sheet says | Game says |
|---|---|---|
| `CritDamage2` big crit | +200% **Lightning** Damage | +200% **crit** damage |
| `PulseBolts` pulse bolts | cost 1 SP | cost 12 Nodes |

Sheet effects are abbreviations ("Spawn Bombs", "+25% DMG to under half"); apart from the two
rows above they mean the same as the game text. `+3 / +8 MaxHP on Kill` are totals, which
matches how the game's text is worded.

## Where all three sources agree and the code disagrees

The in-game text (and therefore both community sources, which copy it) is wrong in these
cases. A faithful remake should follow the code; the full list is in
[skill-tree.md § Notes](skill-tree.md#notes-on-individual-nodes).

| Node | Text | Code |
|---|---|---|
| `SpawnRate2` swarming | +200% spawn rate | +2.5 to `spawn_rate_mod` (+250%) (`res://Scripts/Upgrades/UpgradeProcessor.gd:60`) |
| `Size3` b.i.g. | +100% attack size | `player_size += 1.0`, base 34 px, so about +3% per level (`res://Scripts/Upgrades/UpgradeProcessor.gd:119`) |
| `PulseBolts` | "shoot projectiles" | 3 bolts per attack (`res://Scripts/Upgrades/UpgradeProcessor.gd:72`) |
| `Infinity1`-`Infinity9` | "???" | only `Infinity1` does something: +10 `spawn_rate_mod`, +12 max HP per kill (`res://Scripts/Upgrades/UpgradeProcessor.gd:184-186`) |

## What neither source covers

Positions, connections and unlock rules, enemy/boss/prestige numbers, drain, drops, XP,
Crypto Mine, Lab, milestones and settings all come only from the game files; see
[gameplay.md](gameplay.md) and [meta.md](meta.md). One more text/code mismatch outside the
tree: milestone `Blues1.6k` says "destroy 1,500 blue enemies" but checks for 1,600
(`res://Scripts/Upgrades/UpgradeProcessor.gd:493`).
