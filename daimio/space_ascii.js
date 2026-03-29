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

  // ── Route connections ────────────────────────────────────────────────
  // Trunk-and-channel model:
  //   - One trunk hline per (gap, row) pair (shared by all connections at that gap-row)
  //   - Vertical channels in inter-layer gaps for cross-row connections
  //   - Horizontal channels between station rows for multi-layer jogs and back-edges

  function comp_right(cid) {
    return layer_x[layer_of[cid]] + comp_w(cid)
  }

  // ── Classify connections ───────────────────────────────────────────

  var left_port_groups = {}  // comp_id → [port, ...]
  var right_port_groups = {} // comp_id → [port, ...]
  var direct_conns = []      // same row, adjacent layers → single trunk
  var adjacent_cross = []    // different rows, adjacent layers → trunk + vchannel + trunk
  var multi_conns = []       // spans 2+ gaps (any row) → per-gap routing with h-channel

  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id
    if (port_by_id[fid] && is_comp(tid)) {
      if (!left_port_groups[tid]) left_port_groups[tid] = []
      left_port_groups[tid].push(port_by_id[fid])
    } else if (is_comp(fid) && port_by_id[tid]) {
      if (!right_port_groups[fid]) right_port_groups[fid] = []
      right_port_groups[fid].push(port_by_id[tid])
    } else if (is_comp(fid) && is_comp(tid) && !back_edge_set[fid + '|' + tid]) {
      var sl = layer_of[fid], dl = layer_of[tid]
      if (dl - sl === 1 && row_of[fid] === row_of[tid]) direct_conns.push(c)
      else if (dl - sl === 1) adjacent_cross.push(c)
      else multi_conns.push(c)
    }
  }

  // Widen PORT_COL if both fan vlines and jog vlines are needed in the left margin.
  // Fan vlines exist when a left port connects to stations at different rows.
  // Jog vlines exist when a left port connects to a station at layer > 0.
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

  var left_mid_x = Math.floor(PORT_COL / 2)
  var port_jog_vlines = {}
  var has_left_ports = false
  for (var cid in left_port_groups) { has_left_ports = true; break }
  // Left margin slots for back-edge dest vlines: positions 2..PORT_COL-2, minus reserved
  var left_margin_reserved = {}
  if (has_left_ports) left_margin_reserved[PORT_COL - 2] = true
  var left_margin_capacity = PORT_COL - 3 - (has_left_ports ? 1 : 0)
  var left_margin_used = 0

  if (gap_v_channels.length > 0) {
    for (var i = 0; i < back_edges.length; i++) {
      var be_from = back_edges[i][0], be_to = back_edges[i][1]
      var from_layer = layer_of[be_from], to_layer = layer_of[be_to]
      // Source vline: gap to the RIGHT (connects to _out), or right margin if last layer
      if (from_layer >= layers.length - 1) {
        be_right_margin.push(back_edges[i])
      } else {
        var from_gap = from_layer  // gap to the RIGHT of source station
        gap_v_channels[from_gap].push({ conn: { id: be_ids[i] }, from_row: row_of[be_from], to_row: row_of[be_from], side: 'be_from' })
      }
      // Dest vline: left margin if layer 0 and room, else gap to the LEFT (or RIGHT for layer 0)
      if (to_layer === 0 && left_margin_used < left_margin_capacity) {
        be_left_margin.push(back_edges[i])
        left_margin_used++
      } else {
        var to_gap = to_layer > 0 ? to_layer - 1 : 0
        gap_v_channels[to_gap].push({ conn: { id: be_ids[i] }, from_row: row_of[be_to], to_row: row_of[be_to], side: 'be_to' })
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

  // ── Compute layer_x with gaps sized for channel counts ────────────

  var layer_x = []
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
  var row_h_count = {}
  for (var rk in row_pair_h_channels) {
    var r = parseInt(rk)
    var n = row_pair_h_channels[rk].length
    row_h_count[r] = n > 0 ? 2 * n - 1 : 0
  }
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

  // Assign h-channel y-positions
  var h_channel_y = {}
  for (var rk in row_pair_h_channels) {
    var r = parseInt(rk)
    var base_y = comp_y(r) + ROW_HEIGHT
    var channels = row_pair_h_channels[rk]
    for (var j = 0; j < channels.length; j++) {
      if (channels[j].conn)
        h_channel_y[channels[j].conn.id] = base_y + j * 2
      else if (channels[j].back_edge)
        var be_idx = back_edges.indexOf(channels[j].back_edge)
        h_channel_y[be_ids[be_idx]] = base_y + j * 2
    }
  }

  // ── Place components ──────────────────────────────────────────────

  elements = []
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      var cid = layers[i][j]
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
  // Each connection gets a path: array of {x,y} waypoints tracing its route.
  // The renderer converts paths to visual wire segments.

  var conn_paths = {}
  function add_path(conn_id, x, y) {
    if (!conn_paths[conn_id]) conn_paths[conn_id] = []
    conn_paths[conn_id].push({ x: x, y: y })
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
    var rk = '' + row
    var n = row_pair_h_channels[rk] ? row_pair_h_channels[rk].length : 0
    var hc = n > 0 ? 2 * n - 1 : 0
    return comp_y(row) + ROW_HEIGHT + hc + (hc > 0 ? 1 : 0)
  }

  // Check if any component in a later layer occupies the same row as cid
  function has_later_comp_at_row(cid) {
    var cl = layer_of[cid], cr = row_of[cid]
    for (var li = cl + 1; li < layers.length; li++)
      for (var j = 0; j < layers[li].length; j++)
        if (row_of[layers[li][j]] === cr) return true
    return false
  }

  // ── Route forward connections ──────────────────────────────────────

  // Direct connections: single horizontal segment through the gap
  for (var i = 0; i < direct_conns.length; i++) {
    var c = direct_conns[i]
    var wy = wire_y(row_of[c.from.id])
    add_path(c.id, comp_right(c.from.id), wy)
    add_path(c.id, layer_x[layer_of[c.to.id]], wy)
  }

  // Adjacent cross-row: source trunk → vchannel → dest trunk
  for (var i = 0; i < adjacent_cross.length; i++) {
    var c = adjacent_cross[i]
    var src_wy = wire_y(row_of[c.from.id]), dst_wy = wire_y(row_of[c.to.id])
    var track_x = v_channel_x[c.id]
    add_path(c.id, comp_right(c.from.id), src_wy)
    add_path(c.id, track_x, src_wy)
    add_path(c.id, track_x, dst_wy)
    add_path(c.id, layer_x[layer_of[c.to.id]], dst_wy)
  }

  // Multi-layer: source trunk → source vchannel → h-channel → dest vchannel → dest trunk
  for (var i = 0; i < multi_conns.length; i++) {
    var c = multi_conns[i]
    var dl = layer_of[c.to.id]
    var src_wy = wire_y(row_of[c.from.id]), dst_wy = wire_y(row_of[c.to.id])
    var src_vx = v_channel_x[c.id + 'source']
    var dst_vx = v_channel_x[c.id + 'dest']
    var jog_y = h_channel_y[c.id]
    add_path(c.id, comp_right(c.from.id), src_wy)
    add_path(c.id, src_vx, src_wy)
    add_path(c.id, src_vx, jog_y)
    add_path(c.id, dst_vx, jog_y)
    add_path(c.id, dst_vx, dst_wy)
    add_path(c.id, layer_x[dl], dst_wy)
  }

  // ── Route left port connections ────────────────────────────────────

  var emitted_ports = {}

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
          // Jog below via the fan vline
          var jog_wy = jog_y_below(row_of[cid])
          add_path(pc, 1, port_y)
          add_path(pc, left_mid_x, port_y)
          add_path(pc, left_mid_x, jog_wy)
          var target_gap_x = v_channel_x['lp_' + cid + 'lp_tgt'] || (layer_x[layer_of[cid]] - 3)
          add_path(pc, target_gap_x, jog_wy)
          add_path(pc, target_gap_x, wy)
          add_path(pc, lx, wy)
        } else {
          // Layer 0: fan vline down, then direct to station
          add_path(pc, 1, port_y)
          add_path(pc, left_mid_x, port_y)
          add_path(pc, left_mid_x, wy)
          add_path(pc, lx, wy)
        }
      } else if (layer_of[cid] > 0) {
        // First port, non-layer-0: jog below
        var jog_wy = jog_y_below(row_of[cid])
        var first_gap_x = PORT_COL - 2
        add_path(pc, 1, wy)
        add_path(pc, first_gap_x, wy)
        add_path(pc, first_gap_x, jog_wy)
        var target_gap_x = v_channel_x['lp_' + cid + 'lp_tgt'] || (layer_x[layer_of[cid]] - 3)
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
      var rx = layer_x[i] + comp_w(layers[i][j]) + 2
      if (rx > max_right_x) max_right_x = rx
    }
  for (var i = 0; i < back_edges.length; i++) {
    var be_from_vx = v_channel_x[be_ids[i] + 'be_from']
    var rx = be_from_vx !== undefined ? be_from_vx + 2 : comp_right(back_edges[i][0]) + 4
    if (rx > max_right_x) max_right_x = rx
  }
  var width = Math.max(min_width, max_right_x)

  // ── Place deferred right ports ─────────────────────────────────────

  var right_edge_positions = {}
  var max_comp_right = 0
  for (var i = 0; i < layers.length; i++)
    for (var j = 0; j < layers[i].length; j++) {
      var cr = layer_x[i] + comp_w(layers[i][j]) + 1
      if (cr > max_comp_right) max_comp_right = cr
    }
  var next_right_edge = max_comp_right + 2
  var be_right_margin_x = {}
  for (var i = 0; i < be_right_margin.length; i++) {
    be_right_margin_x[be_ids[back_edges.indexOf(be_right_margin[i])]] = next_right_edge
    next_right_edge += 2
  }
  for (var i = 0; i < deferred_right.length; i++) {
    var dr_pre = deferred_right[i]
    if (dr_pre.offset === 0 && layer_of[dr_pre.comp_id] < layers.length - 1) {
      right_edge_positions[dr_pre.comp_id] = next_right_edge
      next_right_edge += 2
    }
  }
  var be_left_margin_x = {}
  var next_left_margin = 2
  for (var i = 0; i < be_left_margin.length; i++) {
    while (left_margin_reserved[next_left_margin]) next_left_margin++
    be_left_margin_x[be_ids[back_edges.indexOf(be_left_margin[i])]] = next_left_margin
    next_left_margin += 2
  }
  if (next_right_edge + 3 > width) width = next_right_edge + 3

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
      // Offset port: vline from base wire row to offset, then hline to port
      var mid_x = rx + Math.floor((width - 1 - rx) / 2)
      add_path(rpc, rx, base_wy)
      add_path(rpc, mid_x, base_wy)
      add_path(rpc, mid_x, wy)
      add_path(rpc, port_x, wy)
    } else if (layer_of[dr.comp_id] < layers.length - 1 && has_later_comp_at_row(dr.comp_id)) {
      // Non-last-layer with station blocking: jog below
      var right_jog_y = jog_y_below(row)
      var right_gap_x = v_channel_x['rp_' + dr.comp_id + 'rp_src'] || (rx + 2)
      var right_edge_x = right_edge_positions[dr.comp_id] || (width - 3)
      add_path(rpc, rx, wy)
      add_path(rpc, right_gap_x, wy)
      add_path(rpc, right_gap_x, right_jog_y)
      add_path(rpc, right_edge_x, right_jog_y)
      add_path(rpc, right_edge_x, wy)
      add_path(rpc, port_x, wy)
    } else {
      // Direct hline to port
      add_path(rpc, rx, wy)
      add_path(rpc, port_x, wy)
    }
    // Fan-in: add vertical segment from wire row to port's y, then to port
    if (needs_fan_v) {
      var port_wy = emitted_ports[dr.port.id].y
      add_path(rpc, right_fan_x, port_wy)
      add_path(rpc, width - 2, port_wy)
    }
  }

  // ── Route back-edges ───────────────────────────────────────────────

  for (var i = 0; i < back_edges.length; i++) {
    var be_from = back_edges[i][0], be_to = back_edges[i][1]
    var be_conn = conn_for_pair[be_from + '|' + be_to]
    if (!be_conn) continue
    var back_y = h_channel_y[be_ids[i]]
    if (back_y === undefined) {
      var max_row = Math.max(row_of[be_from], row_of[be_to])
      back_y = comp_y(max_row) + ROW_HEIGHT - 1
    }
    var from_x = v_channel_x[be_ids[i] + 'be_from']
    if (from_x === undefined && be_right_margin_x[be_ids[i]] !== undefined)
      from_x = be_right_margin_x[be_ids[i]]
    var to_x = v_channel_x[be_ids[i] + 'be_to']
    var to_is_left_margin = false
    if (to_x === undefined && be_left_margin_x[be_ids[i]] !== undefined) {
      to_x = be_left_margin_x[be_ids[i]]
      to_is_left_margin = true
    }
    var from_wy = wire_y(row_of[be_from]), to_wy = wire_y(row_of[be_to])
    // Path: source station → source vline → h-channel → dest vline → (dest station if left margin)
    if (from_x !== undefined) {
      add_path(be_conn, comp_right(be_from), from_wy)
      add_path(be_conn, from_x, from_wy)
    }
    if (from_x !== undefined) add_path(be_conn, from_x, back_y)
    if (to_x !== undefined) add_path(be_conn, to_x, back_y)
    if (to_x !== undefined) {
      add_path(be_conn, to_x, to_wy)
      add_path(be_conn, layer_x[layer_of[be_to]], to_wy)
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
  for (var cid in conn_paths) paths.push({ conn: cid, path: conn_paths[cid] })

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
}

export function render(laid_out) {
  var w = laid_out.width
  var h = laid_out.height
  var elements = laid_out.elements
  var paths = laid_out.paths || []

  var grid = []
  for (var y = 0; y < h; y++) {
    grid[y] = []
    for (var x = 0; x < w; x++) grid[y][x] = ' '
  }

  // 1. Stamp box
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type !== 'box') continue
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

  // 2. Stamp ports, labels, text
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type === 'port') grid[el.y][el.x] = 'o'
    else if (el.type === 'label' || el.type === 'text')
      for (var j = 0; j < el.text.length; j++) grid[el.y][el.x + j] = el.text[j]
  }

  // 3. Stamp path wire segments and track h/v directions for intersections
  var h_dir = {}  // 'x,y' → direction
  var v_dir = {}
  for (var i = 0; i < paths.length; i++) {
    var pts = paths[i].path
    for (var j = 0; j < pts.length - 1; j++) {
      var x0 = pts[j].x, y0 = pts[j].y, x1 = pts[j + 1].x, y1 = pts[j + 1].y
      if (y0 === y1) {
        var xmin = Math.min(x0, x1), xmax = Math.max(x0, x1)
        var dir = x1 >= x0 ? 'right' : 'left'
        for (var x = xmin; x <= xmax; x++) { grid[y0][x] = '-'; h_dir[x + ',' + y0] = dir }
      } else if (x0 === x1) {
        var ymin = Math.min(y0, y1), ymax = Math.max(y0, y1)
        var dir = y1 >= y0 ? 'down' : 'up'
        for (var y = ymin; y <= ymax; y++) { grid[y][x0] = '|'; v_dir[x0 + ',' + y] = dir }
      }
    }
  }

  // 4. Compute intersections from h/v overlap
  var dir_char = { down: 'v', up: '^', right: '>', left: '<' }
  for (var k in h_dir) {
    if (!v_dir[k]) continue
    var parts = k.split(','), x = parseInt(parts[0]), y = parseInt(parts[1])
    var h_thru = !!h_dir[(x - 1) + ',' + y] && !!h_dir[(x + 1) + ',' + y]
    var v_thru = !!v_dir[x + ',' + (y - 1)] && !!v_dir[x + ',' + (y + 1)]
    var hd = h_dir[k], vd = v_dir[k]
    grid[y][x] = h_thru && v_thru ? 'O' : h_thru ? dir_char[vd] : v_thru ? dir_char[hd] : dir_char[vd]
  }

  // 5. Stamp stations and subspace_boxes ON TOP of wires
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type === 'station') {
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
    } else if (el.type === 'subspace_box') {
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
