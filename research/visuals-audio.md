# Look and sound

How the game looks and sounds, and where each piece comes from. Full file list with sizes
and durations: [assets.md](assets.md). Parameters: [data/post.json](data/post.json),
[data/palette.json](data/palette.json). `res://` = `reference/extracted/` (not committed).

## Render pipeline

1. Everything in play (tree, battle, menus, popups, transitions) renders into a **480x270
   SubViewport**, nearest filtering (`res://MainScene.tscn`, `GameViewport`).
2. The viewport is shown integer-scaled in the window (default 1440x810; stretch
   `canvas_items`, scale mode `integer`: `res://project.godot`).
3. **WorldEnvironment glow** (2D HDR glow over canvas layers ≤ 10): `glow_intensity` 1.8
   (0.9 with CRT off), `glow_strength` 0.75, blend mode 0 (additive), `glow_hdr_threshold` 0.1,
   `glow_hdr_luminance_cap` 0.2, normalized (`res://MainScene.tscn:19-28`). This is the
   soft bloom around every bright shape.
4. **CRT overlay**: a full-window `ColorRect` on CanvasLayer 4 with
   `res://Shaders/CRTShader.gdshader` reading the screen texture. It runs at **window**
   resolution, so its pixel-based terms (chromatic offset, 3-px RGB grid) are in window
   pixels, not game pixels. Hidden when `crt_effect` is off.
5. **Glitch overlay** (`res://Shaders/GlitchScreenShader.gdshader`, MIT, by Yui Kinomoto)
   above the CRT; hidden except during the ending.

### CRT shader (`res://Shaders/CRTShader.gdshader`) — the look to reproduce

Values used by the game (material in `res://MainScene.tscn:30-47`; shader defaults differ):

| Uniform | Game value | Shader default |
|---|---:|---:|
| wobble_speed | 0.1 | 0.1 |
| wobble_frequency | 0.3 | 0.5 |
| wobble_strength | 0.5 | 0.5 |
| fisheye | 0.25 | 0.5 |
| brighten | 0.65 | 0.5 |
| scanline_count | 240 | 50 |
| scanline_movespeed | 0.5 | 3.0 |
| horizontal_scanline_strength | 0.4 | 0.4 |
| vertical_scanline_strength | 0.02 | 0.4 |
| chromatic | 2.0 | 2.0 |
| ghosting | 0.05 | 0.05 |
| vignette | 0.05 | 0.5 |
| edge_color | (0.03, 0.03, 0.03) | (1, 1, 1) |
| bloomRadius / bloomThreshold / bloomIntensity | 1 / 1 / 1 | 1 / 1 / 1 |

Per pixel, in order (all from the shader source):

1. **Barrel distortion**: `uv = (uv-0.5)*2; uv.x *= 1 + (|uv.y|*fisheye)^3; uv.y *= 1 + (|uv.x|*fisheye)^3; uv = uv/2+0.5`.
2. **Wobble**: `x = sin(ws*T + uv.y*wf*14) * sin(ws*2.5*T + uv.y*wf*20) * 0.004 * wstr` (horizontal UV shift).
3. **Chromatic aberration**: R sampled at `+(c, c)`, G at `(c, −c)`, B at `(−c, −c)` times
   `SCREEN_PIXEL_SIZE.x` (note: x size used for both axes), each channel **+0.05** (lifts blacks).
4. **Ghosting**: adds `ghosting ×` the channel sampled ≈(−0.02..−0.025, −0.018..−0.025) UV away.
5. **Brighten**: `col *= 1 + brighten` (×1.65).
6. **Bloom**: 3x3 bilinear taps of `max(tex − bloomThreshold, 0)`, weights 1 / 0.5 / 0.2929,
   normalised by 4.1716, × bloomIntensity. With threshold 1.0 it only catches HDR values > 1.
7. **Scanlines**: `s = sin(0.5*T + uv.y*240*2π)`, `s = (s*0.2+0.5)*0.9+0.1`, `col *= s^(0.4*0.5)`.
8. **Aperture grille**: per window-pixel column `mod(x, 3)` → R/G/B mask, clamped to
   `[0.5 − 0.02, 1]`, normalised and clamped: a very faint RGB stripe.
9. **Vignette**: `col *= (20·u·v·(1−u)·(1−v))^0.05`.
10. Outside the curved screen: `edge_color` (near black).

Output alpha is 1. The two unused shaders (`BloomShader.gdshader`, `GlitchShader.gdshader`)
are not part of the look.

### Glitch shader (ending only)

`shake_power` 0.03 (tweened 0 → 0.8 in the ending), `shake_rate` 1.0, `shake_speed` 5,
`shake_block_size` 240, `shake_color_rate` 0.01 (`res://MainScene.tscn:49-55`). Horizontal
band offsets per 1/240 of the screen, re-randomised 5×/s, with R/B split.

