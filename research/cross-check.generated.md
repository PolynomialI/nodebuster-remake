## Steam guide: every entry with a difference

| Section | Guide name | Node id | Differences |
|---|---|---|---|
| Lighting | lighting rod | `LightningChance1` | name spelled "lighting rod" (game: "lightning rod") |
| Maximum Health Pool | better endurance | `Health2` | description numbers differ: guide "+8 max health", game "+12 max health" |
| Enemy Spawns | swaming | `SpawnRate2` | name spelled "swaming" (game: "swarming") |
| Enemy Spawns | overloading | `SpawnRate4` | name spelled "overloading" (game: "overloaded") |

Game nodes not in the guide: none.

## Spreadsheet: every row with a difference

| CSV row | Sheet name | Node id | Differences |
|---:|---|---|---|
| 26 | Spawn Exploders | `ExplodersChance` | effect text numbers differ: sheet "Spawn Bombs", game "+5% chance to spawn enemies that explode on death" |
| 37 | Pulse Bolts | `PulseBolts` | currency: sheet SP (sp), game nodes (res://Scripts/Autoloads/Stores/UpgradeStore.gd:219)<br>costs: sheet [1], game [12] (res://Scripts/Autoloads/Stores/UpgradeStore.gd:219)<br>total: sheet 1, game 12 |
| 41 | Last Strike | `Execute1` | effect text numbers differ: sheet "+25% DMG to under half", game "+25% damage to enemies below 50% hp" |
| 63 | Finishing Blow | `Execute2` | effect text numbers differ: sheet "+100% DMG to under half", game "+100% damage to enemies below 50% hp" |

Game nodes not in the sheet: `Infinity1`, `Infinity2`, `Infinity3`, `Infinity4`, `Infinity5`, `Infinity6`, `Infinity7`, `Infinity8`, `Infinity9`.

Rows that match the game exactly (name, currency, levels, every cost, total, effect numbers): 84 of 88.
