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
  var HLINE_GAP = 5
  var ROW_HEIGHT = 6
  var HEADER_HEIGHT = 2
  var PORT_COL = 5   // 1 (port 'o') + 3 (visible wire '---') + 1 (paren '(' push-out)
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

  // Initial layer_x (will be recomputed after row assignment to widen gaps)
  var layer_x = []
  for (var i = 0; i < layers.length; i++) {
    if (i === 0) layer_x.push(PORT_COL)
    else layer_x.push(layer_x[i - 1] + layer_width[i - 1] + HLINE_GAP)
  }

  // ── Row assignment with barycentric crossing minimization ───────────
  // 1. Initial assignment: definition order for layer 0, predecessor-based for others
  // 2. Barycentric sweep: reorder layers to minimize crossings
  // 3. Assign final row numbers from the reordered layers

  // Build neighbor lookup: for each component, which components in adjacent layers?
  // left_neighbors[id] = [ids in layer-1], right_neighbors[id] = [ids in layer+1]
  var left_neighbors = {}
  var right_neighbors = {}
  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id
    if (!is_comp(fid) || !is_comp(tid)) continue
    if (back_edge_set[fid + '|' + tid]) continue
    if (!right_neighbors[fid]) right_neighbors[fid] = []
    right_neighbors[fid].push(tid)
    if (!left_neighbors[tid]) left_neighbors[tid] = []
    left_neighbors[tid].push(fid)
  }

  // Initial ordering: definition order (just use layers arrays as-is)
  // Each layers[i] is an array of comp ids; their index IS their position.

  // Position lookup: pos_of[id] = index within its layer
  function build_pos() {
    var pos = {}
    for (var i = 0; i < layers.length; i++)
      for (var j = 0; j < layers[i].length; j++)
        pos[layers[i][j]] = j
    return pos
  }

  // Barycenter of a node relative to an adjacent layer:
  // average position of its neighbors in that layer
  function barycenter(id, neighbors, pos) {
    var nbrs = neighbors[id]
    if (!nbrs || nbrs.length === 0) return -1  // no constraint
    var sum = 0
    for (var k = 0; k < nbrs.length; k++) sum += pos[nbrs[k]]
    return sum / nbrs.length
  }

  // Sort a layer by barycenter, preserving order for unconstrained nodes
  function sort_layer_by_bc(layer, neighbors, pos) {
    var items = []
    for (var j = 0; j < layer.length; j++) {
      items.push({ id: layer[j], bc: barycenter(layer[j], neighbors, pos), orig: j })
    }
    items.sort(function(a, b) {
      if (a.bc < 0 && b.bc < 0) return a.orig - b.orig  // both unconstrained: keep order
      if (a.bc < 0) return 1   // unconstrained goes last
      if (b.bc < 0) return -1
      return a.bc - b.bc || a.orig - b.orig
    })
    for (var j = 0; j < layer.length; j++) layer[j] = items[j].id
  }

  // Sweep: left-to-right then right-to-left, repeat
  for (var sweep = 0; sweep < 4; sweep++) {
    var pos = build_pos()
    if (sweep % 2 === 0) {
      // Left to right: fix layer i, reorder layer i+1 by left_neighbors
      for (var i = 1; i < layers.length; i++) {
        sort_layer_by_bc(layers[i], left_neighbors, pos)
        pos = build_pos()
      }
    } else {
      // Right to left: fix layer i, reorder layer i-1 by right_neighbors
      for (var i = layers.length - 2; i >= 0; i--) {
        sort_layer_by_bc(layers[i], right_neighbors, pos)
        pos = build_pos()
      }
    }
  }

  // Assign row numbers from final layer ordering
  var row_of = {}
  var total_rows = 0
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      if (row_of[layers[i][j]] === undefined) {
        row_of[layers[i][j]] = j
      }
    }
    if (layers[i].length > total_rows) total_rows = layers[i].length
  }

  // Recompute layer_x with gaps sized for cross-row connections
  var gap_cross_count = {}
  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id
    if (!is_comp(fid) || !is_comp(tid)) continue
    if (back_edge_set[fid + '|' + tid]) continue
    if (row_of[fid] === row_of[tid]) continue
    var src_layer = layer_of[fid]
    gap_cross_count[src_layer] = (gap_cross_count[src_layer] || 0) + 1
  }
  layer_x = []
  for (var i = 0; i < layers.length; i++) {
    if (i === 0) layer_x.push(PORT_COL)
    else {
      var n_cross = gap_cross_count[i - 1] || 0
      var gap = Math.max(HLINE_GAP, n_cross + 4)
      layer_x.push(layer_x[i - 1] + layer_width[i - 1] + gap)
    }
  }

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
  var comp_conns = []      // comp→comp connections, routed after collection

  // Group left ports by target component, right ports by source component
  var left_port_groups = {}   // comp_id → [port, ...]
  var right_port_groups = {}  // comp_id → [port, ...]
  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    if (port_by_id[c.from.id] && is_comp(c.to.id)) {
      var tid = c.to.id
      if (!left_port_groups[tid]) left_port_groups[tid] = []
      left_port_groups[tid].push(port_by_id[c.from.id])
    } else if (is_comp(c.from.id) && port_by_id[c.to.id]) {
      var fid = c.from.id
      if (!right_port_groups[fid]) right_port_groups[fid] = []
      right_port_groups[fid].push(port_by_id[c.to.id])
    }
  }

  // Route left port groups — first port on the wire row, extras offset with vlines
  var left_port_x = PORT_COL - 2  // vline column for fan-in (one before '(')
  var left_mid_x = Math.floor(PORT_COL / 2)  // midpoint for fan-in vline
  var max_fan_y = 0  // track max y used by fan-in/fan-out offset ports
  for (var cid in left_port_groups) {
    var group = left_port_groups[cid]
    var base_wy = wire_y(row_of[cid])
    var lx = layer_x[layer_of[cid]]
    for (var j = 0; j < group.length; j++) {
      var wy = base_wy + j * 2
      if (wy > max_fan_y) max_fan_y = wy
      elements.push({ type: 'port', x: 0, y: wy, dir: 'left', key: group[j].key })
      var pcids = [group[j].id, cid]
      if (j > 0) {
        // Offset port: hline from port to midpoint, vline from base row
        elements.push({ type: 'hline', x: 1, y: wy, length: left_mid_x, cids: pcids })
        elements.push({ type: 'vline', x: left_mid_x, y: base_wy, length: wy - base_wy + 1, cids: pcids, dir: 'up' })
      } else if (layer_of[cid] > 0) {
        // First port but multi-layer: jog below intermediate stations
        var jog_wy = wy + 3
        if (jog_wy > max_fan_y) max_fan_y = jog_wy
        var first_gap_x = PORT_COL - 2
        elements.push({ type: 'hline', x: 1, y: wy, length: first_gap_x, cids: pcids })
        elements.push({ type: 'vline', x: first_gap_x, y: wy, length: jog_wy - wy + 1, cids: pcids, dir: 'down' })
        // Route across to gap before target layer
        var target_gap_x = layer_x[layer_of[cid]] - 3
        elements.push({ type: 'hline', x: first_gap_x, y: jog_wy, length: target_gap_x - first_gap_x + 1, cids: pcids, dir: 'right' })
        elements.push({ type: 'vline', x: target_gap_x, y: wy, length: jog_wy - wy + 1, cids: pcids, dir: 'up' })
        elements.push({ type: 'hline', x: target_gap_x, y: wy, length: lx - target_gap_x, cids: pcids })
      } else {
        // First port, adjacent layer: direct hline
        elements.push({ type: 'hline', x: 1, y: wy, length: lx - 1, cids: pcids })
      }
    }
  }

  // Route right port groups (deferred — need width first)
  for (var cid in right_port_groups) {
    var group = right_port_groups[cid]
    for (var j = 0; j < group.length; j++) {
      deferred_right.push({ comp_id: cid, port: group[j], offset: j })
    }
  }

  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id

    if (port_by_id[fid] && is_comp(tid)) {
      // Already handled above in left port groups
      continue

    } else if (is_comp(fid) && port_by_id[tid]) {
      // Already handled above in right port groups
      continue

    } else if (is_comp(fid) && is_comp(tid)) {
      // Skip back-edges — routed separately below
      if (back_edge_set[fid + '|' + tid]) continue
      // Component → component: collected and routed below
      comp_conns.push(c)
    }
  }

  // ── Route comp→comp connections ──────────────────────────────────────
  // Group cross-row connections by layer gap, assign separate x tracks.

  // First, route same-row, adjacent-layer connections (no intermediate stations to cross)
  for (var i = 0; i < comp_conns.length; i++) {
    var c = comp_conns[i]
    var src_row = row_of[c.from.id], dst_row = row_of[c.to.id]
    var src_layer = layer_of[c.from.id], dst_layer = layer_of[c.to.id]
    if (src_row === dst_row && dst_layer - src_layer === 1) {
      var rx = comp_right(c.from.id)
      var lx = layer_x[layer_of[c.to.id]]
      elements.push({ type: 'hline', x: rx, y: wire_y(src_row), length: lx - rx, cids: [c.from.id, c.to.id] })
    }
  }

  // Collect connections that need tracks: cross-row OR same-row spanning multiple layers
  var gap_conns = {}  // 'srcLayer|dstLayer' → [conn, ...]
  for (var i = 0; i < comp_conns.length; i++) {
    var c = comp_conns[i]
    var src_layer = layer_of[c.from.id], dst_layer = layer_of[c.to.id]
    if (row_of[c.from.id] === row_of[c.to.id] && dst_layer - src_layer === 1) continue  // already routed
    var gap_key = layer_of[c.from.id] + '|' + layer_of[c.to.id]
    if (!gap_conns[gap_key]) gap_conns[gap_key] = []
    gap_conns[gap_key].push(c)
  }

  // For each gap, assign x tracks and route
  for (var gk in gap_conns) {
    var conns = gap_conns[gk]
    var src_layer = layer_of[conns[0].from.id]
    var dst_layer = layer_of[conns[0].to.id]
    // Place tracks in the gap just before the destination layer
    var gap_layer = dst_layer - 1  // layer just before destination
    var rx_base = layer_x[gap_layer] + layer_width[gap_layer]  // right edge of pre-dest layer
    var lx_base = layer_x[dst_layer]                           // left edge of dest layer
    var gap = lx_base - rx_base

    // Sort connections to minimize crossings: by source row, then dest row
    conns.sort(function(a, b) {
      var ar = row_of[a.from.id], br = row_of[b.from.id]
      if (ar !== br) return ar - br
      return row_of[a.to.id] - row_of[b.to.id]
    })

    // Assign x tracks evenly spaced in the usable zone
    // Usable zone: rx_base + 2 (gap after ')') to lx_base - 3 (gap before '(')
    var track_min = rx_base + 2
    var track_max = lx_base - 3
    var n = conns.length
    var usable = track_max - track_min
    var spacing = n > 1 ? usable / (n - 1) : 0

    for (var ci = 0; ci < conns.length; ci++) {
      var c = conns[ci]
      var src_row = row_of[c.from.id]
      var dst_row = row_of[c.to.id]
      var track_x = n === 1 ? track_min + Math.floor(usable / 2) : Math.round(track_min + spacing * ci)
      if (track_x > track_max) track_x = track_max
      if (track_x < track_min) track_x = track_min

      var rx = comp_right(c.from.id)
      var lx = layer_x[layer_of[c.to.id]]
      var src_wy = wire_y(src_row)
      var dst_wy = wire_y(dst_row)
      var cids = [c.from.id, c.to.id]

      var track_cid = c.id  // unique per connection for mid-track segments

      if (src_row === dst_row) {
        // Same-row but multi-layer: jog below intermediate stations
        var jog_wy = src_wy + 3  // below station bottom curve
        if (jog_wy > max_fan_y) max_fan_y = jog_wy
        // Hline from source to first gap track
        var first_gap_x = layer_x[layer_of[c.from.id]] + layer_width[layer_of[c.from.id]] + 2
        elements.push({ type: 'hline', x: rx, y: src_wy, length: first_gap_x - rx + 1, cids: cids })
        // Vline down to jog row
        elements.push({ type: 'vline', x: first_gap_x, y: src_wy, length: jog_wy - src_wy + 1, cids: [track_cid], dir: 'down' })
        // Hline across jog row to track
        elements.push({ type: 'hline', x: first_gap_x, y: jog_wy, length: track_x - first_gap_x + 1, cids: [track_cid], dir: 'right' })
        // Vline up to dest row
        elements.push({ type: 'vline', x: track_x, y: src_wy, length: jog_wy - src_wy + 1, cids: [track_cid], dir: 'up' })
        // Hline from track to target
        if (lx > track_x)
          elements.push({ type: 'hline', x: track_x, y: src_wy, length: lx - track_x, cids: cids })
      } else {
        var min_wy = Math.min(src_wy, dst_wy)
        var max_wy = Math.max(src_wy, dst_wy)
        var vdir = src_row < dst_row ? 'down' : 'up'
        // Hline from source to track (near station — shared cids for branch point)
        elements.push({ type: 'hline', x: rx, y: src_wy, length: track_x - rx + 1, cids: cids })
        // Vline at track — endpoints use shared cids, middle uses unique
        // Split into: top cell, middle, bottom cell
        if (max_wy - min_wy + 1 <= 2) {
          // Short vline: just use shared cids
          elements.push({ type: 'vline', x: track_x, y: min_wy, length: max_wy - min_wy + 1, cids: cids, dir: vdir })
        } else {
          // Top endpoint
          elements.push({ type: 'vline', x: track_x, y: min_wy, length: 1, cids: cids, dir: vdir })
          // Middle (unique cid — crossings here are real)
          elements.push({ type: 'vline', x: track_x, y: min_wy + 1, length: max_wy - min_wy - 1, cids: [track_cid], dir: vdir })
          // Bottom endpoint
          elements.push({ type: 'vline', x: track_x, y: max_wy, length: 1, cids: cids, dir: vdir })
        }
        // Hline from track to target (near station — shared cids for merge point)
        if (lx > track_x)
          elements.push({ type: 'hline', x: track_x, y: dst_wy, length: lx - track_x, cids: cids })
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

  // Width from component placement: rightmost edge of any component or port connection
  var max_right_x = 0
  // From right port connections
  for (var i = 0; i < deferred_right.length; i++) {
    var rx = comp_right(deferred_right[i].comp_id) + HLINE_GAP + 1
    if (rx > max_right_x) max_right_x = rx
  }
  // From rightmost component edge (even without right ports)
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      var rx = layer_x[i] + comp_w(layers[i][j]) + 2  // component + padding
      if (rx > max_right_x) max_right_x = rx
    }
  }
  // From back-edge vline positions (need room inside the box)
  for (var i = 0; i < back_edges.length; i++) {
    var rx = comp_right(back_edges[i][0]) + 4  // vline at +2, plus gap + border
    if (rx > max_right_x) max_right_x = rx
  }
  var width = Math.max(min_width, max_right_x)

  // ── Place deferred right ports at box edge ─────────────────────────

  for (var i = 0; i < deferred_right.length; i++) {
    var dr = deferred_right[i]
    var row = row_of[dr.comp_id]
    var base_wy = wire_y(row)
    var wy = base_wy + (dr.offset ? dr.offset * 2 : 0)
    if (wy > max_fan_y) max_fan_y = wy
    var rx = comp_right(dr.comp_id)
    var mid_x = rx + Math.floor((width - 1 - rx) / 2)
    var rpcids = [dr.comp_id, dr.port.id]
    if (dr.offset > 0) {
      // Offset port: hline from midpoint to port, vline from base row
      elements.push({ type: 'hline', x: mid_x, y: wy, length: width - 1 - mid_x, cids: rpcids })
      elements.push({ type: 'vline', x: mid_x, y: base_wy, length: wy - base_wy + 1, cids: rpcids, dir: 'down' })
    } else {
      // First port: hline from component to port
      elements.push({ type: 'hline', x: rx, y: wy, length: width - 1 - rx, cids: rpcids })
    }
    elements.push({ type: 'port', x: width - 1, y: wy, dir: 'right', key: dr.port.key })
  }

  // ── Compute content_y: bottom of all component + fan rows ───────────

  var base_content_y = HEADER_HEIGHT + total_rows * ROW_HEIGHT
  var content_y = max_fan_y > 0 ? Math.max(base_content_y, max_fan_y + 2) : base_content_y

  // ── Route back-edges (cycle connections) ────────────────────────────
  // Back-edges go from a later (or same) layer back to an earlier layer.
  // Route as U-shape below stations, vlines just outside the parens:
  //   two past ')' → down → horizontal at back_y → up → two before '('

  for (var i = 0; i < back_edges.length; i++) {
    var be_from = back_edges[i][0]
    var be_to = back_edges[i][1]
    // Route just below the lower of the two connected stations
    var max_row = Math.max(row_of[be_from], row_of[be_to])
    var back_y = comp_y(max_row) + ROW_HEIGHT - 1
    var from_x = comp_right(be_from) + 2   // two past ')' — one char gap
    var to_x = layer_x[layer_of[be_to]] - 3  // two before '(' — one char gap
    // Avoid collision with fan-in vlines at left_mid_x
    if (to_x === left_mid_x) to_x = left_mid_x + 1
    var from_wy = wire_y(row_of[be_from])
    var to_wy = wire_y(row_of[be_to])

    var from_rx = comp_right(be_from)
    var to_lx = layer_x[layer_of[be_to]]

    var becids = [be_from, be_to]
    // Horizontal from source ')' to source vline
    if (from_x > from_rx)
      elements.push({ type: 'hline', x: from_rx, y: from_wy, length: from_x - from_rx + 1, cids: becids })
    // Vertical down from source wire row to back-edge row
    if (back_y > from_wy)
      elements.push({ type: 'vline', x: from_x, y: from_wy, length: back_y - from_wy + 1, cids: becids, dir: 'down' })
    // Horizontal across at back-edge row
    var left_x = Math.min(from_x, to_x)
    var right_x = Math.max(from_x, to_x)
    if (right_x > left_x)
      elements.push({ type: 'hline', x: left_x, y: back_y, length: right_x - left_x + 1, cids: becids, dir: 'left' })
    // Vertical up from back-edge row to target wire row
    if (back_y > to_wy)
      elements.push({ type: 'vline', x: to_x, y: to_wy, length: back_y - to_wy + 1, cids: becids, dir: 'up' })
    // Horizontal from target vline to target '('
    if (to_lx - 1 > to_x)
      elements.push({ type: 'hline', x: to_x, y: to_wy, length: to_lx - 1 - to_x, cids: becids })
  }

  // ── Standalone port rows ─────────────────────────────────────────────

  var port_rows = Math.max(left_ports.length, right_ports.length)
  var sy = content_y + back_edge_rows
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

  var height = content_y + back_edge_rows + port_rows + state_rows + 1
  if (total_rows === 0 && port_rows === 0 && state_rows === 0 && back_edge_rows === 0 && max_fan_y === 0) height = 3

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

  // Create 2D grid filled with spaces, plus cid grid and dir grid
  var grid = []
  var cid_grid = []
  var dir_grid = []
  for (var y = 0; y < h; y++) {
    grid[y] = []
    cid_grid[y] = []
    dir_grid[y] = []
    for (var x = 0; x < w; x++) { grid[y][x] = ' '; cid_grid[y][x] = null; dir_grid[y][x] = null }
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
      for (var x = el.x; x < el.x + el.length; x++) {
        var cur = grid[el.y][x]
        var cur_cids = cid_grid[el.y][x]
        if (cur === '|' || cur === '+' || cur === 'O' || cur === 'v' || cur === '^' || cur === '<' || cur === '>') {
          // Wire overlap: always check cids for shared endpoints
          var shared = false
          if (cur_cids && el.cids) {
            for (var k = 0; k < el.cids.length && !shared; k++)
              for (var m = 0; m < cur_cids.length && !shared; m++)
                if (el.cids[k] === cur_cids[m]) shared = true
          } else if (!cur_cids || !el.cids) { shared = true }  // no cids = assume junction
          grid[el.y][x] = shared ? '+' : 'O'
          if (shared && el.dir) dir_grid[el.y][x] = el.dir
        } else {
          grid[el.y][x] = '-'
          if (el.dir) dir_grid[el.y][x] = el.dir
        }
        // Merge cids
        if (el.cids) {
          if (cid_grid[el.y][x]) {
            var merged = cid_grid[el.y][x].slice()
            for (var k = 0; k < el.cids.length; k++)
              if (merged.indexOf(el.cids[k]) < 0) merged.push(el.cids[k])
            cid_grid[el.y][x] = merged
          } else {
            cid_grid[el.y][x] = el.cids
          }
        }
      }
    }

    else if (el.type === 'vline') {
      for (var y = el.y; y < el.y + el.length; y++) {
        var cur = grid[y][el.x]
        var cur_cids = cid_grid[y][el.x]
        if (cur === '-' || cur === '+' || cur === 'O' || cur === 'v' || cur === '^' || cur === '<' || cur === '>') {
          var shared = false
          if (cur_cids && el.cids) {
            for (var k = 0; k < el.cids.length && !shared; k++)
              for (var m = 0; m < cur_cids.length && !shared; m++)
                if (el.cids[k] === cur_cids[m]) shared = true
          } else if (!cur_cids || !el.cids) { shared = true }
          grid[y][el.x] = shared ? '+' : 'O'
          if (shared && el.dir && !dir_grid[y][el.x]) dir_grid[y][el.x] = el.dir
        } else {
          grid[y][el.x] = '|'
        }
        if (el.dir && !dir_grid[y][el.x]) dir_grid[y][el.x] = el.dir
        // Merge cids
        if (el.cids) {
          if (cid_grid[y][el.x]) {
            var merged = cid_grid[y][el.x].slice()
            for (var k = 0; k < el.cids.length; k++)
              if (merged.indexOf(el.cids[k]) < 0) merged.push(el.cids[k])
            cid_grid[y][el.x] = merged
          } else {
            cid_grid[y][el.x] = el.cids
          }
        }
      }
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
      // Line 2: ( content ) — parens pushed out one position
      grid[sy + 2][sx - 1] = '('
      var inner = sw
      var content = '  ' + el.source
      while (content.length < inner) content += ' '
      for (var j = 0; j < inner; j++)
        grid[sy + 2][sx + j] = content[j]
      grid[sy + 2][sx + sw] = ')'
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

  // Post-process: replace '+' junctions with directional chars
  // Use dir_grid (flow direction from layout) when available,
  // fall back to neighbor-based detection for corners
  var h_chars = { '-': 1, '+': 1, 'O': 1, '<': 1, '>': 1, 'v': 1, '^': 1 }
  var v_chars = { '|': 1, '+': 1, 'O': 1, 'v': 1, '^': 1, '<': 1, '>': 1 }
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (grid[y][x] !== '+') continue
      // If we have a recorded flow direction, use it
      if (dir_grid[y][x]) {
        var d = dir_grid[y][x]
        if (d === 'down') grid[y][x] = 'v'
        else if (d === 'up') grid[y][x] = '^'
        else if (d === 'right') grid[y][x] = '>'
        else if (d === 'left') grid[y][x] = '<'
        continue
      }
      // No flow direction: keep as '+' (corners, 4-way)
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