## Palette

`res://Scripts/MyColors.gd`

| Name | Hex | Used for |
|---|---|---|
| WHITE | `#dcdcdc` | text, tree lines, button outlines, flashes |
| RED | `#f03a3f` | Bits, red enemies, health bar, "can't buy" outline |
| YELLOW | `#eed345` | Processors, "maxed" outline, LEVEL UP, highlights |
| GREEN | `#4ff264` | Netcoin, "can buy" outline, milestone % |
| BLUE | `#3fb9eb` | SP, reticle, pulse bolts, explosions, lightning, drones |
| DARK_BLUE | `#457af6` | Nodes, blue enemies |
| PURPLE | `#c359fb` | Cores, bosses |
| BG | `#1f1f1f` | background of every scene |
| VIOLET | `#e048f7` | alternate palette: maxed |
| DARK_RED | `#a71818` | alternate palette: can't buy |

Others: clear colour black; disabled buttons `#6c6c6c`; dark transition `#8f8f8f`;
XP bar `rgb(0.839, 0.631, 0.161)`; session progress bar WHITE; background particles 0.17 grey.
Button fills seen in scenes: continue `rgb(.153,.608,.227)`, options `rgb(.929,.306,.675)`,
quit/terminate/back RED, claim/deposit `rgb(.114,.549,.220)`, upgrade mine
`rgb(.826,.239,.786)`, Lab tab `rgb(.788,.286,.663)` with hue cycling 0.2 turns/s.

## Fonts and text

- UI font: `res://Themes/retro-pixel-cute-prop.ttf`, size **11**, `spacing_top −2`,
  `spacing_bottom −1` (`res://Themes/DefaultTheme.tres`). Titles and credits use size 22.
- `res://Themes/Pixellari.ttf` ships but is unused.
- Label/RichText default colour WHITE; all text is lower case except status/transition text.
- Tooltips: black panel `#0f0f0f`, margins 4/1/3/1, max width 300 px, spring in (squash
  −0.1/0.3, rotate 7°) (`res://MainScene.tscn`, `res://Scripts/UI/Tooltip.gd`).

## UI components

- **Buttons** (`res://Scripts/UI/Buttons/MyButton.gd`): three nested rects: 1 px WHITE
  outline, 1 px BG inline, then the fill colour. Hover: fill 20% towards white, rotate
  spring −6°, `ButtonHover5.ogg`. Press: squash, `ButtonDown2.ogg`/`ButtonUp4.ogg`, then a
  jump 8 px up over 0.1 s and squash/rotate. Disabled: `#6c6c6c`.
- **Skill nodes**: 16x16 9-patch frame `res://Sprites/SkillNode.png` tinted by state, dark
  fill, 14x14 icon inside; buying springs scale +0.4 and rotate 12° (`res://Scripts/Shop/UpgradeNode.gd`).
- **Upgrade tooltip** (`res://Scenes/UI/UpgradeDescription.tscn`): name, icon, centred
  description, `Lv. a / b`, cost panel `<icon> have / cost` tinted green (can buy) or red,
  or `MAX` on a yellow-ish panel.
- **Bars**: 9-patch `BarOutline/BarInner/BarFill.png`, under WHITE, over BG, fill colour per
  bar; health 10,10 76x12; XP 10,33 76x12; progress 3,261 474x6 (`res://GameScenes/BattleScene.tscn`).
- **Springs**: default scale spring stiffness 250, damping 12; rotate 600/14
  (`res://Scripts/Autoloads/Springer.gd`, integrator in `Spring.gd`, dt capped at 0.05).

## Battle visuals

- Reticle: CornerBox in BLUE plus a 4 px square dot (`Square32.png` × 0.125) at the cursor
  (`res://GameScenes/BattleScene.tscn`).
- Enemies: 128 px outline sprite + inner mask used as a progress fill for HP, tinted with the
  currency colour; boss rainbow hue from P18.
- Drops: 6x6 sprites tinted by currency.
- Background: 96-128 slowly pulsing grey circles (`BgParticles.tscn`: lifetime 10 s, scale
  0.1-0.2, box 480x270). The skill tree has two layers with parallax 0.1 and 0.2.
- Screen shake: camera offset noise, magnitude 3 px × setting (default 0.9), 0.3 s, 70 Hz,
  linear decay (`res://Scripts/MyCamera.gd`, `res://Scripts/Autoloads/Shaker.gd`).
- Particles: hit (6 lines, 0.4 s, radial 100-220 px/s), level up (12 yellow shards, 0.4 s,
  120-300 px/s). `PulseParticles.tscn` is preloaded but never spawned.
