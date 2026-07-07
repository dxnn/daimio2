// site/js/space_ascii_parse.js — Parse ASCII space diagrams back to source.dm format
//
// Takes a render.txt string and produces a source.dm string.
// Round-trip: render.txt → parse_ascii() → source.dm → seedlikes_from_string → extract → layout → render

import D from '../../daimio/daimio.js'
import { render_space } from './space_ascii.js'

export function parse_ascii(text, options) {
  // Each block (space) is refined independently against its own render —
  // refining the whole text at once would let the greedy search move one
  // block's routes into another. The other blocks' sources stay in scope
  // while rendering candidates: a subspace reference only registers when
  // the referenced space is defined in the same source.
  var blocks = split_blocks(text)
  var parsed = blocks.map(parse_block_data)
  var sources = parsed.map(function(p) { return p.source })
  for (var i = 0; i < blocks.length; i++)
    sources[i] = refine(blocks[i].join('\n'), sources, i, parsed[i], options)
  return sources.join('\n')
}

// Raw parse without refine (for debugging)
export function parse_ascii_raw(text) {
  var blocks = split_blocks(text)
  return blocks.map(function(b) { return parse_block_data(b).source }).join('\n')
}

// Render one block's candidate source with the other blocks' sources in
// scope, returning only that block's render
function try_block(sources, index, candidate, options) {
  var all = sources.slice()
  all[index] = candidate
  var sl = D.seedlikes_from_string(all.join('\n'))
  var names = Object.keys(sl)
  if (index >= names.length) return ''
  return render_space(names[index], sl[names[index]], options)
}

function render_score(rendered, original) {
  if (rendered === original) return 0
  // Character-level: count matching chars at same position, penalize length diff
  var score = 0
  var len = Math.max(rendered.length, original.length)
  for (var i = 0; i < len; i++) {
    if (i < rendered.length && i < original.length && rendered[i] === original[i]) score++
    else score--
  }
  return score
}

function generate_all_routes(parsed_blocks) {
  // Generate ALL possible route lines from parsed components
  var all_routes = []
  for (var bi = 0; bi < parsed_blocks.length; bi++) {
    var p = parsed_blocks[bi]
    // Collect endpoint names
    var sources = [], sinks = []
    for (var i = 0; i < p.ports.length; i++) {
      var pl = p.port_labels[i]
      if (p.ports[i].side === 'left') sources.push('@' + pl)
      else sinks.push('@' + pl)
    }
    for (var i = 0; i < p.stations.length; i++) {
      var sn = p.stations[i].name || p.stations[i].source
      sources.push(sn)
      sinks.push(sn)
    }
    for (var i = 0; i < p.subspaces.length; i++) {
      sources.push(p.subspaces[i].name + '.out')
      sinks.push(p.subspaces[i].name + '.in')
    }
    // Generate all source→sink pairs
    for (var si2 = 0; si2 < sources.length; si2++)
      for (var di = 0; di < sinks.length; di++)
        if (sources[si2] !== sinks[di])
          all_routes.push('  ' + sources[si2] + ' -> ' + sinks[di])
  }
  return all_routes
}

