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

  function comp_y(row) { return HEADER_HEIGHT + row * ROW_HEIGHT }
  function wire_y(row) { return comp_y(row) + 3 }

  // ── Route connections ────────────────────────────────────────────────
  // Trunk-and-channel model:
  //   - One trunk hline per gap on each wire row (shared by all connections)
  //   - Vertical channels in inter-layer gaps for cross-row connections
  //   - Horizontal channels between station rows for jogs and back-edges

  function comp_right(cid) {
    return layer_x[layer_of[cid]] + comp_w(cid)
  }

  // ── Classify connections ───────────────────────────────────────────

  var comp_conns = []        // forward comp→comp (not back-edges)
  var left_port_groups = {}  // comp_id → [port, ...]
  var right_port_groups = {} // comp_id → [port, ...]

  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id
    if (port_by_id[fid] && is_comp(tid)) {
      if (!left_port_groups[tid]) left_port_groups[tid] = []
      left_port_groups[tid].push(port_by_id[fid])
    } else if (is_comp(fid) && port_by_id[tid]) {
      if (!right_port_groups[fid]) right_port_groups[fid] = []
      right_port_groups[fid].push(port_by_id[tid])
    } else if (is_comp(fid) && is_comp(tid)) {
      if (!back_edge_set[fid + '|' + tid])
        comp_conns.push(c)
    }
  }

  // Classify comp→comp connections
  var direct_conns = []   // same row, adjacent layers
  var cross_conns = []    // different rows
  var jog_conns = []      // same row, multi-layer gap

  for (var i = 0; i < comp_conns.length; i++) {
    var c = comp_conns[i]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    var sl = layer_of[c.from.id], dl = layer_of[c.to.id]
    if (sr === dr && dl - sl === 1) direct_conns.push(c)
    else if (sr !== dr) cross_conns.push(c)
    else jog_conns.push(c)
  }

  // ── Recompute layer_x with gaps sized for cross-row connections ────
  // Only cross-row connections need allocated channels. Jog vlines use
  // fixed positions (first_gap_x for source side, allocated track for dest side).
  var gap_cross_count = {}
  for (var i = 0; i < cross_conns.length; i++) {
    var src_layer = layer_of[cross_conns[i].from.id]
    gap_cross_count[src_layer] = (gap_cross_count[src_layer] || 0) + 1
  }
  // Jog connections also need one track in the gap before the dest layer
  for (var i = 0; i < jog_conns.length; i++) {
    var dl = layer_of[jog_conns[i].to.id]
    var gap_layer = dl - 1
    gap_cross_count[gap_layer] = (gap_cross_count[gap_layer] || 0) + 1
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

  // ── Re-place components at new coordinates ─────────────────────────

  elements = []
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

  // ── Allocate vertical channel x positions per gap ──────────────────
  // Group cross-row connections and jog dest-side connections by the gap
  // just before the destination layer, matching the old code's approach.

  var gap_conns = {}  // 'srcLayer|dstLayer' → [conn, ...]
  for (var i = 0; i < cross_conns.length; i++) {
    var c = cross_conns[i]
    var gk = layer_of[c.from.id] + '|' + layer_of[c.to.id]
    if (!gap_conns[gk]) gap_conns[gk] = []
    gap_conns[gk].push(c)
  }
  for (var i = 0; i < jog_conns.length; i++) {
    var c = jog_conns[i]
    var gk = layer_of[c.from.id] + '|' + layer_of[c.to.id]
    if (!gap_conns[gk]) gap_conns[gk] = []
    gap_conns[gk].push(c)
  }

  // For each gap group, assign x tracks evenly in the gap before dest layer
  var v_channel_x = {}  // conn.id → track_x
  for (var gk in gap_conns) {
    var conns = gap_conns[gk]
    var dst_layer = layer_of[conns[0].to.id]
    var gap_layer = dst_layer - 1
    var rx_base = layer_x[gap_layer] + layer_width[gap_layer]
    var lx_base = layer_x[dst_layer]
    var track_min = rx_base + 2
    var track_max = lx_base - 3
    var n = conns.length
    var usable = track_max - track_min

    // Sort to minimize crossings
    conns.sort(function(a, b) {
      var ar = row_of[a.from.id], br = row_of[b.from.id]
      if (ar !== br) return ar - br
      return row_of[a.to.id] - row_of[b.to.id]
    })

    var spacing = n > 1 ? usable / (n - 1) : 0
    for (var j = 0; j < n; j++) {
      var tx = n === 1 ? track_min + Math.floor(usable / 2) : Math.round(track_min + spacing * j)
      if (tx > track_max) tx = track_max
      if (tx < track_min) tx = track_min
      v_channel_x[conns[j].id] = tx
    }
  }

  // ── Track used ports ───────────────────────────────────────────────

  var used_ports = {}
  for (var i = 0; i < connections.length; i++) {
    if (port_by_id[connections[i].from.id]) used_ports[connections[i].from.id] = true
    if (port_by_id[connections[i].to.id]) used_ports[connections[i].to.id] = true
  }

  // ── Emit trunk hlines (direct connections) ─────────────────────────

  for (var i = 0; i < direct_conns.length; i++) {
    var c = direct_conns[i]
    var rx = comp_right(c.from.id)
    var lx = layer_x[layer_of[c.to.id]]
    var wy = wire_y(row_of[c.from.id])
    elements.push({ type: 'hline', x: rx, y: wy, length: lx - rx, cids: [c.from.id, c.to.id] })
  }

  // ── Emit cross-row connections ─────────────────────────────────────

  for (var i = 0; i < cross_conns.length; i++) {
    var c = cross_conns[i]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    var src_wy = wire_y(sr), dst_wy = wire_y(dr)
    var rx = comp_right(c.from.id)
    var lx = layer_x[layer_of[c.to.id]]
    var track_x = v_channel_x[c.id]
    var vdir = sr < dr ? 'down' : 'up'
    var min_wy = Math.min(src_wy, dst_wy)
    var max_wy = Math.max(src_wy, dst_wy)
    var cids = [c.from.id, c.to.id]

    // Hline from source to track
    if (track_x >= rx)
      elements.push({ type: 'hline', x: rx, y: src_wy, length: track_x - rx + 1, cids: cids })
    // Vline at track — split into endpoint/middle for crossing detection
    if (max_wy - min_wy + 1 <= 2) {
      elements.push({ type: 'vline', x: track_x, y: min_wy, length: max_wy - min_wy + 1, cids: cids, dir: vdir })
    } else {
      elements.push({ type: 'vline', x: track_x, y: min_wy, length: 1, cids: cids, dir: vdir })
      elements.push({ type: 'vline', x: track_x, y: min_wy + 1, length: max_wy - min_wy - 1, cids: [c.id], dir: vdir })
      elements.push({ type: 'vline', x: track_x, y: max_wy, length: 1, cids: cids, dir: vdir })
    }
    // Hline from track to target
    if (lx > track_x)
      elements.push({ type: 'hline', x: track_x, y: dst_wy, length: lx - track_x, cids: cids })
  }

  // ── Emit jog connections ───────────────────────────────────────────

  var max_fan_y = 0  // track max y used by fan/jog offset

  for (var i = 0; i < jog_conns.length; i++) {
    var c = jog_conns[i]
    var sr = row_of[c.from.id]
    var src_wy = wire_y(sr)
    var rx = comp_right(c.from.id)
    var lx = layer_x[layer_of[c.to.id]]
    var cids = [c.from.id, c.to.id]
    // Source-side vline at fixed position (2 past source layer edge)
    var first_gap_x = layer_x[layer_of[c.from.id]] + layer_width[layer_of[c.from.id]] + 2
    // Dest-side vline at allocated track position
    var track_x = v_channel_x[c.id]
    // Jog below station: wire_y + 3 (below station bottom)
    var jog_y = src_wy + 3
    if (jog_y > max_fan_y) max_fan_y = jog_y

    // Hline from source to first gap
    if (first_gap_x > rx)
      elements.push({ type: 'hline', x: rx, y: src_wy, length: first_gap_x - rx + 1, cids: cids })
    // Vline down to jog row
    elements.push({ type: 'vline', x: first_gap_x, y: src_wy, length: jog_y - src_wy + 1, cids: [c.id], dir: 'down' })
    // Hline across jog row
    elements.push({ type: 'hline', x: first_gap_x, y: jog_y, length: track_x - first_gap_x + 1, cids: [c.id], dir: 'right' })
    // Vline up from jog row to dest wire row
    elements.push({ type: 'vline', x: track_x, y: src_wy, length: jog_y - src_wy + 1, cids: [c.id], dir: 'up' })
    // Hline from track to target
    if (lx > track_x)
      elements.push({ type: 'hline', x: track_x, y: src_wy, length: lx - track_x, cids: cids })
  }

  // ── Left port groups ───────────────────────────────────────────────

  var left_mid_x = Math.floor(PORT_COL / 2)
  for (var cid in left_port_groups) {
    var group = left_port_groups[cid]
    var base_wy = wire_y(row_of[cid])
    var lx = layer_x[layer_of[cid]]
    for (var j = 0; j < group.length; j++) {
      var wy = base_wy + j * 2
      if (wy > max_fan_y) max_fan_y = wy
      var pcids = [group[j].id, cid]
      elements.push({ type: 'port', x: 0, y: wy, dir: 'left', key: group[j].key })
      if (j > 0) {
        // Offset port: hline from port to midpoint, vline from base row
        elements.push({ type: 'hline', x: 1, y: wy, length: left_mid_x, cids: pcids })
        elements.push({ type: 'vline', x: left_mid_x, y: base_wy, length: wy - base_wy + 1, cids: pcids, dir: 'up' })
      } else if (layer_of[cid] > 0) {
        // First port but multi-layer target: jog below
        var jog_wy = wy + 3
        if (jog_wy > max_fan_y) max_fan_y = jog_wy
        var first_gap_x = PORT_COL - 2
        elements.push({ type: 'hline', x: 1, y: wy, length: first_gap_x, cids: pcids })
        elements.push({ type: 'vline', x: first_gap_x, y: wy, length: jog_wy - wy + 1, cids: pcids, dir: 'down' })
        var target_gap_x = layer_x[layer_of[cid]] - 3
        elements.push({ type: 'hline', x: first_gap_x, y: jog_wy, length: target_gap_x - first_gap_x + 1, cids: pcids, dir: 'right' })
        elements.push({ type: 'vline', x: target_gap_x, y: wy, length: jog_wy - wy + 1, cids: pcids, dir: 'up' })
        elements.push({ type: 'hline', x: target_gap_x, y: wy, length: lx - target_gap_x, cids: pcids })
      } else {
        // First port, layer 0: direct hline
        elements.push({ type: 'hline', x: 1, y: wy, length: lx - 1, cids: pcids })
      }
    }
  }

  // ── Right port groups (deferred — need width first) ────────────────

  var deferred_right = []
  for (var cid in right_port_groups) {
    var group = right_port_groups[cid]
    for (var j = 0; j < group.length; j++) {
      deferred_right.push({ comp_id: cid, port: group[j], offset: j })
    }
  }

  // ── Standalone ports (not in any connection) ───────────────────────

  var left_ports = []
  var right_ports = []
  for (var i = 0; i < ports.length; i++) {
    if (used_ports[ports[i].id]) continue
    if (ports[i].dir === 'left') left_ports.push(ports[i])
    else right_ports.push(ports[i])
  }

  // ── Compute width ──────────────────────────────────────────────────

  var min_width = Math.max(name.length + 7, 12)
  var max_right_x = 0
  for (var i = 0; i < deferred_right.length; i++) {
    var rx = comp_right(deferred_right[i].comp_id) + HLINE_GAP + 1
    if (rx > max_right_x) max_right_x = rx
  }
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      var rx = layer_x[i] + comp_w(layers[i][j]) + 2
      if (rx > max_right_x) max_right_x = rx
    }
  }
  for (var i = 0; i < back_edges.length; i++) {
    var rx = comp_right(back_edges[i][0]) + 4
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
      elements.push({ type: 'hline', x: mid_x, y: wy, length: width - 1 - mid_x, cids: rpcids })
      elements.push({ type: 'vline', x: mid_x, y: base_wy, length: wy - base_wy + 1, cids: rpcids, dir: 'down' })
    } else {
      elements.push({ type: 'hline', x: rx, y: wy, length: width - 1 - rx, cids: rpcids })
    }
    elements.push({ type: 'port', x: width - 1, y: wy, dir: 'right', key: dr.port.key })
  }

  // ── Compute content_y ──────────────────────────────────────────────

  var base_content_y = HEADER_HEIGHT + total_rows * ROW_HEIGHT
  var content_y = max_fan_y > 0 ? Math.max(base_content_y, max_fan_y + 2) : base_content_y

  // ── Route back-edges ───────────────────────────────────────────────

  var back_edge_rows = back_edges.length
  for (var i = 0; i < back_edges.length; i++) {
    var be_from = back_edges[i][0]
    var be_to = back_edges[i][1]
    var max_row = Math.max(row_of[be_from], row_of[be_to])
    var back_y = comp_y(max_row) + ROW_HEIGHT - 1
    var from_x = comp_right(be_from) + 2
    var to_x = layer_x[layer_of[be_to]] - 3
    if (to_x === left_mid_x) to_x = left_mid_x + 1
    var from_wy = wire_y(row_of[be_from])
    var to_wy = wire_y(row_of[be_to])
    var from_rx = comp_right(be_from)
    var to_lx = layer_x[layer_of[be_to]]

    var becids = [be_from, be_to]
    if (from_x > from_rx)
      elements.push({ type: 'hline', x: from_rx, y: from_wy, length: from_x - from_rx + 1, cids: becids })
    if (back_y > from_wy)
      elements.push({ type: 'vline', x: from_x, y: from_wy, length: back_y - from_wy + 1, cids: becids, dir: 'down' })
    var left_x = Math.min(from_x, to_x)
    var right_x = Math.max(from_x, to_x)
    if (right_x > left_x)
      elements.push({ type: 'hline', x: left_x, y: back_y, length: right_x - left_x + 1, cids: becids, dir: 'left' })
    if (back_y > to_wy)
      elements.push({ type: 'vline', x: to_x, y: to_wy, length: back_y - to_wy + 1, cids: becids, dir: 'up' })
    if (to_lx - 1 > to_x)
      elements.push({ type: 'hline', x: to_x, y: to_wy, length: to_lx - 1 - to_x, cids: becids })
  }

  // ── Standalone port rows ───────────────────────────────────────────

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

  // ── State variable rows ────────────────────────────────────────────

  var state = topology.state || {}
  var state_keys = Object.keys(state)
  var state_rows = state_keys.length
  for (var i = 0; i < state_keys.length; i++) {
    var stext = '$' + state_keys[i] + ': ' + JSON.stringify(state[state_keys[i]])
    elements.push({ type: 'text', x: 2, y: sy + i, text: stext })
    var needed = stext.length + 4
    if (needed > width) width = needed
  }

  // ── Height and box ─────────────────────────────────────────────────

  var height = content_y + back_edge_rows + port_rows + state_rows + 1
  if (total_rows === 0 && port_rows === 0 && state_rows === 0 && back_edge_rows === 0 && max_fan_y === 0) height = 3

  elements.unshift({ type: 'box', x: 0, y: 0, width: width, height: height, name: name })

  return { id: topology.id, name: name, width: width, height: height, elements: elements }
}

