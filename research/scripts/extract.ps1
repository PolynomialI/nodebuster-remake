# Regenerates research/data/*.json and research/skill-tree.md from the recovered project.
#
#   powershell -ExecutionPolicy Bypass -File research/scripts/extract.ps1
#
# Input:  reference/extracted/  (GDRE Tools v2.6.4 --recover of reference/game/Nodebuster.pck)
#         research/sources/     (snapshots of the Steam guide and the community spreadsheet)
# Output: research/data/*.json, research/skill-tree.md, research/cross-check.md
#
# Every value carries a "src" of the form "res://<path>:<line>". res:// maps to
# reference/extracted/.
param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference = 'Stop'
$X   = Join-Path $Root 'reference\extracted'
$Out = Join-Path $Root 'research\data'
$Res = Join-Path $Root 'research'
$Inv = [Globalization.CultureInfo]::InvariantCulture
$Utf8 = New-Object Text.UTF8Encoding $false

function ReadLines($rel) { [IO.File]::ReadAllLines((Join-Path $X $rel), $Utf8) }
function Ref($rel, $line) { "res://$($rel -replace '\\','/'):$line" }
function Num($s) {
    $s = $s.Trim().TrimEnd(',')
    $d = [double]::Parse($s, $Inv)
    if ($d -eq [math]::Floor($d) -and [math]::Abs($d) -lt 1e15) { return [long]$d }
    return $d
}
function WriteText($path, $text) { [IO.File]::WriteAllText($path, $text, $Utf8) }
# Ref to the first line of $rel matching $pat (throws if none), so cited line numbers can't drift.
function At($rel, $pat) {
    $lines = ReadLines $rel
    for ($i = 0; $i -lt $lines.Length; $i++) { if ($lines[$i] -match $pat) { return Ref $rel ($i + 1) } }
    throw "At: /$pat/ not found in $rel"
}
# Minimal JSON writer: 2-space indent, arrays of scalars on one line.
# (ConvertTo-Json in PowerShell 5.1 pads heavily and escapes < > ' as \u00xx.)
function JsonStr($s) {
    $e = $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
    return '"' + $e + '"'
}
function ToJson($v, $ind) {
    if ($null -eq $v) { return 'null' }
    if ($v -is [bool]) { return $(if ($v) { 'true' } else { 'false' }) }
    if ($v -is [string]) { return JsonStr $v }
    if ($v -is [double] -or $v -is [single]) { return ([double]$v).ToString('R', $Inv) }
    if ($v -is [int] -or $v -is [long]) { return $v.ToString($Inv) }
    $pad = '  ' * ($ind + 1); $end = '  ' * $ind
    if ($v -is [Collections.IDictionary]) {
        if ($v.Count -eq 0) { return '{}' }
        $parts = foreach ($k in $v.Keys) { $pad + (JsonStr "$k") + ': ' + (ToJson $v[$k] ($ind + 1)) }
        return "{`n" + ($parts -join ",`n") + "`n$end}"
    }
    if ($v -is [Collections.IEnumerable]) {
        $items = @($v)
        if ($items.Count -eq 0) { return '[]' }
        $scalar = -not ($items | Where-Object { $_ -is [Collections.IDictionary] -or ($_ -is [Collections.IEnumerable] -and $_ -isnot [string]) })
        if ($scalar) { return '[' + (($items | ForEach-Object { ToJson $_ 0 }) -join ', ') + ']' }
        $parts = foreach ($it in $items) { $pad + (ToJson $it ($ind + 1)) }
        return "[`n" + ($parts -join ",`n") + "`n$end]"
    }
    return JsonStr "$v"
}
function WriteJson($name, $obj) {
    WriteText (Join-Path $Out $name) ((ToJson $obj 0) + "`n")
}
# Lines of a GDScript function body (from "func name" to the next top-level func).
function FuncRange($lines, $name) {
    $s = -1
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match "^func $name\(") { $s = $i; continue }
        if ($s -ge 0 -and $lines[$i] -match '^func ') { return @($s, $i) }
    }
    return @($s, $lines.Length)
}
function Code($s) { '`' + $s + '`' }
function CodeList($items) { if (@($items).Count) { (@($items) | ForEach-Object { Code $_ }) -join ', ' } else { 'none' } }
function FmtNum($v) {
    $d = [double]$v
    if ($d -eq [math]::Floor($d)) { return $d.ToString('N0', $Inv) }
    return $d.ToString('0.#####', $Inv)
}

$currencyNames = @{ bits = 'Bits'; nodes = 'Nodes'; cores = 'Cores'; sp = 'SP'; netcoin = 'Netcoin'; processors = 'Processors' }

# ---------------------------------------------------------------- upgrades
$relStore = 'Scripts/Autoloads/Stores/UpgradeStore.gd'
$StoreLines = ReadLines $relStore
$upgrades = [ordered]@{}
for ($i = 0; $i -lt $StoreLines.Length; $i++) {
    if ($StoreLines[$i] -notmatch 'Upgrade\.new\(\{') { continue }
    $u = [ordered]@{}; $costLine = 0; $costText = ''
    $j = $i + 1
    while ($StoreLines[$j] -notmatch '^\s*\}\),') {
        $ln = $StoreLines[$j]
        if ($ln -match '"id":\s*"([^"]+)"') { $u.id = $Matches[1]; $u.src = Ref $relStore ($j + 1) }
        elseif ($ln -match '"name":\s*"([^"]*)"') { $u.name = $Matches[1] }
        elseif ($ln -match '"description":\s*"([^"]*)"') { $u.description = $Matches[1] }
        elseif ($ln -match 'ResourceType\.(\w+)') { $u.currency = $Matches[1].ToLower() }
        elseif ($ln -match '"costs":') { $costLine = $j + 1; $costText = $ln }
        elseif ($costLine) { $costText += $ln }
        $j++
    }
    $null = $costText -match '\[(.*)\]'
    $u.costs = @($Matches[1].Split(',') | Where-Object { $_.Trim() } | ForEach-Object { Num $_ })
    $u.costsSrc = Ref $relStore $costLine
    $u.maxLevel = $u.costs.Count
    $sum = 0.0; foreach ($c in $u.costs) { $sum += $c }
    $u.totalCost = Num ([math]::Round($sum, 6).ToString($Inv))
    $upgrades[$u.id] = $u
    $i = $j
}

# effects: UpgradeProcessor.gain_upgrade
$relProc = 'Scripts/Upgrades/UpgradeProcessor.gd'
$ProcLines = ReadLines $relProc
$r = FuncRange $ProcLines 'gain_upgrade'
$cur = $null
for ($i = $r[0]; $i -lt $r[1]; $i++) {
    $ln = $ProcLines[$i]
    if ($ln -match '^\t\t"(\w+)":') { $cur = $upgrades[$Matches[1]]; $cur.effects = @(); $cur.sideEffects = @(); continue }
    if (-not $cur) { continue }
    if ($ln -match 'State\.stats\.(\w+)\s*(\+=|=)\s*(.+?)\s*$') {
        $val = $Matches[3]
        $v = if ($val -eq 'true') { $true } else { Num $val }
        $op = if ($Matches[2] -eq '+=') { 'add' } else { 'set' }
        $cur.effects += , ([ordered]@{ stat = $Matches[1]; op = $op; perLevel = $v; src = Ref $relProc ($i + 1) })
    }
    elseif ($ln -match 'set_achievement\("(\w+)"') { $cur.sideEffects += "steam achievement $($Matches[1]) ($(Ref $relProc ($i + 1)))" }
    elseif ($ln -match 'show_(\w+)_btn') { $cur.sideEffects += "shows the $($Matches[1]) tab button ($(Ref $relProc ($i + 1)))" }
}