function refine(original, block_sources, index, parsed_block, options) {
  var source = block_sources[index]
  function render_candidate(src) { return try_block(block_sources, index, src, options) }
  if (render_candidate(source) === original) return source

  // Split source into header (non-route) and routes + footer
  var lines = source.split('\n')
  var header = [], traced_routes = [], footer = []
  var in_routes = false
  for (var i = 0; i < lines.length; i++) {
    if (/^\s+\S.*->/.test(lines[i])) {
      traced_routes.push(lines[i])
      in_routes = true
    } else if (in_routes) {
      footer.push(lines[i])
    } else {
      header.push(lines[i])
    }
  }

  // Generate brute-force candidate routes
  var extra = generate_all_routes([parsed_block])
  var extra_seen = {}
  for (var i = 0; i < traced_routes.length; i++) extra_seen[traced_routes[i].trim()] = true
  var extras = []
  for (var i = 0; i < extra.length; i++)
    if (!extra_seen[extra[i].trim()]) { extras.push(extra[i]); extra_seen[extra[i].trim()] = true }

  function build(routes) { return header.concat(routes).concat(footer).join('\n') }
  function sc(routes) {
    var rendered = render_candidate(build(routes))
    return rendered === original ? Infinity : render_score(rendered, original)
  }

  // Bidirectional greedy: top-down (remove) and bottom-up (add), alternating
  var current = traced_routes.slice()
  var best_score = sc(current)
  if (best_score === Infinity) return build(current)

  var changed = true
  while (changed) {
    changed = false

    // Try rotating cyclic chains first (semantics-preserving): the traced
    // start of a cycle is arbitrary, but it decides which edge the layout
    // treats as the back-edge — and an inline anonymous station is only
    // expressible when it appears once, mid-chain.
    for (var i = 0; i < current.length && !changed; i++) {
      var m = current[i].match(/^(\s+)(.+)$/)
      if (!m) continue
      var parts = m[2].split(' -> ')
      if (parts.length < 3 || parts[0] !== parts[parts.length - 1]) continue
      for (var r = 1; r < parts.length - 1; r++) {
        var rot = parts.slice(r, parts.length - 1).concat(parts.slice(0, r), [parts[r]])
        var candidate = current.slice()
        candidate[i] = m[1] + rot.join(' -> ')
        var s = sc(candidate)
        if (s === Infinity) return build(candidate)
        if (s > best_score) { current = candidate; best_score = s; changed = true; break }
      }
    }
    if (changed) continue

    // Try joining routes that share an inline anonymous endpoint: the two
    // occurrences parse as two different stations, but the diagram may
    // show one chain through a single station
    for (var a = 0; a < current.length && !changed; a++) {
      for (var b = 0; b < current.length && !changed; b++) {
        if (a === b) continue
        var ma = current[a].match(/^(\s+)(.+)$/)
        var mb = current[b].match(/^\s+(.+)$/)
        if (!ma || !mb) continue
        var pa = ma[2].split(' -> '), pb = mb[1].split(' -> ')
        var tail = pa[pa.length - 1]
        if (tail !== pb[0] || tail[0] !== '{') continue
        var candidate = current.slice()
        candidate[a] = ma[1] + pa.concat(pb.slice(1)).join(' -> ')
        candidate.splice(b, 1)
        var s = sc(candidate)
        if (s === Infinity) return build(candidate)
        if (s > best_score) { current = candidate; best_score = s; changed = true }
      }
    }
    if (changed) continue

    // Top-down: try removing each route. Best-improvement, not first —
    // taking the first improving removal can delete a true route whose
    // absence still scores well, hiding the exact fix.
    var best_i = -1, best_s = best_score
    for (var i = current.length - 1; i >= 0; i--) {
      var candidate = current.slice(0, i).concat(current.slice(i + 1))
      var s = sc(candidate)
      if (s === Infinity) return build(candidate)
      if (s > best_s) { best_i = i; best_s = s }
    }
    if (best_i >= 0) {
      current = current.slice(0, best_i).concat(current.slice(best_i + 1))
      best_score = best_s; changed = true
      continue
    }

    // Bottom-up: try adding from extras (best-improvement)
    best_i = -1; best_s = best_score
    for (var i = 0; i < extras.length; i++) {
      var candidate = current.concat([extras[i]])
      var s = sc(candidate)
      if (s === Infinity) return build(candidate)
      if (s > best_s) { best_i = i; best_s = s }
    }
    if (best_i >= 0) {
      current = current.concat([extras[best_i]])
      extras.splice(best_i, 1)
      best_score = best_s; changed = true
      continue
    }

    // Try swapping pairs of routes
    for (var a = 0; a < current.length && !changed; a++) {
      for (var b = a + 1; b < current.length; b++) {
        var candidate = current.slice()
        var tmp = candidate[a]; candidate[a] = candidate[b]; candidate[b] = tmp
        var s = sc(candidate)
        if (s === Infinity) return build(candidate)
        if (s > best_score) { current = candidate; best_score = s; changed = true; break }
      }
    }
  }

  // Final: try station declaration swaps
  var lines2 = build(current).split('\n')
  changed = true
  while (changed) {
    changed = false
    var si = []
    for (var i = 0; i < lines2.length; i++)
      if (/^\s+\S+ \{/.test(lines2[i]) && !/->/.test(lines2[i])) si.push(i)
    for (var a = 0; a < si.length && !changed; a++) {
      for (var b = a + 1; b < si.length; b++) {
        var sw = lines2.slice()
        var tmp = sw[si[a]]; sw[si[a]] = sw[si[b]]; sw[si[b]] = tmp
        var cand = sw.join('\n')
        var rendered = render_candidate(cand)
        if (rendered === original) return cand
        if (render_score(rendered, original) > best_score) {
          lines2 = sw; best_score = render_score(rendered, original); changed = true; break
        }
      }
    }
  }

  return lines2.join('\n')
}

function split_blocks(text) {
  var lines = text.split('\n')
  var blocks = []
  var current = []
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      if (current.length > 0) { blocks.push(current); current = [] }
    } else {
      current.push(lines[i])
    }
  }
  if (current.length > 0) blocks.push(current)
  return blocks
}

