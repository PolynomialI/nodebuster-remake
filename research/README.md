# Nodebuster research

Everything the remake needs to match the original, taken from the game's own files and
checked against the community sources. It covers PLAN.md §5-§7: the values PLAN.md §6
marked as unknown ("?") are now known.

## Documents

| File | Contents |
|---|---|
| [skill-tree.md](skill-tree.md) | All 97 nodes: name, description, currency, cost per level, max level, effect, prerequisites, position, connections, text-vs-code notes *(generated)* |
| [gameplay.md](gameplay.md) | The session: reticle, attack timing, damage and armor formulas, health drain, spawning, enemy types, prestige table, drops, XP, boss, pulse bolts, drones, lightning, test scenarios |
| [meta.md](meta.md) | Currencies, prestige, feature unlocks, Milestones, Crypto Mine, Lab, godvirus ending timeline, achievements, save format |
| [settings.md](settings.md) | Options menu and controls |
| [visuals-audio.md](visuals-audio.md) | Render pipeline, CRT/glow/glitch shaders step by step, palette, fonts, UI, effects, transitions, music and sound triggers |
| [assets.md](assets.md) | Every sprite, icon, font, shader and sound with path, size/duration and where it's used *(generated)* |
| [cross-check.md](cross-check.md) | Comparison with the Steam guide and the community spreadsheet; [cross-check.generated.md](cross-check.generated.md) has every row |

## Data (`data/`)

| File | Contents |
|---|---|
| `upgrades.json` | skill tree nodes and edges |
| `player-stats.json` | reticle base stats |
| `prestige.json` | per-prestige enemy/boss/reward/drain values, P0-P25 |
| `enemies.json` | enemy types, boss, hitboxes, sprites |
| `xp.json` | XP per level |
| `milestones.json` | 25 milestones |
| `cryptomine.json` | conversion rate, speed per level, deposits |
| `lab.json` | research goal, ending timeline |
| `achievements.json` | 13 Steam achievement ids and conditions |
| `settings.json` | options, defaults, effects |
| `palette.json` | colours |
| `post.json` | CRT, glitch and glow parameters |
| `assets.json` | asset catalogue |
| `cross-check.json` | per-row comparison with the community sources |

Every value has a `src`: `res://<path>:<line>` in the recovered project (or a URL for web
sources). `res://` means `reference/extracted/`.

## How this was produced

1. `reference/game/Nodebuster.pck` (Steam build, Godot 4.2.2, 645 files) was recovered with
   **GDRE Tools v2.6.4** (Windows build from https://github.com/GDRETools/gdsdecomp/releases,
   kept in `reference/tools/`, gitignored):
   ```
   reference/tools/gdre_tools.exe --headless --recover=reference/game/Nodebuster.pck --output=reference/extracted
   ```
   The scripts were shipped as plain GDScript source, so nothing had to be decompiled and
   the recovered code is exactly what runs. All 274 imported resources converted; all 175
   textures were imported uncompressed (`compress/mode=0`), so the PNGs are exact. GDRE
   reports one "lossy" conversion without naming it: it is `res://icon.svg`. The pack only
   holds its imported raster (a lossless WebP inside
   `.godot/imported/icon.svg-218a8f2b3041327d8a5756f3a245f83b.ctex`, offset 56), so GDRE
   traced it back into a vector with VTracer. It is the stock Godot project icon
   (`application/config/icon`, the window icon; the game never draws it). Rendered at
   128x128, the traced SVG matches the cached raster exactly (largest channel difference
   below 1/255, no pixel off by more than 16), so nothing was lost that matters.
2. `scripts/extract.ps1` (PowerShell 5.1, the only runtime on this machine) parses the
   scripts and scenes into `data/*.json`, `skill-tree.md`, `assets.md` and
   `cross-check.generated.md`. Rerun it after re-extracting:
   ```
   powershell -ExecutionPolicy Bypass -File research/scripts/extract.ps1
   ```
   It fails loudly if a prerequisite isn't a scene neighbour or a cited pattern is missing.
3. The other documents were written by reading the scripts. Every hand-cited line was
   printed and checked against its file.
4. The Steam guide and the spreadsheet were fetched on 2026-09-29 and snapshotted in
   `sources/`. The guide itself doesn't link a spreadsheet; see [cross-check.md](cross-check.md).

`reference/` (game, tools, extracted project) is not committed: it is Goblobin's work.

## Findings that change PLAN.md

- **Resolution:** 480x270, integer-scaled, nearest filtering. Default window 1440x810.
- **Engine:** Godot 4.2.2. The whole game is ~90 small GDScript files.
- **The "virus" drain is a constant per prestige** (0.2 HP/s at P0), not a curve that grows
  during a run. What grows within a run is enemy HP and damage (linear in seconds).
- **Enemies only hurt you when you hit them** (per enemy per pulse, minus armor). There is no
  contact damage.
- **Drops never expire** during a session; they are lost only when it ends.
- **The boss** spawns after 45 s, and only at your highest prestige. It drops 1 Core. There are
  25 Cores in a save; the tree needs 19.
- **Prestige 25 does not reset anything.** The boss stays beatable; the end text says "there is
  nowhere left to go".
- **The Lab** needs the nine `Infinity` nodes (9 Cores), then costs 1 Bit. The godvirus needs
  **1000 Netcoin** deposited; Netcoin over 1000 is lost on deposit.
- **SP** = 1 per level up. **Netcoin** = Bits × 0.00001 through the Crypto Mine (5 → 1,280,000
  Bits/s over 36 Processor upgrades).
- **Big numbers:** the largest values are boss HP 145,000,000 and enemy HP growth, but damage
  can scale with max HP (`bloodblade`) and permanent max HP grows every kill, so plain JS
  `number` (2^53) needs a check in phase 2. Netcoin is a float in the original.
- **Text vs code:** several node descriptions don't match what the code does (swarming +250%,
  b.i.g. +1 px, pulse bolts give 3). The data records both; the remake should follow the code.
- **Original bugs to keep or fix deliberately:** the boss damage bonus leaks to other enemies
  in the same pulse; the second `prestige == 19` branch is dead code; milestone "BLUE RIVAL"
  text says 1,500 but needs 1,600.
- **Settings:** window size, v-sync, screen shake (default 90), CRT on/off, transition colour,
  flashing effects, colour palette, master/BGM/SFX volume (50/60/100).
