# Gameplay: the session ("breach")

How a run works, with every number and formula taken from the recovered scripts.
`res://` paths are relative to `reference/extracted/` (not committed; regenerate with
GDRE Tools, see [README](README.md)). Tables of values live in `data/*.json`.

## 1. Frame, resolution, timing

| Item | Value | Source |
|---|---|---|
| Internal resolution | 480 x 270 | `res://project.godot` (`viewport_width/height`), `res://Scripts/Autoloads/Globals.gd:7` |
| Default window | 1440 x 810 (3x), integer scaling, stretch mode `canvas_items` | `res://project.godot` |
| Texture filter | nearest | `res://project.godot` (`default_texture_filter=0`) |
| Renderer | Godot 4.2.2 "mobile" | `res://project.godot` |
| Simulation | Frame-rate dependent: attack timer, spawner, health drain and growth run in `_process(delta)`; enemy movement and drop pickup run in `_physics_process` (Godot default 60 Hz). | files below |

## 2. The reticle (player)

Base stats (before upgrades) are in [data/player-stats.json](data/player-stats.json)
(`res://Scripts/Systems/Stats.gd`). The ones that matter most:

| Stat | Base | Meaning |
|---|---|---|
| `damage` | 1 | damage per hit |
| `attacks_per_sec` | 0.5 | one pulse every 2 s |
| `max_health` | 10 | |
| `player_size` | 34 | reticle side in px |
| `drop_pickup_radius` | 16 | px |
| `spawn_rate` | 0.33 | enemies/s; `spawn_rate_mod` starts at **1.0**, upgrades add to it |
| `crit_damage` | 1.0 | a crit multiplies by `1 + crit_damage` (x2 base) |
| `lightning_chains` | 2 | |

- The reticle follows the mouse, clamped to the 480x270 screen; the OS cursor is hidden
  in battle (`res://Scripts/Player/PlayerCursor.gd:21-24`, `res://Scripts/Battle/BattleScene.gd:28`).
