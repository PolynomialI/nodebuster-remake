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
	apply_profile(s.get("profile", {}))
	var scene: String = s.scene
	if scene == "battle":
		await build_battle(s)
	elif scene == "menu":
		var m = await enter(load("res://GameScenes/MainMenu.tscn"))
		m.new_game.connect(func(): pass)
		m.continue_game.connect(func(): pass)
		m.setup()
		await frames(int(s.get("waitFrames", 150)))
		if not s.get("bgParticles", false):
			hide_particles(m)
	elif scene == "shop":
		await build_shop(s)
	await capture(s)

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
	if sp.has("treePos"):
		sh.upgrades_page.upgrade_tree.set_tree_pos(Vector2(sp.treePos[0], sp.treePos[1]))
	if sp.has("page"):
		sh.set_page(int(sp.page))
	if not s.get("bgParticles", false):
		hide_particles(sh)
	if sp.has("hover"):
		for c in sh.upgrades_page.upgrade_tree.get_children():
			if c is UpgradeNode and c.upgrade.id == sp.hover:
				Refs.upgrade_description.show_upgrade_node(c)
	await frames(int(sp.get("waitFrames", 60)))

# ---------------------------------------------------------------- output

func set_crt_time(t: float) -> void:
	Refs.crt.material.set_shader_parameter("capture_time", t)

func capture(s: Dictionary) -> void:
	var name: String = s.name
	set_crt_time(float(s.get("time", 1.0)))
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