function parse_block_data(lines) {
  var max_w = 0
  for (var i = 0; i < lines.length; i++)
    if (lines[i].length > max_w) max_w = lines[i].length
  var grid = []
  for (var y = 0; y < lines.length; y++) {
    grid[y] = []
    for (var x = 0; x < max_w; x++)
      grid[y][x] = x < lines[y].length ? lines[y][x] : ' '
  }
  var h = grid.length

  // Find bounds from bottom border
  var bottom = h - 1
  var left_col = 0, right_col = max_w - 1
  for (var x = 0; x < max_w; x++)
    if (grid[bottom][x] === '|') { left_col = x; break }
  for (var x = max_w - 1; x >= 0; x--)
    if (grid[bottom][x] === '|') { right_col = x; break }

  // Extract space name from top border
  var top_str = lines[0]
  var name_match = top_str.match(/_ (.+?) _/)
  var name = name_match ? name_match[1] : ''

  var stations = find_stations(grid, h, left_col, right_col)
  var subspaces = find_subspaces(grid, h, left_col, right_col, stations)
  var ports = find_ports(grid, h, left_col, right_col, subspaces)
  var state = find_state(grid, h, left_col, right_col, stations)
  var connections = trace_all(grid, stations, subspaces, ports, left_col, right_col)

  // Build port labels for route generation
  var left_ports = ports.filter(function(p) { return p.side === 'left' })
  var right_ports = ports.filter(function(p) { return p.side === 'right' })
  var port_labels = {}
  for (var i = 0; i < left_ports.length; i++) {
    var pi = ports.indexOf(left_ports[i])
    port_labels[pi] = left_ports.length === 1 ? 'in' : (i === 0 ? 'in' : 'in:' + String.fromCharCode(97 + i - 1))
  }
  for (var i = 0; i < right_ports.length; i++) {
    var pi = ports.indexOf(right_ports[i])
    port_labels[pi] = right_ports.length === 1 ? 'out' : (i === 0 ? 'out' : 'out:' + String.fromCharCode(97 + i - 1))
  }

  var source = emit(name, stations, subspaces, ports, state, connections)
  return { source: source, stations: stations, subspaces: subspaces, ports: ports, port_labels: port_labels }
}

function parse_block(lines) {
  return parse_block_data(lines).source
}

// --- Component detection ---

function find_stations(grid, h, left_col, right_col) {
  var stations = []
  for (var y = 1; y < h - 1; y++) {
    for (var x = left_col + 1; x < right_col; x++) {
      if (grid[y][x] !== '(') continue
      if (y < 1 || y + 1 >= h) continue
      if (x + 1 > right_col) continue
      // Check station structure: / above-right, \ below-right
      if (grid[y - 1][x + 1] !== '/') continue
      // Find matching ) with \ below-left and / above-left
      var rx = -1
      for (var x2 = x + 1; x2 <= right_col; x2++) {
        if (grid[y][x2] === ')') {
          // Verify station boundary: / at (x2-1, y+1)
          if (y + 1 < h && grid[y + 1][x2 - 1] === '/') { rx = x2; break }
        }
      }
      if (rx < 0) continue
      // Also check \ at (x2-1, y-1) for the top-right corner
      if (grid[y - 1][rx - 1] !== '\\') continue

      // Extract source
      var raw = ''
      for (var j = x + 1; j < rx; j++) raw += grid[y][j]
      var source = raw.replace(/^\s+/, '').replace(/\s+$/, '')

      // Extract name from 2 rows up — format: "_ name ____..."
      var name_raw = ''
      for (var j = x + 2; j < rx; j++) name_raw += grid[y - 2][j]
      var nm = name_raw.match(/_ (.+?) _/)
      var sname = nm ? nm[1] : ''

      stations.push({ name: sname, source: source, paren_x: x, close_x: rx, body_y: y })
    }
  }
  return stations
}

function find_subspaces(grid, h, left_col, right_col, stations) {
  var subspaces = []
  for (var y = 1; y < h - 1; y++) {
    // Find interior o pairs (only subspace sides render interior o's —
    // wall ports are outside the scan; stations may share the row)
    var os = []
    for (var x = left_col + 1; x < right_col; x++)
      if (grid[y][x] === 'o') os.push(x)
    for (var i = 0; i < os.length - 1; i++) {
      var lx = os[i], rx = os[i + 1]
      if (grid[y - 1][lx] !== '|' || grid[y - 1][rx] !== '|') continue
      var raw = ''
      for (var j = lx + 1; j < rx; j++) raw += grid[y - 1][j]
      subspaces.push({ name: raw.trim(), left_x: lx, right_x: rx, port_y: y })
      i++  // consume both o's so adjacent boxes can't pair across the gap
    }
  }
  return subspaces
}