# prerequisites: UpgradeProcessor.check_upgrade_unlocked
$r = FuncRange $ProcLines 'check_upgrade_unlocked'
for ($i = $r[0]; $i -lt $r[1]; $i++) {
    if ($ProcLines[$i] -notmatch '^\t\t"(\w+)":') { continue }
    $u = $upgrades[$Matches[1]]
    $expr = ($ProcLines[$i + 1] -replace '^\s*return\s*', '').Trim()
    $join = if ($expr -match ' or ') { 'any' } else { 'all' }
    $reqs = @()
    foreach ($term in ($expr -split ' or | and ')) {
        if ($term -match 'connected\["(\w+)"\]\s*>\s*0') { $reqs += , ([ordered]@{ id = $Matches[1]; level = 1 }) }
        elseif ($term -match 'connected\["(\w+)"\]\s*>=\s*max\["\w+"\]') { $reqs += , ([ordered]@{ id = $Matches[1]; level = 'max' }) }
        else { throw "Unparsed prerequisite: $term" }
    }
    $u.requires = [ordered]@{ mode = $join; nodes = $reqs; expr = $expr; src = Ref $relProc ($i + 2) }
}

# positions + connections: GameScenes/ShopScene.tscn
$relShop = 'GameScenes/ShopScene.tscn'
$ShopLines = ReadLines $relShop
$sceneNodes = @{}   # scene node name -> info
for ($i = 0; $i -lt $ShopLines.Length; $i++) {
    if ($ShopLines[$i] -notmatch '^\[node name="(\d+)" parent="UpgradesPage/UpgradeTree"') { continue }
    $n = [ordered]@{ node = $Matches[1]; line = $i + 1; links = @() }
    $j = $i + 1
    while ($j -lt $ShopLines.Length -and $ShopLines[$j] -notmatch '^\[') {
        if ($ShopLines[$j] -match '^offset_(left|top|right|bottom) = (.+)$') { $n[$Matches[1]] = [int](Num $Matches[2]) }
        elseif ($ShopLines[$j] -match '^upgrade_id = "(\w+)"') { $n.id = $Matches[1] }
        elseif ($ShopLines[$j] -match '^connected_nodes = ') { $n.links = @([regex]::Matches($ShopLines[$j], 'NodePath\("\.\./(\d+)"\)') | ForEach-Object { $_.Groups[1].Value }) }
        $j++
    }
    $sceneNodes[$n.node] = $n
}
$edges = @{}
foreach ($n in $sceneNodes.Values) {
    foreach ($l in $n.links) {
        $a = $n.id; $b = $sceneNodes[$l].id
        $key = (@($a, $b) | Sort-Object) -join '|'
        $edges[$key] = $true
    }
}
$origin = $sceneNodes.Values | Where-Object { $_.id -eq 'Damage1' }
$ox = ($origin.left + $origin.right) / 2; $oy = ($origin.top + $origin.bottom) / 2
foreach ($n in $sceneNodes.Values) {
    $u = $upgrades[$n.id]
    $cx = ($n.left + $n.right) / 2; $cy = ($n.top + $n.bottom) / 2
    $u.position = [ordered]@{
        rect = @($n.left, $n.top, ($n.right - $n.left), ($n.bottom - $n.top))
        center = @($cx, $cy)
        grid = @((($cx - $ox) / 32), (($cy - $oy) / 32))
        sceneNode = $n.node
        src = Ref $relShop $n.line
    }
    $u.neighbors = @($edges.Keys | ForEach-Object { $p = $_.Split('|'); if ($p[0] -eq $n.id) { $p[1] } elseif ($p[1] -eq $n.id) { $p[0] } } | Sort-Object)
}

# icons
foreach ($u in $upgrades.Values) {
    $rel = "Sprites/UpgradeIcons/$($u.id).png"
    $u.icon = if (Test-Path (Join-Path $X $rel)) { "res://$rel" } else { $null }
    if (-not $u.Contains('requires')) { $u.requires = $null }
    if (-not $u.Contains('effects')) { $u.effects = @() }
    if (-not $u.Contains('sideEffects')) { $u.sideEffects = @() }
}

# Sanity: every prerequisite must be a scene neighbour (the game indexes connected[] by it).
foreach ($u in $upgrades.Values) {
    if (-not $u.requires) { continue }
    foreach ($q in $u.requires.nodes) { if ($u.neighbors -notcontains $q.id) { throw "$($u.id) requires non-neighbour $($q.id)" } }
}

# Notes where the in-game text and the code disagree, or where the code is surprising.
# Each was checked by hand against the cited lines.
$notes = @{
    'SpawnRate2'   = 'Description says +200% spawn rate; code adds 2.5 to spawn_rate_mod (+250%).'
    'Size3'        = 'Description says +100% attack size; code adds 1.0 to player_size (base 34 px), not to player_size_mod. Each level widens the reticle by 1 px x (1 + player_size_mod). Likely a bug in the original; reproduce as coded.'
    'PulseBolts'   = 'Grants 3 pulse bolts per attack (pulse_bolt_count += 3).'
    'PickupRadius1'= '+8 px pickup radius per level (base 16 px), i.e. +50% of base, additive.'
    'StealMaxHealth2' = 'Adds +2 (total with unending parasite = 3), matching the description''s "to +3".'
    'StealMaxHealth3' = 'Adds +5 (total = 8), matching the description''s "to +8".'
    'Infinity1'    = 'Description "???". Code: spawn_rate_mod += 10.0 and perma_max_health_on_kill += 12.'
    'Health4'      = 'Level-6 cost is 0.012 while every other level is 0.01 (as shipped).'
    'YellowSpawn1' = 'yellow_enemy_chance += 0.001 (0.1% per spawn).'
    'YellowSpawn2' = 'yellow_enemy_chance += 0.004 (total 0.5% per spawn).'
    'Lifesteal3'   = 'Heals 1% of max health per enemy hit (max_health_on_hit).'
    'Laboratory'   = 'Costs 1 Bit. Unlocked by buying Infinity9 (singularity).'
    'BossDamage1'  = 'Boss multiplier is applied to the shared damage variable inside the per-enemy loop, so once a boss is hit, later enemies in the same pulse also take the boosted damage (res://Scripts/Player/PlayerCursor.gd:53-54, res://Scripts/Autoloads/Globals.gd:51-52).'
    'MovingPulser1'= 'Each level adds one drone (auto_pulser_count += 1).'
    'ExplodersChance' = 'Exploder weight is taken from the Square weight each session (res://Scripts/Battle/BattleScene.gd:356-358).'
}
foreach ($id in 2..9) { $notes["Infinity$id"] = 'Description "???". No effect in code (no case in gain_upgrade); acts only as a path to the next node.' }
foreach ($u in $upgrades.Values) { $u.notes = if ($notes.ContainsKey($u.id)) { $notes[$u.id] } else { $null } }

