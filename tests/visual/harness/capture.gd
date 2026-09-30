extends Node
# Reference capture harness for the original game (runs inside a patched copy of
# the recovered project, see scripts/make-harness.mjs). Builds each scenario from
# tests/visual/scenarios.json with the game's own scenes and saves:
#   <name>.raw.png   the 480x270 game viewport (no post-processing)
#   <name>.crt.png   the 1440x810 window with CRT + glow
#   <name>.nocrt.png the window with the CRT option off

var out_dir := ""
var list_path := ""

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--scenarios="):
			list_path = a.substr(12)
		elif a.begins_with("--out="):
			out_dir = a.substr(6)
	run.call_deferred()

func frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame

func run() -> void:
	var f := FileAccess.open(list_path, FileAccess.READ)
	var scenarios: Array = JSON.parse_string(f.get_as_text())
	await frames(20)
	# Park the mouse where no scenario has UI, so nothing is hovered by accident.
	Input.warp_mouse(Vector2(1437, 600))
	for s in scenarios:
		if s.has("only") and not s.only.has("godot"):
			continue
		await run_scenario(s)
	get_tree().quit()

# ---------------------------------------------------------------- state

func apply_profile(p: Dictionary) -> void:
	State.reset()
	for k in p:
		if k in ["upgrades", "milestones", "nums", "crypto_mine", "achievements", "version"]:
			continue
		State.set(k, p[k])
	if p.has("nums"):
		for k in p.nums:
			State.nums.set(k, p.nums[k])
	if p.has("crypto_mine"):
		State.crypto_mine.mine_level = p.crypto_mine.get("mine_level", 0)
		State.crypto_mine.curr_bits = p.crypto_mine.get("curr_bits", 0)
		State.crypto_mine.calculate_speed()
	var levels := {}
	if p.has("upgrades"):
		for id in p.upgrades:
			levels[id] = int(p.upgrades[id])
	UpgradeStore.load_save(levels)
	var ms := {}
	if p.has("milestones"):
		ms = p.milestones
	MilestoneStore.load_save(ms)

func enter(packed: PackedScene) -> Node:
	var main = Refs.main_scn
	if main.curr_scn:
		main.curr_scn.queue_free()
	await get_tree().process_frame
	var scn = packed.instantiate()
	main.root.add_child(scn)
	Refs.curr_scn = scn
	main.curr_scn = scn
	return scn

func hide_particles(node: Node) -> void:
	for c in node.get_children():
		if c is GPUParticles2D:
			c.hide()
		hide_particles(c)

# ---------------------------------------------------------------- scenes

func run_scenario(s: Dictionary) -> void:
	Refs.popups.clear_popups()
	Globals.mouse_locks.clear()
	Globals.mouse_blocker.hide()
	apply_profile(s.get("profile", {}))
	# Freeze the Crypto Mine so both engines show the same numbers.
	State.crypto_mine.processing = false
	var opts: Dictionary = s.get("options", {})
	for k in ["color_palette", "flashing_fx", "transition_color"]:
		OptionData.apply_option(k, opts.get(k, 0))
	var scene: String = s.scene
	if scene == "battle":
		await build_battle(s)
	elif scene == "menu":
		# "continue" shows only when a save exists.
		if s.get("hasSave", false):
			Saver.save_game()
		else:
			DirAccess.remove_absolute(Saver.path)
		var m = await enter(load("res://GameScenes/MainMenu.tscn"))
		m.new_game.connect(func(): pass)
		m.continue_game.connect(func(): pass)
		m.setup()
		if not s.get("bgParticles", false):
			hide_particles(m)
		var popup: String = s.get("popup", "")
		if popup == "options":
			Refs.popups.add_popup(Refs._options.instantiate())
			Refs.popups.focus_curr()
		elif popup == "credits":
			Refs.popups.add_popup(load("res://Scenes/Popups/CreditsPopup.tscn").instantiate())
			Refs.popups.focus_curr()
		await frames(int(s.get("waitFrames", 150)))
	elif scene == "shop":
		await build_shop(s)
	elif scene == "probe":
		await build_probe(s)
	if s.has("transition"):
		var tr = Refs.scene_transition
		var spec: Dictionary = s.transition
		tr.transition_in(spec.text)
		if spec.has("outAfter"):
			await frames(int(spec.outAfter))
			tr.transition_out()
		var tdone := 0
		for f in spec.frames:
			await frames(int(f) - tdone)
			tdone = int(f)
			var s3 := s.duplicate()
			s3.name = s.name + "_f" + str(int(f))
			await capture(s3, false)
		if not spec.has("outAfter"):
			await frames(90)
			tr.transition_out()
		await frames(60)
		return
	if s.has("ending"):
		var sh = Refs.curr_scn
		sh.get_node("%LabPage")._on_deploy_virus_pressed()
		var done := 0
		for f in s.ending.frames:
			await frames(int(f) - done)
			done = int(f)
			var s2 := s.duplicate()
			s2.name = s.name + "_f" + str(int(f))
			await capture(s2, false)
		return
	await capture(s)
	if scene == "probe":
		restore_glow()

