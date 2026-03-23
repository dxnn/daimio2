// daimio/space_ascii.js — three-phase ASCII topology renderer for Daimio spaces
//
// Pipeline: extract (seedlike → topology) → layout (topology → positioned) → render (positioned → ASCII)

export function extract(name, seedlike) {
  var ports = []
  var port_keys = Object.keys(seedlike.ports || {})
  for (var i = 0; i < port_keys.length; i++) {
    var key = port_keys[i]
    var arr = seedlike.ports[key]
    var prefix = key.split(':')[0]
    var dir = (prefix === 'in' || prefix === 'up') ? 'left' : 'right'
    var flavour = arr[0]
    ports.push({ id: 'p' + i, key: key, dir: dir, flavour: flavour })
  }

  var stations = []
  var station_names = Object.keys(seedlike.stations || {})
  for (var i = 0; i < station_names.length; i++) {
    var sname = station_names[i]
    var station = seedlike.stations[sname]
    var source = station.value || ''
    var extra = (station.extraports || []).slice()
    var sends = source.match(/>@(\w+)/g)
    if (sends) {
      for (var j = 0; j < sends.length; j++) {
        var pname = sends[j].slice(2)
        if (extra.indexOf(pname) < 0) extra.push(pname)
      }
    }
    stations.push({ id: 's' + i, name: sname, source: source, ports: extra })
  }

  // Build lookup maps
  var port_key_to_id = {}
  for (var i = 0; i < ports.length; i++)
    port_key_to_id[ports[i].key] = ports[i].id

  var station_name_to_id = {}
  for (var i = 0; i < stations.length; i++)
    station_name_to_id[stations[i].name] = stations[i].id

  var subspace_names = seedlike.subspaces || {}
  var subspaces = []
  var subspace_keys = Object.keys(subspace_names)
  for (var i = 0; i < subspace_keys.length; i++)
    subspaces.push(subspace_names[subspace_keys[i]])

  // Resolve a route endpoint to { id, port }
  function resolve_endpoint(ep) {
    var dot = ep.indexOf('.')
    if (dot < 0) {
      // Boundary port
      return { id: port_key_to_id[ep], port: ep }
    }
    var comp = ep.slice(0, dot)
    var port = ep.slice(dot + 1)
    if (subspace_names[comp] !== undefined) {
      // Subspace port — id is the referenced seedlike name
      return { id: subspace_names[comp], port: port }
    }
    if (station_name_to_id[comp] !== undefined) {
      // Station port — map 'in'/'out' to '_in'/'_out'
      var mapped = (port === 'in') ? '_in' : (port === 'out') ? '_out' : port
      return { id: station_name_to_id[comp], port: mapped }
    }
    return null
  }

  // Process routes into connections
  var routes = seedlike.routes || []
  var connections = []
  // Build a set of route signatures for contract detection
  var route_set = {}
  for (var i = 0; i < routes.length; i++)
    route_set[routes[i][0] + '|' + routes[i][1]] = true

  for (var i = 0; i < routes.length; i++) {
    var from = resolve_endpoint(routes[i][0])
    var to = resolve_endpoint(routes[i][1])
    if (!from || !to) continue

    // Detect contract: check if reverse route exists
    // For [A, B.in] check [B.out, A]; for [B.out, A] check [A, B.in]
    var src = routes[i][0]
    var dst = routes[i][1]
    var type = 'faf'

    // Check for matching reverse pair
    // If src has '.in' suffix, reverse would be src_base+'.out' → dst
    // If dst has '.out' suffix, reverse would be dst_base+'.in' ← src
    var src_dot = src.indexOf('.')
    var dst_dot = dst.indexOf('.')
    if (src_dot >= 0) {
      var src_base = src.slice(0, src_dot)
      var src_port = src.slice(src_dot + 1)
      if (src_port === 'out' && route_set[dst + '|' + src_base + '.in'])
        type = 'contract'
    }
    if (dst_dot >= 0) {
      var dst_base = dst.slice(0, dst_dot)
      var dst_port = dst.slice(dst_dot + 1)
      if (dst_port === 'in' && route_set[dst_base + '.out' + '|' + src])
        type = 'contract'
    }

    connections.push({ id: 'c' + connections.length, from: from, to: to, type: type })
  }

  // Fix port directions for custom-named ports by checking connection usage.
  // If a port key doesn't start with a known direction (in/out/up/down),
  // infer from connections: port as source (from) → left, port as dest (to) → right.
  var known_dirs = { 'in': 1, 'out': 1, 'up': 1, 'down': 1 }
  for (var i = 0; i < ports.length; i++) {
    var prefix = ports[i].key.split(':')[0]
    if (known_dirs[prefix]) continue
    for (var j = 0; j < connections.length; j++) {
      if (connections[j].from.id === ports[i].id) { ports[i].dir = 'left'; break }
      if (connections[j].to.id === ports[i].id) { ports[i].dir = 'right'; break }
    }
  }

  // Link contract pairs: for each contract connection, find its reverse
  for (var i = 0; i < connections.length; i++) {
    if (connections[i].type !== 'contract') continue
    if (connections[i].pair) continue
    var ci = connections[i]
    for (var j = i + 1; j < connections.length; j++) {
      var cj = connections[j]
      if (cj.type !== 'contract') continue
      if (cj.pair) continue
      if (ci.from.id === cj.to.id && ci.to.id === cj.from.id) {
        ci.pair = cj.id
        cj.pair = ci.id
        break
      }
    }
  }

  return {
    id: name,
    name: name,
    ports: ports,
    stations: stations,
    subspaces: subspaces,
    connections: connections,
    state: seedlike.state || {}
  }
}