function find_ports(grid, h, left_col, right_col, subspaces) {
  var sub_pos = {}
  for (var i = 0; i < subspaces.length; i++) {
    sub_pos[subspaces[i].left_x + ',' + subspaces[i].port_y] = true
    sub_pos[subspaces[i].right_x + ',' + subspaces[i].port_y] = true
  }
  var ports = []
  for (var y = 0; y < h; y++) {
    if (grid[y][left_col] === 'o' && !sub_pos[left_col + ',' + y])
      ports.push({ side: 'left', x: left_col, y: y })
    if (grid[y][right_col] === 'o' && !sub_pos[right_col + ',' + y])
      ports.push({ side: 'right', x: right_col, y: y })
  }
  return ports
}

function find_state(grid, h, left_col, right_col, stations) {
  var state = []
  var station_ys = {}
  for (var i = 0; i < stations.length; i++) station_ys[stations[i].body_y] = true
  for (var y = 0; y < h; y++) {
    if (station_ys[y]) continue
    for (var x = left_col + 1; x < right_col; x++) {
      if (grid[y][x] !== '$') continue
      var text = ''
      for (var j = x; j < right_col; j++) text += grid[y][j]
      text = text.trim()
      var m = text.match(/^\$(\w+):\s*(.+)$/)
      if (m) { state.push({ name: m[1], value: m[2].trim() }); break }
    }
  }
  return state
}

// --- Wire tracing ---

function is_h_connectable(ch) {
  return ch === '-' || ch === 'o' || ch === '(' || ch === ')' || ch === 'O' ||
         ch === 'v' || ch === '^' || ch === '>' || ch === '<'
}
function is_v_connectable(ch) {
  return ch === '|' || ch === 'o' || ch === 'O' ||
         ch === 'v' || ch === '^' || ch === '>' || ch === '<'
}
function is_wire(ch) {
  return ch === '-' || ch === '|' || ch === 'v' || ch === '^' ||
         ch === '>' || ch === '<' || ch === 'O'
}

function check_h_thru(grid, x, y) {
  var left = x > 0 ? grid[y][x - 1] : ' '
  var right = (x + 1 < grid[y].length) ? grid[y][x + 1] : ' '
  return is_h_connectable(left) && is_h_connectable(right)
}
function check_v_thru(grid, x, y) {
  var above = y > 0 ? grid[y - 1][x] : ' '
  var below = (y + 1 < grid.length) ? grid[y + 1][x] : ' '
  return is_v_connectable(above) && is_v_connectable(below)
}
function char_dir(ch) {
  return ch === 'v' ? 'down' : ch === '^' ? 'up' : ch === '>' ? 'right' : ch === '<' ? 'left' : null
}