export function render(laid_out) {
  var w = laid_out.width
  var h = laid_out.height
  var elements = laid_out.elements.slice()

  // Sort: box first, then labels/text/ports, then wires, then stations on top
  var render_order = { box: 0, label: 1, text: 1, port: 1, hline: 2, vline: 2, station: 3, subspace_box: 3 }
  elements.sort(function(a, b) { return (render_order[a.type] || 0) - (render_order[b.type] || 0) })

  var grid = []
  var cid_grid = []   // tracks wire cids at each cell for junction vs crossing detection
  var dir_grid = []   // tracks flow direction at each cell for junction character resolution
  for (var y = 0; y < h; y++) {
    grid[y] = []
    cid_grid[y] = []
    dir_grid[y] = []
    for (var x = 0; x < w; x++) { grid[y][x] = ' '; cid_grid[y][x] = null; dir_grid[y][x] = null }
  }

  // Check if two cid arrays share any element
  function cids_shared(a, b) {
    if (!a || !b) return true  // no cids = assume junction
    for (var k = 0; k < a.length; k++)
      for (var m = 0; m < b.length; m++)
        if (a[k] === b[m]) return true
    return false
  }

  // Merge cids into cid_grid cell
  function merge_cids(y, x, cids) {
    if (!cids) return
    if (cid_grid[y][x]) {
      var merged = cid_grid[y][x].slice()
      for (var k = 0; k < cids.length; k++)
        if (merged.indexOf(cids[k]) < 0) merged.push(cids[k])
      cid_grid[y][x] = merged
    } else {
      cid_grid[y][x] = cids
    }
  }

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]

    if (el.type === 'box') {
      for (var x = el.x + 1; x <= el.x + el.width - 2; x++) grid[el.y][x] = '_'
      if (el.name) {
        var bname = ' ' + el.name + ' '
        for (var j = 0; j < bname.length && el.x + 2 + j < el.x + el.width - 3; j++)
          grid[el.y][el.x + 2 + j] = bname[j]
      }
      grid[el.y + el.height - 1][el.x] = '|'
      for (var x = el.x + 1; x <= el.x + el.width - 2; x++) grid[el.y + el.height - 1][x] = '_'
      grid[el.y + el.height - 1][el.x + el.width - 1] = '|'
      for (var y = el.y + 1; y < el.y + el.height - 1; y++) {
        grid[y][el.x] = '|'
        grid[y][el.x + el.width - 1] = '|'
      }
    }

    else if (el.type === 'label') {
      for (var j = 0; j < el.text.length; j++) grid[el.y][el.x + j] = el.text[j]
    }

    else if (el.type === 'port') {
      grid[el.y][el.x] = 'o'
    }

    else if (el.type === 'hline') {
      for (var x = el.x; x < el.x + el.length; x++) {
        var cur = grid[el.y][x]
        var wire = (cur === '|' || cur === '+' || cur === 'O' || cur === 'v' || cur === '^' || cur === '<' || cur === '>')
        if (wire) {
          var shared = cids_shared(cid_grid[el.y][x], el.cids)
          grid[el.y][x] = shared ? '+' : 'O'
          if (shared && el.dir) dir_grid[el.y][x] = el.dir
        } else {
          grid[el.y][x] = '-'
          if (el.dir) dir_grid[el.y][x] = el.dir
        }
        merge_cids(el.y, x, el.cids)
      }
    }

    else if (el.type === 'vline') {
      for (var y = el.y; y < el.y + el.length; y++) {
        var cur = grid[y][el.x]
        var wire = (cur === '-' || cur === '+' || cur === 'O' || cur === 'v' || cur === '^' || cur === '<' || cur === '>')
        if (wire) {
          var shared = cids_shared(cid_grid[y][el.x], el.cids)
          grid[y][el.x] = shared ? '+' : 'O'
          if (shared && el.dir && !dir_grid[y][el.x]) dir_grid[y][el.x] = el.dir
        } else {
          grid[y][el.x] = '|'
        }
        if (el.dir && !dir_grid[y][el.x]) dir_grid[y][el.x] = el.dir
        merge_cids(y, el.x, el.cids)
      }
    }

    else if (el.type === 'station') {
      var sx = el.x, sy = el.y, sw = el.width
      for (var x = sx + 1; x <= sx + sw - 2; x++) grid[sy][x] = '_'
      if (el.name) {
        var sname = ' ' + el.name + ' '
        for (var j = 0; j < sname.length && sx + 2 + j < sx + sw - 3; j++)
          grid[sy][sx + 2 + j] = sname[j]
      }
      grid[sy + 1][sx] = '/'
      grid[sy + 1][sx + sw - 1] = '\\'
      grid[sy + 2][sx - 1] = '('
      var inner = sw
      var content = '  ' + el.source
      while (content.length < inner) content += ' '
      for (var j = 0; j < inner; j++) grid[sy + 2][sx + j] = content[j]
      grid[sy + 2][sx + sw] = ')'
      grid[sy + 3][sx] = '\\'
      for (var x = sx + 1; x <= sx + sw - 2; x++) grid[sy + 3][x] = '_'
      grid[sy + 3][sx + sw - 1] = '/'
    }

    else if (el.type === 'subspace_box') {
      var sx = el.x, sy = el.y, sw = el.width
      for (var x = sx + 1; x <= sx + sw - 2; x++) grid[sy][x] = '_'
      grid[sy + 1][sx] = '|'
      grid[sy + 1][sx + sw - 1] = '|'
      var inner = sw - 2
      var content = ' ' + el.name
      while (content.length < inner) content += ' '
      for (var j = 0; j < inner; j++) grid[sy + 1][sx + 1 + j] = content[j]
      grid[sy + 2][sx] = 'o'
      grid[sy + 2][sx + sw - 1] = 'o'
      grid[sy + 3][sx] = '|'
      for (var x = sx + 1; x <= sx + sw - 2; x++) grid[sy + 3][x] = '_'
      grid[sy + 3][sx + sw - 1] = '|'
    }

    else if (el.type === 'text') {
      for (var j = 0; j < el.text.length; j++) grid[el.y][el.x + j] = el.text[j]
    }
  }

  // Post-process: resolve '+' junctions to directional characters
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (grid[y][x] !== '+') continue
      if (dir_grid[y][x]) {
        var d = dir_grid[y][x]
        if (d === 'down') grid[y][x] = 'v'
        else if (d === 'up') grid[y][x] = '^'
        else if (d === 'right') grid[y][x] = '>'
        else if (d === 'left') grid[y][x] = '<'
      }
      // No dir: keep as '+' (shouldn't happen in practice)
    }
  }

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