func build_battle(s: Dictionary) -> void:
	var b: Dictionary = s.battle
	var bs = await enter(load("res://GameScenes/BattleScene.tscn"))
	await frames(2)
	var spawner = Refs.enemy_spawner
	spawner.set_process(false)
	for c in spawner.get_children():
		c.queue_free()
	for c in bs.get_children():
		if c is MovingPulser:
			c.queue_free()
	await frames(1)
	bs.set_process(false)
	var cursor = bs.player_cursor
	cursor.set_process(false)
	cursor.set_physics_process(false)
	cursor.global_position = Vector2(b.cursor[0], b.cursor[1])
	if b.has("hp"):
		Refs.health.value = b.hp
	if b.has("xp"):
		Refs.xp.value = b.xp
		Refs.xp.update_ui()
	if b.has("progress"):
		bs.progress_bar.value = b.progress
	var scenes := {"Square": spawner._square, "SmallSquare": spawner._square, "BigSquare": spawner._square, "Exploder": spawner._circle, "Pill": spawner._pill, "Pentagon": spawner._pentagon, "PentagonSmall": spawner._pentagon, "Spiky": spawner._spiky, "Boss": spawner._square}
	var types := {"bits": ResourceType.BITS, "nodes": ResourceType.NODES, "processors": ResourceType.PROCESSORS, "cores": ResourceType.CORES, "sp": ResourceType.SP, "netcoin": ResourceType.NETCOIN}
	for e in b.get("enemies", []):
		var en = spawner._create_enemy(scenes[e.type], types[e.currency], 100.0, 1.0, 0.0, 0.0, e.scale)
		en.global_position = Vector2(e.x, e.y)
		en.rotation_degrees = e.rot
		en.curr_health = 100.0 * e.hp
		en.update_bar()
		en.set_physics_process(false)
		en.set_process(false)
	for d in b.get("drops", []):
		Refs.drop_creator.create_drop(Vector2(d.x, d.y), types[d.currency])
	if not s.get("bgParticles", false):
		hide_particles(bs)
	if b.has("end"):
		var e: Dictionary = b.end
		var drops := {}
		for k in e.get("collected", {}):
			drops[types[k]] = int(e.collected[k])
		bs.collected_drops = drops
		bs.battle_over = true
		bs.create_battle_end_screen(int(e.status))
		await frames(int(e.get("waitFrames", 60)))
	await frames(4)

func build_shop(s: Dictionary) -> void:
	var sh = await enter(load("res://GameScenes/ShopScene.tscn"))
	await frames(2)
	var sp: Dictionary = s.get("shop", {})
	var tree = sh.get_node("%UpgradeTree")
	if sp.has("treePos"):
		tree.set_tree_pos(Vector2(sp.treePos[0], sp.treePos[1]))
	if sp.has("page"):
		sh.set_page(int(sp.page))
	if not s.get("bgParticles", false):
		hide_particles(sh)
	if sp.has("popup") and sp.popup == "prestige":
		var pp = load("res://Scenes/Popups/PrestigePicker.tscn").instantiate()
		Refs.popups.add_popup(pp)
		pp.setup()
		Refs.popups.focus_curr()
	if sp.has("hover"):
		for c in tree.get_children():
			if c is UpgradeNode and c.upgrade.id == sp.hover:
				Refs.upgrade_description.show_upgrade_node(c)
	await frames(int(sp.get("waitFrames", 60)))

# ---------------------------------------------------------------- output

# A blank canvas with test rectangles and glow overrides, to measure the
# renderer's glow (levels, kernels, quantization) independently of the game.
func build_probe(s: Dictionary) -> void:
	var main = Refs.main_scn
	if main.curr_scn:
		main.curr_scn.queue_free()
	await get_tree().process_frame
	var scn := Node2D.new()
	main.root.add_child(scn)
	main.curr_scn = null
	Refs.curr_scn = scn
	var p: Dictionary = s.probe
	var bg := ColorRect.new()
	bg.size = Vector2(480, 270)
	bg.color = Color.html(p.get("bg", "#000000"))
	scn.add_child(bg)
	for l in p.get("labels", []):
		var lb := Label.new()
		lb.position = Vector2(l[0], l[1])
		lb.text = l[2]
		lb.add_theme_color_override("font_color", Color.html(l[3] if l.size() > 3 else "#dcdcdc"))
		scn.add_child(lb)
	for r in p.get("rects", []):
		var c := ColorRect.new()
		c.position = Vector2(r[0], r[1])
		c.size = Vector2(r[2], r[3])
		c.color = Color.html(r[4] if r.size() > 4 else "#ffffff")
		scn.add_child(c)
	var env: Environment = Refs.world_env.environment
	var levels: Array = p.get("levels", [0, 0, 1, 0, 1, 0, 0])
	for i in 7:
		env.set_glow_level(i, float(levels[i]))
	env.glow_normalized = bool(p.get("normalized", true))
	env.glow_intensity = float(p.get("intensity", 1.8))
	await frames(4)

func restore_glow() -> void:
	var env: Environment = Refs.world_env.environment
	var d := [0, 0, 1, 0, 1, 0, 0]
	for i in 7:
		env.set_glow_level(i, float(d[i]))
	env.glow_normalized = true
	env.glow_intensity = 1.8

func set_crt_time(t: float) -> void:
	Refs.crt.material.set_shader_parameter("capture_time", t)

func capture(s: Dictionary, settle: bool = true) -> void:
	var name: String = s.name
	set_crt_time(float(s.get("time", 1.0)))
	if settle:
		await frames(2)
	await RenderingServer.frame_post_draw
	Refs.viewport.get_texture().get_image().save_png(out_dir + "/" + name + ".raw.png")
	get_viewport().get_texture().get_image().save_png(out_dir + "/" + name + ".crt.png")
	# Glow off: the pure 480x270 image (geometry and palette only).
	Refs.world_env.environment.glow_enabled = false
	await frames(2)
	await RenderingServer.frame_post_draw
	Refs.viewport.get_texture().get_image().save_png(out_dir + "/" + name + ".rawng.png")
	Refs.world_env.environment.glow_enabled = true
	await frames(2)
	OptionData.apply_option("crt_effect", 1)
	await frames(2)
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(out_dir + "/" + name + ".nocrt.png")
	OptionData.apply_option("crt_effect", 0)
	set_crt_time(-1.0)
	print("captured ", name)