// --- Flow inference ---
// Junction chars fix flow only at their own cells; plain - and | runs are
// directionless, letting a trace ride a wire backwards after a legal turn.
// Infer each maximal run's direction from its evidence: arrow chars on the
// run, attachments at its ends ( ')' departs right, '(' and wall-'o'
// receive ), and corner chars at its ends (a corner whose vertical flows
// away means the horizontal flows toward it, and vice versa). Cells of
// runs with consistent evidence are marked; traversal rejects moves
// against a marked flow. The two cells beside a left port stay unmarked —
// a contract return T-junctions there and runs against the port's wire.
function infer_h_flow(grid, left_col, right_col) {
  var flow = {}
  var run_chars = '-><Ov^'
  for (var y = 0; y < grid.length; y++) {
    var x = left_col + 1
    while (x < right_col) {
      if (run_chars.indexOf(grid[y][x]) < 0) { x++; continue }
      var x0 = x
      while (x < right_col && run_chars.indexOf(grid[y][x]) >= 0) x++
      var x1 = x - 1
      var has_dash = false
      for (var j = x0; j <= x1; j++) if ('-><'.indexOf(grid[y][j]) >= 0) has_dash = true
      if (!has_dash) continue
      var dirs = {}
      for (var j = x0; j <= x1; j++) {
        if (grid[y][j] === '>') dirs.right = true
        if (grid[y][j] === '<') dirs.left = true
      }
      var lt = x0 - 1 >= 0 ? grid[y][x0 - 1] : ' '
      var rt = x1 + 1 < grid[y].length ? grid[y][x1 + 1] : ' '
      if (lt === ')' || lt === 'o') dirs.right = true
      if (rt === '(' || rt === 'o') dirs.right = true
      if (rt === ')') dirs.left = true
      // Corner evidence at run ends: v/^ with the vertical on one side only
      function corner_dir(cx, at_right_end) {
        var ch = grid[y][cx]
        if (ch !== 'v' && ch !== '^') return null
        var above = y > 0 && is_v_connectable(grid[y - 1][cx])
        var below = y + 1 < grid.length && is_v_connectable(grid[y + 1][cx])
        if (above === below) return null
        var away = (ch === 'v' && below) || (ch === '^' && above)
        // flow toward an away-corner, away from an into-corner
        if (at_right_end) return away ? 'right' : 'left'
        return away ? 'left' : 'right'
      }
      var cl = corner_dir(x0, false), cr = corner_dir(x1, true)
      if (cl) dirs[cl] = true
      if (cr) dirs[cr] = true
      if (dirs.right && !dirs.left) {
        for (var j = x0; j <= x1; j++) flow[j + ',' + y] = 'right'
      } else if (dirs.left && !dirs.right) {
        for (var j = x0; j <= x1; j++) flow[j + ',' + y] = 'left'
      }
    }
    // Port-mouth exemption: the 1-2 cells beside a wall port carry both
    // directions (contract returns T in on the left; down-port responses
    // branch off on the right)
    if (grid[y][left_col] === 'o') {
      delete flow[(left_col + 1) + ',' + y]
      delete flow[(left_col + 2) + ',' + y]
    }
    if (grid[y][right_col] === 'o') {
      delete flow[(right_col - 1) + ',' + y]
      delete flow[(right_col - 2) + ',' + y]
    }
  }
  return flow
}

function infer_v_flow(grid, left_col, right_col) {
  var flow = {}
  var run_chars = '|v^O><'
  var h = grid.length
  for (var x = left_col + 1; x < right_col; x++) {
    var y = 1
    while (y < h - 1) {
      if (run_chars.indexOf(grid[y][x]) < 0) { y++; continue }
      var y0 = y
      while (y < h - 1 && run_chars.indexOf(grid[y][x]) >= 0) y++
      var y1 = y - 1
      var has_bar = false
      for (var j = y0; j <= y1; j++) if ('|v^'.indexOf(grid[j][x]) >= 0) has_bar = true
      if (!has_bar) continue
      var dirs = {}
      for (var j = y0; j <= y1; j++) {
        if (grid[j][x] === 'v') dirs.down = true
        if (grid[j][x] === '^') dirs.up = true
      }
      // Corner evidence at run ends: >/< with the horizontal on one side only
      function corner_dir(cy, at_bottom_end) {
        var ch = grid[cy][x]
        if (ch !== '>' && ch !== '<') return null
        var left = x > 0 && is_h_connectable(grid[cy][x - 1])
        var right = x + 1 < grid[cy].length && is_h_connectable(grid[cy][x + 1])
        if (left === right) return null
        var away = (ch === '>' && right) || (ch === '<' && left)
        if (at_bottom_end) return away ? 'down' : 'up'
        return away ? 'up' : 'down'
      }
      var ct = corner_dir(y0, false), cb = corner_dir(y1, true)
      if (ct) dirs[ct] = true
      if (cb) dirs[cb] = true
      if (dirs.down && !dirs.up) {
        for (var j = y0; j <= y1; j++) flow[x + ',' + j] = 'down'
      } else if (dirs.up && !dirs.down) {
        for (var j = y0; j <= y1; j++) flow[x + ',' + j] = 'up'
      }
    }
  }
  return flow
}

var opposite = { left: 'right', right: 'left', up: 'down', down: 'up' }