export function topo_sort(topology) {
  var stations = topology.stations || []
  var subspaces = topology.subspaces || []
  var connections = topology.connections || []
  var ports = topology.ports || []

  // Build set of port ids (to exclude from graph)
  var port_ids = {}
  for (var i = 0; i < ports.length; i++)
    port_ids[ports[i].id] = true

  // Collect all component ids
  var comp_ids = []
  var comp_set = {}
  for (var i = 0; i < stations.length; i++) {
    comp_ids.push(stations[i].id)
    comp_set[stations[i].id] = true
  }
  for (var i = 0; i < subspaces.length; i++) {
    comp_ids.push(subspaces[i])
    comp_set[subspaces[i]] = true
  }

  if (comp_ids.length === 0)
    return { layers: [], layer_of: {}, back_edges: [] }

  // Build predecessor lists (component → component edges only)
  var in_edges = {}
  for (var i = 0; i < comp_ids.length; i++)
    in_edges[comp_ids[i]] = []

  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    if (comp_set[c.from.id] && comp_set[c.to.id])
      in_edges[c.to.id].push(c.from.id)
  }

  // Longest-path layering via recursive DFS (three-state for cycle detection)
  var layer_of = {}
  var state = {}        // 0=unvisited, 1=in-progress, 2=done
  var back_edges = []
  function longest_path(id) {
    if (state[id] === 2) return layer_of[id]
    if (state[id] === 1) return -1  // cycle: back-edge
    state[id] = 1
    var max_pred = -1
    var preds = in_edges[id]
    for (var i = 0; i < preds.length; i++) {
      var pred_layer = longest_path(preds[i])
      if (pred_layer === -1) {
        back_edges.push([preds[i], id])
        continue
      }
      if (pred_layer > max_pred) max_pred = pred_layer
    }
    layer_of[id] = max_pred + 1
    state[id] = 2
    return layer_of[id]
  }

  for (var i = 0; i < comp_ids.length; i++)
    longest_path(comp_ids[i])

  // Group into layers
  var max_layer = 0
  for (var i = 0; i < comp_ids.length; i++)
    if (layer_of[comp_ids[i]] > max_layer) max_layer = layer_of[comp_ids[i]]

  var layers = []
  for (var i = 0; i <= max_layer; i++) layers.push([])
  for (var i = 0; i < comp_ids.length; i++)
    layers[layer_of[comp_ids[i]]].push(comp_ids[i])

  return { layers: layers, layer_of: layer_of, back_edges: back_edges }
}