# Order keys the same way for every node.
$keys = 'id', 'name', 'description', 'currency', 'costs', 'maxLevel', 'totalCost', 'effects', 'sideEffects', 'requires', 'position', 'neighbors', 'icon', 'notes', 'src', 'costsSrc'
$upList = @(foreach ($u in $upgrades.Values) { $o = [ordered]@{}; foreach ($k in $keys) { $o[$k] = $null; if ($u.Contains($k)) { $o[$k] = $u[$k] } }; $o })
$edgeList = @($edges.Keys | Sort-Object | ForEach-Object { , ($_.Split('|')) })
WriteJson 'upgrades.json' ([ordered]@{
    source = 'Nodebuster.pck recovered with GDRE Tools v2.6.4 (engine 4.2.2)'
    semantics = [ordered]@{
        cost = 'costs[i] is the price of going from level i to i+1 (res://Scripts/Upgrades/Upgrade.gd:31-33). maxLevel = costs.length.'
        effects = 'Applied once per level bought (res://Scripts/Shop/UpgradeTree.gd:97-98; on load, per saved level: res://Scripts/Autoloads/Stores/UpgradeStore.gd:716-717). op add = stat += perLevel; op set = stat = value.'
        requires = 'Node is visible and buyable only when the rule holds, evaluated over scene neighbours. level 1 = neighbour has >= 1 level; level "max" = neighbour is maxed. mode any = OR, all = AND. requires null = always visible (root). (res://Scripts/Upgrades/UpgradeProcessor.gd:197-399, res://Scripts/Shop/UpgradeTree.gd:66-67)'
        position = 'rect = [x, y, w, h] in tree-local pixels (Control offsets, res://GameScenes/ShopScene.tscn). grid = centre relative to Damage1 in 32 px steps (x right, y down).'
        neighbors = 'Undirected edges drawn as 1 px lines in MyColors.WHITE (res://Scripts/Shop/UpgradeTree.gd:34-51).'
    }
    nodeCount = $upList.Count
    edges = $edgeList
    nodes = $upList
})

# ---------------------------------------------------------------- player base stats
$relStats = 'Scripts/Systems/Stats.gd'
$T = ReadLines $relStats
$stats = [ordered]@{}
for ($i = 0; $i -lt $T.Length; $i++) {
    if ($T[$i] -match '^var (\w+): (\w+) = (.+)$') {
        $v = switch ($Matches[3]) { 'true' { $true } 'false' { $false } default { Num $Matches[3] } }
        $stats[$Matches[1]] = [ordered]@{ value = $v; type = $Matches[2]; src = Ref $relStats ($i + 1) }
    }
}
WriteJson 'player-stats.json' ([ordered]@{
    note = 'Base values before upgrades (class Stats, rebuilt from upgrade levels on load; not saved). max_health shown in-battle = max_health + State.bonus_max_health (res://Scripts/Systems/Stats.gd:32-33).'
    stats = $stats
})

# ---------------------------------------------------------------- prestige
$relBattle = 'Scripts/Battle/BattleScene.gd'
$BattleLines = ReadLines $relBattle
$r = FuncRange $BattleLines 'setup_prestige'
$branches = [ordered]@{}; $overrides = [ordered]@{}; $key = $null; $phase = 1; $inRates = $false
for ($i = $r[0]; $i -lt $r[1]; $i++) {
    $ln = $BattleLines[$i]
    if ($ln -match '^\t(if|elif) State\.curr_prestige == (\d+):') {
        if ($Matches[1] -eq 'if' -and $branches.Count -gt 0) { $phase = 2 }
        $key = $Matches[2]
        $target = if ($phase -eq 1) { $branches } else { $overrides }
        if ($target.Contains($key)) { $key = "$key-duplicate" }
        $target[$key] = [ordered]@{ src = Ref $relBattle ($i + 1) }
        continue
    }
    if ($ln -match '^\telse:') { $key = 'else'; $branches[$key] = [ordered]@{ src = Ref $relBattle ($i + 1) }; continue }
    if ($ln -match '^\tif State\.stats\.exploder') { break }
    if (-not $key) { continue }
    $target = if ($phase -eq 1) { $branches[$key] } else { $overrides[$key] }
    if ($ln -match 'set_spawn_rates\(\{') { $inRates = $true; $target.spawn_weights = [ordered]@{}; continue }
    if ($inRates) {
        if ($ln -match '"(\w+)":\s*([\d.]+)') { $target.spawn_weights[$Matches[1]] = Num $Matches[2] }
        if ($ln -match '\}\)') { $inRates = $false }
        continue
    }
    if ($ln -match '^\t\t(?:s\.)?(\w+) = ([\d.]+)') { $target[$Matches[1]] = [ordered]@{ value = (Num $Matches[2]); src = Ref $relBattle ($i + 1) } }
}
$fields = 'enemy_base_health', 'enemy_health_growth_per_sec', 'enemy_base_damage', 'enemy_damage_growth_per_sec', 'boss_health', 'boss_damage', 'enemy_xp', 'bit_boost', 'node_boost', 'bit_value', 'health_loss_per_sec', 'enemy_speed_mod'
$defaults = @{ bit_value = [ordered]@{ value = 1; src = At 'Scripts/Battle/EnemySpawner.gd' '^var bit_value' }; node_boost = [ordered]@{ value = 0; src = "default int 0 ($(At 'Scripts/Battle/EnemySpawner.gd' '^var node_boost'))" } }
$prestige = @()
foreach ($lvl in 0..25) {
    $b = if ($branches.Contains("$lvl")) { $branches["$lvl"] } else { $branches['else'] }
    $row = [ordered]@{ prestige = $lvl; branch = $b.src }
    foreach ($f in $fields) {
        $e = $null
        if ($overrides.Contains("$lvl") -and $overrides["$lvl"].Contains($f)) { $e = $overrides["$lvl"][$f] }
        elseif ($b.Contains($f)) { $e = $b[$f] }
        else { $e = $defaults[$f] }
        $row[$f] = $e
    }
    $row.spawn_weights = $b.spawn_weights
    $row.boss_rainbow = [ordered]@{ value = ($lvl -ge 18); src = At 'Scripts/Battle/EnemySpawner.gd' 'curr_prestige >= 18' }
    $prestige += , $row
}
WriteJson 'prestige.json' ([ordered]@{
    notes = @(
        'Values reset at the start of every session from State.curr_prestige (res://Scripts/Battle/BattleScene.gd:55-358).',
        'Prestige 12 and above use the else branch; prestige 13-25 then override enemy_xp, node_boost and bit_value.',
        'The second "== 19" branch (res://Scripts/Battle/BattleScene.gd:327) is unreachable because the first "== 19" matches first, so its values (xp 58, bit_value 50) are never used. Listed under overridesUnreachable.',
        'enemy HP/damage grow linearly: base + growth_per_sec * t, where t is seconds since the session started (res://Scripts/Battle/EnemySpawner.gd:70-71). Enemies keep the HP/damage they spawned with.',
        'health_loss_per_sec is the constant "virus" drain on the player (res://Scripts/Battle/BattleScene.gd:362-365). It does not grow during a session.',
        'Exploder (if bought) takes its weight from Square: Square -= exploder_spawn_chance, Exploder = exploder_spawn_chance (res://Scripts/Battle/BattleScene.gd:356-358).',
        'Max prestige is 25; beating the P25 boss gives no new prestige (res://Scripts/Battle/BattleScene.gd:416-419).'
    )
    overridesUnreachable = $overrides['19-duplicate']
    levels = $prestige
})