function get_exits(grid, x, y, dir, flows) {
  var ch = grid[y][x]
  var results = []

  function try_exit(dx, dy, new_dir) {
    var nx = x + dx, ny = y + dy
    if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[ny].length) return
    var nc = grid[ny][nx]
    if (new_dir === 'left' || new_dir === 'right') {
      if (!is_h_connectable(nc)) return
      if (flows && flows.h[nx + ',' + ny] === opposite[new_dir]) return
    } else {
      if (!is_v_connectable(nc)) return
      if (flows && flows.v[nx + ',' + ny] === opposite[new_dir]) return
    }
    results.push({ x: nx, y: ny, dir: new_dir })
  }

  if (ch === '-') {
    if (dir === 'right') try_exit(1, 0, 'right')
    else if (dir === 'left') try_exit(-1, 0, 'left')
  } else if (ch === '|') {
    if (dir === 'down') try_exit(0, 1, 'down')
    else if (dir === 'up') try_exit(0, -1, 'up')
  } else if (ch === 'O') {
    if (dir === 'right') try_exit(1, 0, 'right')
    else if (dir === 'left') try_exit(-1, 0, 'left')
    else if (dir === 'up') try_exit(0, -1, 'up')
    else if (dir === 'down') try_exit(0, 1, 'down')
  } else if (ch === 'v' || ch === '^') {
    // Vertical-flow junction: the vertical wire at this cell flows in the
    // char's direction (v=down, ^=up). Layout invariants guarantee the
    // char is flow-faithful, so traversal must respect it:
    //  - arriving along the horizontal: continue straight; branch onto the
    //    vertical only in its flow direction (away from the wire)
    //  - arriving along the vertical WITH the flow: continue, or turn onto
    //    the horizontal where the vertical ends (both h sides — the h flow
    //    isn't encoded here)
    //  - arriving against the vertical flow: dead end
    var flow_dy = ch === 'v' ? 1 : -1
    var flow_vdir = ch === 'v' ? 'down' : 'up'
    if (dir === 'left' || dir === 'right') {
      try_exit(dir === 'left' ? -1 : 1, 0, dir)
      try_exit(0, flow_dy, flow_vdir)
    } else if (dir === flow_vdir) {
      try_exit(0, flow_dy, flow_vdir)
      // Turning onto the horizontal is only possible where the vertical
      // ends; at a v-through cell the arrow marks a horizontal wire
      // merging IN (cross-and-merge is one-directional)
      if (!check_v_thru(grid, x, y)) {
        try_exit(1, 0, 'right')
        try_exit(-1, 0, 'left')
      }
    }
  } else if (ch === '>' || ch === '<') {
    // Horizontal-flow junction: the horizontal wire here flows in the
    // char's direction (>=right, <=left). Mirror of the above:
    //  - arriving along the vertical: continue straight; branch onto the
    //    horizontal only in its flow direction
    //  - arriving along the horizontal WITH the flow: continue, or turn
    //    onto the vertical (both v sides)
    //  - arriving against the horizontal flow: dead end
    var flow_dx = ch === '>' ? 1 : -1
    var flow_hdir = ch === '>' ? 'right' : 'left'
    if (dir === 'up' || dir === 'down') {
      try_exit(0, dir === 'up' ? -1 : 1, dir)
      try_exit(flow_dx, 0, flow_hdir)
    } else if (dir === flow_hdir) {
      try_exit(flow_dx, 0, flow_hdir)
      // Same one-direction rule, transposed: at an h-through cell the
      // arrow marks a vertical wire merging in, not a horizontal turning
      if (!check_h_thru(grid, x, y)) {
        try_exit(0, -1, 'up')
        try_exit(0, 1, 'down')
      }
    }
  } else if (ch === 'o') {
    if (dir !== 'left') try_exit(1, 0, 'right')
    if (dir !== 'right') try_exit(-1, 0, 'left')
    if (dir !== 'down') try_exit(0, -1, 'up')
    if (dir !== 'up') try_exit(0, 1, 'down')
  } else if (ch === ')') {
    try_exit(1, 0, 'right')
  }
  // ( is a sink — no exits

  return results
}

