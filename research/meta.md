# Meta progression: currencies, prestige, Milestones, Crypto Mine, Lab, ending, saves

`res://` paths are relative to `reference/extracted/`. Data: [data/milestones.json](data/milestones.json),
[data/cryptomine.json](data/cryptomine.json), [data/lab.json](data/lab.json),
[data/achievements.json](data/achievements.json), [data/xp.json](data/xp.json).

## Currencies

`res://Scripts/Enums/ResourceType.gd`, `res://Scripts/Autoloads/State.gd`, tooltip text from
`res://Scripts/Shop/ShopScene.gd:121-152`.

| Currency | Colour | Icon | Earned from | Type |
|---|---|---|---|---|
| Bits | RED #f03a3f | `Sprites/UI/Red.png` | red enemies ("a common resource") | int |
| Nodes | DARK_BLUE #457af6 | `Sprites/UI/Blue.png` | blue enemies ("uncommon") | int |
| Cores | PURPLE #c359fb | `Sprites/UI/Purple.png` | bosses, 1 per prestige level ("a limited resource") | int |
| SP | BLUE #3fb9eb | `Sprites/UI/SP.png` | level ups, 1 per level | int |
| Netcoin | GREEN #4ff264 | `Sprites/UI/Netcoin.png` | Crypto Mine conversion of Bits | **float** |
| Processors | YELLOW #eed345 | `Sprites/UI/Processors.png` | yellow enemies, Yellows milestones | int |

- A currency panel appears once that currency has ever been above 0 (`*_unlocked` flags).
  Bits and Netcoin/Processors also show on the Crypto Mine tab; Netcoin on the Lab tab
  (`res://Scripts/Shop/ShopScene.gd:58-68`).
- Blue enemy chance comes only from "node finder" (+1% per level, max 5%); yellow only from
  "processor acquisition" (+0.1%) and "endless" (+0.4%) (`data/upgrades.json`).
- Lifetime `total_bits` / `total_nodes` count every gain (for achievements), spending doesn't
  reduce them (`res://Scripts/Autoloads/State.gd:12-26`).

## Prestige

- Starts at 0. Beating the boss at your highest prestige unlocks the next, up to 25, and
  moves you to it (`res://Scripts/Battle/BattleScene.gd:407-419`).
- Once `max_prestige > 0`, "Breach" opens a picker ("choose prestige level", − / + / ?):
  any level from 0 to `max_prestige` (`res://Scripts/Popups/PrestigePicker.gd:23,38`,
  `res://Scripts/Shop/ShopScene.gd:110`). Tooltip: "Unlock a new prestige level when you beat
  the boss of the previous one. Each prestige level increases both enemy stats and resource
  gain."
- Bosses (and Cores) only appear at `curr_prestige == max_prestige`. There is no reset at
  P25: the boss can be fought and killed again, it just gives nothing new.