export function layout(topology, options) {
  var HLINE_GAP = 3
  var ROW_HEIGHT = 6
  var HEADER_HEIGHT = 2
  var PORT_COL = 4   // 1 (port 'o') + 3 (hline '---')
  var max_source = (options && options.max_source !== undefined) ? options.max_source : 20

  var name = topology.name
  var ports = topology.ports || []
  var stations = topology.stations || []
  var connections = topology.connections || []
  var subspaces = topology.subspaces || []
  var elements = []

  // ── Lookups ──────────────────────────────────────────────────────────

  var port_by_id = {}
  for (var i = 0; i < ports.length; i++)
    port_by_id[ports[i].id] = ports[i]

  var station_by_id = {}
  for (var i = 0; i < stations.length; i++)
    station_by_id[stations[i].id] = stations[i]

  var subspace_set = {}
  for (var i = 0; i < subspaces.length; i++)
    subspace_set[subspaces[i]] = true

  function is_comp(id) { return !!station_by_id[id] || !!subspace_set[id] }

  function trunc(s) {
    if (max_source > 0 && s.length > max_source) return s.slice(0, max_source - 1) + '\u2026'
    return s
  }

  function comp_w(id) {
    if (station_by_id[id]) {
      var sw = trunc(station_by_id[id].source).length + 6
      var sn = station_by_id[id].name
      if (sn && sn.indexOf('station-') !== 0) sw = Math.max(sw, sn.length + 7)
      return sw
    }
    if (subspace_set[id]) return id.length + 8
    return 0
  }

  // ── Topo sort ────────────────────────────────────────────────────────

  var sorted = topo_sort(topology)
  var layers = sorted.layers
  var layer_of = sorted.layer_of
  var back_edges = sorted.back_edges || []

  // Build back-edge lookup set for skipping in main routing
  var back_edge_set = {}
  for (var i = 0; i < back_edges.length; i++)
    back_edge_set[back_edges[i][0] + '|' + back_edges[i][1]] = true

  // ── Adjacency lookups ────────────────────────────────────────────────
  // forward_comp: comp_id → [conn] outgoing to other comps
  // reverse_comp: comp_id → [conn] incoming from other comps
  // port_to_comp: port_id → conn (boundary port → component)
  // comp_to_port: comp_id → [conn] (component → boundary port)

  var forward_comp = {}
  var reverse_comp = {}
  var port_to_comp = {}
  var comp_to_port = {}

  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id
    if (is_comp(fid) && is_comp(tid)) {
      if (!forward_comp[fid]) forward_comp[fid] = []
      forward_comp[fid].push(c)
      if (!reverse_comp[tid]) reverse_comp[tid] = []
      reverse_comp[tid].push(c)
    } else if (port_by_id[fid] && is_comp(tid)) {
      port_to_comp[fid] = c
    } else if (is_comp(fid) && port_by_id[tid]) {
      if (!comp_to_port[fid]) comp_to_port[fid] = []
      comp_to_port[fid].push(c)
    }
  }

  // ── Layer x positions ────────────────────────────────────────────────

  var layer_width = []
  for (var i = 0; i < layers.length; i++) {
    var max_w = 0
    for (var j = 0; j < layers[i].length; j++) {
      var w = comp_w(layers[i][j])
      if (w > max_w) max_w = w
    }
    layer_width.push(max_w)
  }

  var layer_x = []
  for (var i = 0; i < layers.length; i++) {
    if (i === 0) {
      layer_x.push(PORT_COL)
    } else {
      layer_x.push(layer_x[i - 1] + layer_width[i - 1] + HLINE_GAP)
    }
  }

  // ── Row assignment ───────────────────────────────────────────────────
  // Walk layers left-to-right. Layer 0 components get rows in definition
  // order. Components in later layers inherit the row of their first
  // predecessor; if that row is already used in THIS layer, pick next free.

  var row_of = {}
  var next_row = 0

  for (var i = 0; i < layers.length; i++) {
    var layer_rows_used = {} // rows occupied by components in THIS layer
    for (var j = 0; j < layers[i].length; j++) {
      var cid = layers[i][j]
      if (i === 0) {
        row_of[cid] = next_row
        layer_rows_used[next_row] = true
        next_row++
      } else {
        // Find first predecessor's row
        var preds = reverse_comp[cid] || []
        var target_row = -1
        for (var k = 0; k < preds.length; k++) {
          var pred_row = row_of[preds[k].from.id]
          if (pred_row !== undefined) { target_row = pred_row; break }
        }
        if (target_row >= 0 && !layer_rows_used[target_row]) {
          row_of[cid] = target_row
          layer_rows_used[target_row] = true
          if (target_row >= next_row) next_row = target_row + 1
        } else {
          row_of[cid] = next_row
          layer_rows_used[next_row] = true
          next_row++
        }
      }
    }
  }

  var total_rows = next_row

  function comp_y(row) { return HEADER_HEIGHT + row * ROW_HEIGHT }
  function wire_y(row) { return comp_y(row) + 3 }

  // ── Track used ports (ports that participate in connections) ──────────

  var used_ports = {}
  for (var i = 0; i < connections.length; i++) {
    if (port_by_id[connections[i].from.id]) used_ports[connections[i].from.id] = true
    if (port_by_id[connections[i].to.id]) used_ports[connections[i].to.id] = true
  }

  // ── Place components ─────────────────────────────────────────────────

  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      var cid = layers[i][j]
      var row = row_of[cid]
      var cx = layer_x[i]
      var cy = comp_y(row) + 1
      var cw = comp_w(cid)
      if (station_by_id[cid]) {
        var sname = station_by_id[cid].name
        var el = { type: 'station', x: cx, y: cy, width: cw, height: 4, source: trunc(station_by_id[cid].source) }
        if (sname && sname.indexOf('station-') !== 0) el.name = sname
        elements.push(el)
      } else {
        elements.push({ type: 'subspace_box', x: cx, y: cy, width: cw, height: 4, name: cid })
      }
    }
  }

  // ── Route connections ────────────────────────────────────────────────
  // Connections come in three flavours:
  //   boundary port → component  (left port feed)
  //   component → boundary port  (right port output)
  //   component → component      (inter-layer edge)

  // Helper: rightmost x of a placed component (one past its box)
  function comp_right(cid) {
    return layer_x[layer_of[cid]] + comp_w(cid)
  }

  var deferred_right = []  // right ports placed after width is known

  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id

    if (port_by_id[fid] && is_comp(tid)) {
      // Left boundary port → component
      var row = row_of[tid]
      var wy = wire_y(row)
      elements.push({ type: 'port', x: 0, y: wy, dir: 'left', key: port_by_id[fid].key })
      elements.push({ type: 'hline', x: 1, y: wy, length: layer_x[layer_of[tid]] - 1 })

    } else if (is_comp(fid) && port_by_id[tid]) {
      // Component → right boundary port (deferred — placed after width is known)
      deferred_right.push({ comp_id: fid, port: port_by_id[tid] })

    } else if (is_comp(fid) && is_comp(tid)) {
      // Skip back-edges — routed separately below
      if (back_edge_set[fid + '|' + tid]) continue
      // Component → component
      var src_row = row_of[fid]
      var dst_row = row_of[tid]
      var rx = comp_right(fid)
      var lx = layer_x[layer_of[tid]]

      if (src_row === dst_row) {
        // Same row — straight hline
        elements.push({ type: 'hline', x: rx, y: wire_y(src_row), length: lx - rx })
      } else {
        // Different rows — hline out, vline, hline in
        var mid_x = rx + 1
        var src_wy = wire_y(src_row)
        var dst_wy = wire_y(dst_row)
        var min_wy = Math.min(src_wy, dst_wy)
        var max_wy = Math.max(src_wy, dst_wy)

        // Hline from source right edge to mid_x
        if (mid_x > rx)
          elements.push({ type: 'hline', x: rx, y: src_wy, length: mid_x - rx })
        // Vline connecting the two rows
        elements.push({ type: 'vline', x: mid_x, y: min_wy, length: max_wy - min_wy + 1 })
        // Hline from mid_x to target left edge
        if (lx > mid_x + 1)
          elements.push({ type: 'hline', x: mid_x + 1, y: dst_wy, length: lx - mid_x - 1 })
      }
    }
  }

  // Back-edges deferred until after width is known
  var back_edge_rows = back_edges.length

  // ── Standalone ports (not in any connection) ─────────────────────────

  var left_ports = []
  var right_ports = []
  for (var i = 0; i < ports.length; i++) {
    if (used_ports[ports[i].id]) continue
    if (ports[i].dir === 'left') left_ports.push(ports[i])
    else right_ports.push(ports[i])
  }

  // ── Compute width before placing right ports ────────────────────────

  var min_width = Math.max(name.length + 7, 12)

  // Width from component placement: rightmost comp edge + HLINE_GAP + 1 (port)
  var max_right_x = 0
  for (var i = 0; i < deferred_right.length; i++) {
    var rx = comp_right(deferred_right[i].comp_id) + HLINE_GAP + 1
    if (rx > max_right_x) max_right_x = rx
  }
  var width = Math.max(min_width, max_right_x)

  // ── Place deferred right ports at box edge ─────────────────────────

  for (var i = 0; i < deferred_right.length; i++) {
    var dr = deferred_right[i]
    var row = row_of[dr.comp_id]
    var wy = wire_y(row)
    var rx = comp_right(dr.comp_id)
    elements.push({ type: 'hline', x: rx, y: wy, length: width - 1 - rx })
    elements.push({ type: 'port', x: width - 1, y: wy, dir: 'right', key: dr.port.key })
  }

  // ── Route back-edges (cycle connections) ────────────────────────────
  // Back-edges go from a later (or same) layer back to an earlier layer.
  // Route as U-shape below all component rows:
  //   source right edge → down → horizontal at back_y → up → target left edge

  for (var i = 0; i < back_edges.length; i++) {
    var be_from = back_edges[i][0]
    var be_to = back_edges[i][1]
    var back_y = HEADER_HEIGHT + total_rows * ROW_HEIGHT + i
    var from_x = comp_right(be_from)
    var to_x = layer_x[layer_of[be_to]]
    var from_wy = wire_y(row_of[be_from])
    var to_wy = wire_y(row_of[be_to])

    // Vertical down from source wire row to back-edge row
    if (back_y > from_wy)
      elements.push({ type: 'vline', x: from_x, y: from_wy, length: back_y - from_wy + 1 })
    // Horizontal across at back-edge row
    var left_x = Math.min(from_x, to_x)
    var right_x = Math.max(from_x, to_x)
    if (right_x > left_x)
      elements.push({ type: 'hline', x: left_x, y: back_y, length: right_x - left_x })
    // Vertical up from back-edge row to target wire row
    if (back_y > to_wy)
      elements.push({ type: 'vline', x: to_x, y: to_wy, length: back_y - to_wy + 1 })
  }

  // ── Standalone port rows ─────────────────────────────────────────────

  var port_rows = Math.max(left_ports.length, right_ports.length)
  var sy = HEADER_HEIGHT + total_rows * ROW_HEIGHT + back_edge_rows
  var li = 0, ri = 0
  while (li < left_ports.length || ri < right_ports.length) {
    if (li < left_ports.length) {
      elements.push({ type: 'port', x: 0, y: sy, dir: 'left', key: left_ports[li].key })
      li++
    }
    if (ri < right_ports.length) {
      elements.push({ type: 'port', x: width - 1, y: sy, dir: 'right', key: right_ports[ri].key })
      ri++
    }
    sy++
  }

  // ── State variable rows ──────────────────────────────────────────────

  var state = topology.state || {}
  var state_keys = Object.keys(state)
  var state_rows = state_keys.length
  for (var i = 0; i < state_keys.length; i++) {
    var stext = '$' + state_keys[i] + ': ' + JSON.stringify(state[state_keys[i]])
    elements.push({ type: 'text', x: 2, y: sy + i, text: stext })
    var needed = stext.length + 4
    if (needed > width) width = needed
  }

  // ── Height and box ───────────────────────────────────────────────────

  var height = HEADER_HEIGHT + total_rows * ROW_HEIGHT + back_edge_rows + port_rows + state_rows + 1
  if (total_rows === 0 && port_rows === 0 && state_rows === 0 && back_edge_rows === 0) height = 3

  elements.unshift({ type: 'box', x: 0, y: 0, width: width, height: height, name: name })

  return { id: topology.id, name: name, width: width, height: height, elements: elements }
}