function trace_all(grid, stations, subspaces, ports, left_col, right_col) {
  var flows = { h: infer_h_flow(grid, left_col, right_col),
                v: infer_v_flow(grid, left_col, right_col) }
  // Build lookup: (x,y) -> [{kind, index, role}]
  var attach_at = {}
  function add(x, y, info) {
    var k = x + ',' + y
    if (!attach_at[k]) attach_at[k] = []
    attach_at[k].push(info)
  }

  // Detect contract ports: a contract return T-junctions into the port's
  // wire — a ^ within a few cells right of the port, fed by a vertical
  // from below (a ^ fed from above would be the port's own fan rising).
  var contract_set = {}
  for (var i = 0; i < ports.length; i++) {
    var p = ports[i]
    if (p.side !== 'left') continue
    for (var dx = 1; dx <= 3; dx++) {
      var rx = p.x + dx
      if (rx >= grid[p.y].length) break
      var nc = grid[p.y][rx]
      if (nc === '^' &&
          p.y + 1 < grid.length && is_v_connectable(grid[p.y + 1][rx]) &&
          !(p.y > 0 && is_v_connectable(grid[p.y - 1][rx]))) {
        contract_set[i] = true
        break
      }
      if (!is_h_connectable(nc)) break
    }
  }

  // Register attachments
  var sources = []
  for (var i = 0; i < ports.length; i++) {
    var p = ports[i]
    add(p.x, p.y, { kind: 'port', index: i, side: p.side })
    if (p.side === 'left') {
      sources.push({ x: p.x, y: p.y, dir: 'right', info: { kind: 'port', index: i, side: 'left' } })
    } else {
      // A right port with a v branching off its mouth (fed downward) is a
      // down-port response source — trace it leftward
      for (var dx = 1; dx <= 3; dx++) {
        var lx = p.x - dx
        if (lx < 0) break
        var nc = grid[p.y][lx]
        if (nc === 'v' &&
            p.y + 1 < grid.length && is_v_connectable(grid[p.y + 1][lx]) &&
            !(p.y > 0 && is_v_connectable(grid[p.y - 1][lx]))) {
          sources.push({ x: p.x, y: p.y, dir: 'left', info: { kind: 'port', index: i, side: 'right' } })
          break
        }
        if (!is_h_connectable(nc)) break
      }
    }
  }
  for (var i = 0; i < stations.length; i++) {
    var s = stations[i]
    add(s.close_x, s.body_y, { kind: 'station_out', index: i })
    add(s.paren_x, s.body_y, { kind: 'station_in', index: i })
    sources.push({ x: s.close_x, y: s.body_y, dir: 'right', info: { kind: 'station_out', index: i } })
  }
  for (var i = 0; i < subspaces.length; i++) {
    var sub = subspaces[i]
    add(sub.left_x, sub.port_y, { kind: 'subspace_in', index: i })
    add(sub.right_x, sub.port_y, { kind: 'subspace_out', index: i })
    sources.push({ x: sub.right_x, y: sub.port_y, dir: 'right',
                   info: { kind: 'subspace_out', index: i } })
  }

  // BFS from each source
  var connections = []
  for (var si = 0; si < sources.length; si++) {
    var src = sources[si]
    var queue = [{ x: src.x, y: src.y, dir: src.dir }]
    var visited = {}

    while (queue.length > 0) {
      var cur = queue.shift()
      var vk = cur.x + ',' + cur.y + ',' + cur.dir
      if (visited[vk]) continue
      visited[vk] = true

      var here = attach_at[cur.x + ',' + cur.y]
      if (here && !(cur.x === src.x && cur.y === src.y)) {
        var found_sink = false
        for (var ai = 0; ai < here.length; ai++) {
          var a = here[ai]
          var is_sink = a.kind === 'station_in' || a.kind === 'subspace_in' ||
                        (a.kind === 'port' && a.side === 'right') ||
                        (a.kind === 'port' && a.side === 'left' && contract_set[a.index])
          if (is_sink) { connections.push({ from: src.info, to: a }); found_sink = true }
        }
        if (found_sink) continue
        // At a source-only attachment: stop
        var is_source = here.some(function(a) {
          return a.kind === 'station_out' || a.kind === 'subspace_out' ||
                 (a.kind === 'port' && a.side === 'left' && !contract_set[a.index])
        })
        if (is_source) continue
      }

      var exits = get_exits(grid, cur.x, cur.y, cur.dir, flows)
      for (var ei = 0; ei < exits.length; ei++) queue.push(exits[ei])
    }
  }

  // Filter spurious self-loops from contract fan-in
  var filtered = []
  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    if (c.from.kind === 'station_out' && c.to.kind === 'station_in' &&
        c.from.index === c.to.index) {
      var has_contract = connections.some(function(c2) {
        return c2.from.kind === 'station_out' && c2.from.index === c.from.index &&
               c2.to.kind === 'port' && c2.to.side === 'left'
      })
      if (has_contract) continue
    }
    filtered.push(c)
  }

  // Deduplicate
  var seen = {}
  var deduped = []
  for (var i = 0; i < filtered.length; i++) {
    var c = filtered[i]
    var key = c.from.kind + c.from.index + '|' + c.to.kind + c.to.index
    if (seen[key]) continue
    seen[key] = true
    deduped.push(c)
  }

  // Sort connections by position: source (x,y) then dest (x,y)
  function pos_of(ep) {
    if (ep.kind === 'port') return { x: ports[ep.index].x, y: ports[ep.index].y }
    if (ep.kind === 'station_in') return { x: stations[ep.index].paren_x, y: stations[ep.index].body_y }
    if (ep.kind === 'station_out') return { x: stations[ep.index].close_x, y: stations[ep.index].body_y }
    if (ep.kind === 'subspace_in') return { x: subspaces[ep.index].left_x, y: subspaces[ep.index].port_y }
    if (ep.kind === 'subspace_out') return { x: subspaces[ep.index].right_x, y: subspaces[ep.index].port_y }
    return { x: 0, y: 0 }
  }
  deduped.sort(function(a, b) {
    var fa = pos_of(a.from), fb = pos_of(b.from), ta = pos_of(a.to), tb = pos_of(b.to)
    return (fa.x - fb.x) || (fa.y - fb.y) || (ta.x - tb.x) || (ta.y - tb.y)
  })

  return deduped
}