- Per-level numbers: [gameplay.md §4](gameplay.md#prestige-table-summary-full-data-with-sources-in-dataprestigejson).

## Feature unlocks (tree paths)

From `data/upgrades.json` (requirements are on scene neighbours):

| Feature | Node (cost) | Shortest prerequisite chain |
|---|---|---|
| Milestones tab | `Milestones` (1 Node) | power → crowding → bit boost (1 SP) → node finder (400 Bits) → milestones |
| Crypto Mine tab | `CryptoMine` (50 Nodes) | power → crowding → swarming (1 Core, max) → infesting (≥1) → domain expansion (1 Core) → crypto mine |
| Yellow enemies | `YellowSpawn1` (0.01 Netcoin) | crypto mine → processor acquisition |
| Lab tab | `Laboratory` (1 Bit) | … → beyond (`Health7`) → 9 × Infinity nodes (1 Core each) → the lab |

The plan's "Lab needs 9 tree branches" is really these nine single-level Infinity nodes
(`Infinity1`-`Infinity9`, 9 Cores). Only `Infinity1` has an effect (+1000% spawn rate,
+12 max HP per kill); the other eight do nothing.

## Milestones

`res://Scripts/Autoloads/Stores/MilestoneStore.gd` (names, text), rewards and thresholds in
`res://Scripts/Upgrades/UpgradeProcessor.gd:402-508`. Progress uses lifetime kill counters;
each milestone is claimed once with its "claim" button. The tab button gets a notification
dot while anything is claimable. Icons: `res://Sprites/MilestoneIcons/<id>.png`.

| id | name | requirement | reward |
|---|---|---|---|
| Reds500 | RED DEFEATER | 500 red kills | 500 Bits |
| Blues10 | BLUE DEFEATER | 10 blue kills | 5 Nodes |
| Reds2k | RED ENEMY | 2,000 red | 3,000 Bits |
| Blues100 | BLUE ENEMY | 100 blue | 100 Nodes |
| Reds4k | RED SLAYER | 4,000 red | 5,000 Bits |
| Blues200 | BLUE SLAYER | 200 blue | 200 Nodes |
| Reds6k | RED BUSTER | 6,000 red | 8,000 Bits |
| Blues300 | BLUE BUSTER | 300 blue | 300 Nodes |
| Reds8k | RED HACKER | 8,000 red | 12,000 Bits |
| Blues500 | BLUE HACKER | 500 blue | 500 Nodes |
| Reds10k | RED DESTROYER | 10,000 red | 16,000 Bits |
| Blues800 | BLUE DESTROYER | 800 blue | 800 Nodes |
| Yellows5 | YELLOW DEFEATER | 5 yellow | 1 Processor |
| Reds15k | RED ENDER | 15,000 red | 20,000 Bits |
| Blues1.2k | BLUE ENDER | 1,200 blue | 1,200 Nodes |
| Yellows10 | YELLOW ENEMY | 10 yellow | 1 Processor |
| Reds20k | RED RIVAL | 20,000 red | 30,000 Bits |
| Blues1.6k | BLUE RIVAL | **1,600** blue (text says "1,500") | 1,600 Nodes |
| Yellows15 | YELLOW SLAYER | 15 yellow | 1 Processor |
| Reds30k | RED BREAKER | 30,000 red | 50,000 Bits |
| Blues2k | BLUE BREAKER | 2,000 blue | 2,000 Nodes |
| Reds50k | RED CHALLENGER | 50,000 red | 100,000 Bits |
| Blues4k | BLUE CHALLENGER | 4,000 blue | 4,000 Nodes |
| Reds100k | RED NEMESIS | 100,000 red | 1,000,000 Bits |
| Blues8k | BLUE NEMESIS | 8,000 blue | 8,000 Nodes |

Entry format: icon, name, `<unlock text> (xx.x%)` with the percentage in green,
`REWARD: <amount> <currency>` in yellow; claimed entries fade 70% towards the background
and the button reads "claimed" (`res://Scripts/Milestones/MilestoneEntry.gd`).

## Crypto Mine

`res://Scripts/Systems/CryptoMine.gd`, `res://Scripts/Shop/CryptoMinePage.gd`

- Deposit buttons: 1k, 5k, 10k, 50k, 100k, 1m Bits (disabled when you can't afford them).
- Rate: **1 Bit → 0.00001 Netcoin** (100,000 Bits = 1 Netcoin).
- Speed: Bits converted per second, by mine level (upgrade = 1 Processor, 36 upgrades):
  5, 10, 20, 40, 80, 160, 320, 640, 1280, 1800, 2600, 3400, 4200, 5200, 6400, 7600, 8800,
  10000, 12000, 14000, 17000, 21000, 25000, 32000, 42000, 52000, 64000, 80000, 100000,
  124000, 164000, 228000, 320000, 480000, 640000, 820000, 1280000 (levels 0-36).
- Converts continuously while the game runs, in any scene (`res://Scripts/Autoloads/State.gd:104-106`);
  nothing is converted while the game is closed. Level and remaining deposit are saved.
- Page shows: "conversion rate" (1 → 0.00001), "deposited", "netcoin_returns",
  "time_remaining" (mm:ss, yellow), "conversion_speed: N/sec", "upgrade speed (1 Processor)"
  and a "?" help tooltip: "Deposit Bits and they will automatically be converted into
  Netcoin over time. Spend Processors to improve the conversion speed."

## The Lab and the godvirus

`res://Scripts/Shop/LabPage.gd`

- Header "godvirus research lab" (rainbow text), "research progress" bar out of **1000
  Netcoin** (`LabPage.gd:28`).
- "deposit <all your netcoin>": adds all Netcoin, clamps progress to 1000 and sets Netcoin
  to 0, so any excess over 1000 is lost (`LabPage.gd:68-69`). The bar tweens over 0.4 s with
  rising-pitch `Tick3.ogg` ticks.
- At 1000: "virus ready", animated godvirus sprite (`Sprites/UI/Godvirus.png`, 5 frames of
  32x32, 10 fps), "deploy virus" button.
- Deploying sets `virus_deployed` and saves (`LabPage.gd:81-82`); afterwards the tab shows
  "virus already deployed". The save continues to be playable.

### Ending sequence (`res://Scripts/Ending.gd`, `res://Scenes/Ending.tscn`)

| t (s) | Event |
|---:|---|
| 0 | Mouse locked. Panel "deploying virus..." with spinning loading circle (−180°/s); `Deploying.ogg` |
| 4 | Panel "virus deployed!" + smile sprite + "ok"; `Deployed.ogg`; achievement DEPLOY_GODVIRUS |
| 6 | Glitch overlay shown (shake_power 0); BGM fades to volume 0 and low-pass 500 Hz over 10 s |
| 8 | `Static.ogg` fades 0 → 1 and glitch shake_power 0 → 0.8, both over 10 s |
| 18 | Static stops; `VoiceLoop.ogg` + `VCR.ogg` play; screen freezes on a screenshot; glitch hidden |
| 23 | Voice stops; black credits screen |
| 25 | `BackgroundNoise.ogg` |
| 26 | Credits animation (16.5 s): "nodebuster" 0-3.5 s, "a game by Goblobin" 4-7.5 s, "with music by Holizna" 8-11.5 s, "thanks for playing <3" 13-16.5 s (font size 22) |
| 47.5 | Back to main menu (no transition), mouse unlocked |

## Achievements (Steam)

[data/achievements.json](data/achievements.json). 13 ids set in code:

| id | condition | where |
|---|---|---|
| FIRST_SESSION | start any session | `res://Scripts/MainScene.gd:122` |
| TOTAL_SESSIONS_50 | 50 sessions started | `res://Scripts/MainScene.gd:123` |
| MILESTONES | buy "milestones" | `res://Scripts/Upgrades/UpgradeProcessor.gd:54` |
| CRYPTO_MINE | buy "crypto mine" | `res://Scripts/Upgrades/UpgradeProcessor.gd:105` |
| THE_LAB | buy "the lab" | `res://Scripts/Upgrades/UpgradeProcessor.gd:191` |
| BITS_10K / 100K / 1M / 10M | lifetime Bits ≥ 10k / 100k / 1M / 10M, checked on the end screen | `res://Scripts/UI/BattleEndScreen.gd:63-66` |
| NODES_1K / NODES_10K | lifetime Nodes ≥ 1k / 10k, end screen | `res://Scripts/UI/BattleEndScreen.gd:68-69` |
| SP_25 | reach level 25 | `res://Scripts/Battle/XPBar.gd:50-51` |
| DEPLOY_GODVIRUS | deploy the godvirus | `res://Scripts/Ending.gd:37` |

Display names (Awakened, Routine, Bit Guy/Getter/Collector/Lord, Node Hunter, Node Buster,
SP Seeker, Genesis…) are in Steam, not the game files; they come from PLAN.md §6.

## Saves

`res://Scripts/Autoloads/Saver.gd`, `res://Scripts/Autoloads/State.gd:151-169`

- `user://save.dat`, Godot `var_to_str` text of
  `{ upgrades: {id: level}, milestones: {id: claimed}, state: {...} }`. Written to
  `save_temp.dat` then copied over.
- `state` holds every `State` property except `stats` (currencies, `*_unlocked`, level,
  curr_xp, bonus_max_health, nums {enemies/reds/blues/yellows killed}, crypto_mine
  {mine_level, curr_bits}, lab_research_progress, virus_deployed, curr/max prestige,
  sessions, total_bits, total_nodes, version 0).
- Stats are rebuilt on load by re-applying every owned upgrade level.
- Saved when entering the shop or a battle, on "main menu", after deploying the virus and
  on window close (`res://Scripts/MainScene.gd`). "new game" with an existing save asks
  "Start a new save? Your old save will be permanently deleted." (no / yes).