- Floating text ("LEVEL UP"): rises 15 px over 0.3 s, types in over 0.2 s, blinks, 0.4 s.

## Scene transitions

`res://Scripts/Effects/SceneTransition.gd`, `res://MainScene.tscn:432-460`

- In: `Transition2.png` (16 frames of 500x290, 28 fps ≈ 0.57 s) wipes in; after 0.2 s the
  centred text types in over 0.3 s (colour BG) while blinking every 0.04 s × 14; hold 0.4 s.
  `TransitionIn3.ogg`; BGM ducks to volume 0.7 / low-pass 500 Hz.
- Out: `Transition2Inverse.png` (16 frames, 28 fps) plays; `TransitionOut.ogg`.
- Tint: WHITE, or `#8f8f8f` with the "dark" setting.
- Texts: `INITIALIZING SESSION...`, `ENTERING HOME...`, `RETURNING TO MENU...`
  (`res://Scripts/MainScene.gd:49,87,106`).
- `Transition.png` / `TransitionInverse.png` are older unused versions.

## Main menu

`res://GameScenes/MainMenu.tscn`, `res://Scripts/MainMenu/MainMenu.gd`

- Title "nodebuster" (size 22) types one character per 0.1 s with a random `Type1-5.ogg`,
  then a 2x20 px WHITE cursor blinks every 0.5 s. A RED 32x32 square rotated 45° sits behind
  the title.
- Buttons in a row at y 178: "new game" (78x30), "continue" (78x30, green; only if a save
  exists), "options" (78x22, pink), "quit" (78x22, red); "credits" bottom-left.
- Credits popup: developer Goblobin (Steam curator link), music Holizna
  (`https://freemusicarchive.org/music/holiznacc0/`).

## Audio

### Buses (`res://default_bus_layout.tres`)

| Bus | Volume | Effects |
|---|---|---|
| Master | 0 dB (× setting, default 50%) | |
| SFX | −10.52 dB (× setting, default 100%) | |
| BGM | 0 dB (× setting, default 60%) | Low-pass filter, animated per scene |

### Music (`res://Scripts/Autoloads/BGM.gd`)

Nine CC0 tracks from HoliznaCC0, *Lofi And Chill* (03, 04, 05, 06, 07, 14, 16, 17, 24),
130-180 s each, played as a shuffled playlist that never repeats the last song first.
Volume/low-pass per context (0.5 s tweens; `res://Scripts/MainScene.gd:60,97,117`):

| Context | Volume | Low-pass |
|---|---:|---:|
| Boot | 0 → 1.0 (0.1 s) | 1000 Hz |
| Main menu | 1.0 | 1000 Hz |
| Shop / skill tree | 0.8 | 800 Hz |
| Battle | 1.0 | 5000 Hz |
| During a transition | 0.7 | 500 Hz |
| Ending | 0 over 10 s | 500 Hz |

### Sound effects (`res://Scripts/Autoloads/SFX.gd`)

50 pooled players on the SFX bus. Each sound has a 1-physics-frame cooldown (it won't
restart twice in one frame) and a random pitch of `1 ± range` (default ±0.05).

| Sound | File | Trigger (pitch range) |
|---|---|---|
| PULSE | Pulse.ogg | reticle attack, explosions, bolt burst |
| HIT | Hit2.ogg | each enemy hit by pulse, bolt or explosion (±0.2) |
| ELECTRICITY | Electricity.ogg | each lightning hop |
| PICKUP_START | PickupStart.ogg | drop picked up |
| PICKUP_RESOURCE | Pickup2.ogg | drop reaches cursor (±0.1) |
| LEVEL_UP | LevelUpJingle.ogg | level up (no pitch change) |
| WIN / LOSE | Win.ogg / Lose.ogg | end screen (Lose +2 dB) |
| TRANSITION_IN / OUT | TransitionIn3.ogg / TransitionOut.ogg | scene transitions |
| TYPE | Type1-5.ogg (random) | title typing, transition text |
| BUTTON_HOVER / DOWN / UP / CLICK | ButtonHover5 / ButtonDown2 / ButtonUp4 / ButtonOneClick | buttons, skill nodes, options, Escape menu |
| MOUSE_DOWN / UP | MouseDown / MouseUp | right-drag on the skill tree |
| PLINK | Plink3.ogg | Crypto Mine deposit |
| TICK | Tick3.ogg | Lab bar filling (pitch rises with tween time) |
| DEPLOYING / DEPLOYED | Deploying.ogg / Deployed.ogg | ending |
| (scene players) | Static, VoiceLoop, VCR, BackgroundNoise | ending (`res://Scenes/Ending.tscn`) |

Seventeen SFX files ship unused (older variants); see [assets.md](assets.md).