// --- Source.dm emission ---

function emit(name, stations, subspaces, ports, state, connections) {
  var lines = [name]

  // Label ports
  var left_ports = ports.filter(function(p) { return p.side === 'left' })
  var right_ports = ports.filter(function(p) { return p.side === 'right' })

  var port_label = {}  // port index → label string (without @)
  for (var i = 0; i < left_ports.length; i++) {
    var pi = ports.indexOf(left_ports[i])
    if (left_ports.length === 1) port_label[pi] = 'in'
    else port_label[pi] = i === 0 ? 'in' : 'in:' + String.fromCharCode(97 + i - 1)
  }
  for (var i = 0; i < right_ports.length; i++) {
    var pi = ports.indexOf(right_ports[i])
    if (right_ports.length === 1) port_label[pi] = 'out'
    else port_label[pi] = i === 0 ? 'out' : 'out:' + String.fromCharCode(97 + i - 1)
  }

  // Declare ports
  for (var i = 0; i < ports.length; i++)
    if (port_label[i]) lines.push('  @' + port_label[i])

  // Declare state
  for (var i = 0; i < state.length; i++)
    lines.push('  $' + state[i].name + ' ' + state[i].value)

  // Declare all stations — anonymous ones (s0, s1, ...) too. Declaring
  // them under their rendered rank-name round-trips exactly (extract keeps
  // declared sN names and rank-naming skips taken names), while an inline
  // {…} reference would mint a new station per occurrence.
  for (var i = 0; i < stations.length; i++)
    if (stations[i].name) lines.push('  ' + stations[i].name + ' ' + stations[i].source)

  // Build routes with chaining
  var routes = build_routes(connections, stations, subspaces, ports, port_label)
  for (var i = 0; i < routes.length; i++)
    lines.push('  ' + routes[i].join(' -> '))

  // Trailing flush: seedlikes_from_string doesn't flush the last action,
  // so append a {} dialect line that triggers flush of the real last property.
  // When flushed, it sets dialect={} (same as default), so it's harmless.
  if (lines.length > 1) lines.push('  {}')

  return lines.join('\n')
}

function build_routes(connections, stations, subspaces, ports, port_label) {
  // Build adjacency: station index → incoming/outgoing connection indices
  var in_by = {}, out_by = {}
  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    if (c.to.kind === 'station_in') {
      if (!in_by[c.to.index]) in_by[c.to.index] = []
      in_by[c.to.index].push(i)
    }
    if (c.from.kind === 'station_out') {
      if (!out_by[c.from.index]) out_by[c.from.index] = []
      out_by[c.from.index].push(i)
    }
  }

  function ep_name(ep) {
    if (ep.kind === 'port') return '@' + port_label[ep.index]
    if (ep.kind === 'station_in' || ep.kind === 'station_out')
      return stations[ep.index].name || stations[ep.index].source
    if (ep.kind === 'subspace_in') return subspaces[ep.index].name + '.in'
    if (ep.kind === 'subspace_out') return subspaces[ep.index].name + '.out'
    return '?'
  }

  var used = {}
  var routes = []

  function follow_chain(start_name, first_to) {
    var chain = [start_name]
    var cur = first_to
    while (true) {
      chain.push(ep_name(cur))
      if (cur.kind !== 'station_in') break
      var si = cur.index
      var outs = out_by[si], ins = in_by[si]
      if (!outs || outs.length !== 1 || !ins || ins.length !== 1) break
      var next_ci = outs[0]
      if (used[next_ci]) break
      used[next_ci] = true
      cur = connections[next_ci].to
    }
    return chain
  }

  // Start chains from port/subspace sources
  for (var i = 0; i < connections.length; i++) {
    if (used[i]) continue
    var c = connections[i]
    if (c.from.kind !== 'port' && c.from.kind !== 'subspace_out') continue
    used[i] = true
    routes.push(follow_chain(ep_name(c.from), c.to))
  }

  // Remaining connections (station → ...)
  for (var i = 0; i < connections.length; i++) {
    if (used[i]) continue
    used[i] = true
    routes.push(follow_chain(ep_name(connections[i].from), connections[i].to))
  }

  return routes
}