export function render(laid_out) {
  var w = laid_out.width
  var h = laid_out.height
  var elements = laid_out.elements.slice()

  // Sort elements so stations/subspace_boxes draw after hlines/vlines
  // (later elements overwrite earlier ones on the grid)
  var render_order = { box: 0, label: 1, text: 1, port: 1, hline: 2, vline: 2, station: 3, subspace_box: 3 }
  elements.sort(function(a, b) { return (render_order[a.type] || 0) - (render_order[b.type] || 0) })

  // Create 2D grid filled with spaces
  var grid = []
  for (var y = 0; y < h; y++) {
    grid[y] = []
    for (var x = 0; x < w; x++) grid[y][x] = ' '
  }

  // Stamp each element onto the grid
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]

    if (el.type === 'box') {
      // Top row: space at x, then underscores with optional name
      for (var x = el.x + 1; x <= el.x + el.width - 2; x++)
        grid[el.y][x] = '_'
      if (el.name) {
        var bname = ' ' + el.name + ' '
        for (var j = 0; j < bname.length && el.x + 2 + j < el.x + el.width - 3; j++)
          grid[el.y][el.x + 2 + j] = bname[j]
      }
      // Bottom row: | _ _ _ |
      grid[el.y + el.height - 1][el.x] = '|'
      for (var x = el.x + 1; x <= el.x + el.width - 2; x++)
        grid[el.y + el.height - 1][x] = '_'
      grid[el.y + el.height - 1][el.x + el.width - 1] = '|'
      // Side rows
      for (var y = el.y + 1; y < el.y + el.height - 1; y++) {
        grid[y][el.x] = '|'
        grid[y][el.x + el.width - 1] = '|'
      }
    }

    else if (el.type === 'label') {
      for (var j = 0; j < el.text.length; j++)
        grid[el.y][el.x + j] = el.text[j]
    }

    else if (el.type === 'port') {
      grid[el.y][el.x] = 'o'
    }

    else if (el.type === 'hline') {
      for (var x = el.x; x < el.x + el.length; x++)
        grid[el.y][x] = '-'
    }

    else if (el.type === 'vline') {
      for (var y = el.y; y < el.y + el.length; y++)
        grid[y][el.x] = '|'
    }

    else if (el.type === 'station') {
      var sx = el.x, sy = el.y, sw = el.width
      // Line 0: underscores from x+1 to x+width-2, with optional name
      for (var x = sx + 1; x <= sx + sw - 2; x++)
        grid[sy][x] = '_'
      if (el.name) {
        var sname = ' ' + el.name + ' '
        for (var j = 0; j < sname.length && sx + 2 + j < sx + sw - 3; j++)
          grid[sy][sx + 2 + j] = sname[j]
      }
      // Line 1: / at x, \ at x+width-1
      grid[sy + 1][sx] = '/'
      grid[sy + 1][sx + sw - 1] = '\\'
      // Line 2: ( content )
      grid[sy + 2][sx] = '('
      grid[sy + 2][sx + sw - 1] = ')'
      var inner = sw - 2
      var content = '  ' + el.source
      while (content.length < inner) content += ' '
      for (var j = 0; j < inner; j++)
        grid[sy + 2][sx + 1 + j] = content[j]
      // Line 3: \ underscores /
      grid[sy + 3][sx] = '\\'
      for (var x = sx + 1; x <= sx + sw - 2; x++)
        grid[sy + 3][x] = '_'
      grid[sy + 3][sx + sw - 1] = '/'
    }

    else if (el.type === 'subspace_box') {
      var sx = el.x, sy = el.y, sw = el.width
      // Line 0: space + underscores
      for (var x = sx + 1; x <= sx + sw - 2; x++)
        grid[sy][x] = '_'
      // Line 1: | name padding |
      grid[sy + 1][sx] = '|'
      grid[sy + 1][sx + sw - 1] = '|'
      var inner = sw - 2
      var content = ' ' + el.name
      while (content.length < inner) content += ' '
      for (var j = 0; j < inner; j++)
        grid[sy + 1][sx + 1 + j] = content[j]
      // Line 2: o at left and right edges (port markers)
      grid[sy + 2][sx] = 'o'
      grid[sy + 2][sx + sw - 1] = 'o'
      // Line 3: | underscores |
      grid[sy + 3][sx] = '|'
      for (var x = sx + 1; x <= sx + sw - 2; x++)
        grid[sy + 3][x] = '_'
      grid[sy + 3][sx + sw - 1] = '|'
    }

    else if (el.type === 'text') {
      for (var j = 0; j < el.text.length; j++)
        grid[el.y][el.x + j] = el.text[j]
    }
  }

  // Join rows, trim trailing spaces, join with newlines
  var lines = []
  for (var y = 0; y < h; y++)
    lines.push(grid[y].join('').replace(/\s+$/, ''))

  return lines.join('\n')
}

export function render_space(name, seedlike, options) {
  return render(layout(extract(name, seedlike), options))
}

export function render_all(seedlikes, options) {
  return Object.keys(seedlikes).map(function(n) { return render_space(n, seedlikes[n], options) }).join('\n\n')
}
