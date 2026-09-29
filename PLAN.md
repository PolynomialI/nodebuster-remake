# Nodebuster Remake — Plan

Status: **planning only**. No gameplay, art or values have been built yet; those wait on the
reference material and numbers listed in [§7](#7-what-i-need-from-you).

## 1. Goal and definition of done

A faithful browser remake of *Nodebuster* (Goblobin, 2024): same mechanics, cursor feel,
skill tree, values, timings, look (CRT/VHS post-processing) and audio, with room to add
new content later.

**Platform:** a Claude HTML artifact (claude.ai), played in Chrome on a Chromebook. No
installers, no downloads.

The full game is **done** when all of these hold:

1. It runs as a claude.ai artifact in Chrome on ChromeOS at a steady 60 fps on a
   low-end Chromebook (target: Intel Celeron / MediaTek class, integrated GPU).
2. Every skill-tree node from the reference data exists with the same name, position,
   prerequisites, cost curve, max level and effect.
3. Enemy, boss, spawn, damage, health drain, drop and prestige numbers match the
   reference data. Automated tests check each table value and a set of timing scenarios
   (for example: time for an un-upgraded reticle to kill a basic red node).
4. Side-by-side screenshots against your reference captures pass a visual diff within an
   agreed tolerance for the listed screens (§8).
5. Everything in the original game loop is there: runs ("sessions"), bosses and cores,
   prestige 1–25, Milestones, Crypto Mine, the Lab, the godvirus ending, and the settings
   menu.
6. Saves persist across reloads, and a save can be exported/imported as a string.
7. New nodes, enemies or bosses can be added by editing data files only, without code
   changes (the "room for more" requirement).

## 2. Platform constraints (Claude artifacts)

| Constraint | Consequence for the build |
|---|---|
| Page and each text file ≤ 16 MB; binaries ≤ 15 MB; up to 255 files per publish | Plenty for this game. Build output is `index.html` plus bundled JS, textures, audio and data, published through the artifact `files` map. |
| External scripts only from cdnjs / jsdelivr / unpkg | Bundle everything (including PixiJS) with Vite. No runtime CDN dependency. |
| Runs inside claude.ai's iframe | Fullscreen and pointer lock may be refused, so try them and degrade gracefully. Hide the OS cursor with CSS over the canvas instead (the original hides the mouse during battle). |
| Browser storage can be empty or throw (private window, cleared data) | Primary save uses the artifact **`db` capability**: a private per-player doc under `data/users/<id>/save` (needs `db` + `user`). Fall back to `localStorage`, plus a manual export/import save string. |
| Audio needs a user gesture | A "click to start" boot screen, which also suits the original's terminal-boot style. |
| Chromebook input: touchpad, sometimes touchscreen | Use Pointer Events. Hover = move for mouse and touchpad; touch = drag the reticle. |

## 3. Stack

- **TypeScript + Vite**, building to static files.
- **PixiJS v8 (WebGL2)** for batched shapes and sprites, particles, and filter-based
  post-processing.
- **Fixed-timestep simulation** (60 Hz, separate from rendering) with a seeded RNG, so
  timings are exact and tests are deterministic.
- **Low internal resolution** (set to the original's native resolution once measured),
  integer-scaled and letterboxed to the iframe. This matches the retro look and keeps
  the CRT pass cheap on weak GPUs.
- **Web Audio** for SFX and music.
- **Vitest** for data and simulation tests. **Playwright** (Chromium is preinstalled in
  this environment) for screenshots, visual diffs and scripted play.

## 4. Architecture

```
src/
  core/        loop (fixed step), rng, events, save (db → localStorage → export string)
  sim/         run state, reticle, enemies, spawner, damage, health/virus drain,
               drops & collection, bosses, prestige, effects (lightning, drones, bullets…)
  meta/        skill tree state, costs, unlock rules, currencies, milestones,
               crypto mine, lab / godvirus
  render/      scenes, shape/sprite drawing, particles, UI, skill-tree camera (pan/zoom)
  post/        CRT/VHS filter chain (each stage toggleable and parameterised)
  audio/       sfx/music playback, volume buses
  data/        loaders + validators for the JSON content files (schemas in §5)
content/       ← all game values and text live here, not in code
  upgrades.json, enemies.json, bosses.json, prestige.json, spawn.json,
  economy.json, milestones.json, cryptomine.json, lab.json, settings.json,
  strings.en.json, post.json (CRT/VHS parameters), palette.json (normal + alternate)
assets/        ← your art/audio drops in here (§7)
tests/         value tests, timing scenarios, visual-diff baselines
```

The simulation never reads the renderer, so gameplay can be tested headless and faster
than real time.

## 5. Data schemas (the format values come in)

Effects are **named modifiers** that the sim looks up. That's how new content gets added
without code changes: a new node reuses an existing modifier type, and only a genuinely
new mechanic needs one new modifier handler.

**Skill-tree node** (`upgrades.json`)
```jsonc
{
  "id": "attack_damage_1",
  "name": "Damage",
  "description": "+{value} damage",          // template, filled from effect
  "pos": [0, -2],                           // grid coords in the tree
  "icon": "icons/damage.png",               // or a procedural shape id
  "currency": "bits",                       // bits | nodes | sp | cores | netcoin | processors
  "cost": { "type": "exponential", "base": 10, "growth": 1.5 },  // or "table": [..]
  "maxLevel": 5,
  "requires": [{ "id": "start", "level": 1 }],   // "level": "max" for maxed prerequisite
  "effects": [{ "stat": "attack.damage", "op": "add", "perLevel": 1 }],
  "unlocksFeature": null                    // e.g. "milestones", "cryptomine", "lab"
}
```

**Enemy** (`enemies.json`): id, shape/sprite, colour, size, base HP, contact/retaliation
damage, HP and damage growth over run time, drop table (`bits`/`nodes`/`processors`, amount,
chance), enhanced variant multiplier, movement pattern.

**Spawner** (`spawn.json`): base interval, per-type weights, unlock conditions (e.g. blue
after upgrade X), spawn-area rules, max on screen, scaling over run time.

**Run and health** (`economy.json`): starting HP, armor formula, regen, virus drain curve
(drain per second as a function of elapsed time), attack interval, reticle size, drop
lifetime, auto-collect chance.

**Boss / prestige** (`bosses.json`, `prestige.json`): when the boss appears, boss HP and
attack patterns, core reward, per-prestige stat and reward multipliers (1–25), and the
prestige-25 reset rule.

**Crypto Mine / Lab / Milestones**: conversion rate bits → netcoin, processor speed-up,
milestone thresholds and rewards, godvirus cost (reportedly 1000 netcoin) and the ending
sequence.

**Numbers:** late-game values may pass 2^53. The number type (plain `number` vs. a
big-number library) will be decided once the real maximums are known.

## 6. What's known about the original (from public sources)

Confidence: **✔** several sources agree · **~** one source or my memory · **?** unknown.

| Area | Known | |
|---|---|---|
| Engine | Godot (per one listing) | ~ |
| Core loop | Move a reticle; it attacks nodes under it automatically at a fixed interval | ✔ |
| Health | HP drains constantly; a "virus" drains it faster the longer the run lasts; attacked nodes hit back | ✔ |
| Scaling | Enemy HP and damage grow during a run | ✔ |
| Enemies | Red squares → **bits**; blue → **nodes**; yellow → **processors** (speed up the Crypto Mine); enhanced variants give more | ✔ |
| Drops | Must be collected by hovering; uncollected drops vanish at run end; an upgrade adds an auto-collect chance | ✔ |
| Currencies | Bits, Nodes, SP, Cores, Netcoin (+ processors) | ✔ |
| Upgrades | Damage, HP, Armor, Regen, Attack Speed (e.g. +20%), Attack Size, Spawn Rate, Blue Spawn Rate, % of HP as armor/regen/damage, scaling with enemies in area, Lightning Rod (5% chain lightning), drones, bullets | ✔/~ |
| Tree rules | Some nodes need 1 level in a prerequisite, some need it maxed; every node is purchasable | ✔ |
| Boss | Large purple boss ends the session and drops a **core**; beating it unlocks the next prestige | ✔ |
| Prestige | Higher prestige = tougher enemies and more rewards; capped at **25**; at P25 the boss resets the run | ✔ |
| Features | Milestones tab; Crypto Mine (left side of the tree, after the Attack Size upgrades; bits → netcoin); the Lab (needs 9 tree branches); godvirus costs 1000 netcoin (ending) | ✔ |
| Achievements | 13: Awakened, Routine (50 sessions), Milestones, Crypto Mine, The Lab, Bit Guy/Getter/Collector/Lord (10k/100k/1M/10M bits), Node Hunter (1k nodes), Node Buster (10k nodes), SP Seeker (25 SP), Genesis (deploy godvirus) | ✔ |
| Settings | CRT effect on/off; flashing effects off; alternate colour palette (tree); darker screen transition; (plus presumably volume/fullscreen) | ✔/? |
| Length | ~4 hours to finish | ✔ |
| Exact numbers | Costs, HP, damage, intervals, spawn rates, drain curve, boss stats | **?** — need §7 |
| SP / Cores details | How SP is earned, what cores buy | **?** |
| Visual specifics | Native resolution, palette hex values, font, CRT/VHS parameters, particle and screen-shake behaviour | **?** |

## 7. What I need from you

**Values.** Any of these works, from most to least exact:
- a copy of the Steam "Nodebuster Full Skill Tree" guide or the wiki text (or allow those
  domains, §9, and I'll pull them myself);
- values datamined from your own copy of the game;
- a spreadsheet you fill in by hand (one row per node / enemy, matching §5).

**Visual and audio reference.** These are needed to get the look exactly right:
- **Screenshots** at native resolution with the window not resized: title/boot screen,
  skill tree (zoomed out and in, a node tooltip), an early run, a late run with many
  enemies, a boss, the Milestones / Crypto Mine / Lab tabs, the settings menu, the ending.
  One set with the CRT effect on and one with it off; the "off" set gives exact palette
  and geometry.
- **Short screen recordings (≤ 30 s each):** reticle movement and attack pulses, enemy
  spawn and death, drop collection, screen transitions, the boss. These are for timing,
  easing and effects. I'll step through them frame by frame.
- **Art and audio files** if you have them: icons, font, SFX, music (PNG / OGG / MP3 /
  TTF). Anything that is purely procedural (squares, lines, particles) I'll redraw in code
  to match the captures.

**Drop-in layout:** `assets/ref/screens/`, `assets/ref/video/`, `assets/art/`,
`assets/audio/`, `content/*.json` or `content/source/*.csv`.

## 8. How "exactly the same" gets verified

- **Values:** unit tests assert every table value, cost at each level, and unlock chains.
- **Timings:** deterministic sim scenarios (fixed seed) compared with numbers measured
  from your recordings: attack interval, time-to-kill, drain curve, boss arrival.
- **Look:** Playwright captures the same screens at the same resolution. Each is diffed
  against your CRT-off reference first (geometry and palette), then CRT-on (post chain
  tuning). Tolerances are agreed per screen.
- **Feel:** you play on the Chromebook and report differences. Those feed back into
  `content/` or `post.json`, not code.

## 9. Network access needed for the build session

Today this environment allows package registries and GitHub (npm works; the build can
run). To read the reference material directly, add these to the environment's allowed
domains (cloud environment menu → Edit → Network access), or pick a broader access level:

- `steamcommunity.com`: skill-tree guide, discussions
- `store.steampowered.com`: store page, patch notes
- `steamdb.info`: patch history
- `game-vault.net`, `www.mejoress.com`: walkthroughs

Video sites won't help much, since I can't watch video from the web. Recordings you upload
are what I can step through.

## 10. Phases

| # | Phase | Output | Needs from you |
|---|---|---|---|
| 0 | **Plan** (this doc) | PLAN.md in the repo | — |
| 1 | Scaffold | Vite/TS/Pixi project, fixed-step loop, save layer, content loaders + validators, artifact build/publish script, empty scene. No art or gameplay. | — |
| 2 | Data | `content/*.json` filled + value tests green | values (§7) |
| 3 | Core run | reticle, attacks, enemies, spawner, drain, drops, run end | values + recordings |
| 4 | Skill tree | tree view (pan/zoom, tooltips, buying), all nodes wired | values + tree screenshots |
| 5 | Meta | bosses, cores, prestige 1–25, Milestones, Crypto Mine, Lab, ending, achievements | values |
| 6 | Look & sound | palette, font, particles, transitions, CRT/VHS chain, audio, settings menu | screenshots, recordings, audio |
| 7 | Fidelity pass | visual diffs + timing scenarios + your playtest on the Chromebook | your playtest |
| 8 | Extensions | new content via data files | your ideas |

Phase 1 can start as soon as the repo exists, since it doesn't depend on art or values.

## 11. Risks and open questions

- **Copyright.** The mechanics can be reproduced freely, but Goblobin's art, audio, text
  and code are theirs. Keep the repo and the artifact private (the artifact is private
  by default; sharing its link would distribute their assets). If this ever becomes
  public, swap in original art/names through the same `content/` and `assets/` files.
- **Exact values may not be public** in full; datamining your own copy or measuring may
  be needed for some curves.
- **iframe limits** on fullscreen/pointer lock inside claude.ai. The design doesn't depend
  on either.
- **Low-end GPU cost** of the CRT/VHS chain. Mitigated by the low internal resolution and
  a quality setting.
- **Big numbers** late game (see §5).
