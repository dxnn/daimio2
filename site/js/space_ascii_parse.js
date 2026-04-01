// site/js/space_ascii_parse.js — Parse ASCII space diagrams back to source.dm format
//
// Takes a render.txt string and produces a source.dm string.
// Round-trip: render.txt → parse_ascii() → source.dm → seedlikes_from_string → extract → layout → render

import D from '../../daimio/daimio.js'
import { render_space, render_all } from './space_ascii.js'

export function parse_ascii(text, options) {
  var blocks = split_blocks(text)
  var parsed = blocks.map(parse_block_data)
  var source = parsed.map(function(p) { return p.source }).join('\n')
  return refine(text, source, parsed, options)
}

// Raw parse without refine (for debugging)
export function parse_ascii_raw(text) {
  var blocks = split_blocks(text)
  return blocks.map(function(b) { return parse_block_data(b).source }).join('\n')
}

function try_render(source, options) {
  var sl = D.seedlikes_from_string(source)
  var names = Object.keys(sl)
  if (names.length === 0) return ''
  if (names.length === 1) return render_space(names[0], sl[names[0]], options)
  return render_all(sl, options)
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
      var sn = /^s\d+$/.test(p.stations[i].name) ? p.stations[i].source : p.stations[i].name
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

function refine(original, source, parsed_blocks, options) {
  if (try_render(source, options) === original) return source

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
  var extra = generate_all_routes(parsed_blocks)
  var extra_seen = {}
  for (var i = 0; i < traced_routes.length; i++) extra_seen[traced_routes[i].trim()] = true
  var extras = []
  for (var i = 0; i < extra.length; i++)
    if (!extra_seen[extra[i].trim()]) { extras.push(extra[i]); extra_seen[extra[i].trim()] = true }

  function build(routes) { return header.concat(routes).concat(footer).join('\n') }
  function sc(routes) {
    var rendered = try_render(build(routes), options)
    return rendered === original ? Infinity : render_score(rendered, original)
  }

  // Bidirectional greedy: top-down (remove) and bottom-up (add), alternating
  var current = traced_routes.slice()
  var best_score = sc(current)
  if (best_score === Infinity) return build(current)

  var changed = true
  while (changed) {
    changed = false

    // Top-down: try removing each route
    for (var i = current.length - 1; i >= 0; i--) {
      var candidate = current.slice(0, i).concat(current.slice(i + 1))
      var s = sc(candidate)
      if (s === Infinity) return build(candidate)
      if (s > best_score) { current = candidate; best_score = s; changed = true; break }
    }
    if (changed) continue

    // Bottom-up: try adding from extras
    for (var i = 0; i < extras.length; i++) {
      var candidate = current.concat([extras[i]])
      var s = sc(candidate)
      if (s === Infinity) return build(candidate)
      if (s > best_score) {
        current = candidate
        extras.splice(i, 1)
        best_score = s; changed = true; break
      }
    }
    if (changed) continue

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
        var rendered = try_render(cand, options)
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
  // Collect station body rows to skip
  var station_rows = {}
  for (var i = 0; i < stations.length; i++) station_rows[stations[i].body_y] = true

  for (var y = 1; y < h - 1; y++) {
    if (station_rows[y]) continue
    // Find interior o pairs
    var os = []
    for (var x = left_col + 1; x < right_col; x++)
      if (grid[y][x] === 'o') os.push(x)
    for (var i = 0; i < os.length - 1; i++) {
      var lx = os[i], rx = os[i + 1]
      if (y < 1) continue
      if (grid[y - 1][lx] !== '|' || grid[y - 1][rx] !== '|') continue
      var raw = ''
      for (var j = lx + 1; j < rx; j++) raw += grid[y - 1][j]
      subspaces.push({ name: raw.trim(), left_x: lx, right_x: rx, port_y: y })
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

function get_exits(grid, x, y, dir) {
  var ch = grid[y][x]
  var results = []

  function try_exit(dx, dy, new_dir) {
    var nx = x + dx, ny = y + dy
    if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[ny].length) return
    var nc = grid[ny][nx]
    if (new_dir === 'left' || new_dir === 'right') {
      if (!is_h_connectable(nc)) return
    } else {
      if (!is_v_connectable(nc)) return
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
  } else if (ch === 'v' || ch === '^' || ch === '>' || ch === '<') {
    // Junction char: try all directions except back. The refine step
    // will remove any false-positive connections from over-eager forking.
    if (dir !== 'left') try_exit(1, 0, 'right')
    if (dir !== 'right') try_exit(-1, 0, 'left')
    if (dir !== 'down') try_exit(0, -1, 'up')
    if (dir !== 'up') try_exit(0, 1, 'down')
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
  // Build lookup: (x,y) -> [{kind, index, role}]
  var attach_at = {}
  function add(x, y, info) {
    var k = x + ',' + y
    if (!attach_at[k]) attach_at[k] = []
    attach_at[k].push(info)
  }

  // Detect contract ports: left port with junction char immediately right + vertical wire below
  var contract_set = {}
  for (var i = 0; i < ports.length; i++) {
    var p = ports[i]
    if (p.side !== 'left') continue
    var rx = p.x + 1
    if (rx >= grid[p.y].length) continue
    var nc = grid[p.y][rx]
    if ((nc === '^' || nc === 'v' || nc === '|') &&
        p.y + 1 < grid.length && is_v_connectable(grid[p.y + 1][rx]))
      contract_set[i] = true
  }

  // Register attachments
  var sources = []
  for (var i = 0; i < ports.length; i++) {
    var p = ports[i]
    add(p.x, p.y, { kind: 'port', index: i, side: p.side })
    if (p.side === 'left')
      sources.push({ x: p.x, y: p.y, dir: 'right', info: { kind: 'port', index: i, side: 'left' } })
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

      var exits = get_exits(grid, cur.x, cur.y, cur.dir)
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

  // Determine anonymous stations (s0, s1, ...)
  var anon = {}
  for (var i = 0; i < stations.length; i++)
    if (/^s\d+$/.test(stations[i].name)) anon[i] = true

  // Declare named stations
  for (var i = 0; i < stations.length; i++)
    if (!anon[i]) lines.push('  ' + stations[i].name + ' ' + stations[i].source)

  // Build routes with chaining
  var routes = build_routes(connections, stations, subspaces, ports, port_label, anon)
  for (var i = 0; i < routes.length; i++)
    lines.push('  ' + routes[i].join(' -> '))

  // Trailing flush: seedlikes_from_string doesn't flush the last action,
  // so append a {} dialect line that triggers flush of the real last property.
  // When flushed, it sets dialect={} (same as default), so it's harmless.
  if (lines.length > 1) lines.push('  {}')

  return lines.join('\n')
}

function build_routes(connections, stations, subspaces, ports, port_label, anon) {
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
    if (ep.kind === 'station_in' || ep.kind === 'station_out') {
      if (anon[ep.index]) return stations[ep.index].source
      return stations[ep.index].name
    }
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
