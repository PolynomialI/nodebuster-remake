# Settings

Options menu, in on-screen order (`res://Scenes/Popups/Options/OptionsPopup.tscn`). Defaults
from `res://Scripts/Autoloads/OptionData.gd:8-20`, effects from `apply_option` in the same
file. JSON: [data/settings.json](data/settings.json).

| Label | id | Control | Default | Effect |
|---|---|---|---|---|
| window_size | `window_size` | list: fullscreen, 480x270, 960x540, … up to the screen size | fullscreen | exclusive fullscreen, or a centred window of 480n × 270n |
| v-sync | `vsync` | on / off | on | |
| screen_shake | `screenshake` | slider 0-100 | 90 | camera shake magnitude × value/100 |
| crt_effect | `crt_effect` | on / off | on | shows/hides the CRT overlay; glow intensity 1.8 on, 0.9 off |
| transition_color | `transition_color` | white / dark | white | transition wipe `#dcdcdc` or `#8f8f8f` |
| flashing_fx | `flashing_fx` | on / off | on | white flash on enemy hit and kill impact |
| color_palette | `color_palette` | default / alternate | default | skill node outlines yellow/green/red → violet/green/dark red |
| master_vol | `master_volume` | slider 0-100 | 50 | Master bus, `linear_to_db(v/100)` |
| bgm_vol | `bgm_volume` | slider 0-100 | 60 | BGM bus |
| sfx_vol | `sfx_volume` | slider 0-100 | 100 | SFX bus |

- A 16 px spacer separates the volume sliders from the rest.
- Every change is applied and written to `user://options.dat` at once.
- Reached from the main menu ("options") or the shop's Escape menu ("main menu", "options",
  "back"). Popups slide up from below over 0.15 s on a 47% black backdrop
  (`res://Scripts/Popups/PopupManager.gd`).
- Controls (`res://project.godot` input map): mouse only in battle; in the skill tree,
  right-drag or WASD / arrow keys to pan, mouse wheel to zoom, Escape for the menu.
- For the browser remake: `window_size` and `vsync` have no direct equivalent (the iframe
  sets the size; browsers always vsync), so they can map to a fullscreen toggle or be dropped.