- It is drawn as a `CornerBox` (9-patch `res://Sprites/BoxCorners.png`, 12x12, margins 5)
  of side `player_size * (1 + player_size_mod)` in `MyColors.BLUE` (#3fb9eb), with a
  translucent fill `Color(1,1,1,0.133)` (`res://Scenes/Effects/CornerBox.tscn`,
  `res://Scripts/Player/PlayerCursor.gd:13-16`).

### Attack pulse

`res://Scripts/Player/PlayerCursor.gd:18-70`

1. `pulse_time += attacks_per_sec * (1 + attack_speed_mod) * delta`; when it reaches 1 the
   reticle attacks and subtracts 1. `pulse_time` starts at 0, so **the first pulse is at
   2.0 s** with no upgrades.
2. Effects: corner box flashes white for 0.1 s and springs (scale +16/size, rotate ±8°),
   `Pulse.ogg` plays, camera shakes (magnitude 3 px × screenshake setting, 0.3 s, 70 Hz)
   (`res://Scripts/Effects/CornerBox.gd:19-24`, `res://Scripts/MyCamera.gd:8-11`).
3. Hit test: axis-aligned box of the reticle size centred on the cursor, against enemy
   areas, up to 128 results (`res://Scripts/Player/PlayerCursor.gd:38-39`).
4. Pulse bolts are fired after every pulse, whether or not anything was hit (line 70).

### Damage dealt

Per pulse (`res://Scripts/Player/PlayerCursor.gd:41-43`):

```
base    = damage + max_health_damage * maxHP
pulse   = base * (1 + n * damage_mod_per_enemy)        n = enemies in the box
for each enemy hit:
  if boss: pulse *= 1 + boss_damage_mod                (mutates pulse, see note)
  enemy.take_damage(pulse)
```

Inside `take_damage` (`res://Scripts/Enemy/Enemy.gd:62-88`):

```
mods = 0
if hp >= maxHp:            mods += undamaged_mod          (first strike / ambush)
elif hp / maxHp <= 0.5:    mods += execute_mod            (last strike / finishing blow)
mods += elapsed_session_seconds * damage_mod_per_sec      (learning)
amount *= 1 + mods
if rand <= crit_chance:    amount *= 1 + crit_damage
```

- The boss multiplier bug: `pulse` is a single variable, so every enemy processed after a
  boss in the same pulse also gets the boss bonus, and two bosses would stack (there is only
  ever one boss). Same pattern in explosions (`res://Scripts/Autoloads/Globals.gd:51-52`).
- Random rolls use `randf_range(0,1) <= chance` (`res://Scripts/Utils.gd`, `wflip`).
- A hit that doesn't kill: enemy flashes white for 0.1 s if flashing effects are on, its
  fill bar springs; hit particles (6 line particles, 0.4 s) in the enemy colour
  (`res://Scripts/Enemy/Enemy.gd:62-64,90-95`, `res://Scenes/Particles/HitParticles.tscn`).
- A kill: `SquareImpact` (size = enemy width + 6, scale 1.4 → 1 over 0.12 s, white 0.08 s
  then colour 0.05 s) (`res://Scripts/Enemy/Enemy.gd:79-85`, `res://Scripts/Effects/SquareImpact.gd`).

### Damage taken (enemies hit back)

Enemies deal damage **only when you hit them** (no contact damage over time). For each
enemy hit by the reticle pulse (`res://Scripts/Player/PlayerCursor.gd:45-67`):

```
armor_mod = 1 + n * armor_mod_per_enemy
if n <= 8: armor_mod += focus_armor_mod
armor_mod += elapsed_session_seconds * armor_mod_per_sec
armor = (armor + maxHP * max_health_armor) * armor_mod
if boss: armor = (armor + boss_armor) * (1 + boss_armor_mod)
taken  = max(enemy.damage - armor, 0)
```

Pulse bolts, explosions, drones and lightning never cause damage to the player.

## 3. Health

`res://Scripts/Battle/BattleScene.gd:360-366`, `res://Scripts/Battle/PlayerHealthBar.gd`

- Every frame: `hp += (-health_loss_per_sec + health_regen + maxHP * max_health_regen) * delta`.
  `health_loss_per_sec` is the "virus" drain, a **constant per prestige** (0.2/s at P0 up to
  60000/s at P12+, see [data/prestige.json](data/prestige.json)); it does not ramp within a session.
- HP is stored as the health bar's `value`; Godot's `Range` clamps it to `[0, max_value]`,
  so healing never exceeds max HP.
- Heals: `health_on_kill` per kill (`res://Scripts/Battle/EnemySpawner.gd:222`),
  `health_on_hit + maxHP * max_health_on_hit` per enemy hit by *any* player source that calls
  `enemy_hit` (reticle, bolts, explosions/drones) (`res://Scripts/Battle/BattleScene.gd:383-386`),
  `health_on_pickup_drop` per resource collected (line 375-376).
- Parasite nodes: each kill adds `perma_max_health_on_kill` to max HP now **and** to the
  saved `State.bonus_max_health` (permanent) (`res://Scripts/Battle/EnemySpawner.gd:219-220`).
- Health bar width: `clamp(76 + (maxHP - 10) / 8000 * 124, 76, 200)` px
  (`res://Scripts/Battle/BattleScene.gd:35`). Text `"%.1f/%d"`.
- HP ≤ 0 ends the session (status 401).

## 4. Enemies and spawning

Per-type data: [data/enemies.json](data/enemies.json). Per-prestige data:
[data/prestige.json](data/prestige.json). Spawner: `res://Scripts/Battle/EnemySpawner.gd`.

### Spawn loop (`res://Scripts/Battle/EnemySpawner.gd:51-71`)

```
acc += spawn_rate(0.33) * spawn_rate_mod * delta     acc starts at 2 → 2 enemies on frame 1
while acc >= 1: acc -= 1; spawn one
  colour: yellow if rand <= yellow_enemy_chance, else blue if rand <= blue_enemy_chance, else red
  type:   weighted pick from the prestige weights (yellow uses weights without BigSquare/Pentagon)
enemy_base_health += health_growth_per_sec * delta
enemy_base_damage += damage_growth_per_sec * delta
```

- Enemies take the current base HP/damage at spawn (× type multipliers) and keep them.
- No cap on enemies on screen.
- Placement: random side, just off-screen by 0.7 × width; direction towards a random point
  within 84 px of screen centre; straight line (`res://Scripts/Battle/EnemySpawner.gd:177-205`).
  Removed once off-screen after ≥ 5 s alive (`res://Scripts/Enemy/Enemy.gd:118-123`).
- Colour is the currency colour; the fill mask inside the outline shows remaining HP
  (`TextureProgressBar`, fill bottom-to-top for square/circle/pentagon, clockwise for spiky:
  `fill_mode` 3 / 8 in the enemy scenes).

### Types (`res://Scripts/Battle/EnemySpawner.gd:86-138`)

| id | sprite | scale | speed px/s | spin turns/s | HP × | drops × | XP × | dmg × | first prestige |
|---|---|---|---|---|---|---|---|---|---|
| Square | SquareEnemy | 0.14-0.18 | 18-22 | 0.12-0.25 | 1 | 1 | 1 | 1 | 0 |
| SmallSquare | SquareEnemy | 0.08-0.10 | 30-36 | 0.16-0.26 | 0.6 | 1 | 1 | 1 | 1 |
| BigSquare | SquareEnemy | 0.45-0.50 | 12-15 | 0 | 5 | 3 | 4 | 1 | 1 |
| Pill | PillEnemy | 0.16-0.22 | 20-24 | faces velocity, wavy | 1 | 1 | 1 | 1 | 4 |
| Pentagon | PentagonEnemy | 0.40-0.45 | 14-18 | 0.15-0.20 | 3 | 2 | 2 | 1 | 5 |
| PentagonSmall | PentagonEnemy | 0.10-0.12 | 26-32 | 0.20-0.26 | 0.6 | 1 | 1 | 1 | (6 per Pentagon death) |
| Spiky | SpikyBall | 0.30-0.34 | 14-18 | 0.16-0.20 | 2 | 4 | 2 | **3** | 9 |
| Exploder | CircleEnemy | 0.14-0.18 | 18-22 | 0.12-0.25 | 1 | 1 | 1 | 1 | with "spawn exploders" |

- Speeds are multiplied by the prestige `enemy_speed_mod` (1.0 → 2.2).
- Spin direction is random (±). Sprites are 128 px art; on-screen size = 128 × scale.
- Hitboxes (unscaled, × scale): square 128x128 rect; circle r64; pill r60 (a circle);
  pentagon r60 offset (0,5); spiky r50.
- Pill wobble: `dir = normalize(move_dir*speed + perp * sin(t*1.0) * 34)` (`res://Scripts/Enemy/Enemy.gd:105-108`).
- Pentagon death: 6 PentagonSmall within 40 px, same currency and heading.
- Exploder death: square explosion 110 × (1 + exploder_size) px, random angle 0-90°,
  hitting enemies with the player's attack damage (and triggering on-hit effects).

### Prestige table (summary; full data with sources in `data/prestige.json`)

| P | enemy HP | HP/s | enemy dmg | dmg/s | boss HP | boss dmg | XP/kill | +bits | +nodes | bit value | drain/s | speed | new types |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | 3 | 0.15 | 0.4 | 0.015 | 120 | 5 | 1 | 0 | 0 | 1 | 0.2 | 1.0 | Square only |
| 1 | 10 | 0.5 | 1 | 0.04 | 800 | 10 | 2 | 1 | 0 | 1 | 0.6 | 1.0 | Small/Big square |
| 2 | 35 | 1.5 | 2.5 | 0.1 | 2,000 | 25 | 3 | 3 | 0 | 1 | 1.2 | 1.1 | |
| 3 | 100 | 4 | 8 | 0.3 | 8,000 | 75 | 5 | 5 | 0 | 1 | 3.6 | 1.2 | |
| 4 | 300 | 12 | 20 | 1 | 24,000 | 240 | 7 | 8 | 0 | 1 | 10 | 1.3 | Pill |
| 5 | 800 | 36 | 65 | 3 | 70,000 | 630 | 9 | 13 | 1 | 1 | 30 | 1.5 | Pentagon |
| 6 | 2,400 | 108 | 200 | 9 | 210,000 | 1,500 | 11 | 18 | 2 | 1 | 90 | 1.65 | |
| 7 | 7,200 | 300 | 600 | 26 | 600,000 | 4,500 | 13 | 18 | 3 | 1.4 | 270 | 1.8 | |
| 8 | 21,000 | 900 | 1,800 | 78 | 1.8M | 13,500 | 15 | 18 | 4 | 2 | 810 | 2.0 | |
| 9 | 60,000 | 2,700 | 5,300 | 230 | 5.4M | 40,000 | 18 | 18 | 5 | 3 | 2,400 | 2.0 | Spiky |
| 10 | 180,000 | 8,100 | 15,600 | 690 | 16.2M | 120,000 | 21 | 18 | 7 | 4 | 7,200 | 2.1 | |
| 11 | 540,000 | 24,000 | 45,000 | 2,100 | 48.6M | 360,000 | 24 | 18 | 7 | 6 | 21,600 | 2.2 | |
| 12 | 1.5M | 60,000 | 150,000 | 6,000 | 145M | 1M | 27 | 18 | 9 | 8 | 60,000 | 2.2 | |
| 13 | ″ | ″ | ″ | ″ | ″ | ″ | 30 | 18 | 11 | 10 | ″ | ″ | |
| 14 | ″ | | | | | | 34 | 18 | 13 | 12 | | | |
| 15 | ″ | | | | | | 38 | 18 | 15 | 15 | | | |
| 16 | ″ | | | | | | 42 | 18 | 18 | 19 | | | |
| 17 | ″ | | | | | | 46 | 18 | 18 | 25 | | | |
| 18 | ″ | | | | | | 50 | 18 | 18 | 32 | | | boss turns rainbow |
| 19 | ″ | | | | | | 54 | 18 | 18 | 40 | | | |
| 20 | ″ | | | | | | 62 | 18 | 18 | 70 | | | |
| 21 | ″ | | | | | | 66 | 18 | 18 | 110 | | | |
| 22 | ″ | | | | | | 70 | 18 | 18 | 200 | | | |
| 23 | ″ | | | | | | 74 | 18 | 18 | 360 | | | |
| 24 | ″ | | | | | | 78 | 18 | 18 | 520 | | | |
| 25 | ″ | | | | | | 82 | 18 | 18 | 720 | | | |

″ = same as P12. Enemy stats stop growing at P12; only rewards grow after that.
Source: `res://Scripts/Battle/BattleScene.gd:55-358`. A duplicate `elif == 19` at line 327
(XP 58, bit value 50) can never run.

Spawn weights: P0 Square 1; P1-3 Square .86 / Small .10 / Big .04; P4 adds Pill .08
(Square .78); P5-8 adds Pentagon .05 (Square .73); P9+ adds Spiky .02 (Square .71).
Exploders, when bought, take `0.05` from Square.

## 5. Drops and collection

`res://Scripts/Battle/EnemySpawner.gd:216-279`, `res://Scripts/Battle/EnemyDropsCreator.gd`

- Drops per kill: red `1 + stats.bit_boost + prestige bit_boost`, blue `1 + stats.node_boost
  + prestige node_boost`, then `× drop_mult`, then `×2` with `bonus_drop_chance`. Yellow
  (processor) enemies drop exactly 1 and ignore all of these. Bosses drop nothing (the Core
  is granted directly).
- Each drop rolls `autocollect_chance`: collected instantly, otherwise placed at a random
  point within half the enemy width.
- Drops have **no lifetime**; they stay until picked up or the session ends (then lost).
- Pickup: every physics frame, a circle of `drop_pickup_radius` (16 px + 8 per magnet
  level) around the cursor collects drops (drop collision radius 3 px). Collected drops
  first move 26 px away from the cursor over 0.2 s (quad ease-out, `PickupStart.ogg`), then
  fly to the cursor with `t += 6*delta`, `lerp(start, cursor, ease(t, 1.5))`, then give the
  resource and play `Pickup2.ogg`. The resource is granted at pickup time (before the
  flight) (`res://Scripts/Battle/EnemyDropsCreator.gd:59-86`, `res://Scripts/Battle/EnemySpawner.gd:271-279`).
- Value: a Bits drop gives `floor(bit_value)` plus 1 more with probability
  `frac(bit_value)` (P7: 1.4 → 1 or 2). Every other drop gives 1.
- Drop sprites: `res://Sprites/Drops/{Red,Blue,Yellow}Drop.png` tinted with the currency colour.
- Resources are added to the saved totals immediately, so terminating a session keeps
  everything already collected.

## 6. XP, levels, SP

[data/xp.json](data/xp.json), `res://Scripts/Battle/XPBar.gd`

- XP per kill = prestige `enemy_xp` × type `xp_mult`. Level and XP persist between sessions.
- XP to next level: 50, 300, 800, 2000, 3400, 5200, 7000, 9000, 11000, 14000, 18000,
  22000, 26000, 30000, 34000, 38000, 43000, 48000, 53000, 58000, 63000, 68000, 73000,
  78000, 83000 (levels 0-24), then `83000 + 5000 × (level − 24)`.
- Each level: +1 SP, "LEVEL UP" floating text (yellow), 12 shard particles, `LevelUpJingle.ogg`
  (`res://Scripts/Battle/BattleScene.gd:439-443`).

## 7. Boss and the end of a session

- A 45 s progress bar ("progress", bottom of screen) runs only when
  `curr_prestige == max_prestige`; when full, the boss spawns
  (`res://GameScenes/BattleScene.tscn:140`, `res://Scripts/Battle/BattleScene.gd:37-39,368-372`).
  When replaying a lower prestige there is no bar and no boss.
- Boss: purple square, scale 1.0 (128 px), 15 px/s (not affected by `enemy_speed_mod`),
  spins 0.1 turns/s, HP/damage from the prestige table, re-enters the screen instead of
  despawning (`res://Scripts/Battle/EnemySpawner.gd:153-162,213-214`).
- Killing the boss at max prestige: +1 Core, `max_prestige` and `curr_prestige` +1 (up to
  25). At P25 the text reads "there is nowhere left to go" and nothing more unlocks
  (`res://Scripts/Battle/BattleScene.gd:407-419`, `res://Scripts/UI/BattleEndScreen.gd:29-33`).
  One Core per prestige level, so 25 Cores total in a save; the tree needs 19.
- End screen codes (`res://Scripts/UI/BattleEndScreen.gd:22-41`):

| Cause | Text | Background | Sound |
|---|---|---|---|
| HP 0 | `status code 401: health reached zero` | BG→RED 20%, α 0.6 | Lose.ogg (+2 dB) |
| Boss killed | `status code 404: boss defeated` + `prestige N unlocked` (yellow) | BG→GREEN 20% | Win.ogg |
| TERMINATE button | `status code 500: terminated by user` | BG→RED 20% | Lose.ogg |

  Then "acquired resources:" lists the amounts collected this session; buttons "go to home"
  and "new session". Text reveals over 0.5 s.
- Sessions counter +1 each time a battle starts (`res://Scripts/MainScene.gd:121`).

## 8. Secondary attacks

### Pulse bolts (`res://Scripts/Autoloads/Globals.gd`, `res://Scripts/Player/PulseBolt.gd`)

- Fired from the reticle after every pulse: `pulse_bolt_count` bolts at angles
  `-90 + 360/count × i` degrees (evenly spaced, first straight up).
- Damage `(damage + maxHP × max_health_damage) × (1 + pulse_bolt_damage_mod)`; no
  per-enemy or boss bonus. Pierce: they hit every enemy they touch until they expire.
- Speed 300 px/s, lifetime random 0.4-0.6 s, hit circle r 5.1, drawn as a 14x6 blue rect.
- "bolt burst": on expiry, a 64 px explosion with `damage_mod = pulse_bolt_damage_mod`
  (no camera shake, but plays Pulse.ogg).
- "bit explosion": any enemy death has `enemy_death_pulse_bolt_chance` to fire a bolt ring
  from the corpse (`res://Scripts/Battle/EnemySpawner.gd:250-251`).

### Explosions (`res://Scripts/Autoloads/Globals.gd`, `create_explosion`)

A rotated square of side `width` hits all enemies inside with
`base × (1 + n × damage_mod_per_enemy + damage_mod)` (boss bonus as in the pulse), shows a
blue CornerBox that flickers out (6 × 0.04 s after 0.15 s), plays Pulse.ogg and shakes the
camera (unless disabled). Used by exploders (110 px), bolt burst (64 px) and drones (76 px).

### Auto pulser drones (`res://Scripts/Battle/MovingPulser.gd`)

- One per "auto pulser" level; placed at random inside a 20 px margin at session start.
- Move at 15 × (1 + speed mod) px/s, turning at most 90°/s towards a random living enemy
  (re-picked when the target dies).
- Pulse every `3.0 / (1 + auto_pulser_attack_speed_mod)` s (first after a random 0-50%
  of that), explosion side `76 × (1 + auto_pulser_size_mod)`, angle 45°.

### Lightning (`res://Scripts/Battle/BattleScene.gd:388-394`, `res://Scripts/Player/Lightning.gd`)

- Every `enemy_hit` (reticle, bolts, explosions) rolls `lightning_chance`.
- Damage `(damage + maxHP × max_health_damage) × (1 + lightning_damage_mod)`, then the
  normal `take_damage` rules (undamaged/execute/learning bonuses, crit roll).
- Chains `lightning_chains` times (2 base), one hop every 0.06 s, each hop to the first
  enemy found within 80 px not hit yet (not necessarily the nearest). Lightning hits do
  not trigger on-hit heals or further lightning.
- Visual: jagged blue line (segments every ~15 px, ±12 px jitter), width 4 → 0 over 0.25 s,
  16 px blue SquareImpact; `Electricity.ogg`.

## 9. Timing scenarios for tests

Derived from the formulas above; useful as fixed-seed simulation checks.

| Scenario | Expected |
|---|---|
| New save, P0, no upgrades: first attack | t = 2.0 s |
| Same: kill a Square spawned at t≈0 (HP 3, 1 dmg, no crit) | 3 hits → t = 6.0 s |
| Same: HP if you never hit anything | 10 − 0.2 t → dies at t = 50 s |
| Same: boss spawn | t = 45 s (P0 is both current and max prestige) |
| Same: damage taken per hit on a Square spawned at t | 0.4 + 0.015 t (armor 0) |
| Spawns at t=0 | 2 (accumulator starts at 2), then one every 1/0.33 ≈ 3.03 s |
| With `repeating` + `repeat-repeating` | 0.5 × 1.4 = 0.7 attacks/s → 1.43 s interval |
