// site/js/space_layout.js — extract and layout for Daimio space topology diagrams
//
// Pipeline: extract (seedlike → topology) → layout (topology → positioned elements + paths)
//
// Layout invariants:
//   1. No wire passes through a station or subspace body (hline or vline)
//   2. No two parallel wires share a grid cell (no overlapping hlines, no overlapping vlines)
//   3. At least one empty space between parallel wires (adjacent hlines or vlines)
//   4. At least one empty space between any wire and the box boundary
//
// Junction rules:
//   5. Wire terminating at a perpendicular through-wire: show terminating wire's direction
//      (> or < for hlines, v or ^ for vlines)
//   6. Wire crossing over a perpendicular wire without connecting: O
//   7. Every hline starts and ends at a port, station, or < / >
//   8. Every vline starts and ends at a port, station, or v / ^
//
// Port rules:
//   9. Each unique port renders as a single 'o' (no duplicates)
//  10. Ports connecting to multiple stations use a fan vline to reach all rows
//
// Back-edge rules:
//  11. Source vline on the output side (_out) of the source station
//  12. Dest vline on the input side (_in) of the dest station
//  13. Back-edge flow is visually right-to-left (opposite of forward flow)
//
// Topo sort:
//  14. Port-connected stations prioritized for lower layers (closer to ports)

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

  // Prioritize port-connected stations: visit them last in DFS so they end up
  // at lower layers (closer to their ports). This matters when cycles force a
  // choice of which edge becomes the back-edge.
  var port_connected = {}
  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    if (port_ids[c.from.id] && comp_set[c.to.id]) port_connected[c.to.id] = true
    if (port_ids[c.to.id] && comp_set[c.from.id]) port_connected[c.from.id] = true
  }
  comp_ids.sort(function(a, b) {
    var pa = port_connected[a] ? 1 : 0
    var pb = port_connected[b] ? 1 : 0
    return pa - pb
  })

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
  var HLINE_GAP = 7
  var ROW_HEIGHT = 6
  var HEADER_HEIGHT = 2
  var PORT_COL = 5   // base: 1 (port 'o') + 3 (wire) + 1 (paren '(' push-out); widened to 7 when fan+jog needed
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

  // Connection lookup: 'from_id|to_id' → connection id
  var conn_for_pair = {}
  for (var i = 0; i < connections.length; i++)
    conn_for_pair[connections[i].from.id + '|' + connections[i].to.id] = connections[i].id

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

  // Build back-edge lookup set and id array
  var back_edge_set = {}
  var be_ids = []
  for (var i = 0; i < back_edges.length; i++) {
    back_edge_set[back_edges[i][0] + '|' + back_edges[i][1]] = true
    be_ids.push('be_' + back_edges[i][0] + '_' + back_edges[i][1])
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

  // ── Dummy nodes for multi-layer edges ────────────────────────────────
  // For each forward comp→comp edge spanning 2+ layers, insert dummy nodes at
  // intermediate layers. Back-edges are routed separately (not via dummies).

  // Classify connections: port↔comp vs comp→comp (forward) vs back-edge
  var left_port_groups = {}   // comp_id → [port, ...]
  var right_port_groups = {}  // comp_id → [port, ...]
  var comp_edges = []         // forward comp→comp edges only
  var be_conns = []           // back-edge connections (original direction)
  var contract_returns = []   // station→left_port (contract return, routes backward)

  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id
    if (port_by_id[fid] && is_comp(tid)) {
      if (!left_port_groups[tid]) left_port_groups[tid] = []
      left_port_groups[tid].push(port_by_id[fid])
    } else if (is_comp(fid) && port_by_id[tid]) {
      // Station→port: check if port is left-dir (contract return)
      if (port_by_id[tid].dir === 'left') {
        contract_returns.push(c)
      } else {
        if (!right_port_groups[fid]) right_port_groups[fid] = []
        right_port_groups[fid].push(port_by_id[tid])
      }
    } else if (is_comp(fid) && is_comp(tid)) {
      if (back_edge_set[fid + '|' + tid]) {
        be_conns.push(c)
      } else {
        comp_edges.push({ id: c.id, from_id: fid, to_id: tid })
      }
    }
  }

  // Pre-compute which gaps each back-edge needs vlines in
  var be_gap_info = {}
  for (var i = 0; i < be_conns.length; i++) {
    var bec = be_conns[i]
    if (bec.from.id === bec.to.id) continue  // self-loop: no gap vlines
    var from_layer = layer_of[bec.from.id], to_layer = layer_of[bec.to.id]
    be_gap_info[bec.id] = {
      src_gap: from_layer < layers.length - 1 ? from_layer : null,  // null = right margin
      dst_gap: to_layer > 0 ? to_layer - 1 : null                   // null = left margin
    }
  }

  // Build reverse map: port_id → [comp_ids] for multi-station port connections
  function build_port_station_map(port_groups) {
    var map = {}
    for (var cid in port_groups) {
      var group = port_groups[cid]
      for (var j = 0; j < group.length; j++) {
        if (!map[group[j].id]) map[group[j].id] = []
        map[group[j].id].push(cid)
      }
    }
    return map
  }

  // Widen PORT_COL if both fan vlines and jog vlines are needed in the left margin
  var left_port_stations = build_port_station_map(left_port_groups)
  var has_left_fan = false, has_left_jog = false
  for (var cid in left_port_groups)
    if (layer_of[cid] > 0) has_left_jog = true
  for (var pid in left_port_stations) {
    var rows = {}
    for (var j = 0; j < left_port_stations[pid].length; j++)
      rows[row_of[left_port_stations[pid][j]]] = true
    if (Object.keys(rows).length > 1) has_left_fan = true
  }
  // Also check if back-edges target layer-0 components (need left margin vlines)
  var has_left_be = false
  for (var i = 0; i < back_edges.length; i++)
    if (layer_of[back_edges[i][1]] === 0) { has_left_be = true; break }
  var left_margin_items = (has_left_fan ? 1 : 0) + (has_left_jog ? 1 : 0) + (has_left_be ? 1 : 0)
  if (left_margin_items >= 2) PORT_COL = Math.max(PORT_COL, 5 + left_margin_items * 2)

  // Insert dummy nodes into layers for edges spanning 2+ layers.
  // Each dummy is { id, layer, edge_id } with zero width.
  var dummy_id_counter = 0
  var dummy_set = {}  // dummy_id → true
  // edge_chain[edge_id] = [from_id, dummy_1, dummy_2, ..., to_id]
  var edge_chain = {}

  for (var i = 0; i < comp_edges.length; i++) {
    var e = comp_edges[i]
    var fl = layer_of[e.from_id], tl = layer_of[e.to_id]
    var span = tl - fl
    if (span <= 1) {
      edge_chain[e.id] = [e.from_id, e.to_id]
      continue
    }
    var chain = [e.from_id]
    for (var l = fl + 1; l < tl; l++) {
      var did = '_d' + (dummy_id_counter++)
      dummy_set[did] = true
      layer_of[did] = l
      layers[l].push(did)
      chain.push(did)
    }
    chain.push(e.to_id)
    edge_chain[e.id] = chain
  }

  // Re-run crossing minimization with dummies included.
  // Rebuild neighbor lookups including dummy chains.
  left_neighbors = {}
  right_neighbors = {}
  for (var i = 0; i < comp_edges.length; i++) {
    var chain = edge_chain[comp_edges[i].id]
    for (var j = 0; j < chain.length - 1; j++) {
      var a = chain[j], b = chain[j + 1]
      if (!right_neighbors[a]) right_neighbors[a] = []
      right_neighbors[a].push(b)
      if (!left_neighbors[b]) left_neighbors[b] = []
      left_neighbors[b].push(a)
    }
  }

  // Barycentric sweep with dummies
  for (var sweep = 0; sweep < 4; sweep++) {
    var pos = build_pos()
    if (sweep % 2 === 0) {
      for (var i = 1; i < layers.length; i++) {
        sort_layer_by_bc(layers[i], left_neighbors, pos)
        pos = build_pos()
      }
    } else {
      for (var i = layers.length - 2; i >= 0; i--) {
        sort_layer_by_bc(layers[i], right_neighbors, pos)
        pos = build_pos()
      }
    }
  }

  // Re-assign row numbers from reordered layers (with dummies)
  row_of = {}
  total_rows = 0
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      if (row_of[layers[i][j]] === undefined)
        row_of[layers[i][j]] = j
    }
    if (layers[i].length > total_rows) total_rows = layers[i].length
  }

  // ── Gap sizing: count edges that change rows in each gap ──────────

  var gap_channels = []  // gap_channels[g] = number of row-changing edges
  for (var g = 0; g < layers.length - 1; g++) gap_channels.push(0)

  for (var i = 0; i < comp_edges.length; i++) {
    var chain = edge_chain[comp_edges[i].id]
    for (var j = 0; j < chain.length - 1; j++) {
      var g = layer_of[chain[j]]
      if (row_of[chain[j]] !== row_of[chain[j + 1]])
        gap_channels[g]++
    }
  }

  // Also count left port jog vlines and right port jog vlines in gaps
  for (var cid in left_port_groups) {
    if (layer_of[cid] > 0 && layers.length > 1)
      gap_channels[layer_of[cid] - 1]++
  }
  for (var cid in right_port_groups) {
    if (layer_of[cid] < layers.length - 1 && layers.length > 1)
      gap_channels[layer_of[cid]]++
  }

  // Count back-edge vlines in gaps
  for (var i = 0; i < be_conns.length; i++) {
    var info = be_gap_info[be_conns[i].id]
    if (!info) continue
    if (info.src_gap !== null) gap_channels[info.src_gap]++
    if (info.dst_gap !== null) gap_channels[info.dst_gap]++
  }

  // ── Compute layer_x with gaps sized for channel counts ────────────

  var layer_x = []
  for (var i = 0; i < layers.length; i++) {
    if (i === 0) layer_x.push(PORT_COL)
    else {
      var nc = gap_channels[i - 1]
      var gap = Math.max(HLINE_GAP, nc > 0 ? 2 * nc + 5 : HLINE_GAP)
      layer_x.push(layer_x[i - 1] + layer_width[i - 1] + gap)
    }
  }

  function comp_right(cid) {
    return layer_x[layer_of[cid]] + comp_w(cid)
  }

  // ── Vertical channel x-positions per gap ──────────────────────────
  // For each gap, collect all edges that change rows and assign x-positions.

  var v_channel_x = {}  // key → x position
  for (var g = 0; g < layers.length - 1; g++) {
    var ch_list = []
    // Collect comp→comp hops that change rows in this gap
    for (var i = 0; i < comp_edges.length; i++) {
      var chain = edge_chain[comp_edges[i].id]
      for (var j = 0; j < chain.length - 1; j++) {
        if (layer_of[chain[j]] !== g) continue
        if (row_of[chain[j]] === row_of[chain[j + 1]]) continue
        ch_list.push({ key: comp_edges[i].id + '_hop' + j,
                        from_row: row_of[chain[j]], to_row: row_of[chain[j + 1]] })
      }
    }
    // Left port jog vlines in this gap
    for (var cid in left_port_groups) {
      if (layer_of[cid] > 0 && layer_of[cid] - 1 === g)
        ch_list.push({ key: 'lp_' + cid, from_row: row_of[cid], to_row: row_of[cid] })
    }
    // Right port jog vlines in this gap
    for (var cid in right_port_groups) {
      if (layer_of[cid] < layers.length - 1 && layer_of[cid] === g)
        ch_list.push({ key: 'rp_' + cid, from_row: row_of[cid], to_row: row_of[cid] })
    }
    // Back-edge source-leg and dest-leg vlines in this gap
    for (var i = 0; i < be_conns.length; i++) {
      var info = be_gap_info[be_conns[i].id]
      if (!info) continue
      if (info.src_gap === g)
        ch_list.push({ key: 'be_src_' + be_conns[i].id, from_row: row_of[be_conns[i].from.id], to_row: row_of[be_conns[i].from.id] })
      if (info.dst_gap === g)
        ch_list.push({ key: 'be_dst_' + be_conns[i].id, from_row: row_of[be_conns[i].to.id], to_row: row_of[be_conns[i].to.id] })
    }
    if (ch_list.length === 0) continue
    ch_list.sort(function(a, b) { return a.from_row - b.from_row || a.to_row - b.to_row })
    var gap_left = layer_x[g] + layer_width[g]
    var gap_right = layer_x[g + 1]
    var track_min = gap_left + 3
    var track_max = gap_right - 4
    var usable = track_max - track_min
    var n = ch_list.length
    var spacing = n > 1 ? usable / (n - 1) : 0
    for (var j = 0; j < n; j++) {
      var tx = n === 1 ? track_min + Math.floor(usable / 2) : Math.round(track_min + spacing * j)
      tx = Math.max(track_min, Math.min(track_max, tx))
      v_channel_x[ch_list[j].key] = tx
    }
  }

  // ── Row heights: base + back-edge h-channels below each row ───────

  // Count back-edge horizontal channels per row (routed below stations)
  var row_h_count = {}
  for (var i = 0; i < back_edges.length; i++) {
    var max_row = Math.max(row_of[back_edges[i][0]], row_of[back_edges[i][1]])
    row_h_count[max_row] = (row_h_count[max_row] || 0) + 2
  }
  // Contract return h-channels (station→left port)
  for (var i = 0; i < contract_returns.length; i++) {
    var cr_row = row_of[contract_returns[i].from.id]
    row_h_count[cr_row] = (row_h_count[cr_row] || 0) + 2
  }
  // Port jog h-channels
  for (var cid in left_port_groups)
    if (layer_of[cid] > 0)
      row_h_count[row_of[cid]] = (row_h_count[row_of[cid]] || 0) + 2
  for (var cid in right_port_groups)
    if (layer_of[cid] < layers.length - 1)
      row_h_count[row_of[cid]] = (row_h_count[row_of[cid]] || 0) + 2

  var row_y_offset = []
  var cum_y = HEADER_HEIGHT
  for (var r = 0; r < total_rows; r++) {
    row_y_offset.push(cum_y)
    cum_y += ROW_HEIGHT + (row_h_count[r] || 0)
  }

  function comp_y(row) { return row_y_offset[row] !== undefined ? row_y_offset[row] : HEADER_HEIGHT }
  function wire_y(row) { return comp_y(row) + 3 }

  // ── Place components ──────────────────────────────────────────────

  elements = []
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      var cid = layers[i][j]
      if (dummy_set[cid]) continue  // skip dummies
      var row = row_of[cid]
      var cx = layer_x[i]
      var cy = comp_y(row) + 1
      var cw = comp_w(cid)
      var wy = cy + 2  // wire row = station y + 2
      if (station_by_id[cid]) {
        var sname = station_by_id[cid].name
        var el = { type: 'station', id: cid, x: cx, y: cy, width: cw, height: 4,
                   source: trunc(station_by_id[cid].source),
                   in: { x: cx, y: wy }, out: { x: cx + cw, y: wy } }
        if (sname && sname.indexOf('station-') !== 0) el.name = sname
        elements.push(el)
      } else {
        elements.push({ type: 'subspace_box', id: cid, x: cx, y: cy, width: cw, height: 4,
                         name: cid, in: { x: cx, y: wy }, out: { x: cx + cw, y: wy } })
      }
    }
  }

  // ── Track used ports ───────────────────────────────────────────────

  var used_ports = {}
  for (var i = 0; i < connections.length; i++) {
    if (port_by_id[connections[i].from.id]) used_ports[connections[i].from.id] = true
    if (port_by_id[connections[i].to.id]) used_ports[connections[i].to.id] = true
  }

  // ── Connection paths ────────────────────────────────────────────────

  var conn_paths = {}
  function add_path(conn_id, x, y) {
    if (!conn_paths[conn_id]) conn_paths[conn_id] = []
    conn_paths[conn_id].push({ x: x, y: y })
  }

  // ── Route comp→comp edges via dummy chains ─────────────────────────

  // Helper: find the channel x for a hop that changes rows in a gap
  function find_hop_channel_x(edge_id, chain, hop_idx) {
    return v_channel_x[edge_id + '_hop' + hop_idx]
  }

  for (var i = 0; i < comp_edges.length; i++) {
    var e = comp_edges[i]
    var chain = edge_chain[e.id]
    var path = []

    for (var j = 0; j < chain.length - 1; j++) {
      var from_node = chain[j], to_node = chain[j + 1]
      var fl = layer_of[from_node], tl = layer_of[to_node]
      var fr = row_of[from_node], tr = row_of[to_node]

      // Determine x positions for this hop
      var from_x, to_x
      if (dummy_set[from_node]) {
        // Dummy node: use its channel x from previous hop
        // The dummy's position is in the gap, reuse where we ended
        from_x = path.length > 0 ? path[path.length - 1].x : layer_x[fl]
      } else {
        from_x = layer_x[fl] + comp_w(from_node)  // comp_right
      }
      if (dummy_set[to_node]) {
        // Dummy: will be at the channel x in this gap
        to_x = layer_x[tl]  // start of next layer (dummy lives there)
      } else {
        to_x = layer_x[tl]  // comp in.x
      }

      var from_wy = wire_y(fr)
      var to_wy = wire_y(tr)

      if (fr === tr) {
        // Same row: straight horizontal
        if (j === 0) path.push({ x: from_x, y: from_wy })
        path.push({ x: to_x, y: from_wy })
      } else {
        // Different rows: h → v → h through channel
        var ch_x = find_hop_channel_x(e.id, chain, j)
        if (ch_x === undefined) {
          // Fallback: midpoint of gap
          ch_x = Math.floor((from_x + to_x) / 2)
        }
        if (j === 0) path.push({ x: from_x, y: from_wy })
        path.push({ x: ch_x, y: from_wy })
        path.push({ x: ch_x, y: to_wy })
        path.push({ x: to_x, y: to_wy })
      }
    }

    conn_paths[e.id] = path
  }

  // ── Left margin slot assignment ───────────────────────────────────
  // Space vlines 2 apart from x=2 rightward.
  // Slots: back-edge dest vlines, then fan vlines, then jog vlines
  var left_margin_slot = 2
  var be_left_slot = {}
  for (var i = 0; i < be_conns.length; i++) {
    if (layer_of[be_conns[i].to.id] === 0) {
      be_left_slot[be_conns[i].id] = left_margin_slot
      left_margin_slot += 2
    }
  }
  var left_mid_x = left_margin_slot  // fan vlines start after back-edge slots
  var left_jog_x = left_mid_x + 2   // jog vlines after fan

  // Shared right-margin allocation counter — used by back-edge vlines AND port jog vlines
  var right_margin_next = 0
  for (var i = 0; i < layers.length; i++)
    for (var j = 0; j < layers[i].length; j++) {
      if (dummy_set[layers[i][j]]) continue
      var cr = layer_x[i] + comp_w(layers[i][j]) + 1
      if (cr > right_margin_next) right_margin_next = cr
    }
  right_margin_next += 2
  // Back-edge source vlines in right margin
  var be_right_margin_x = {}
  for (var i = 0; i < be_conns.length; i++) {
    var info = be_gap_info[be_conns[i].id]
    if (info && info.src_gap === null) {
      be_right_margin_x[be_conns[i].id] = right_margin_next
      right_margin_next += 2
    }
  }

  // ── Route back-edges ───────────────────────────────────────────────
  // Back-edges go from source._out → right → down → left → up → dest._in
  // They route below all stations via h-channels.

  // Assign h-channel y-positions for back-edges
  var be_h_channels = {}  // be_conn_id → y
  for (var i = 0; i < be_conns.length; i++) {
    var bec = be_conns[i]
    var be_from = bec.from.id, be_to = bec.to.id
    var max_row = Math.max(row_of[be_from], row_of[be_to])
    var base_y = comp_y(max_row) + ROW_HEIGHT
    var hc_idx = 0
    for (var k = 0; k < i; k++) {
      var pk = be_conns[k]
      var pk_max = Math.max(row_of[pk.from.id], row_of[pk.to.id])
      if (pk_max === max_row) hc_idx++
    }
    be_h_channels[bec.id] = base_y + hc_idx * 2
  }

  for (var i = 0; i < be_conns.length; i++) {
    var bec = be_conns[i]
    var be_from = bec.from.id, be_to = bec.to.id
    var from_wy = wire_y(row_of[be_from]), to_wy = wire_y(row_of[be_to])
    var back_y = be_h_channels[bec.id]
    if (back_y === undefined) {
      var max_row = Math.max(row_of[be_from], row_of[be_to])
      back_y = comp_y(max_row) + ROW_HEIGHT - 1
    }

    // Self-loop: source and dest are the same station
    if (be_from === be_to) {
      var src_out_x = comp_right(be_from)
      var src_in_x = layer_x[layer_of[be_from]]
      var loop_vx = src_out_x + 2
      add_path(bec.id, src_out_x, from_wy)
      add_path(bec.id, loop_vx, from_wy)
      add_path(bec.id, loop_vx, back_y)
      add_path(bec.id, src_in_x - 2, back_y)
      add_path(bec.id, src_in_x - 2, to_wy)
      add_path(bec.id, src_in_x, to_wy)
      continue
    }

    var info = be_gap_info[bec.id]
    var src_out_x = comp_right(be_from)
    var dst_in_x = layer_x[layer_of[be_to]]

    // Source vline: coordinated position from gap allocation or right margin
    var from_vx = (info && info.src_gap !== null) ? v_channel_x['be_src_' + bec.id]
                : be_right_margin_x[bec.id]
    if (from_vx === undefined) from_vx = src_out_x + 3

    // Dest vline: coordinated position from gap allocation or left margin
    var to_vx = (info && info.dst_gap !== null) ? v_channel_x['be_dst_' + bec.id]
              : be_left_slot[bec.id]
    if (to_vx === undefined) to_vx = Math.max(2, dst_in_x - 3)

    // Build path: source._out → from_vx → down → back_y → left → to_vx → up → dest._in
    add_path(bec.id, src_out_x, from_wy)
    add_path(bec.id, from_vx, from_wy)
    add_path(bec.id, from_vx, back_y)
    add_path(bec.id, to_vx, back_y)
    add_path(bec.id, to_vx, to_wy)
    add_path(bec.id, dst_in_x, to_wy)
  }

  // ── Route contract returns (station → left port) ──────────────────
  // These route from station.out backward to a left-dir port.
  // Path: station.out → right → down → left → up → port.wire_x



  for (var i = 0; i < contract_returns.length; i++) {
    var cr = contract_returns[i]
    var comp_id = cr.from.id, port_id = cr.to.id
    var port = port_by_id[port_id]
    var from_wy = wire_y(row_of[comp_id])
    // Port may already be emitted from left_port_groups; if not, it will be placed later.
    // The port is at x=0, wire_x=1. We need to route from station.out back to wire_x=1.
    var src_out_x = comp_right(comp_id)
    var port_wy = from_wy  // same row as station (contract pairs share the station)

    // For same-row routing: go from station.out → down → left to port → up
    var cr_back_y = comp_y(row_of[comp_id]) + ROW_HEIGHT
    var hc_below = row_h_count[row_of[comp_id]] || 0
    cr_back_y += hc_below > 0 ? hc_below : 0

    var cr_right_vx = src_out_x + 2
    var cr_left_vx = Math.max(2, left_mid_x)

    add_path(cr.id, src_out_x, from_wy)
    add_path(cr.id, cr_right_vx, from_wy)
    add_path(cr.id, cr_right_vx, cr_back_y)
    add_path(cr.id, cr_left_vx, cr_back_y)
    add_path(cr.id, cr_left_vx, port_wy)
    add_path(cr.id, 1, port_wy)
  }

  // ── Route left port connections ────────────────────────────────────

  var emitted_ports = {}

  // Compute the y below a station row, past h-channels (for jog routing)
  function jog_y_below(row) {
    var hc = row_h_count[row] || 0
    return comp_y(row) + ROW_HEIGHT + hc - (hc > 0 ? 1 : 0)
  }

  for (var cid in left_port_groups) {
    var group = left_port_groups[cid]
    var base_wy = wire_y(row_of[cid])
    var lx = layer_x[layer_of[cid]]
    for (var j = 0; j < group.length; j++) {
      var wy = base_wy + j * 2
      var is_fan_out = left_port_stations[group[j].id] && left_port_stations[group[j].id].length > 1
      var pc = conn_for_pair[group[j].id + '|' + cid]
      if (!emitted_ports[group[j].id]) {
        elements.push({ type: 'port', x: 0, y: wy, dir: 'left', key: group[j].key, id: group[j].id, wire_x: 1 })
        emitted_ports[group[j].id] = { y: wy }
      }
      if (!pc) continue
      if (j > 0) {
        // Offset port: hline from port to midpoint, then vline to base wire row
        add_path(pc, 1, wy)
        add_path(pc, left_mid_x, wy)
        add_path(pc, left_mid_x, base_wy)
        add_path(pc, lx, base_wy)
      } else if (is_fan_out && emitted_ports[group[j].id].y !== wy) {
        // Fan-out: route from fan vline down to this row, then to station
        var port_y = emitted_ports[group[j].id].y
        if (layer_of[cid] > 0) {
          var jog_wy = jog_y_below(row_of[cid])
          add_path(pc, 1, port_y)
          add_path(pc, left_mid_x, port_y)
          add_path(pc, left_mid_x, jog_wy)
          var target_gap_x = v_channel_x['lp_' + cid] || (layer_x[layer_of[cid]] - 3)
          add_path(pc, target_gap_x, jog_wy)
          add_path(pc, target_gap_x, wy)
          add_path(pc, lx, wy)
        } else {
          add_path(pc, 1, port_y)
          add_path(pc, left_mid_x, port_y)
          add_path(pc, left_mid_x, wy)
          add_path(pc, lx, wy)
        }
      } else if (layer_of[cid] > 0) {
        var jog_wy = jog_y_below(row_of[cid])
        var first_gap_x = left_jog_x
        add_path(pc, 1, wy)
        add_path(pc, first_gap_x, wy)
        add_path(pc, first_gap_x, jog_wy)
        var target_gap_x = v_channel_x['lp_' + cid] || (layer_x[layer_of[cid]] - 3)
        add_path(pc, target_gap_x, jog_wy)
        add_path(pc, target_gap_x, wy)
        add_path(pc, lx, wy)
      } else {
        // First port, layer 0: direct hline
        add_path(pc, 1, wy)
        add_path(pc, lx, wy)
      }
    }
  }

  // ── Deferred right port groups ─────────────────────────────────────

  var deferred_right = []
  for (var cid in right_port_groups) {
    var group = right_port_groups[cid]
    for (var j = 0; j < group.length; j++)
      deferred_right.push({ comp_id: cid, port: group[j], offset: j })
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
  for (var i = 0; i < layers.length; i++)
    for (var j = 0; j < layers[i].length; j++) {
      if (dummy_set[layers[i][j]]) continue
      var rx = layer_x[i] + comp_w(layers[i][j]) + 2
      if (rx > max_right_x) max_right_x = rx
    }
  // Back-edge right-margin vlines may extend right of stations
  for (var bid in be_right_margin_x) {
    var rx = be_right_margin_x[bid] + 2
    if (rx > max_right_x) max_right_x = rx
  }
  var width = Math.max(min_width, max_right_x)

  // ── Place deferred right ports ─────────────────────────────────────

  // Check if any component in a later layer occupies the same row as cid
  function has_later_comp_at_row(cid) {
    var cl = layer_of[cid], cr = row_of[cid]
    for (var li = cl + 1; li < layers.length; li++)
      for (var j = 0; j < layers[li].length; j++) {
        if (dummy_set[layers[li][j]]) continue
        if (row_of[layers[li][j]] === cr) return true
      }
    return false
  }

  // Port jog right-edge vlines — continue from shared right_margin_next counter
  var right_edge_positions = {}
  for (var i = 0; i < deferred_right.length; i++) {
    var dr_pre = deferred_right[i]
    if (dr_pre.offset === 0 && layer_of[dr_pre.comp_id] < layers.length - 1) {
      right_edge_positions[dr_pre.comp_id] = right_margin_next
      right_margin_next += 2
    }
  }
  if (right_margin_next + 3 > width) width = right_margin_next + 3

  var right_port_stations = build_port_station_map(right_port_groups)
  var right_fan_x = width - 3

  for (var i = 0; i < deferred_right.length; i++) {
    var dr = deferred_right[i]
    var row = row_of[dr.comp_id]
    var base_wy = wire_y(row)
    var wy = base_wy + (dr.offset ? dr.offset * 2 : 0)
    var rx = comp_right(dr.comp_id)
    var rpc = conn_for_pair[dr.comp_id + '|' + dr.port.id]
    if (!emitted_ports[dr.port.id]) {
      elements.push({ type: 'port', x: width - 1, y: wy, dir: 'right', key: dr.port.key, id: dr.port.id, wire_x: width - 2 })
      emitted_ports[dr.port.id] = { y: wy }
    }
    if (!rpc) continue
    var is_right_fan = right_port_stations[dr.port.id] && right_port_stations[dr.port.id].length > 1
    var needs_fan_v = is_right_fan && emitted_ports[dr.port.id].y !== wy
    var port_x = needs_fan_v ? right_fan_x : width - 2
    if (dr.offset > 0) {
      var mid_x = rx + Math.floor((width - 1 - rx) / 2)
      add_path(rpc, rx, base_wy)
      add_path(rpc, mid_x, base_wy)
      add_path(rpc, mid_x, wy)
      add_path(rpc, port_x, wy)
    } else if (layer_of[dr.comp_id] < layers.length - 1 && has_later_comp_at_row(dr.comp_id)) {
      var right_jog_y = jog_y_below(row)
      var right_gap_x = v_channel_x['rp_' + dr.comp_id] || (rx + 2)
      var right_edge_x = right_edge_positions[dr.comp_id] || (width - 3)
      add_path(rpc, rx, wy)
      add_path(rpc, right_gap_x, wy)
      add_path(rpc, right_gap_x, right_jog_y)
      add_path(rpc, right_edge_x, right_jog_y)
      add_path(rpc, right_edge_x, wy)
      add_path(rpc, port_x, wy)
    } else {
      add_path(rpc, rx, wy)
      add_path(rpc, port_x, wy)
    }
    if (needs_fan_v) {
      var port_wy = emitted_ports[dr.port.id].y
      add_path(rpc, right_fan_x, port_wy)
      add_path(rpc, width - 2, port_wy)
    }
  }

  // ── Compute content_y ──────────────────────────────────────────────

  var max_fan_y = 0
  for (var cid in conn_paths) {
    var pts = conn_paths[cid]
    for (var j = 0; j < pts.length; j++)
      if (pts[j].y > max_fan_y) max_fan_y = pts[j].y
  }
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if ((el.type === 'station' || el.type === 'subspace_box') && el.y + el.height - 1 > max_fan_y)
      max_fan_y = el.y + el.height - 1
    if (el.type === 'port' && el.y > max_fan_y)
      max_fan_y = el.y
  }
  var content_y = max_fan_y > 0 ? max_fan_y + 1 : cum_y

  // ── Standalone port rows ───────────────────────────────────────────

  var port_rows = Math.max(left_ports.length, right_ports.length)
  var sy = content_y
  var li = 0, ri = 0
  while (li < left_ports.length || ri < right_ports.length) {
    if (li < left_ports.length) {
      elements.push({ type: 'port', x: 0, y: sy, dir: 'left', key: left_ports[li].key, wire_x: 1 })
      li++
    }
    if (ri < right_ports.length) {
      elements.push({ type: 'port', x: width - 1, y: sy, dir: 'right', key: right_ports[ri].key, wire_x: width - 2 })
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

  var height = content_y + port_rows + state_rows + 1
  if (total_rows === 0 && port_rows === 0 && state_rows === 0 && max_fan_y === 0) height = 3

  elements.unshift({ type: 'box', x: 0, y: 0, width: width, height: height, name: name })

  // Build paths array for output
  var paths = []
  var conn_by_id = {}
  for (var i = 0; i < connections.length; i++) conn_by_id[connections[i].id] = connections[i]
  for (var cid in conn_paths) {
    var c = conn_by_id[cid]
    paths.push({ conn: cid, from: c ? c.from.id : null, to: c ? c.to.id : null, path: conn_paths[cid] })
  }

  var result = { id: topology.id, name: name, width: width, height: height, elements: elements, paths: paths }
  if (options && options.check_invariants) {
    result.topology = topology
    check_layout_invariants(result)
    delete result.topology
  }
  return result
}

// Verify layout invariants (opt-in via options.check_invariants)
function check_layout_invariants(laid) {
  // Build component lookup: id → element (for endpoint checking)
  var comp_by_id = {}
  var stations = [], port_ids = {}
  for (var i = 0; i < laid.elements.length; i++) {
    var el = laid.elements[i]
    if (el.type === 'station' || el.type === 'subspace_box') { stations.push(el); comp_by_id[el.id] = el }
    if (el.type === 'port') {
      if (port_ids[el.key + ',' + el.dir]) throw new Error('Invariant 9: duplicate port ' + el.key)
      port_ids[el.key + ',' + el.dir] = true
      comp_by_id[el.id] = el
    }
  }

  // Build connection lookup for endpoint awareness
  var topo_conns = {}
  if (laid.topology) {
    for (var i = 0; i < laid.topology.connections.length; i++) {
      var c = laid.topology.connections[i]
      topo_conns[c.id] = c
    }
  }

  var paths = laid.paths || []
  for (var i = 0; i < paths.length; i++) {
    var pts = paths[i].path, conn = paths[i].conn
    // Which stations does this connection touch? (allowed to reach their edge)
    var tc = topo_conns[conn]
    var conn_station_ids = {}
    if (tc) { conn_station_ids[tc.from.id] = true; conn_station_ids[tc.to.id] = true }

    // Invariant 1: no wire segment enters a station body interior
    // A wire may touch a station's in.x or out.x at the wire row, but not interior cells
    for (var j = 0; j < pts.length - 1; j++) {
      var x0 = pts[j].x, y0 = pts[j].y, x1 = pts[j + 1].x, y1 = pts[j + 1].y
      if (y0 === y1) {
        var xmin = Math.min(x0, x1), xmax = Math.max(x0, x1)
        for (var si = 0; si < stations.length; si++) {
          var s = stations[si]
          if (y0 < s.y || y0 > s.y + 3) continue
          // Interior: cells between in.x and out.x exclusive (s.x+1 to s.x+s.width-2)
          if (xmax >= s.x + 1 && xmin <= s.x + s.width - 2)
            throw new Error('Invariant 1: ' + conn + ' hline at y=' + y0 + ' enters interior of ' + (s.name || s.id || s.source))
        }
      } else if (x0 === x1) {
        var ymin = Math.min(y0, y1), ymax = Math.max(y0, y1)
        for (var si = 0; si < stations.length; si++) {
          var s = stations[si]
          if (x0 < s.x || x0 > s.x + s.width - 1) continue
          if (ymax >= s.y && ymin <= s.y + 3)
            throw new Error('Invariant 1: ' + conn + ' vline at x=' + x0 + ' enters ' + (s.name || s.id || s.source))
        }
      }
    }
  }

  // Invariant: every path reaches its FROM and TO
  // Requires topology connections to check against
  if (laid.topology) {
    var topo_conns = {}
    for (var i = 0; i < laid.topology.connections.length; i++) {
      var c = laid.topology.connections[i]
      topo_conns[c.id] = c
    }
    for (var i = 0; i < paths.length; i++) {
      var pts = paths[i].path, conn = paths[i].conn
      if (pts.length < 2) throw new Error('Invariant endpoint: ' + conn + ' has < 2 waypoints')
      var tc = topo_conns[conn]
      if (!tc) continue
      var from_el = comp_by_id[tc.from.id], to_el = comp_by_id[tc.to.id]
      if (!from_el || !to_el) continue
      var first = pts[0], last = pts[pts.length - 1]
      // FROM check: path starts at the component's outgoing point
      var from_pt = from_el.out || { x: from_el.wire_x, y: from_el.y }
      if (first.x !== from_pt.x || first.y !== from_pt.y)
        throw new Error('Invariant endpoint: ' + conn + ' starts at (' + first.x + ',' + first.y + ') but FROM ' + tc.from.id + ' out is (' + from_pt.x + ',' + from_pt.y + ')')
      // TO check: path ends at the component's incoming point
      var to_pt = to_el.in || { x: to_el.wire_x, y: to_el.y }
      if (last.x !== to_pt.x || last.y !== to_pt.y)
        throw new Error('Invariant endpoint: ' + conn + ' ends at (' + last.x + ',' + last.y + ') but TO ' + tc.to.id + ' in is (' + to_pt.x + ',' + to_pt.y + ')')
    }
  }

  // Invariant: no opposing directions on shared wire segments
  // Two connections sharing a cell must flow the same direction on each axis.
  var h_dir_at = {}  // 'x,y' → { dir, conn }
  var v_dir_at = {}
  for (var i = 0; i < paths.length; i++) {
    var pts = paths[i].path, conn = paths[i].conn
    for (var j = 0; j < pts.length - 1; j++) {
      var x0 = pts[j].x, y0 = pts[j].y, x1 = pts[j + 1].x, y1 = pts[j + 1].y
      if (y0 === y1) {
        var hd = x1 > x0 ? 'right' : 'left'
        var xmin = Math.min(x0, x1), xmax = Math.max(x0, x1)
        for (var x = xmin; x <= xmax; x++) {
          var k = x + ',' + y0
          if (h_dir_at[k] && h_dir_at[k].dir !== hd)
            throw new Error('Invariant opposing-h: ' + conn + ' goes ' + hd + ' at (' + x + ',' + y0 + ') but ' + h_dir_at[k].conn + ' goes ' + h_dir_at[k].dir)
          if (!h_dir_at[k]) h_dir_at[k] = { dir: hd, conn: conn }
        }
      } else if (x0 === x1) {
        var vd = y1 > y0 ? 'down' : 'up'
        var ymin = Math.min(y0, y1), ymax = Math.max(y0, y1)
        for (var y = ymin; y <= ymax; y++) {
          var k = x0 + ',' + y
          if (v_dir_at[k] && v_dir_at[k].dir !== vd)
            throw new Error('Invariant opposing-v: ' + conn + ' goes ' + vd + ' at (' + x0 + ',' + y + ') but ' + v_dir_at[k].conn + ' goes ' + v_dir_at[k].dir)
          if (!v_dir_at[k]) v_dir_at[k] = { dir: vd, conn: conn }
        }
      }
    }
  }

  // Invariant: no false connectivity on shared wire segments
  // Two connections sharing a cell in the same direction must share
  // at least one endpoint (from or to). Otherwise the diagram implies
  // a connection that doesn't exist.
  var h_conns_at = {}  // 'x,y' → [{ conn, from, to }]
  var v_conns_at = {}
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i], pts = p.path
    for (var j = 0; j < pts.length - 1; j++) {
      var x0 = pts[j].x, y0 = pts[j].y, x1 = pts[j + 1].x, y1 = pts[j + 1].y
      if (y0 === y1) {
        var hd = x1 > x0 ? 'right' : 'left'
        var xmin = Math.min(x0, x1), xmax = Math.max(x0, x1)
        for (var x = xmin; x <= xmax; x++) {
          var k = x + ',' + y0
          if (!h_conns_at[k]) h_conns_at[k] = []
          h_conns_at[k].push({ conn: p.conn, from: p.from, to: p.to, dir: hd })
        }
      } else if (x0 === x1) {
        var vd = y1 > y0 ? 'down' : 'up'
        var ymin = Math.min(y0, y1), ymax = Math.max(y0, y1)
        for (var y = ymin; y <= ymax; y++) {
          var k = x0 + ',' + y
          if (!v_conns_at[k]) v_conns_at[k] = []
          v_conns_at[k].push({ conn: p.conn, from: p.from, to: p.to, dir: vd })
        }
      }
    }
  }
  var reported_pairs = {}
  function check_shared_wire(cells_at, axis) {
    for (var k in cells_at) {
      var entries = cells_at[k]
      if (entries.length < 2) continue
      for (var i = 0; i < entries.length; i++) {
        for (var j = i + 1; j < entries.length; j++) {
          var a = entries[i], b = entries[j]
          if (a.dir !== b.dir) continue  // different directions handled by opposing check
          if (a.from === b.from || a.to === b.to) continue  // shared endpoint: valid fan-in/out
          var pair_key = a.conn < b.conn ? a.conn + '|' + b.conn : b.conn + '|' + a.conn
          if (reported_pairs[pair_key]) continue
          reported_pairs[pair_key] = true
          throw new Error('Invariant shared-wire: ' + a.conn + ' (' + a.from + '->' + a.to + ') and ' + b.conn + ' (' + b.from + '->' + b.to + ') share ' + axis + ' wire at ' + k + ' with no common endpoint')
        }
      }
    }
  }
  check_shared_wire(h_conns_at, 'h')
  check_shared_wire(v_conns_at, 'v')
}