# ---------------------------------------------------------------- enemy types
$relSp = 'Scripts/Battle/EnemySpawner.gd'
$SpawnerLines = ReadLines $relSp
$r = FuncRange $SpawnerLines 'spawn_enemy'
$scenes = @{ '_square' = 'res://Scenes/Enemies/EnemySquare.tscn'; '_pill' = 'res://Scenes/Enemies/EnemyPill.tscn'; '_circle' = 'res://Scenes/Enemies/EnemyCircle.tscn'; '_spiky' = 'res://Scenes/Enemies/EnemySpikyBall.tscn'; '_pentagon' = 'res://Scenes/Enemies/EnemyPentagon.tscn' }
$enemies = [ordered]@{}; $cur = $null
for ($i = $r[0]; $i -lt $r[1]; $i++) {
    $ln = $SpawnerLines[$i]
    if ($ln -match 'enemy_type == "(\w+)"') { $cur = [ordered]@{ id = $Matches[1]; src = Ref $relSp ($i + 1); health_mult = 1; drop_mult = 1; xp_mult = 1; damage_mult = 1; rotate_speed_turns_per_sec = 0; wavy = $false; rotate_to_velocity = $false }; $enemies[$cur.id] = $cur; continue }
    if (-not $cur) { continue }
    if ($ln -match '_create_enemy') { break }
    if ($ln -match 'enemy_scn = (\w+)') { $cur.scene = $scenes[$Matches[1]] }
    elseif ($ln -match 'rotate_speed = TAU\s*\*\s*randf_range\(([\d.]+), ([\d.]+)\)') { $cur.rotate_speed_turns_per_sec = @((Num $Matches[1]), (Num $Matches[2])); $cur.random_rotation_direction = $true }
    elseif ($ln -match 'rotate_speed = 0') { $cur.rotate_speed_turns_per_sec = 0 }
    elseif ($ln -match 'scale_val = randf_range\(([\d.]+), ([\d.]+)\)') { $cur.scale = @((Num $Matches[1]), (Num $Matches[2])) }
    elseif ($ln -match 'move_speed = randf_range\(([\d.]+), ([\d.]+)\)') { $cur.move_speed_px_per_sec = @((Num $Matches[1]), (Num $Matches[2])) }
    elseif ($ln -match '(health_mult|drop_mult|xp_mult|damage_mult) = ([\d.]+)') { $cur[$Matches[1]] = Num $Matches[2] }
    elseif ($ln -match '(wavy|rotate_to_velocity) = true') { $cur[$Matches[1]] = $true }
}
# collision shapes from the enemy scenes
foreach ($en in $enemies.Values) {
    $rel = $en.scene -replace '^res://', ''
    $lines = ReadLines $rel
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match '^size = Vector2\(([\d.]+), ([\d.]+)\)') { $en.hitbox_unscaled = [ordered]@{ shape = 'rect'; size = @((Num $Matches[1]), (Num $Matches[2])); src = Ref $rel ($i + 1) } }
        if ($lines[$i] -match '^radius = ([\d.]+)') { $en.hitbox_unscaled = [ordered]@{ shape = 'circle'; radius = (Num $Matches[1]); src = Ref $rel ($i + 1) } }
        if ($lines[$i] -match 'texture_over = ExtResource\("(\d+)"\)') { $id = $Matches[1]; $en.sprite = (($lines | Select-String "id=`"$id`"" | Select-Object -First 1).Line -replace '.*path="([^"]+)".*', '$1') }
        if ($lines[$i] -match 'texture_progress = ExtResource\("(\d+)"\)') { $id = $Matches[1]; $en.health_fill_mask = (($lines | Select-String "id=`"$id`"" | Select-Object -First 1).Line -replace '.*path="([^"]+)".*', '$1') }
    }
}
WriteJson 'enemies.json' ([ordered]@{
    notes = @(
        'HP = EnemySpawner.enemy_base_health (current, grows with time) * health_mult; contact damage = enemy_base_damage (current) * damage_mult (res://Scripts/Battle/EnemySpawner.gd:140-142). Base values per prestige are in prestige.json.',
        'Actual move speed = move_speed * prestige enemy_speed_mod (res://Scripts/Battle/EnemySpawner.gd:142).',
        'Sprites are 128 px art scaled by "scale"; on-screen width = 128 * scale (res://Scripts/Enemy/Enemy.gd:59-60). Hitbox = hitbox_unscaled * scale.',
        'Colour = currency colour: red Bits (f03a3f), blue Nodes (457af6), yellow Processors (eed345), purple boss/Cores (c359fb) (res://Scripts/Enums/ResourceType.gd:33-40).',
        'Spawn: off-screen on a random side, offset 0.7*width, heading towards a random point within 84 px of the screen centre (res://Scripts/Battle/EnemySpawner.gd:177-205). Despawn when off-screen after 5 s alive (res://Scripts/Enemy/Enemy.gd:118-123).',
        'Pill: wavy movement, amplitude 34, period 1.0 (sin(t * 1.0)), faces its velocity (res://Scripts/Enemy/Enemy.gd:22-24,105-113).',
        'Pentagon splits into 6 PentagonSmall within 40 px on death, same currency, same direction (res://Scripts/Battle/EnemySpawner.gd:246-249,265-269).',
        'Exploder (circle) explodes on death: 110 px * (1 + exploder_size) square box, random angle 0-90 deg, hitting other enemies with the player attack damage (res://Scripts/Battle/EnemySpawner.gd:243-245).',
        'Yellow (processor) enemies use the same weights minus BigSquare and Pentagon (res://Scripts/Battle/EnemySpawner.gd:44-48).'
    )
    boss = [ordered]@{
        scene = 'res://Scenes/Enemies/EnemySquare.tscn'; scale = 1.0; move_speed_px_per_sec = 15; rotate_speed_turns_per_sec = 0.1; random_rotation_direction = $true
        currency = 'cores'; health = 'prestige.json boss_health'; damage = 'prestige.json boss_damage'
        spawn = 'When the session progress bar fills: 45 s of survival (res://GameScenes/BattleScene.tscn:140), only when curr_prestige == max_prestige (res://Scripts/Battle/BattleScene.gd:37-39,368-372).'
        on_out_of_bounds = 'Re-placed at a new spawn point instead of despawning (res://Scripts/Battle/EnemySpawner.gd:213-214).'
        reward = '+1 Core and max_prestige += 1 (cap 25) only when fighting at max prestige; session then ends (res://Scripts/Battle/BattleScene.gd:407-419).'
        rainbow = 'Hue cycles at 1 turn/s from prestige 18 (res://Scripts/Battle/EnemySpawner.gd:158-159, res://Scripts/Enemy/Enemy.gd:97-99).'
        src = At $relSp '^func spawn_boss'
    }
    types = @($enemies.Values)
})

# ---------------------------------------------------------------- XP / SP
$relXp = 'Scripts/Battle/XPBar.gd'
$XpLines = ReadLines $relXp
$xp = @()
for ($i = 0; $i -lt $XpLines.Length; $i++) { if ($XpLines[$i] -match '^\t\t(\d+): return (\d+)') { $xp += , ([ordered]@{ level = [int]$Matches[1]; xp_to_next = (Num $Matches[2]); src = Ref $relXp ($i + 1) }) } }
WriteJson 'xp.json' ([ordered]@{
    notes = @(
        'XP per kill = prestige enemy_xp * enemy xp_mult (res://Scripts/Battle/EnemySpawner.gd:254). XP and level persist across sessions (State.level, State.curr_xp).',
        'Each level up gives +1 SP (res://Scripts/Battle/XPBar.gd:45-47). Steam achievement SP_25 at level >= 25 (res://Scripts/Battle/XPBar.gd:50-51).',
        'Level 25 and above: 83000 + 5000 * (level - 24) (res://Scripts/Battle/XPBar.gd:39).'
    )
    formulaAbove24 = [ordered]@{ expr = '83000 + 5000*(level-24)'; src = At $relXp '83000 \+ 5000' }
    table = $xp
})

# ---------------------------------------------------------------- milestones
$relMs = 'Scripts/Autoloads/Stores/MilestoneStore.gd'
$MsLines = ReadLines $relMs
$ms = [ordered]@{}; $cur = $null
for ($i = 0; $i -lt $MsLines.Length; $i++) {
    if ($MsLines[$i] -match '"id":\s*"([^"]+)"') { $cur = [ordered]@{ id = $Matches[1]; src = Ref $relMs ($i + 1) }; $ms[$cur.id] = $cur }
    elseif ($cur -and $MsLines[$i] -match '"name":\s*"([^"]+)"') { $cur.name = $Matches[1] }
    elseif ($cur -and $MsLines[$i] -match '"unlock_desc":\s*"([^"]+)"') { $cur.unlock_text = $Matches[1] }
    elseif ($cur -and $MsLines[$i] -match 'resource_str\(ResourceType\.(\w+), "([^"]+)"\)') { $cur.reward_text = "$($Matches[2]) $($currencyNames[$Matches[1].ToLower()])" }
}
$r = FuncRange $ProcLines 'gain_milestone'
for ($i = $r[0]; $i -lt $r[1]; $i++) {
    if ($ProcLines[$i] -match '^\t\t"([^"]+)":') { $id = $Matches[1]; $null = $ProcLines[$i + 1] -match 'State\.(\w+) \+= (\d+)'; $ms[$id].reward = [ordered]@{ currency = $Matches[1]; amount = (Num $Matches[2]); src = Ref $relProc ($i + 2) } }
}
$r = FuncRange $ProcLines 'check_milestone'
for ($i = $r[0]; $i -lt $r[1]; $i++) {
    if ($ProcLines[$i] -match '^\t\t"([^"]+)":') { $id = $Matches[1]; $null = $ProcLines[$i + 1] -match 'nums\.(\w+)/([\d.]+)'; $ms[$id].requirement = [ordered]@{ counter = $Matches[1]; count = (Num $Matches[2]); src = Ref $relProc ($i + 2) } }
}
foreach ($m in $ms.Values) {
    $m.icon = "res://Sprites/MilestoneIcons/$($m.id).png"
    $m.textMismatch = $null
    $shown = [double](($m.unlock_text -replace '[^\d]', ''))
    if ($shown -ne $m.requirement.count) { $m.textMismatch = "Text says $($m.unlock_text) but the check uses $($m.requirement.count)." }
}
WriteJson 'milestones.json' ([ordered]@{
    notes = @(
        'Counters are lifetime kills (State.nums, saved): reds_killed, blues_killed, yellows_killed (res://Scripts/Battle/EnemySpawner.gd:230,233,238). Kills by any means count; bosses do not.',
        'Claimed manually with the "claim" button; each once (res://Scripts/Milestones/MilestoneEntry.gd). Rewards are added directly to the currency.',
        'Unlocked by the "milestones" skill node (1 Node).'
    )
    milestones = @($ms.Values)
})

# ---------------------------------------------------------------- crypto mine
$relCm = 'Scripts/Systems/CryptoMine.gd'
$MineLines = ReadLines $relCm
$speeds = @()
for ($i = 0; $i -lt $MineLines.Length; $i++) { if ($MineLines[$i] -match '^\t\t(\d+): curr_speed = (\d+)') { $speeds += , ([ordered]@{ level = [int]$Matches[1]; bits_per_sec = (Num $Matches[2]); src = Ref $relCm ($i + 1) }) } }
WriteJson 'cryptomine.json' ([ordered]@{
    netcoin_per_bit = [ordered]@{ value = 0.00001; src = At $relCm 'NETCOINS_PER_BIT: float' }
    deposit_buttons = [ordered]@{ values = @(1000, 5000, 10000, 50000, 100000, 1000000); labels = @('1k', '5k', '10k', '50k', '100k', '1m'); src = At 'Scripts/Shop/CryptoMinePage.gd' '^var deposit_values' }
    upgrade_cost = [ordered]@{ value = 1; currency = 'processors'; src = At 'Scripts/Shop/CryptoMinePage.gd' 'State.processors -= 1' }
    max_level = [ordered]@{ value = 36; src = At $relCm 'mine_level >= 36' }
    notes = @(
        'Deposited Bits convert at curr_speed Bits/sec into Netcoin at 0.00001 Netcoin per Bit (res://Scripts/Systems/CryptoMine.gd:15-22).',
        'The mine runs in State._process, i.e. all the time the game is running, in every scene including battle and menus (res://Scripts/Autoloads/State.gd:104-106). It does not run while the game is closed.',
        'Mine level and deposited Bits are saved (res://Scripts/Systems/CryptoMine.gd:82-86).',
        'Unlocked by the "crypto mine" skill node (50 Nodes). Processors come from yellow enemies (1 per kill) and Yellows milestones.'
    )
    speed_by_level = $speeds
})

# ---------------------------------------------------------------- tree summary tables
$byCur = $upList | Group-Object { $_.currency } | ForEach-Object { [ordered]@{ currency = $_.Name; nodes = $_.Count; totalCost = ((($_.Group | ForEach-Object { [double]$_.totalCost }) | Measure-Object -Sum).Sum) } }

# ---------------------------------------------------------------- cross-check
$norm = { param($s) ($s.ToLower() -replace '[^a-z0-9]', '') }
$alias = @{ 'swaming' = 'swarming'; 'overloading' = 'overloaded'; 'lightingrod' = 'lightningrod'; 'netarmor' = 'netarmor' }
$byName = @{}; foreach ($u in $upList) { $byName[(& $norm $u.name)] = $u }
function Lookup($name) { $k = & $norm $name; if ($alias.ContainsKey($k)) { $k = $alias[$k] }; return $byName[$k] }
function Nums($s) { @([regex]::Matches($s, '\d+(?:\.\d+)?') | ForEach-Object { $_.Value }) -join ',' }

$sheetMap = @{ 'Red' = 'bits'; 'Blue' = 'nodes'; 'Purple' = 'cores'; 'SP' = 'sp'; 'Green' = 'netcoin' }
$sheet = Import-Csv (Join-Path $Res 'sources\sheet-upgrades-and-prices.csv')
$sheetRows = @(); $sheetSeen = @{}
$rowNo = 1
foreach ($row in $sheet) {
    $rowNo++
    $name = $row.'Upgrade '.Trim()
    $u = Lookup $name
    $costs = @(1..30 | ForEach-Object { $row."Lvl$_" } | Where-Object { $_ -ne $null -and $_.Trim() -ne '' } | ForEach-Object { Num $_ })
    $issues = @()
    if (-not $u) { $issues += 'no node with this name in the game' }
    else {
        $sheetSeen[$u.id] = $true
        $cur = $sheetMap[$row.Resource.Trim()]
        if ($cur -ne $u.currency) { $issues += "currency: sheet $($row.Resource.Trim()) ($cur), game $($u.currency) ($($u.costsSrc))" }
        if ([int]$row.'Levels ' -ne $u.maxLevel) { $issues += "levels: sheet $($row.'Levels '), game $($u.maxLevel)" }
        if (($costs -join ',') -ne ($u.costs -join ',')) { $issues += "costs: sheet [$($costs -join ', ')], game [$($u.costs -join ', ')] ($($u.costsSrc))" }
        $sheetTotal = Num $row.'Cost Total'
        if ([math]::Abs($sheetTotal - [double]$u.totalCost) -gt 1e-9) { $issues += "total: sheet $sheetTotal, game $($u.totalCost)" }
        if ((Nums $row.Effect) -ne (Nums $u.description)) { $issues += "effect text numbers differ: sheet ""$($row.Effect.Trim())"", game ""$($u.description)""" }
    }
    $sheetRows += , ([ordered]@{ row = $rowNo; name = $name; id = $(if ($u) { $u.id } else { $null }); effect = $row.Effect.Trim(); issues = $issues })
}
$sheetMissing = @($upList | Where-Object { -not $sheetSeen.ContainsKey($_.id) } | ForEach-Object { $_.id })

$GuideLines = [IO.File]::ReadAllLines((Join-Path $Res 'sources\steam-guide-3414691532.txt'), $Utf8) | ForEach-Object { $_.Trim() }
$guideRows = @(); $guideSeen = @{}; $section = ''
for ($i = 0; $i -lt $GuideLines.Length; $i++) {
    if ($GuideLines[$i] -match '^\[LINK ') {
        $name = $GuideLines[$i + 1]; $desc = $GuideLines[$i + 2]; $lv = [int]($GuideLines[$i + 3] -replace '[^\d]', '')
        $u = Lookup $name; $issues = @()
        if (-not $u) { $issues += 'no node with this name in the game' }
        else {
            $guideSeen[$u.id] = $true
            if ($lv -ne $u.maxLevel) { $issues += "levels: guide $lv, game $($u.maxLevel)" }
            if ((Nums $desc) -ne (Nums $u.description)) { $issues += "description numbers differ: guide ""$desc"", game ""$($u.description)""" }
            if ((& $norm $name) -ne (& $norm $u.name)) { $issues += "name spelled ""$name"" (game: ""$($u.name)"")" }
        }
        $guideRows += , ([ordered]@{ section = $section; name = $name; id = $(if ($u) { $u.id } else { $null }); description = $desc; levels = $lv; issues = $issues })
        $i += 3
    }
    # Item lines are consumed above, so any other non-empty line is a section heading.
    elseif ($GuideLines[$i]) { $section = $GuideLines[$i] }
}
$guideMissing = @($upList | Where-Object { -not $guideSeen.ContainsKey($_.id) } | ForEach-Object { $_.id })

WriteJson 'cross-check.json' ([ordered]@{
    sources = [ordered]@{
        guide = 'https://steamcommunity.com/sharedfiles/filedetails/?id=3414691532 (Nodebuster Full Skill Tree, by Orange Creamsicle, updated Jul 8 2025; snapshot research/sources/steam-guide-3414691532.txt)'
        sheet = 'https://docs.google.com/spreadsheets/d/1vrLln6hSPshVy47k3fFz4R0q7zNZpgm-72vdAAGI98E (linked from https://steamcommunity.com/sharedfiles/filedetails/?id=3533964915, "Google Sheet with all Upgrades and their prices", by calamity; snapshot research/sources/sheet-upgrades-and-prices.csv)'
    }
    guide = [ordered]@{ rows = $guideRows.Count; nodesNotListed = $guideMissing; entries = $guideRows }
    sheet = [ordered]@{ rows = $sheetRows.Count; nodesNotListed = $sheetMissing; entries = $sheetRows }
})

# ---------------------------------------------------------------- assets
function PngSize($path) {
    $fs = [IO.File]::OpenRead($path); $b = New-Object byte[] 24; $null = $fs.Read($b, 0, 24); $fs.Close()
    $w = ($b[16] -shl 24) -bor ($b[17] -shl 16) -bor ($b[18] -shl 8) -bor $b[19]
    $h = ($b[20] -shl 24) -bor ($b[21] -shl 16) -bor ($b[22] -shl 8) -bor $b[23]
    return @($w, $h)
}
function OggInfo($path) {
    $bytes = [IO.File]::ReadAllBytes($path)
    $s = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
    $v = $s.IndexOf("$([char]1)vorbis")
    $ch = $bytes[$v + 11]; $rate = [BitConverter]::ToUInt32($bytes, $v + 12)
    $last = $s.LastIndexOf('OggS')
    $gran = [BitConverter]::ToInt64($bytes, $last + 6)
    return [ordered]@{ channels = [int]$ch; sample_rate = [int]$rate; duration_sec = [math]::Round($gran / $rate, 3) }
}
$codeFiles = Get-ChildItem $X -Recurse -File -Include *.gd, *.tscn, *.tres, *.godot | Where-Object { $_.FullName -notmatch '\\\.godot\\|\\addons\\' }
$codeText = @{}; foreach ($f in $codeFiles) { $codeText[$f.FullName.Substring($X.Length + 1) -replace '\\', '/'] = [IO.File]::ReadAllLines($f.FullName, $Utf8) }
function Uses($rel) {
    $hits = @()
    foreach ($k in $codeText.Keys) {
        $lines = $codeText[$k]
        for ($i = 0; $i -lt $lines.Length; $i++) { if ($lines[$i].Contains("res://$rel") -or $lines[$i].Contains("[img]$rel")) { $hits += Ref $k ($i + 1) } }
    }
    return @($hits | Sort-Object)
}
$assetFiles = Get-ChildItem $X -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.godot\\|\\addons\\' -and $_.Extension -in '.png', '.ogg', '.ttf', '.gdshader', '.svg', '.ico' }
$images = @(); $sounds = @(); $fonts = @(); $shaders = @(); $other = @()
foreach ($f in ($assetFiles | Sort-Object FullName)) {
    $rel = $f.FullName.Substring($X.Length + 1) -replace '\\', '/'
    $uses = @(Uses $rel | Where-Object { $_ })
    if ($rel -like 'Sprites/UpgradeIcons/*') { $uses += 'dynamic: loaded by upgrade id (res://Scripts/Upgrades/Upgrade.gd:18)' }
    if ($rel -like 'Sprites/MilestoneIcons/*') { $uses += 'dynamic: loaded by milestone id (res://Scripts/Milestones/Milestone.gd:16)' }
    $entry = [ordered]@{ path = "res://$rel"; bytes = $f.Length; used_by = $uses }
    switch ($f.Extension) {
        '.png' { $sz = PngSize $f.FullName; $entry.width = $sz[0]; $entry.height = $sz[1]; $images += , $entry }
        '.ogg' { $info = OggInfo $f.FullName; foreach ($k in $info.Keys) { $entry[$k] = $info[$k] }; $sounds += , $entry }
        '.ttf' { $fonts += , $entry }
        '.gdshader' { $shaders += , $entry }
        default { $other += , $entry }
    }
}
WriteJson 'assets.json' ([ordered]@{
    notes = @(
        'Paths are res:// paths; the files are in reference/extracted/ (not committed). used_by lists every script/scene line that references the file; an empty list means the file ships but nothing loads it.',
        'All textures use nearest filtering (project default_texture_filter=0, res://project.godot).'
    )
    images = $images; sounds = $sounds; fonts = $fonts; shaders = $shaders; other = $other
})

# ---------------------------------------------------------------- post-processing (CRT etc.)
$relMain = 'MainScene.tscn'
$MainLines = ReadLines $relMain
$blocks = [ordered]@{}; $curB = $null
for ($i = 0; $i -lt $MainLines.Length; $i++) {
    if ($MainLines[$i] -match '^\[sub_resource type="(\w+)" id="(\w+)"\]') { $curB = $null; if ($Matches[1] -in 'Environment', 'ShaderMaterial') { $curB = [ordered]@{ type = $Matches[1]; src = Ref $relMain ($i + 1); params = [ordered]@{} }; $blocks[$Matches[2]] = $curB }; continue }
    if ($MainLines[$i] -match '^\[') { $curB = $null; continue }
    if ($curB -and $MainLines[$i] -match '^(?:shader_parameter/)?(\w+) = (.+)$') {
        $k = $Matches[1]; $raw = $Matches[2]; $v = $raw
        if ($raw -match '^-?[\d.]+$') { $v = Num $raw } elseif ($raw -eq 'true') { $v = $true }
        $curB.params[$k] = [ordered]@{ value = $v; src = Ref $relMain ($i + 1) }
    }
}
$crt = $blocks.Values | Where-Object { $_.params.Contains('shader') -and $_.params.shader.value -eq 'ExtResource("3")' }
$glitch = $blocks.Values | Where-Object { $_.params.Contains('shader') -and $_.params.shader.value -eq 'ExtResource("4")' }
$env = $blocks.Values | Where-Object { $_.type -eq 'Environment' }
foreach ($b in @($crt, $glitch)) { $b.params.Remove('shader') }
WriteJson 'post.json' ([ordered]@{
    notes = @(
        'Render pipeline: the 480x270 game renders into a SubViewport (res://MainScene.tscn), integer-scaled to the window (stretch mode canvas_items, scale_mode integer; default window 1440x810: res://project.godot).',
        'The CRT ColorRect sits on CanvasLayer 4 over the whole window and reads the screen texture, so the CRT runs at window resolution, not 480x270. SCREEN_PIXEL_SIZE (chromatic offsets, 3-px RGB grid) is therefore in window pixels.',
        'WorldEnvironment glow (2D HDR glow, background_mode canvas) applies to canvas layers up to 10. Glow intensity is 1.8 with CRT on and 0.9 with CRT off (res://Scripts/Autoloads/OptionData.gd:86-92).',
        'Glitch overlay is hidden except during the godvirus ending, where shake_power tweens 0 -> 0.8 over 10 s (res://Scripts/Ending.gd:41-52).',
        'BloomShader.gdshader and GlitchShader.gdshader (texture version) ship but are not referenced by any scene.'
    )
    crt = [ordered]@{ shader = 'res://Shaders/CRTShader.gdshader'; node = 'MainScene/ScreenCanvas/CRT (CanvasLayer layer 4)'; material = $crt.src; params = $crt.params }
    glitch = [ordered]@{ shader = 'res://Shaders/GlitchScreenShader.gdshader'; node = 'MainScene/ScreenCanvas/Glitch (hidden by default)'; material = $glitch.src; params = $glitch.params }
    environment = [ordered]@{ src = $env.src; params = $env.params }
})

# ---------------------------------------------------------------- palette
$relCol = 'Scripts/MyColors.gd'
$MC = ReadLines $relCol
$pal = [ordered]@{}
for ($i = 0; $i -lt $MC.Length; $i++) { if ($MC[$i] -match '^const (\w+) = Color\("([0-9a-f]+)"\)') { $pal[$Matches[1]] = [ordered]@{ hex = "#$($Matches[2])"; src = Ref $relCol ($i + 1) } } }
WriteJson 'palette.json' ([ordered]@{
    colors = $pal
    resource_colors = [ordered]@{ bits = 'RED'; nodes = 'DARK_BLUE'; cores = 'PURPLE'; sp = 'BLUE'; netcoin = 'GREEN'; processors = 'YELLOW'; src = At 'Scripts/Enums/ResourceType.gd' '^static func get_color' }
    skill_node_outline = [ordered]@{
        default = [ordered]@{ maxed = 'YELLOW'; can_buy = 'GREEN'; cannot_buy = 'RED' }
        alternate = [ordered]@{ maxed = 'VIOLET'; can_buy = 'GREEN'; cannot_buy = 'DARK_RED' }
        unbought_node_modulate = 'lerp(white, BG, 0.5) while level 0 (res://Scripts/Shop/UpgradeTree.gd:68-71)'
        src = At 'Scripts/UI/UpgradeIcon.gd' '^func setup_outline_color'
    }
    other = [ordered]@{
        clear_color = [ordered]@{ hex = '#000000'; src = At 'Scripts/MainScene.gd' 'set_default_clear_color' }
        scene_background = [ordered]@{ hex = '#1f1f1f'; note = 'ColorRect Color(0.121569,...) in every game scene'; src = At 'GameScenes/BattleScene.tscn' '^color = Color\(0.121569' }
        bg_particles = [ordered]@{ modulate = '0.17 grey'; src = At 'Scenes/Effects/BgParticles.tscn' '^self_modulate' }
        button_disabled = [ordered]@{ hex = '#6c6c6c'; src = At 'Scripts/UI/Buttons/MyButton.gd' 'DISABLED_COLOR: Color' }
        transition_dark = [ordered]@{ hex = '#8f8f8f'; src = At 'Scripts/Autoloads/OptionData.gd' '8f8f8f' }
        xp_bar = [ordered]@{ rgb = @(0.839216, 0.631373, 0.160784); src = At 'GameScenes/BattleScene.tscn' 'tint_progress = Color\(0.839216' }
        progress_bar = [ordered]@{ rgb = @(0.862745, 0.862745, 0.862745); src = At 'GameScenes/BattleScene.tscn' 'tint_progress = Color\(0.862745' }
        health_bar = [ordered]@{ rgb = @(0.941176, 0.227451, 0.247059); src = At 'Scenes/UI/TextureProgressBar.tscn' '^tint_progress' }
    }
})

# ---------------------------------------------------------------- skill-tree.md
$sb = New-Object Text.StringBuilder
$null = $sb.AppendLine('# Skill tree')
$null = $sb.AppendLine()
$null = $sb.AppendLine('Generated by `research/scripts/extract.ps1` from the recovered game. Machine-readable version: [data/upgrades.json](data/upgrades.json).')
$null = $sb.AppendLine()
$null = $sb.AppendLine("**$($upList.Count) nodes, $($edgeList.Count) connections.** Sources:")
$null = $sb.AppendLine()
$null = $sb.AppendLine('- names, descriptions, currencies, per-level costs: `res://Scripts/Autoloads/Stores/UpgradeStore.gd`')
$null = $sb.AppendLine('- effects: `res://Scripts/Upgrades/UpgradeProcessor.gd` `gain_upgrade` (lines 6-195)')
$null = $sb.AppendLine('- prerequisites: `res://Scripts/Upgrades/UpgradeProcessor.gd` `check_upgrade_unlocked` (lines 197-399)')
$null = $sb.AppendLine('- positions and connections: `res://GameScenes/ShopScene.tscn` (UpgradesPage/UpgradeTree children)')
$null = $sb.AppendLine('- icons: `res://Sprites/UpgradeIcons/<id>.png` (14x14 inside a 16x16 frame, `res://Scenes/UI/UpgradeIcon.tscn`)')
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Rules')
$null = $sb.AppendLine()
$null = $sb.AppendLine('- **Cost.** `costs[level]` is the price of the next level; max level = number of costs. No formula: every node has an explicit table (`res://Scripts/Upgrades/Upgrade.gd:24-33`).')
$null = $sb.AppendLine('- **Buying.** Click a visible node when you can afford it. The effect is applied once per level (`res://Scripts/Shop/UpgradeTree.gd:90-107`).')
$null = $sb.AppendLine('- **Visibility = unlock.** A node is shown (and only then clickable) when its rule over *scene neighbours* holds. `>=1` = neighbour has at least one level, `max` = neighbour is maxed, `or` = any. The root `Damage1` has no rule (`res://Scripts/Upgrades/UpgradeProcessor.gd:197-399`). Lines are drawn only between two visible nodes.')
$null = $sb.AppendLine('- **Outline colour.** yellow = maxed, green = affordable, red = not affordable (alternate palette: violet / green / dark red). Nodes with level 0 are drawn at 50% towards the background colour (`res://Scripts/UI/UpgradeIcon.gd:13-22`, `res://Scripts/Shop/UpgradeTree.gd:68-71`).')
$null = $sb.AppendLine('- **Camera.** Pan with right-drag or WASD/arrow keys at 260 px/s; zoom with the wheel between scales 1, 0.75, 0.5 (0.2 s quad ease-out); panning is clamped so the visible nodes stay within 100 px of the screen (`res://Scripts/Shop/UpgradesPage.gd`, `res://Scripts/Shop/UpgradeTree.gd:110-130`).')
$null = $sb.AppendLine('- **Position.** `x,y` = top-left in tree pixels (nodes are 16x16; `Laboratory` is 32x32). `grid` = centre relative to `Damage1` in 32 px steps, x right, y down (up is negative).')
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Totals by currency')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| Currency | Nodes | Cost of maxing all |')
$null = $sb.AppendLine('|---|---:|---:|')
foreach ($c in $byCur) { $null = $sb.AppendLine("| $($currencyNames[$c.currency]) | $($c.nodes) | $(FmtNum ([double]$c.totalCost)) |") }
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Nodes')
$null = $sb.AppendLine()
$null = $sb.AppendLine('In `UpgradeStore.gd` order. Costs are per level, in the listed currency.')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| # | id | name | description | currency | max | costs per level | total | effect per level (code) | requires | x,y | grid | source |')
$null = $sb.AppendLine('|---:|---|---|---|---|---:|---|---:|---|---|---|---|---|')
$n = 0
foreach ($u in $upList) {
    $n++
    $eff = if ($u.effects.Count) { ($u.effects | ForEach-Object { if ($_.op -eq 'add') { "``$($_.stat)`` +$($_.perLevel)" } else { "``$($_.stat)`` = $("$($_.perLevel)".ToLower())" } }) -join '<br>' } else { '-' }
    $req = if ($u.requires) { $sep = if ($u.requires.mode -eq 'any') { ' or ' } else { ' and ' }; ($u.requires.nodes | ForEach-Object { if ($_.level -eq 'max') { "$($_.id) max" } else { "$($_.id) >=1" } }) -join $sep } else { '- (root)' }
    $costs = ($u.costs | ForEach-Object { FmtNum $_ }) -join ', '
    $srcLine = ($u.src -split ':')[-1]
    $null = $sb.AppendLine("| $n | ``$($u.id)`` | $($u.name) | $($u.description) | $($currencyNames[$u.currency]) | $($u.maxLevel) | $costs | $(FmtNum $u.totalCost) | $eff | $req | $($u.position.rect[0]),$($u.position.rect[1]) | $($u.position.grid[0]),$($u.position.grid[1]) | UpgradeStore.gd:$srcLine |")
}
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Notes on individual nodes')
$null = $sb.AppendLine()
$null = $sb.AppendLine('Where the in-game text and the code disagree, or the code does something non-obvious. The remake should follow the code.')
$null = $sb.AppendLine()
foreach ($u in $upList) { if ($u.notes) { $null = $sb.AppendLine("- **``$($u.id)``** ($($u.name)): $($u.notes)") } }
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Connections')
$null = $sb.AppendLine()
$null = $sb.AppendLine('Undirected. A connection is drawn between two nodes when both are visible.')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| Node | Connected to |')
$null = $sb.AppendLine('|---|---|')
foreach ($u in $upList) { $null = $sb.AppendLine("| $(Code $u.id) | $(CodeList $u.neighbors) |") }
WriteText (Join-Path $Res 'skill-tree.md') $sb.ToString()

# ---------------------------------------------------------------- cross-check.md (tables only; prose is in cross-check-summary)
$sb = New-Object Text.StringBuilder
$null = $sb.AppendLine('## Steam guide: every entry with a difference')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| Section | Guide name | Node id | Differences |')
$null = $sb.AppendLine('|---|---|---|---|')
foreach ($g in $guideRows) { if ($g.issues.Count) { $null = $sb.AppendLine("| $($g.section) | $($g.name) | ``$($g.id)`` | $($g.issues -join '<br>') |") } }
$null = $sb.AppendLine()
$null = $sb.AppendLine("Game nodes not in the guide: $(CodeList $guideMissing).")
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Spreadsheet: every row with a difference')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| CSV row | Sheet name | Node id | Differences |')
$null = $sb.AppendLine('|---:|---|---|---|')
foreach ($s in $sheetRows) { if ($s.issues.Count) { $null = $sb.AppendLine("| $($s.row) | $($s.name) | ``$($s.id)`` | $($s.issues -join '<br>') |") } }
$null = $sb.AppendLine()
$null = $sb.AppendLine("Game nodes not in the sheet: $(CodeList $sheetMissing).")
$null = $sb.AppendLine()
$null = $sb.AppendLine("Rows that match the game exactly (name, currency, levels, every cost, total, effect numbers): $(@($sheetRows | Where-Object { -not $_.issues.Count }).Count) of $($sheetRows.Count).")
WriteText (Join-Path $Res 'cross-check.generated.md') $sb.ToString()

# ---------------------------------------------------------------- assets.md
# Sound enum name for each SFX file (res://Scripts/Autoloads/SFX.gd sound_dict).
$sfxLines = ReadLines 'Scripts/Autoloads/SFX.gd'
$soundEnum = @{}; $curEnum = $null
foreach ($ln in $sfxLines) {
    if ($ln -match 'Sound\.(\w+):') { $curEnum = $Matches[1] }
    if ($curEnum -and $ln -match 'res://(Audio/[^"]+)') { $soundEnum["res://$($Matches[1])"] = $curEnum }
}
function ShortUses($uses) {
    if (-not @($uses).Count) { return '**unused**' }
    (@($uses) | ForEach-Object { $_ -replace '^res://', '' -replace '^dynamic: ', '' }) -join '<br>'
}
$sb = New-Object Text.StringBuilder
$null = $sb.AppendLine('# Asset catalogue')
$null = $sb.AppendLine()
$null = $sb.AppendLine('Generated by `research/scripts/extract.ps1`. Every image, sound, font and shader in the recovered project, with where it is referenced. Files are under `reference/extracted/` (not committed; the art and audio are Goblobin''s, and the music is HoliznaCC0). Machine-readable: [data/assets.json](data/assets.json).')
$null = $sb.AppendLine()
$null = $sb.AppendLine("Totals: $($images.Count) images, $($sounds.Count) sounds, $($fonts.Count) fonts, $($shaders.Count) shaders. **unused** = shipped but not referenced by any script or scene.")
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Shaders')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| Path | Used by |'); $null = $sb.AppendLine('|---|---|')
foreach ($a in $shaders) { $null = $sb.AppendLine("| ``$($a.path)`` | $(ShortUses $a.used_by) |") }
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Fonts')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| Path | Bytes | Used by |'); $null = $sb.AppendLine('|---|---:|---|')
foreach ($a in $fonts) { $null = $sb.AppendLine("| ``$($a.path)`` | $($a.bytes) | $(ShortUses $a.used_by) |") }
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Sounds')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| Path | Sound enum | Length (s) | Hz | Ch | Used by |'); $null = $sb.AppendLine('|---|---|---:|---:|---:|---|')
foreach ($a in $sounds) {
    $enum = if ($soundEnum.ContainsKey($a.path)) { $soundEnum[$a.path] } else { '' }
    $null = $sb.AppendLine("| ``$($a.path)`` | $enum | $($a.duration_sec.ToString('0.000', $Inv)) | $($a.sample_rate) | $($a.channels) | $(ShortUses $a.used_by) |")
}
$null = $sb.AppendLine()
$null = $sb.AppendLine('## Images')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| Path | Size | Used by |'); $null = $sb.AppendLine('|---|---|---|')
foreach ($a in $images) { $null = $sb.AppendLine("| ``$($a.path)`` | $($a.width)x$($a.height) | $(ShortUses $a.used_by) |") }
$null = $sb.AppendLine()
if ($other.Count) {
    $null = $sb.AppendLine('## Other')
    $null = $sb.AppendLine()
    $null = $sb.AppendLine('| Path | Bytes | Used by |'); $null = $sb.AppendLine('|---|---:|---|')
    foreach ($a in $other) { $null = $sb.AppendLine("| ``$($a.path)`` | $($a.bytes) | $(ShortUses $a.used_by) |") }
}
WriteText (Join-Path $Res 'assets.md') $sb.ToString()

Write-Host "upgrades: $($upList.Count)  edges: $($edgeList.Count)  prestige rows: $($prestige.Count)  enemies: $($enemies.Count)"
Write-Host "images: $($images.Count)  sounds: $($sounds.Count)  fonts: $($fonts.Count)  shaders: $($shaders.Count)"
Write-Host "guide rows: $($guideRows.Count) (issues: $(@($guideRows | Where-Object { $_.issues.Count }).Count))  sheet rows: $($sheetRows.Count) (issues: $(@($sheetRows | Where-Object { $_.issues.Count }).Count))"
