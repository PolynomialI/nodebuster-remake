// Builds reference/harness/ (gitignored): a copy of the recovered project that
// runs without Steam and saves reference captures of scenarios, then runs it.
//
//   node scripts/make-harness.mjs            # build harness + capture all scenarios
//   node scripts/make-harness.mjs --no-run   # only build the harness
//   node scripts/make-harness.mjs --list tests/visual/probes.json --out reference/probes
//
// Patches (harness copy only):
// - MySteam.gd: no Steam init/ownership check (the original quits without Steam).
// - project.godot: own user folder "NodebusterHarness" (never touches the real save),
//   windowed 1440x810, Capture autoload.
// - CRTShader.gdshader: optional fixed time (capture_time) so time-based effects match.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'reference', 'extracted');
const dst = join(root, 'reference', 'harness');
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const out = resolve(root, arg('--out') ?? join('reference', 'captures'));
const godot = join(root, '.tools', 'godot', 'Godot_v4.2.2-stable_win64_console.exe');

if (!existsSync(dst)) {
  cpSync(src, dst, { recursive: true });
  console.log('copied project to reference/harness');
}

writeFileSync(
  join(dst, 'Scripts/Autoloads/MySteam.gd'),
  'extends Node\n# Harness stub: no Steam.\nfunc set_achievement(_id: String, _store_stats: bool = true) -> void:\n\tpass\n',
);

let proj = readFileSync(join(src, 'project.godot'), 'utf8');
proj = proj.replace('config/use_custom_user_dir=true', 'config/use_custom_user_dir=true\nconfig/custom_user_dir_name="NodebusterHarness"');
proj = proj.replace('MySteam="*res://Scripts/Autoloads/MySteam.gd"', 'MySteam="*res://Scripts/Autoloads/MySteam.gd"\nCapture="*res://capture.gd"');
writeFileSync(join(dst, 'project.godot'), proj);
cpSync(join(root, 'tests', 'visual', 'harness', 'capture.gd'), join(dst, 'capture.gd'));

// Steam.storeStats() is called directly in two places; without Steam it is a no-op.
let crt = readFileSync(join(src, 'Shaders/CRTShader.gdshader'), 'utf8');
crt = crt.replace('uniform float bloomRadius', 'uniform float capture_time = -1.0;\nuniform float bloomRadius');
crt = crt.replace('void fragment()\n{', 'void fragment()\n{\n\tfloat T = capture_time >= 0.0 ? capture_time : TIME;');
crt = crt.replace(/\bTIME\b(?!;)/g, (m, off, s) => (s.slice(off - 30, off).includes('capture_time : ') ? m : 'T'));
writeFileSync(join(dst, 'Shaders/CRTShader.gdshader'), crt);

// Options for the harness user folder: 1440x810 window, CRT on, flashing on.
const appdata = process.env.APPDATA ?? join(process.env.HOME ?? '', '.local', 'share');
const userDir = join(appdata, 'NodebusterHarness');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'options.dat'),
  '{\n"bgm_volume": 0,\n"color_palette": 0,\n"crt_effect": 0,\n"flashing_fx": 0,\n"master_volume": 0,\n"screenshake": 90,\n"sfx_volume": 0,\n"transition_color": 0,\n"version": 0,\n"vsync": 0,\n"window_size": 3\n}\n',
);
rmSync(join(userDir, 'save.dat'), { force: true });

if (process.argv.includes('--no-run')) process.exit(0);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const scen = resolve(root, arg('--list') ?? join('tests', 'visual', 'scenarios.json'));
const r = spawnSync(godot, ['--path', dst, '--fixed-fps', '60', '--', `--scenarios=${scen}`, `--out=${out}`], { stdio: 'inherit', timeout: 600_000 });
if (r.status !== 0) {
  console.error(`Godot exited with ${r.status}`);
  process.exit(1);
}
console.log(`captures in ${out}`);
