// daimio/space_ascii.js — three-phase ASCII topology renderer for Daimio spaces
//
// Pipeline: extract (seedlike → topology) → layout (topology → positioned) → render (positioned → ASCII)
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
  var HLINE_GAP = 5
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

  // ── Route connections ────────────────────────────────────────────────
  // Trunk-and-channel model:
  //   - One trunk hline per (gap, row) pair (shared by all connections at that gap-row)
  //   - Vertical channels in inter-layer gaps for cross-row connections
  //   - Horizontal channels between station rows for multi-layer jogs and back-edges

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

  // Three categories:
  var direct_conns = []      // same row, adjacent layers → single trunk
  var adjacent_cross = []    // different rows, adjacent layers → trunk + vchannel + trunk
  var multi_conns = []       // spans 2+ gaps (any row) → per-gap routing with h-channel

  for (var i = 0; i < comp_conns.length; i++) {
    var c = comp_conns[i]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    var sl = layer_of[c.from.id], dl = layer_of[c.to.id]
    if (dl - sl === 1 && sr === dr) direct_conns.push(c)
    else if (dl - sl === 1) adjacent_cross.push(c)
    else multi_conns.push(c)  // dl - sl > 1, any row combination
  }

  // Widen PORT_COL if both fan vlines and jog vlines are needed in the left margin.
  // Fan vlines exist when a left port connects to stations at different rows.
  // Jog vlines exist when a left port connects to a station at layer > 0.
  var has_left_fan = false, has_left_jog = false
  for (var cid in left_port_groups) {
    if (layer_of[cid] > 0) has_left_jog = true
    var group = left_port_groups[cid]
    for (var j = 0; j < group.length; j++) {
      // Check if this port also connects to a station at a different row
      for (var cid2 in left_port_groups) {
        if (cid2 !== cid && row_of[cid2] !== row_of[cid]) {
          for (var k = 0; k < left_port_groups[cid2].length; k++)
            if (left_port_groups[cid2][k].id === group[j].id) has_left_fan = true
        }
      }
    }
  }
  if (has_left_fan && has_left_jog) PORT_COL = 7

  // ── Channel allocation ───────────────────────────────────────────

  // Vertical channels: one per connection that changes rows in a gap
  var gap_v_channels = []
  for (var g = 0; g < layers.length - 1; g++) gap_v_channels.push([])

  // Adjacent cross-row: one vchannel in the single gap
  for (var i = 0; i < adjacent_cross.length; i++) {
    var c = adjacent_cross[i]
    var g = layer_of[c.from.id]
    gap_v_channels[g].push({ conn: c, from_row: row_of[c.from.id], to_row: row_of[c.to.id] })
  }

  // Multi-layer: vchannel in source gap AND dest gap
  for (var i = 0; i < multi_conns.length; i++) {
    var c = multi_conns[i]
    var sl = layer_of[c.from.id], dl = layer_of[c.to.id]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    gap_v_channels[sl].push({ conn: c, from_row: sr, to_row: sr, side: 'source' })
    gap_v_channels[dl - 1].push({ conn: c, from_row: dr, to_row: dr, side: 'dest' })
  }

  // Back-edges: vchannel in gap to the LEFT of source and LEFT of dest
  // (connecting to _out on source side, _in on dest side)
  // For last-layer sources with multi-layer span → right margin.
  // For layer-0 dests → left margin if room, else gap to the RIGHT.
  var be_right_margin = []  // back-edges whose source needs right-margin routing
  var be_left_margin = []   // back-edges whose dest needs left-margin routing

  // Pre-check left margin capacity: slots 2..PORT_COL-2, minus reserved positions
  var left_mid_x = Math.floor(PORT_COL / 2)
  var port_jog_vlines = {}
  var has_left_ports = false
  for (var cid in left_port_groups) { has_left_ports = true; break }
  var left_margin_reserved = {}
  if (has_left_ports) { left_margin_reserved[PORT_COL - 2] = true }
  var left_margin_capacity = 0
  for (var lmx = 2; lmx < PORT_COL - 1; lmx++)
    if (!left_margin_reserved[lmx]) left_margin_capacity++
  var left_margin_used = 0

  if (gap_v_channels.length > 0) {
    for (var i = 0; i < back_edges.length; i++) {
      var be_from = back_edges[i][0], be_to = back_edges[i][1]
      var be_id = 'be_' + be_from + '_' + be_to
      var from_layer = layer_of[be_from], to_layer = layer_of[be_to]
      // Source vline: gap to the RIGHT (connects to _out), or right margin if last layer
      if (from_layer >= layers.length - 1) {
        be_right_margin.push(back_edges[i])
      } else {
        var from_gap = from_layer  // gap to the RIGHT of source station
        gap_v_channels[from_gap].push({ conn: { id: be_id }, from_row: row_of[be_from], to_row: row_of[be_from], side: 'be_from' })
      }
      // Dest vline: left margin if layer 0 and room, else gap to the LEFT (or RIGHT for layer 0)
      if (to_layer === 0 && left_margin_used < left_margin_capacity) {
        be_left_margin.push(back_edges[i])
        left_margin_used++
      } else {
        var to_gap = to_layer > 0 ? to_layer - 1 : 0
        gap_v_channels[to_gap].push({ conn: { id: be_id }, from_row: row_of[be_to], to_row: row_of[be_to], side: 'be_to' })
      }
    }
  }

  // Right port jog vlines: non-last-layer stations with right ports need a vchannel
  for (var cid in right_port_groups) {
    if (layer_of[cid] < layers.length - 1 && gap_v_channels.length > 0) {
      var rp_gap = layer_of[cid]  // gap to the RIGHT of this station
      gap_v_channels[rp_gap].push({ conn: { id: 'rp_' + cid }, from_row: row_of[cid], to_row: row_of[cid], side: 'rp_src' })
    }
  }

  // Left port jog vlines: non-layer-0 stations with left ports need a vchannel in the gap to their LEFT
  for (var cid in left_port_groups) {
    if (layer_of[cid] > 0 && gap_v_channels.length > 0) {
      var lp_gap = layer_of[cid] - 1  // gap to the LEFT of this station
      gap_v_channels[lp_gap].push({ conn: { id: 'lp_' + cid }, from_row: row_of[cid], to_row: row_of[cid], side: 'lp_tgt' })
    }
  }

  // Sort channels within each gap for consistent positioning
  for (var g = 0; g < gap_v_channels.length; g++) {
    var channels = gap_v_channels[g]
    if (channels.length === 0) continue
    channels.sort(function(a, b) {
      return a.from_row - b.from_row || a.to_row - b.to_row
    })
  }

  // ── Recompute layer_x with gaps sized for channel counts ──────────

  layer_x = []
  for (var i = 0; i < layers.length; i++) {
    if (i === 0) layer_x.push(PORT_COL)
    else {
      var n_channels = gap_v_channels[i - 1].length
      var gap = Math.max(HLINE_GAP, n_channels > 1 ? 2 * n_channels + 3 : n_channels + 5)
      layer_x.push(layer_x[i - 1] + layer_width[i - 1] + gap)
    }
  }

  // Convert channel indices to x-positions
  var v_channel_x = {}
  for (var g = 0; g < gap_v_channels.length; g++) {
    var channels = gap_v_channels[g]
    if (channels.length === 0) continue
    var gap_left = layer_x[g] + layer_width[g]
    var gap_right = layer_x[g + 1]
    var track_min = gap_left + 2
    var track_max = gap_right - 3
    var usable = track_max - track_min
    var n = channels.length
    var spacing = n > 1 ? usable / (n - 1) : 0
    for (var j = 0; j < n; j++) {
      var tx = n === 1 ? track_min + Math.floor(usable / 2) : Math.round(track_min + spacing * j)
      tx = Math.max(track_min, Math.min(track_max, tx))
      var ch = channels[j]
      var key = ch.conn.id + (ch.side || '')
      v_channel_x[key] = tx
    }
  }

  // ── Horizontal channels for multi-layer connections ───────────────

  var row_pair_h_channels = {}
  for (var i = 0; i < multi_conns.length; i++) {
    var c = multi_conns[i]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    var sl = layer_of[c.from.id], dl = layer_of[c.to.id]
    var h_row = Math.min(sr, dr)
    var rk = '' + h_row
    if (!row_pair_h_channels[rk]) row_pair_h_channels[rk] = []
    row_pair_h_channels[rk].push({ conn: c, from_gap: sl, to_gap: dl - 1 })
  }

  // Back-edges also need horizontal routing below stations
  for (var i = 0; i < back_edges.length; i++) {
    var be_from = back_edges[i][0], be_to = back_edges[i][1]
    var max_row = Math.max(row_of[be_from], row_of[be_to])
    var rk = '' + max_row
    if (!row_pair_h_channels[rk]) row_pair_h_channels[rk] = []
    row_pair_h_channels[rk].push({ conn: null, back_edge: back_edges[i], from_gap: 0, to_gap: 0 })
  }

  // Row heights: base + horizontal channel space below each row (stride 2 for spacing)
  // h-channel count (for positioning jogs after h-channels)
  var row_hc_only = {}
  for (var rk in row_pair_h_channels) {
    var r = parseInt(rk)
    var n = row_pair_h_channels[rk].length
    row_hc_only[r] = (row_hc_only[r] || 0) + (n > 0 ? 2 * n - 1 : 0)
  }
  // Full count includes port jog hlines (for row spacing)
  var row_h_count = {}
  for (var r in row_hc_only) row_h_count[r] = row_hc_only[r]
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

  function comp_y_v3(row) { return row_y_offset[row] !== undefined ? row_y_offset[row] : HEADER_HEIGHT }
  function wire_y_v3(row) { return comp_y_v3(row) + 3 }

  // Assign h-channel y-positions
  var h_channel_y = {}
  for (var rk in row_pair_h_channels) {
    var r = parseInt(rk)
    var base_y = comp_y_v3(r) + ROW_HEIGHT
    var channels = row_pair_h_channels[rk]
    for (var j = 0; j < channels.length; j++) {
      if (channels[j].conn)
        h_channel_y[channels[j].conn.id] = base_y + j * 2
      else if (channels[j].back_edge)
        h_channel_y['be_' + channels[j].back_edge[0] + '_' + channels[j].back_edge[1]] = base_y + j * 2
    }
  }

  // ── Place components ──────────────────────────────────────────────

  elements = []
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      var cid = layers[i][j]
      var row = row_of[cid]
      var cx = layer_x[i]
      var cy = comp_y_v3(row) + 1
      var cw = comp_w(cid)
      if (station_by_id[cid]) {
        var sname = station_by_id[cid].name
        var el = { type: 'station', id: cid, x: cx, y: cy, width: cw, height: 4, source: trunc(station_by_id[cid].source) }
        if (sname && sname.indexOf('station-') !== 0) el.name = sname
        elements.push(el)
      } else {
        elements.push({ type: 'subspace_box', id: cid, x: cx, y: cy, width: cw, height: 4, name: cid })
      }
    }
  }

  // ── Track used ports ───────────────────────────────────────────────

  var used_ports = {}
  for (var i = 0; i < connections.length; i++) {
    if (port_by_id[connections[i].from.id]) used_ports[connections[i].from.id] = true
    if (port_by_id[connections[i].to.id]) used_ports[connections[i].to.id] = true
  }

  // ── Trunk-and-channel routing ──────────────────────────────────────

  // Hline accumulator: tracks all hline ranges per y-coordinate
  // Multiple ranges at the same y are kept separate if they don't overlap
  var hline_ranges = {}  // y → [{min_x, max_x, dir, conns}, ...]

  function add_hline_range(y, x_left, x_right, dir, conns) {
    if (!dir) dir = 'right'
    if (!conns) conns = []

    if (!hline_ranges[y]) hline_ranges[y] = []
    var ranges = hline_ranges[y]
    // Merge strictly overlapping ranges (not merely adjacent)
    for (var k = 0; k < ranges.length; k++) {
      if (x_left < ranges[k].max_x && x_right > ranges[k].min_x) {
        if (x_left < ranges[k].min_x) ranges[k].min_x = x_left
        if (x_right > ranges[k].max_x) ranges[k].max_x = x_right
        // Union connection IDs
        for (var ci = 0; ci < conns.length; ci++)
          if (ranges[k].conns.indexOf(conns[ci]) < 0) ranges[k].conns.push(conns[ci])
        // Cascade: check if expanded range now overlaps others
        for (var m = ranges.length - 1; m >= 0; m--) {
          if (m === k) continue
          if (ranges[k].min_x < ranges[m].max_x && ranges[k].max_x > ranges[m].min_x) {
            if (ranges[m].min_x < ranges[k].min_x) ranges[k].min_x = ranges[m].min_x
            if (ranges[m].max_x > ranges[k].max_x) ranges[k].max_x = ranges[m].max_x
            // Union connection IDs from merged range
            for (var ci = 0; ci < ranges[m].conns.length; ci++)
              if (ranges[k].conns.indexOf(ranges[m].conns[ci]) < 0) ranges[k].conns.push(ranges[m].conns[ci])
            ranges.splice(m, 1)
            if (m < k) k--
          }
        }
        return
      }
    }
    ranges.push({ min_x: x_left, max_x: x_right, dir: dir, conns: conns.slice() })
  }

  function add_trunk(gap, row, x_left, x_right, conns) {
    add_hline_range(wire_y_v3(row), x_left, x_right, 'right', conns)
  }

  // Accumulate a port jog vline at x, spanning from y_top to y_bot
  function add_port_jog_vline(x, y_top, y_bot, dir, conns) {
    var k = x + '|' + dir
    if (!port_jog_vlines[k]) port_jog_vlines[k] = { x: x, min_y: y_top, max_y: y_bot, dir: dir, conns: conns ? conns.slice() : [] }
    else {
      if (y_top < port_jog_vlines[k].min_y) port_jog_vlines[k].min_y = y_top
      if (y_bot > port_jog_vlines[k].max_y) port_jog_vlines[k].max_y = y_bot
      if (conns) for (var ci = 0; ci < conns.length; ci++)
        if (port_jog_vlines[k].conns.indexOf(conns[ci]) < 0) port_jog_vlines[k].conns.push(conns[ci])
    }
  }

  // Emit segmented fan vline: split at each y in ys so each is an endpoint
  function emit_fan_vline(x, ys, dir, conns) {
    if (ys.length < 2) return
    elements.push({ type: 'vline', x: x, y: ys[0], length: ys[1] - ys[0] + 1, dir: dir, conns: conns || [] })
    for (var fi = 1; fi < ys.length - 1; fi++)
      elements.push({ type: 'vline', x: x, y: ys[fi] + 1, length: ys[fi + 1] - ys[fi], dir: dir, conns: conns || [] })
  }

  // Emit fan vlines for ports connecting to multiple stations at different rows
  function emit_port_fans(port_stations_map, fan_x, default_dir, is_left) {
    for (var pid in port_stations_map) {
      var sids = port_stations_map[pid]
      if (sids.length <= 1) continue
      var fan_wys = []
      var fan_conns = []
      for (var j = 0; j < sids.length; j++) {
        var fwy = wire_y_v3(row_of[sids[j]])
        if (fan_wys.indexOf(fwy) < 0) fan_wys.push(fwy)
        var cid = is_left ? conn_for_pair[pid + '|' + sids[j]] : conn_for_pair[sids[j] + '|' + pid]
        if (cid && fan_conns.indexOf(cid) < 0) fan_conns.push(cid)
      }
      if (fan_wys.length <= 1) continue
      fan_wys.sort(function(a, b) { return a - b })
      emit_fan_vline(fan_x, fan_wys, default_dir, fan_conns)
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

  // Compute the y below a station row, past h-channels (for jog routing)
  function jog_y_below(row) {
    var row_hc = row_hc_only[row] || 0
    return comp_y_v3(row) + ROW_HEIGHT + row_hc + (row_hc > 0 ? 1 : 0)
  }

  // Check if any component in a later layer occupies the same row as cid
  function has_later_comp_at_row(cid) {
    var cl = layer_of[cid], cr = row_of[cid]
    for (var li = cl + 1; li < layers.length; li++)
      for (var j = 0; j < layers[li].length; j++)
        if (row_of[layers[li][j]] === cr) return true
    return false
  }

  // Direct connections: trunk spans entire gap
  for (var i = 0; i < direct_conns.length; i++) {
    var c = direct_conns[i]
    var g = layer_of[c.from.id]
    var r = row_of[c.from.id]
    add_trunk(g, r, comp_right(c.from.id), layer_x[layer_of[c.to.id]], [c.id])
  }

  // Adjacent cross-row: source-side trunk + dest-side trunk
  for (var i = 0; i < adjacent_cross.length; i++) {
    var c = adjacent_cross[i]
    var g = layer_of[c.from.id]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    var track_x = v_channel_x[c.id]
    add_trunk(g, sr, comp_right(c.from.id), track_x + 1, [c.id])
    add_trunk(g, dr, track_x, layer_x[layer_of[c.to.id]], [c.id])
  }

  // Multi-layer: source trunk (source gap), dest trunk (dest gap)
  for (var i = 0; i < multi_conns.length; i++) {
    var c = multi_conns[i]
    var sl = layer_of[c.from.id], dl = layer_of[c.to.id]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    var src_vx = v_channel_x[c.id + 'source']
    var dst_vx = v_channel_x[c.id + 'dest']
    add_trunk(sl, sr, comp_right(c.from.id), src_vx + 1, [c.id])
    add_trunk(dl - 1, dr, dst_vx, layer_x[dl], [c.id])
  }

  // Emit trunk hlines (defer until all ranges accumulated)
  // More ranges added below from back-edges and port groups

  // Emit vertical channels for adjacent cross-row connections
  for (var i = 0; i < adjacent_cross.length; i++) {
    var c = adjacent_cross[i]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    var src_wy = wire_y_v3(sr), dst_wy = wire_y_v3(dr)
    var track_x = v_channel_x[c.id]
    var vdir = sr < dr ? 'down' : 'up'
    var min_wy = Math.min(src_wy, dst_wy)
    var max_wy = Math.max(src_wy, dst_wy)
    elements.push({ type: 'vline', x: track_x, y: min_wy, length: max_wy - min_wy + 1, dir: vdir, conns: [c.id] })
  }

  // Emit multi-layer routing segments
  for (var i = 0; i < multi_conns.length; i++) {
    var c = multi_conns[i]
    var sr = row_of[c.from.id], dr = row_of[c.to.id]
    var src_wy = wire_y_v3(sr), dst_wy = wire_y_v3(dr)
    var src_vx = v_channel_x[c.id + 'source']
    var dst_vx = v_channel_x[c.id + 'dest']
    var jog_y = h_channel_y[c.id]

    // Source vchannel: source wire row to h-channel
    var src_vmin = Math.min(src_wy, jog_y)
    var src_vmax = Math.max(src_wy, jog_y)
    if (src_vmax > src_vmin)
      elements.push({ type: 'vline', x: src_vx, y: src_vmin, length: src_vmax - src_vmin + 1, dir: jog_y > src_wy ? 'down' : 'up', conns: [c.id] })
    // H-channel hline: across intermediate layers
    var hx_left = Math.min(src_vx, dst_vx)
    var hx_right = Math.max(src_vx, dst_vx)
    if (hx_right > hx_left)
      add_hline_range(jog_y, hx_left, hx_right + 1, 'right', [c.id])
    // Dest vchannel: h-channel to dest wire row
    var vmin = Math.min(dst_wy, jog_y)
    var vmax = Math.max(dst_wy, jog_y)
    if (vmax > vmin)
      elements.push({ type: 'vline', x: dst_vx, y: vmin, length: vmax - vmin + 1, dir: 'up', conns: [c.id] })
  }

  // ── Left port groups ───────────────────────────────────────────────

  var emitted_ports = {}  // port id → { y } (deduplicate port elements, track position)

  var left_port_stations = build_port_station_map(left_port_groups)

  emit_port_fans(left_port_stations, left_mid_x, 'down', true)

  for (var cid in left_port_groups) {
    var group = left_port_groups[cid]
    var base_wy = wire_y_v3(row_of[cid])
    var lx = layer_x[layer_of[cid]]
    var max_left_wy = base_wy
    for (var j = 0; j < group.length; j++) {
      var wy = base_wy + j * 2
      var is_fan_out = left_port_stations[group[j].id] && left_port_stations[group[j].id].length > 1
      var pc = conn_for_pair[group[j].id + '|' + cid]
      var pcs = pc ? [pc] : []
      if (!emitted_ports[group[j].id]) {
        elements.push({ type: 'port', x: 0, y: wy, dir: 'left', key: group[j].key, id: group[j].id })
        emitted_ports[group[j].id] = { y: wy }
      }
      if (j > 0) {
        // Offset port (multiple ports to same station): hline from port to midpoint
        add_hline_range(wy, 1, left_mid_x + 1, 'right', pcs)
        if (wy > max_left_wy) max_left_wy = wy
      } else if (is_fan_out && emitted_ports[group[j].id].y !== wy) {
        // Fan-out: this station shares a port on a different row
        if (layer_of[cid] > 0) {
          // Jog below via the fan vline (left_mid_x is outside any station body)
          var jog_wy = jog_y_below(row_of[cid])
          add_port_jog_vline(left_mid_x, wy, jog_wy, 'down', pcs)
          var target_gap_x = v_channel_x['lp_' + cid + 'lp_tgt'] || (layer_x[layer_of[cid]] - 3)
          add_hline_range(jog_wy, left_mid_x, target_gap_x + 1, 'right', pcs)
          add_port_jog_vline(target_gap_x, wy, jog_wy, 'up', pcs)
          add_hline_range(wy, target_gap_x, lx, 'right', pcs)
        } else {
          // Layer 0: direct hline from fan vline to station
          add_hline_range(wy, left_mid_x, lx, 'right', pcs)
        }
      } else if (layer_of[cid] > 0) {
        // First port occurrence, multi-layer target: jog below
        var jog_wy = jog_y_below(row_of[cid])
        var first_gap_x = PORT_COL - 2
        add_hline_range(wy, 1, first_gap_x + 1, 'right', pcs)
        add_port_jog_vline(first_gap_x, wy, jog_wy, 'down', pcs)
        var target_gap_x = v_channel_x['lp_' + cid + 'lp_tgt'] || (layer_x[layer_of[cid]] - 3)
        add_hline_range(jog_wy, first_gap_x, target_gap_x + 1, 'right', pcs)
        add_port_jog_vline(target_gap_x, wy, jog_wy, 'up', pcs)
        add_hline_range(wy, target_gap_x, lx, 'right', pcs)
      } else {
        // First port, layer 0: direct hline
        add_hline_range(wy, 1, lx, 'right', pcs)
      }
    }
    // Emit non-overlapping vline segments between adjacent fan-in port hlines
    if (max_left_wy > base_wy) {
      var fan_ys = [base_wy]
      var fan_conns = []
      for (var j = 1; j < group.length; j++) {
        fan_ys.push(base_wy + j * 2)
        var fpc = conn_for_pair[group[j].id + '|' + cid]
        if (fpc && fan_conns.indexOf(fpc) < 0) fan_conns.push(fpc)
      }
      emit_fan_vline(left_mid_x, fan_ys, 'up', fan_conns)
    }
  }
  // Emit merged port jog vlines
  for (var pjk in port_jog_vlines) {
    var pj = port_jog_vlines[pjk]
    elements.push({ type: 'vline', x: pj.x, y: pj.min_y, length: pj.max_y - pj.min_y + 1, dir: pj.dir, conns: pj.conns || [] })
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
    var be_from_vx = v_channel_x['be_' + back_edges[i][0] + '_' + back_edges[i][1] + 'be_from']
    var rx = be_from_vx !== undefined ? be_from_vx + 2 : comp_right(back_edges[i][0]) + 4
    if (rx > max_right_x) max_right_x = rx
  }
  var width = Math.max(min_width, max_right_x)

  // ── Place deferred right ports at box edge ─────────────────────────

  // Pre-allocate right-edge vline positions for non-last-layer right port jogs
  // Must be past the rightmost station to avoid crossing station bodies
  var right_edge_positions = {}  // comp_id → x position for right-edge vline
  var max_comp_right = 0
  for (var i = 0; i < layers.length; i++)
    for (var j = 0; j < layers[i].length; j++) {
      var cr = layer_x[i] + comp_w(layers[i][j]) + 1  // +1 for ')' paren
      if (cr > max_comp_right) max_comp_right = cr
    }
  var next_right_edge = max_comp_right + 2
  // Allocate right-margin positions for back-edge sources first (closer to station output)
  var be_right_margin_x = {}  // be_id → x position
  for (var i = 0; i < be_right_margin.length; i++) {
    var be_id = 'be_' + be_right_margin[i][0] + '_' + be_right_margin[i][1]
    be_right_margin_x[be_id] = next_right_edge
    next_right_edge += 2  // leave space between parallel vlines
  }
  // Then right-port jog positions (further from station, closer to port)
  for (var i = 0; i < deferred_right.length; i++) {
    var dr_pre = deferred_right[i]
    if (dr_pre.offset === 0 && layer_of[dr_pre.comp_id] < layers.length - 1) {
      right_edge_positions[dr_pre.comp_id] = next_right_edge
      next_right_edge += 2  // leave space between parallel vlines
    }
  }
  // Allocate left-margin positions for layer-0 back-edge dests
  // These go between the left box border and layer 0, avoiding port fan-in vlines
  var be_left_margin_x = {}  // be_id → x position
  var next_left_margin = 2  // one space from left box border, with visible hline to station
  for (var i = 0; i < be_left_margin.length; i++) {
    while (left_margin_reserved[next_left_margin]) next_left_margin++
    var be_id = 'be_' + be_left_margin[i][0] + '_' + be_left_margin[i][1]
    be_left_margin_x[be_id] = next_left_margin
    next_left_margin += 2  // leave space between parallel vlines
  }
  // Ensure width accommodates right-edge jog vlines + port column
  if (next_right_edge + 3 > width) width = next_right_edge + 3

  var right_port_stations = build_port_station_map(right_port_groups)

  // Emit fan-in vlines for right ports connecting from multiple station rows
  var right_fan_x = width - 3  // space between fan vline and box border/port
  // Find which wire_y each right port's 'o' will be emitted at (first station in deferred_right order)
  var right_port_wy = {}  // port_id → wire_y of the port element
  for (var i = 0; i < deferred_right.length; i++) {
    var dr_pre2 = deferred_right[i]
    if (!right_port_wy[dr_pre2.port.id])
      right_port_wy[dr_pre2.port.id] = wire_y_v3(row_of[dr_pre2.comp_id])
  }

  for (var pid in right_port_stations) {
    var sids = right_port_stations[pid]
    if (sids.length <= 1) continue
    var fan_wys = []
    for (var j = 0; j < sids.length; j++) {
      var fwy = wire_y_v3(row_of[sids[j]])
      if (fan_wys.indexOf(fwy) < 0) fan_wys.push(fwy)
    }
    if (fan_wys.length <= 1) continue
    fan_wys.sort(function(a, b) { return a - b })
    var port_wy = right_port_wy[pid] || fan_wys[0]
    var fan_dir = port_wy <= fan_wys[0] ? 'up' : 'down'
    var fan_conns = []
    for (var j = 0; j < sids.length; j++) {
      var fc = conn_for_pair[sids[j] + '|' + pid]
      if (fc && fan_conns.indexOf(fc) < 0) fan_conns.push(fc)
    }
    emit_fan_vline(right_fan_x, fan_wys, fan_dir, fan_conns)

  }

  var right_vline_max = {}  // comp_id → max_wy for vline grouping
  for (var i = 0; i < deferred_right.length; i++) {
    var dr = deferred_right[i]
    var row = row_of[dr.comp_id]
    var base_wy = wire_y_v3(row)
    var wy = base_wy + (dr.offset ? dr.offset * 2 : 0)
    var rx = comp_right(dr.comp_id)
    var mid_x = rx + Math.floor((width - 1 - rx) / 2)
    var rpc = conn_for_pair[dr.comp_id + '|' + dr.port.id]
    var rpcs = rpc ? [rpc] : []
    if (dr.offset > 0) {
      add_hline_range(wy, mid_x, width - 1, 'right', rpcs)
      if (!right_vline_max[dr.comp_id] || wy > right_vline_max[dr.comp_id].max_wy) {
        right_vline_max[dr.comp_id] = { mid_x: mid_x, base_wy: base_wy, max_wy: wy }
      }
    } else if (layer_of[dr.comp_id] < layers.length - 1 && has_later_comp_at_row(dr.comp_id)) {
      // Non-last-layer with station(s) blocking the path: jog below
      var right_jog_y = jog_y_below(row)
      var right_gap_x = v_channel_x['rp_' + dr.comp_id + 'rp_src'] || (rx + 2)
      var right_edge_x = right_edge_positions[dr.comp_id] || (width - 3)
      add_hline_range(wy, rx, right_gap_x + 1, 'right', rpcs)
      elements.push({ type: 'vline', x: right_gap_x, y: wy, length: right_jog_y - wy + 1, dir: 'down', conns: rpcs })
      add_hline_range(right_jog_y, right_gap_x, right_edge_x + 1, 'right', rpcs)
      elements.push({ type: 'vline', x: right_edge_x, y: wy, length: right_jog_y - wy + 1, dir: 'up', conns: rpcs })
      var is_right_fan = right_port_stations[dr.port.id] && right_port_stations[dr.port.id].length > 1
      if (is_right_fan && emitted_ports[dr.port.id]) {
        add_hline_range(wy, right_edge_x, right_fan_x + 1, 'right', rpcs)
      } else {
        add_hline_range(wy, right_edge_x, width - 1, 'right', rpcs)
      }
    } else {
      // Last layer: direct hline to right edge
      var is_right_fan = right_port_stations[dr.port.id] && right_port_stations[dr.port.id].length > 1
      if (is_right_fan && emitted_ports[dr.port.id]) {
        add_hline_range(wy, rx, right_fan_x + 1, 'right', rpcs)
      } else {
        add_hline_range(wy, rx, width - 1, 'right', rpcs)
      }
    }
    if (!emitted_ports[dr.port.id]) {
      elements.push({ type: 'port', x: width - 1, y: wy, dir: 'right', key: dr.port.key, id: dr.port.id })
      emitted_ports[dr.port.id] = { y: wy }
    }
  }
  // Non-overlapping vline segments for right port groups
  for (var cid in right_port_groups) {
    var rgroup = right_port_groups[cid]
    if (rgroup.length <= 1) continue
    var rbase_wy = wire_y_v3(row_of[cid])
    var rfan_ys = [rbase_wy]
    for (var j = 1; j < rgroup.length; j++) rfan_ys.push(rbase_wy + j * 2)
    var rmid_x = right_vline_max[cid] ? right_vline_max[cid].mid_x : 0
    if (!rmid_x) continue
    var rfan_conns = []
    for (var j = 0; j < rgroup.length; j++) {
      var rfc = conn_for_pair[cid + '|' + rgroup[j].id]
      if (rfc && rfan_conns.indexOf(rfc) < 0) rfan_conns.push(rfc)
    }
    emit_fan_vline(rmid_x, rfan_ys, 'down', rfan_conns)
  }

  // ── Route back-edges ───────────────────────────────────────────────

  var back_edge_rows = 0
  for (var i = 0; i < back_edges.length; i++) {
    var be_from = back_edges[i][0]
    var be_to = back_edges[i][1]
    var be_conn = conn_for_pair[be_from + '|' + be_to]
    var becs = be_conn ? [be_conn] : []
    var be_id = 'be_' + be_from + '_' + be_to
    var back_y = h_channel_y[be_id]
    if (back_y === undefined) {
      var max_row = Math.max(row_of[be_from], row_of[be_to])
      back_y = comp_y_v3(max_row) + ROW_HEIGHT - 1
    }
    // Use allocated vchannel positions or right-margin for last-layer sources
    var from_x = v_channel_x[be_id + 'be_from']
    var from_is_right_margin = false
    if (from_x === undefined && be_right_margin_x[be_id] !== undefined) {
      from_x = be_right_margin_x[be_id]
      from_is_right_margin = true
    }
    var to_x = v_channel_x[be_id + 'be_to']
    var to_is_left_margin = false
    if (to_x === undefined && be_left_margin_x[be_id] !== undefined) {
      to_x = be_left_margin_x[be_id]
      to_is_left_margin = true
    }
    var from_wy = wire_y_v3(row_of[be_from])
    var to_wy = wire_y_v3(row_of[be_to])

    // Source-side hline
    if (from_x !== undefined) {
      if (from_is_right_margin) {
        // Right-margin source: hline from station RIGHT edge to vline (past station)
        add_hline_range(from_wy, comp_right(be_from), from_x + 1, 'right', becs)
      } else {
        // Gap source: hline from station RIGHT edge to vchannel (connects to _out)
        var from_right = comp_right(be_from)
        if (from_x > from_right)
          add_hline_range(from_wy, from_right, from_x + 1, 'right', becs)
      }
    }
    // Source vline down to h-channel
    if (from_x !== undefined && back_y > from_wy)
      elements.push({ type: 'vline', x: from_x, y: from_wy, length: back_y - from_wy + 1, dir: 'down', conns: becs })
    // H-channel hline between source and dest vchannels
    if (from_x !== undefined && to_x !== undefined) {
      var left_x = Math.min(from_x, to_x)
      var right_x = Math.max(from_x, to_x)
      if (right_x > left_x)
        add_hline_range(back_y, left_x, right_x + 1, 'left', becs)
    }
    // Dest vline up from h-channel to wire row
    if (to_x !== undefined && back_y > to_wy)
      elements.push({ type: 'vline', x: to_x, y: to_wy, length: back_y - to_wy + 1, dir: 'up', conns: becs })
    // Dest-side hline
    if (to_x !== undefined) {
      if (to_is_left_margin) {
        // Left-margin dest: hline from vline to station LEFT edge (connects to _in)
        var to_left_edge = layer_x[layer_of[be_to]]
        if (to_left_edge > to_x)
          add_hline_range(to_wy, to_x, to_left_edge, 'right', becs)
      } else {
        // Gap dest: vchannel meets the trunk at wire row — no explicit hline needed
        // (the trunk already connects to the station, and the vline joins the trunk at a junction)
      }
    }
  }

  // ── Compute content_y from all emitted elements ────────────────────

  var max_fan_y = 0
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    var bottom = el.type === 'vline' ? el.y + el.length - 1
               : el.type === 'hline' ? el.y
               : el.type === 'port' ? el.y
               : (el.type === 'station' || el.type === 'subspace_box') ? el.y + el.height - 1 : 0
    if (bottom > max_fan_y) max_fan_y = bottom
  }
  // Also check deferred hline_ranges (not yet emitted as elements)
  for (var hy in hline_ranges) {
    var hy_int = parseInt(hy)
    if (hy_int > max_fan_y) max_fan_y = hy_int
  }
  var content_y = max_fan_y > 0 ? max_fan_y + 1 : cum_y

  // ── Emit all accumulated hlines ─────────────────────────────────────

  for (var hy in hline_ranges) {
    var ranges = hline_ranges[hy]
    for (var ri2 = 0; ri2 < ranges.length; ri2++) {
      var rng = ranges[ri2]
      if (rng.max_x > rng.min_x)
        elements.push({ type: 'hline', x: rng.min_x, y: parseInt(hy), length: rng.max_x - rng.min_x, dir: rng.dir || 'right', conns: rng.conns || [] })
    }
  }

  // ── Compute intersections ──────────────────────────────────────────
  // For each cell where an hline and vline overlap, classify and pick a char.
  // h_thru/v_thru: does that wire pass through (middle) or terminate (endpoint)?
  // Crossing (both through) → O. Tee (one through) → stem wire's dir. Corner → vline's dir.

  var v_cells = {}  // vline cell map for detecting split-segment continuation
  for (var i = 0; i < elements.length; i++)
    if (elements[i].type === 'vline')
      for (var vy = elements[i].y; vy < elements[i].y + elements[i].length; vy++)
        v_cells[elements[i].x + ',' + vy] = true

  var dir_char = { down: 'v', up: '^', right: '>', left: '<' }
  var hlines = [], vlines = []
  for (var i = 0; i < elements.length; i++) {
    if (elements[i].type === 'hline') hlines.push(elements[i])
    else if (elements[i].type === 'vline') vlines.push(elements[i])
  }
  for (var i = 0; i < hlines.length; i++) {
    var hl = hlines[i]
    for (var j = 0; j < vlines.length; j++) {
      var vl = vlines[j]
      if (vl.x < hl.x || vl.x >= hl.x + hl.length) continue
      if (hl.y < vl.y || hl.y >= vl.y + vl.length) continue
      var h_thru = vl.x > hl.x && vl.x < hl.x + hl.length - 1
      var v_thru = (hl.y > vl.y || v_cells[vl.x + ',' + (hl.y - 1)])
              && (hl.y < vl.y + vl.length - 1 || v_cells[vl.x + ',' + (hl.y + 1)])
      var ch = h_thru && v_thru ? 'O' : h_thru ? dir_char[vl.dir] : v_thru ? dir_char[hl.dir] : dir_char[vl.dir]
      elements.push({ type: 'intersection', x: vl.x, y: hl.y, char: ch })
    }
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

  var result = { id: topology.id, name: name, width: width, height: height, elements: elements }
  if (options && options.check_invariants) check_layout_invariants(result)
  return result
}

// Verify layout invariants (opt-in via options.check_invariants)
function check_layout_invariants(laid) {
  var stations = [], hlines = [], vlines = [], port_ids = {}
  for (var i = 0; i < laid.elements.length; i++) {
    var el = laid.elements[i]
    if (el.type === 'station' || el.type === 'subspace_box') stations.push(el)
    if (el.type === 'hline') hlines.push(el)
    if (el.type === 'vline') vlines.push(el)
    if (el.type === 'port') {
      if (port_ids[el.key + ',' + el.dir]) throw new Error('Invariant 9: duplicate port ' + el.key)
      port_ids[el.key + ',' + el.dir] = true
    }
  }
  // Invariant 1: no wire passes through a station body
  for (var i = 0; i < hlines.length; i++) {
    var h = hlines[i]
    for (var j = 0; j < stations.length; j++) {
      var s = stations[j]
      if (h.y >= s.y && h.y <= s.y + 3) {
        if (h.x < s.x && h.x + h.length - 1 > s.x + s.width - 1)
          throw new Error('Invariant 1: hline at y=' + h.y + ' passes through ' + (s.name || s.source))
      }
    }
  }
  for (var i = 0; i < vlines.length; i++) {
    var v = vlines[i]
    for (var j = 0; j < stations.length; j++) {
      var s = stations[j]
      if (v.x >= s.x && v.x <= s.x + s.width - 1) {
        if (v.y < s.y && v.y + v.length - 1 > s.y + 3)
          throw new Error('Invariant 1: vline at x=' + v.x + ' passes through ' + (s.name || s.source))
      }
    }
  }
  // Invariant 2: no two parallel wires share a grid cell
  var wire_cells = {}
  for (var i = 0; i < hlines.length; i++) {
    for (var x = hlines[i].x; x < hlines[i].x + hlines[i].length; x++) {
      var k = x + ',' + hlines[i].y
      if (!wire_cells[k]) wire_cells[k] = { h: 0, v: 0 }
      wire_cells[k].h++
    }
  }
  for (var i = 0; i < vlines.length; i++) {
    for (var y = vlines[i].y; y < vlines[i].y + vlines[i].length; y++) {
      var k = vlines[i].x + ',' + y
      if (!wire_cells[k]) wire_cells[k] = { h: 0, v: 0 }
      wire_cells[k].v++
    }
  }
  for (var k in wire_cells) {
    if (wire_cells[k].h > 1) throw new Error('Invariant 2: cell ' + k + ' has ' + wire_cells[k].h + ' overlapping hlines')
    if (wire_cells[k].v > 1) throw new Error('Invariant 2: cell ' + k + ' has ' + wire_cells[k].v + ' overlapping vlines')
  }
}

export function render(laid_out) {
  var w = laid_out.width
  var h = laid_out.height
  var elements = laid_out.elements.slice()

  // Sort: box first, then labels/text/ports, then wires, then intersections, then stations on top
  var render_order = { box: 0, label: 1, text: 1, port: 1, hline: 2, vline: 2, intersection: 3, station: 4, subspace_box: 4 }
  elements.sort(function(a, b) { return (render_order[a.type] || 0) - (render_order[b.type] || 0) })

  var grid = []
  for (var y = 0; y < h; y++) {
    grid[y] = []
    for (var x = 0; x < w; x++) grid[y][x] = ' '
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
      for (var x = el.x; x < el.x + el.length; x++)
        grid[el.y][x] = '-'
    }

    else if (el.type === 'vline') {
      for (var y = el.y; y < el.y + el.length; y++)
        grid[y][el.x] = '|'
    }

    else if (el.type === 'intersection') {
      grid[el.y][el.x] = el.char
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
