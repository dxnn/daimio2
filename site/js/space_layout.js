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

  // Anonymous stations get order-independent stable names: rank among the
  // anonymous stations by source text (declaration order breaks ties), so
  // a parsed render — which can't know declaration order — names them the
  // same way the original did. Names already used by declared stations are
  // skipped, so a user station named s0 can't collide with an auto-name.
  var anon = []
  var taken = {}
  for (var i = 0; i < stations.length; i++) {
    if (stations[i].name.indexOf('station-') === 0) anon.push(i)
    else taken[stations[i].name] = true
  }
  anon.sort(function(a, b) {
    var sa = stations[a].source, sb = stations[b].source
    return sa < sb ? -1 : sa > sb ? 1 : a - b
  })
  var next_anon = 0
  for (var i = 0; i < anon.length; i++) {
    while (taken['s' + next_anon]) next_anon++
    stations[anon[i]].name = 's' + next_anon
    next_anon++
  }

  // Build lookup maps
  var port_key_to_id = {}
  for (var i = 0; i < ports.length; i++)
    port_key_to_id[ports[i].key] = ports[i].id

  var station_name_to_id = {}
  for (var i = 0; i < stations.length; i++)
    station_name_to_id[stations[i].name] = stations[i].id
  // Also map original seedlike keys (for route resolution when name was stabilized)
  for (var i = 0; i < station_names.length; i++)
    station_name_to_id[station_names[i]] = 's' + i

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

  // Collect all component ids, sorted deterministically:
  // subspaces first (by name), then named stations (by name), then anonymous (by source)
  var comp_ids = []
  var comp_set = {}
  var station_by_id = {}
  for (var i = 0; i < stations.length; i++) {
    comp_ids.push(stations[i].id)
    comp_set[stations[i].id] = true
    station_by_id[stations[i].id] = stations[i]
  }
  for (var i = 0; i < subspaces.length; i++) {
    comp_ids.push(subspaces[i])
    comp_set[subspaces[i]] = true
  }
  comp_ids.sort(function(a, b) {
    var a_sub = !station_by_id[a], b_sub = !station_by_id[b]
    if (a_sub !== b_sub) return a_sub ? -1 : 1  // subspaces first
    if (a_sub) return a < b ? -1 : a > b ? 1 : 0  // both subspaces: sort by name
    var sa = station_by_id[a], sb = station_by_id[b]
    var a_anon = /^s\d+$/.test(sa.name), b_anon = /^s\d+$/.test(sb.name)
    if (a_anon !== b_anon) return a_anon ? 1 : -1  // named before anonymous
    if (a_anon) return sa.source < sb.source ? -1 : sa.source > sb.source ? 1 : 0
    return sa.name < sb.name ? -1 : sa.name > sb.name ? 1 : 0
  })

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
  // Sort predecessor lists by name so cycle-breaking (which edge becomes
  // the back-edge) is independent of declaration and route order
  function pred_name(id) {
    var s = station_by_id[id]
    if (!s) return id
    return /^s\d+$/.test(s.name) ? '~' + s.source : s.name
  }
  for (var id in in_edges)
    in_edges[id].sort(function(a, b) {
      var an = pred_name(a), bn = pred_name(b)
      return an < bn ? -1 : an > bn ? 1 : 0
    })

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
  var max_source = (options && options.max_source !== undefined) ? options.max_source : 20

  var name = topology.name
  var ports = topology.ports || []
  var stations = topology.stations || []
  var connections = (topology.connections || []).slice()
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

  // Sort connections by component NAME (source text for anonymous
  // stations, key for ports), not id: ids follow declaration order, and
  // the layout must be identical no matter how the source orders its
  // declarations and routes (a parsed render can't reproduce the order).
  function comp_sort_name(id) {
    var s = station_by_id[id]
    if (s) return /^s\d+$/.test(s.name) ? '~' + s.source : s.name
    if (port_by_id[id]) return port_by_id[id].key
    return id
  }
  connections.sort(function(a, b) {
    var af = comp_sort_name(a.from.id), bf = comp_sort_name(b.from.id)
    var at = comp_sort_name(a.to.id), bt = comp_sort_name(b.to.id)
    return (af < bf ? -1 : af > bf ? 1 : 0) || (at < bt ? -1 : at > bt ? 1 : 0) ||
           (a.from.port < b.from.port ? -1 : a.from.port > b.from.port ? 1 : 0) ||
           (a.to.port < b.to.port ? -1 : a.to.port > b.to.port ? 1 : 0)
  })

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

  // Build back-edge lookup set
  var back_edge_set = {}
  for (var i = 0; i < back_edges.length; i++)
    back_edge_set[back_edges[i][0] + '|' + back_edges[i][1]] = true

  // ── Layer widths (real layers only) ──────────────────────────────────

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
  // Pre-dummy sweep: only real nodes, forward comp→comp edges

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

  function build_pos() {
    var pos = {}
    for (var i = 0; i < layers.length; i++)
      for (var j = 0; j < layers[i].length; j++)
        pos[layers[i][j]] = j
    return pos
  }

  function barycenter(id, neighbors, pos) {
    var nbrs = neighbors[id]
    if (!nbrs || nbrs.length === 0) return -1
    var sum = 0
    for (var k = 0; k < nbrs.length; k++) sum += pos[nbrs[k]]
    return sum / nbrs.length
  }

  function sort_layer_by_bc(layer, neighbors, pos) {
    var items = []
    for (var j = 0; j < layer.length; j++) {
      items.push({ id: layer[j], bc: barycenter(layer[j], neighbors, pos), orig: j })
    }
    items.sort(function(a, b) {
      if (a.bc < 0 && b.bc < 0) return a.orig - b.orig
      if (a.bc < 0) return 1
      if (b.bc < 0) return -1
      return a.bc - b.bc || a.orig - b.orig
    })
    for (var j = 0; j < layer.length; j++) layer[j] = items[j].id
  }

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

  // Assign row numbers from final layer ordering
  var row_of = {}
  var total_rows = 0
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      if (row_of[layers[i][j]] === undefined)
        row_of[layers[i][j]] = j
    }
    if (layers[i].length > total_rows) total_rows = layers[i].length
  }

  // ── Virtual port layers + unified edge list ─────────────────────────
  // Model ports as 1-cell nodes in virtual layers so they go through the
  // Sugiyama dummy pipeline. Left ports → layer 0, right ports → last layer.

  // Collect used ports and classify
  var used_left_ports = []   // port objects with dir=left in some connection
  var used_right_ports = []  // port objects with dir=right in some connection
  var used_ports = {}
  for (var i = 0; i < connections.length; i++) {
    if (port_by_id[connections[i].from.id]) used_ports[connections[i].from.id] = true
    if (port_by_id[connections[i].to.id]) used_ports[connections[i].to.id] = true
  }
  var left_port_set = {}, right_port_set = {}
  for (var i = 0; i < ports.length; i++) {
    if (!used_ports[ports[i].id]) continue
    if (ports[i].dir === 'left') { used_left_ports.push(ports[i]); left_port_set[ports[i].id] = true }
    else { used_right_ports.push(ports[i]); right_port_set[ports[i].id] = true }
  }

  // Shift real layers by +1 to make room for left port layer at index 0
  var real_layer_count = layers.length
  var new_layers = [[]]  // layer 0: left ports
  for (var i = 0; i < layers.length; i++) new_layers.push(layers[i])
  new_layers.push([])  // last layer: right ports

  // Update layer_of for real nodes (shift by +1)
  for (var id in layer_of) layer_of[id] = layer_of[id] + 1

  // Place left port nodes in layer 0
  for (var i = 0; i < used_left_ports.length; i++) {
    var pid = used_left_ports[i].id
    layer_of[pid] = 0
    new_layers[0].push(pid)
    row_of[pid] = new_layers[0].length - 1
  }

  // Place right port nodes in last layer
  var right_layer_idx = new_layers.length - 1
  for (var i = 0; i < used_right_ports.length; i++) {
    var pid = used_right_ports[i].id
    layer_of[pid] = right_layer_idx
    new_layers[right_layer_idx].push(pid)
    row_of[pid] = new_layers[right_layer_idx].length - 1
  }

  layers = new_layers
  // Update total_rows to include port layers
  for (var i = 0; i < layers.length; i++)
    if (layers[i].length > total_rows) total_rows = layers[i].length

  // Prepend/append zero-width entries to layer_width
  var new_layer_width = [0]
  for (var i = 0; i < layer_width.length; i++) new_layer_width.push(layer_width[i])
  new_layer_width.push(0)
  layer_width = new_layer_width

  // ── Build unified edge list ───────────────────────────────────────
  // All edges (forward comp→comp, reversed back-edges, port↔station) in one list.
  // Self-loops handled separately.

  var all_edges = []       // { id, from_id, to_id }
  var reversed_set = {}    // conn_id → true if back-edge was reversed
  var self_loops = []      // self-loop connections

  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    var fid = c.from.id, tid = c.to.id

    if (is_comp(fid) && is_comp(tid) && fid === tid) {
      // Self-loop
      self_loops.push(c)
      continue
    }

    if (is_comp(fid) && is_comp(tid) && back_edge_set[fid + '|' + tid]) {
      // Back-edge: reverse direction so it flows left-to-right through dummies
      all_edges.push({ id: c.id, from_id: tid, to_id: fid })
      reversed_set[c.id] = true
      continue
    }

    if (port_by_id[fid] && is_comp(tid)) {
      if (port_by_id[fid].dir === 'right') {
        // Right port → station (a down-port response): flows right-to-left,
        // so route it like a back-edge via a below-station h-channel
        all_edges.push({ id: c.id, from_id: tid, to_id: fid })
        reversed_set[c.id] = true
      } else {
        // Left port → station: forward edge (port in layer 0, station in 1+)
        all_edges.push({ id: c.id, from_id: fid, to_id: tid })
      }
      continue
    }

    if (is_comp(fid) && port_by_id[tid]) {
      if (port_by_id[tid].dir === 'left') {
        // Station → left port (contract return): reverse to left_port → station
        all_edges.push({ id: c.id, from_id: tid, to_id: fid })
        reversed_set[c.id] = true
      } else {
        // Station → right port: forward edge
        all_edges.push({ id: c.id, from_id: fid, to_id: tid })
      }
      continue
    }

    if (is_comp(fid) && is_comp(tid)) {
      // Forward comp→comp edge
      all_edges.push({ id: c.id, from_id: fid, to_id: tid })
    }
  }

  // ── Dummy insertion for all edges ─────────────────────────────────

  var dummy_id_counter = 0
  var dummy_set = {}
  var dummy_edge = {}   // dummy id → its edge (for chain straightening)
  var edge_chain = {}

  for (var i = 0; i < all_edges.length; i++) {
    var e = all_edges[i]
    if (reversed_set[e.id]) {
      // Reversed edges route via below-station h-channels — dummies would
      // only occupy layer slots and stretch rows for nothing
      edge_chain[e.id] = [e.from_id, e.to_id]
      continue
    }
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
      dummy_edge[did] = e
      layer_of[did] = l
      layers[l].push(did)
      chain.push(did)
    }
    chain.push(e.to_id)
    edge_chain[e.id] = chain
  }

  // ── Second crossing minimization with dummies ──────────────────────

  left_neighbors = {}
  right_neighbors = {}
  for (var i = 0; i < all_edges.length; i++) {
    var chain = edge_chain[all_edges[i].id]
    for (var j = 0; j < chain.length - 1; j++) {
      var a = chain[j], b = chain[j + 1]
      if (!right_neighbors[a]) right_neighbors[a] = []
      right_neighbors[a].push(b)
      if (!left_neighbors[b]) left_neighbors[b] = []
      left_neighbors[b].push(a)
    }
  }

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

  // Re-assign row numbers from reordered layers (with dummies and ports)
  row_of = {}
  total_rows = 0
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      if (row_of[layers[i][j]] === undefined)
        row_of[layers[i][j]] = j
    }
    if (layers[i].length > total_rows) total_rows = layers[i].length
  }

  // ── Straighten chains ───────────────────────────────────────────────
  // Crossing minimization is free to zigzag a dummy chain outside the band
  // between its endpoints' rows, which routes the wire away and back for
  // nothing (a split that rejoins itself). Clamp dummy rows into that band
  // when a slot is free: dummies may share a (layer, row) slot with
  // dummies of same-source or same-dest edges (their horizontals merge
  // into a legal trunk), never with real components or unrelated dummies.

  var slot_nodes = {}   // layer|row → [node ids]
  for (var i = 0; i < layers.length; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      var sk = i + '|' + row_of[layers[i][j]]
      if (!slot_nodes[sk]) slot_nodes[sk] = []
      slot_nodes[sk].push(layers[i][j])
    }
  }
  function slot_free_for(layer, row, e) {
    var list = slot_nodes[layer + '|' + row]
    if (!list) return true
    for (var k = 0; k < list.length; k++) {
      if (!dummy_set[list[k]]) return false
      var oe = dummy_edge[list[k]]
      if (oe.id !== e.id && oe.from_id !== e.from_id && oe.to_id !== e.to_id) return false
    }
    return true
  }
  for (var i = 0; i < all_edges.length; i++) {
    var e = all_edges[i]
    if (reversed_set[e.id]) continue
    var chain = edge_chain[e.id]
    if (chain.length <= 2) continue
    var lo = Math.min(row_of[e.from_id], row_of[e.to_id])
    var hi = Math.max(row_of[e.from_id], row_of[e.to_id])
    for (var j = 1; j < chain.length - 1; j++) {
      var d = chain[j]
      var r = row_of[d]
      if (r >= lo && r <= hi) continue
      // Try band rows starting from the nearest boundary
      var targets = []
      if (r < lo) { for (var t = lo; t <= hi; t++) targets.push(t) }
      else { for (var t = hi; t >= lo; t--) targets.push(t) }
      for (var c = 0; c < targets.length; c++) {
        if (!slot_free_for(layer_of[d], targets[c], e)) continue
        var old_sk = layer_of[d] + '|' + r
        slot_nodes[old_sk].splice(slot_nodes[old_sk].indexOf(d), 1)
        row_of[d] = targets[c]
        var new_sk = layer_of[d] + '|' + targets[c]
        if (!slot_nodes[new_sk]) slot_nodes[new_sk] = []
        slot_nodes[new_sk].push(d)
        break
      }
    }
  }

  // Compact away rows emptied by straightening
  var used_rows = {}
  for (var id in row_of) used_rows[row_of[id]] = true
  var row_remap = {}
  var next_row = 0
  for (var r = 0; r < total_rows; r++)
    if (used_rows[r]) row_remap[r] = next_row++
  if (next_row < total_rows) {
    for (var id in row_of) row_of[id] = row_remap[row_of[id]]
    total_rows = next_row
  }

  // ── Gap sizing: count distinct fan groups per gap ───────────────
  // Hops from the same source (fan-out) or to the same dest (fan-in)
  // share one channel, so count groups not individual hops.

  // Build from/to frequency maps to detect fans. Only forward edges count:
  // reversed edges route via below-station h-channels, not gap channels.
  var from_count = {}, to_count = {}
  for (var i = 0; i < all_edges.length; i++) {
    if (reversed_set[all_edges[i].id]) continue
    from_count[all_edges[i].from_id] = (from_count[all_edges[i].from_id] || 0) + 1
    to_count[all_edges[i].to_id] = (to_count[all_edges[i].to_id] || 0) + 1
  }

  // For each hop, determine its fan group key in its gap. A hop can join
  // its edge's from-fan (trunk shared by all wires out of one source) or,
  // if it is the final hop of its chain, the to-fan (trunk shared by all
  // wires arriving at one dest). Join whichever group actually has more
  // members in this gap+direction; ties go to the from-fan. Split by
  // direction so fans going both up AND down get separate channels.
  var fan_key = {}
  var from_group_n = {}   // gap|dir|from_id → cross-row hop count
  var to_group_n = {}     // gap|dir|to_id → cross-row FINAL hop count
  for (var i = 0; i < all_edges.length; i++) {
    var e = all_edges[i]
    if (reversed_set[e.id]) continue
    var chain = edge_chain[e.id]
    for (var j = 0; j < chain.length - 1; j++) {
      if (row_of[chain[j]] === row_of[chain[j + 1]]) continue
      var g = layer_of[chain[j]]
      var hop_dir = row_of[chain[j + 1]] > row_of[chain[j]] ? 'dn' : 'up'
      var fk = g + '|' + hop_dir + '|' + e.from_id
      from_group_n[fk] = (from_group_n[fk] || 0) + 1
      if (j === chain.length - 2) {
        var tk = g + '|' + hop_dir + '|' + e.to_id
        to_group_n[tk] = (to_group_n[tk] || 0) + 1
      }
    }
  }
  // Reversed-edge and self-loop drop legs join their source's down-fan —
  // count them so a lone forward hop from the same source still groups
  // with them instead of taking its own column
  for (var i = 0; i < all_edges.length; i++) {
    if (!reversed_set[all_edges[i].id]) continue
    var chain = edge_chain[all_edges[i].id]
    var orig_from = chain[chain.length - 1]
    if (port_by_id[orig_from]) continue
    var fk = layer_of[orig_from] + '|dn|' + orig_from
    from_group_n[fk] = (from_group_n[fk] || 0) + 1
  }
  for (var i = 0; i < self_loops.length; i++) {
    var fk = layer_of[self_loops[i].from.id] + '|dn|' + self_loops[i].from.id
    from_group_n[fk] = (from_group_n[fk] || 0) + 1
  }
  for (var i = 0; i < all_edges.length; i++) {
    var e = all_edges[i]
    if (reversed_set[e.id]) continue
    var chain = edge_chain[e.id]
    for (var j = 0; j < chain.length - 1; j++) {
      if (row_of[chain[j]] === row_of[chain[j + 1]]) continue
      var g = layer_of[chain[j]]
      var hop_dir = row_of[chain[j + 1]] > row_of[chain[j]] ? 'dn' : 'up'
      var fg = from_group_n[g + '|' + hop_dir + '|' + e.from_id] || 0
      var tg = (j === chain.length - 2) ? (to_group_n[g + '|' + hop_dir + '|' + e.to_id] || 0) : 0
      if (tg >= 2 && tg > fg)
        fan_key[e.id + '_hop' + j] = 'to_' + hop_dir + '_' + e.to_id
      else if (fg >= 2)
        fan_key[e.id + '_hop' + j] = 'from_' + hop_dir + '_' + e.from_id
      else
        fan_key[e.id + '_hop' + j] = e.id + '_hop' + j
    }
  }

  // ── Vertical channel ordinals per gap ─────────────────────────────
  // Each fan group in a gap gets an ordered slot (left to right). The
  // concrete x positions are assigned once layer_x and width are known;
  // conflict detection below only needs the ordering.

  var gap_groups = {}       // gap → sorted [{ key, from_row, to_row, hops }]
  var channel_ordinal = {}  // hop key → ordinal of its group in its gap
  for (var g = 0; g < layers.length - 1; g++) {
    var ch_list = [], group_hops = {}, group_seen = {}
    for (var i = 0; i < all_edges.length; i++) {
      if (reversed_set[all_edges[i].id]) continue
      var chain = edge_chain[all_edges[i].id]
      for (var j = 0; j < chain.length - 1; j++) {
        if (layer_of[chain[j]] !== g) continue
        if (row_of[chain[j]] === row_of[chain[j + 1]]) continue
        var hop_key = all_edges[i].id + '_hop' + j
        var fk = fan_key[hop_key]
        if (!group_hops[fk]) group_hops[fk] = []
        group_hops[fk].push(hop_key)
        if (!group_seen[fk]) {
          group_seen[fk] = true
          ch_list.push({ key: fk, from_row: row_of[chain[j]], to_row: row_of[chain[j + 1]] })
        } else {
          // Expand the group's row range
          for (var ci = 0; ci < ch_list.length; ci++) {
            if (ch_list[ci].key !== fk) continue
            if (row_of[chain[j]] < ch_list[ci].from_row) ch_list[ci].from_row = row_of[chain[j]]
            if (row_of[chain[j + 1]] < ch_list[ci].from_row) ch_list[ci].from_row = row_of[chain[j + 1]]
            if (row_of[chain[j]] > ch_list[ci].to_row) ch_list[ci].to_row = row_of[chain[j]]
            if (row_of[chain[j + 1]] > ch_list[ci].to_row) ch_list[ci].to_row = row_of[chain[j + 1]]
          }
        }
      }
    }
    // Reversed edges drop from their source's out through this gap into a
    // below-band h-channel. Register the drop leg as a pseudo-hop under the
    // source's down-fan key: it merges with a forward down-trunk when one
    // exists, and otherwise gets its own properly spaced column.
    for (var i = 0; i < all_edges.length; i++) {
      if (!reversed_set[all_edges[i].id]) continue
      var chain = edge_chain[all_edges[i].id]
      var orig_from = chain[chain.length - 1]
      if (port_by_id[orig_from]) continue
      if (layer_of[orig_from] !== g) continue
      var hop_key = 'rev_' + all_edges[i].id
      var fk = 'from_dn_' + orig_from
      if (!group_hops[fk]) group_hops[fk] = []
      group_hops[fk].push(hop_key)
      if (!group_seen[fk]) {
        group_seen[fk] = true
        ch_list.push({ key: fk, from_row: row_of[orig_from], to_row: row_of[orig_from] })
      }
    }
    // Self-loop out-legs drop the same way — same key, same trunk
    for (var i = 0; i < self_loops.length; i++) {
      var sl_id = self_loops[i].from.id
      if (layer_of[sl_id] !== g) continue
      var hop_key = 'sl_' + self_loops[i].id
      var fk = 'from_dn_' + sl_id
      if (!group_hops[fk]) group_hops[fk] = []
      group_hops[fk].push(hop_key)
      if (!group_seen[fk]) {
        group_seen[fk] = true
        ch_list.push({ key: fk, from_row: row_of[sl_id], to_row: row_of[sl_id] })
      }
    }
    if (ch_list.length === 0) continue
    ch_list.sort(function(a, b) { return a.from_row - b.from_row || a.to_row - b.to_row })
    for (var j = 0; j < ch_list.length; j++) {
      ch_list[j].hops = group_hops[ch_list[j].key]
      for (var h = 0; h < ch_list[j].hops.length; h++)
        channel_ordinal[ch_list[j].hops[h]] = j
    }
    gap_groups[g] = ch_list
  }

  // Channel demand per gap = number of fan groups (pseudo-hops included)
  var gap_channels = []
  for (var g = 0; g < layers.length - 1; g++)
    gap_channels.push(gap_groups[g] ? gap_groups[g].length : 0)

  // ── Approach-track conflict detection ──────────────────────────────
  // A cross-row hop has a departing horizontal at wire_y(from_row) spanning
  // [start_x, channel_x] and an arriving horizontal at wire_y(to_row)
  // spanning [channel_x, to_x]. Two unrelated hops sharing a wire row in
  // the same gap conflict only when those ranges overlap — which, since
  // departures start left of every channel and arrivals end right of every
  // channel, is exactly when the departure's channel ordinal >= the
  // arrival's. Conflicting arrivals move to an approach track between the
  // rows. Reversed edges route via below-station h-channels and never run
  // along wire rows in the gap.

  var gap_row_hops = {}   // gap → row → [{ key, from, to, ord, arriving, to_node, band }]
  for (var i = 0; i < all_edges.length; i++) {
    var ae = all_edges[i]
    if (reversed_set[ae.id]) continue
    var chain = edge_chain[ae.id]
    for (var j = 0; j < chain.length - 1; j++) {
      var fr = row_of[chain[j]], tr = row_of[chain[j + 1]]
      if (fr === tr) continue
      var g = layer_of[chain[j]]
      var key = ae.id + '_hop' + j
      if (!gap_row_hops[g]) gap_row_hops[g] = {}
      if (!gap_row_hops[g][fr]) gap_row_hops[g][fr] = []
      gap_row_hops[g][fr].push({ key: key, from: ae.from_id, to: ae.to_id,
                                 ord: channel_ordinal[key], arriving: false })
      if (!gap_row_hops[g][tr]) gap_row_hops[g][tr] = []
      gap_row_hops[g][tr].push({ key: key, from: ae.from_id, to: ae.to_id,
                                 ord: channel_ordinal[key], arriving: true,
                                 to_node: chain[j + 1], band: Math.min(fr, tr) })
    }
  }
  // Reversed-edge drop legs occupy [out_x, drop_x] on their source's wire
  // row — include them as departing segments so unrelated arrivals at that
  // row get approach tracks.
  for (var i = 0; i < all_edges.length; i++) {
    if (!reversed_set[all_edges[i].id]) continue
    var chain = edge_chain[all_edges[i].id]
    var orig_from = chain[chain.length - 1], orig_to = chain[0]
    if (port_by_id[orig_from]) continue
    var g = layer_of[orig_from]
    var r = row_of[orig_from]
    if (!gap_row_hops[g]) gap_row_hops[g] = {}
    if (!gap_row_hops[g][r]) gap_row_hops[g][r] = []
    gap_row_hops[g][r].push({ key: 'rev_' + all_edges[i].id, from: orig_from, to: orig_to,
                              ord: channel_ordinal['rev_' + all_edges[i].id], arriving: false })
  }
  for (var i = 0; i < self_loops.length; i++) {
    var sl_id = self_loops[i].from.id
    var g = layer_of[sl_id]
    var r = row_of[sl_id]
    if (!gap_row_hops[g]) gap_row_hops[g] = {}
    if (!gap_row_hops[g][r]) gap_row_hops[g][r] = []
    gap_row_hops[g][r].push({ key: 'sl_' + self_loops[i].id, from: sl_id, to: sl_id,
                              ord: channel_ordinal['sl_' + self_loops[i].id], arriving: false })
  }

  var needs_approach = {}  // hop key → { to_node, band, gap }
  for (var g in gap_row_hops) {
    var rows = gap_row_hops[g]
    for (var r in rows) {
      var hops = rows[r]
      for (var a = 0; a < hops.length; a++) {
        if (!hops[a].arriving) continue
        for (var b = 0; b < hops.length; b++) {
          if (hops[b].arriving) continue
          if (hops[a].from === hops[b].from || hops[a].to === hops[b].to) continue
          if (hops[a].ord !== undefined && hops[b].ord !== undefined && hops[b].ord < hops[a].ord) continue
          needs_approach[hops[a].key] = { to_node: hops[a].to_node, band: hops[a].band,
                                          gap: parseInt(g, 10) }
          break
        }
      }
    }
  }

  // Arrival ladder per gap: verticals entering a dest from beside it —
  // approach jogs, reversed-edge rises, self-loop returns — take columns
  // at to_x-3, to_x-5, ... so at least one dash shows between the turn
  // and the station's in-paren (drawn at in.x-1, covering that cell).
  // Reserve gap width so the ladder stays clear of the channel tracks.
  var arrival_ordinal = {}   // gap|kind|node → ladder ordinal in its gap
  var arrival_count = {}     // gap → allocated ladder columns
  function alloc_arrival(gap, key) {
    var k = gap + '|' + key
    if (arrival_ordinal[k] !== undefined) return
    arrival_ordinal[k] = arrival_count[gap] || 0
    arrival_count[gap] = arrival_ordinal[k] + 1
  }
  // Approach jogs: one column per dest node
  for (var key in needs_approach)
    alloc_arrival(needs_approach[key].gap, 'jog|' + needs_approach[key].to_node)
  // Reversed-edge rises: one column per dest, shared by all edges into it
  // (ports are exempt — contract returns T-junction into the port wire)
  for (var i = 0; i < all_edges.length; i++) {
    if (!reversed_set[all_edges[i].id]) continue
    var orig_to = edge_chain[all_edges[i].id][0]
    if (port_by_id[orig_to]) continue
    alloc_arrival(layer_of[orig_to] - 1, 'rev|' + orig_to)
  }
  // Self-loop returns share their station's rev-rise column
  for (var i = 0; i < self_loops.length; i++)
    alloc_arrival(layer_of[self_loops[i].from.id] - 1, 'rev|' + self_loops[i].from.id)

  // Returns to a left port rise in a fixed lane at x=2 (the T-junction);
  // when gap 0 also carries channels, reserve a unit so its track region
  // starts clear of the lane
  var left_port_return = false
  for (var i = 0; i < all_edges.length; i++) {
    if (!reversed_set[all_edges[i].id]) continue
    var orig_to = edge_chain[all_edges[i].id][0]
    if (port_by_id[orig_to] && port_by_id[orig_to].dir === 'left') left_port_return = true
  }

  function gap_units(g) {
    var units = (gap_channels[g] || 0) + (arrival_count[g] || 0)
    if (g === 0 && left_port_return && units > 0) units++
    return units
  }

  // ── Compute layer_x ──────────────────────────────────────────────
  // Layer 0 (left ports) is at x=0. Gap between layer 0 and layer 1 is
  // sized for channels. Right port layer x is set after width is known.

  var layer_x = []
  for (var i = 0; i < layers.length; i++) {
    if (i === 0) {
      layer_x.push(0)  // left port virtual layer at x=0
    } else if (i === 1) {
      // Gap from left port layer to first real layer
      var nc = gap_units(0)
      var port_gap = Math.max(5, nc > 0 ? 2 * nc + 5 : 5)
      layer_x.push(port_gap)
    } else if (i === layers.length - 1) {
      // Right port layer: placeholder, set after width is known
      layer_x.push(0)
    } else {
      var nc = gap_units(i - 1)
      var gap = Math.max(HLINE_GAP, nc > 0 ? 2 * nc + 5 : HLINE_GAP)
      layer_x.push(layer_x[i - 1] + layer_width[i - 1] + gap)
    }
  }

  function comp_right(cid) {
    return layer_x[layer_of[cid]] + comp_w(cid)
  }

  // ── Compute width ──────────────────────────────────────────────────
  // Width is determined from real component extents, then right port
  // layer x is set to width - 1.

  var min_width = Math.max(name.length + 7, 12)
  var max_right_x = 0
  // Real layers: component right edges
  for (var i = 1; i < layers.length - 1; i++)
    for (var j = 0; j < layers[i].length; j++) {
      if (dummy_set[layers[i][j]]) continue
      var rx = layer_x[i] + comp_w(layers[i][j]) + 2
      if (rx > max_right_x) max_right_x = rx
    }
  // Right port connections need gap after last real layer
  if (used_right_ports.length > 0 && real_layer_count > 0) {
    var last_real = real_layer_count  // shifted index of last real layer
    var nc = gap_units(last_real)
    var right_gap = Math.max(HLINE_GAP, nc > 0 ? 2 * nc + 5 : HLINE_GAP)
    var rx = layer_x[last_real] + layer_width[last_real] + right_gap + 1
    if (rx > max_right_x) max_right_x = rx
  }
  // Self-loop right margin (drop column in the gap right of the station)
  for (var i = 0; i < self_loops.length; i++) {
    var lyr = layer_of[self_loops[i].from.id]
    var rx = layer_x[lyr] + layer_width[lyr] + 2 * gap_units(lyr) + 4
    if (rx > max_right_x) max_right_x = rx
  }
  // Reversed edges need room for their drop columns in the gap right of
  // the source layer (track region plus wall margin)
  for (var i = 0; i < all_edges.length; i++) {
    if (!reversed_set[all_edges[i].id]) continue
    var chain = edge_chain[all_edges[i].id]
    var orig_from = chain[chain.length - 1]
    if (port_by_id[orig_from]) continue
    var lyr = layer_of[orig_from]
    var rx = layer_x[lyr] + layer_width[lyr] + 2 * gap_units(lyr) + 4
    if (rx > max_right_x) max_right_x = rx
  }
  var width = Math.max(min_width, max_right_x)

  // Set right port layer x
  if (layers.length > 1)
    layer_x[layers.length - 1] = width - 1

  // ── Vertical channel x-positions per gap ──────────────────────────
  // Spread each gap's fan groups across the track region in ordinal
  // order. The last 2*arrival_count columns before the next layer are
  // reserved for the arrival ladder.

  var v_channel_x = {}
  var group_x = {}         // gap + '|' + fan_group_key → x (for reversed-leg trunk reuse)
  for (var g in gap_groups) {
    var gi = parseInt(g, 10)
    var ch_list = gap_groups[g]
    var gap_left = layer_x[gi] + layer_width[gi]
    var gap_right = layer_x[gi + 1]
    var track_min = gap_left + 3
    if (gi === 0 && left_port_return) track_min += 1  // clear of the return lane at x=2
    var track_max = gap_right - 4 - 2 * (arrival_count[gi] || 0)
    // Ensure track_max >= track_min
    if (track_max < track_min) track_max = track_min
    var usable = track_max - track_min
    var n = ch_list.length
    var spacing = n > 1 ? usable / (n - 1) : 0
    for (var j = 0; j < n; j++) {
      var tx = n === 1 ? track_min + Math.floor(usable / 2) : Math.round(track_min + spacing * j)
      tx = Math.max(track_min, Math.min(track_max, tx))
      // Assign this x to ALL hop keys in the fan group
      var gk = ch_list[j].key
      group_x[gi + '|' + gk] = tx
      for (var h = 0; h < ch_list[j].hops.length; h++)
        v_channel_x[ch_list[j].hops[h]] = tx
    }
  }

  // ── Band slot allocation ────────────────────────────────────────────
  // All horizontal runs living below a station row — approach tracks,
  // reversed-edge h-channels, self-loop channels — share one allocator per
  // band (the space below row r), handing out y slots two rows apart so
  // parallel channels never touch. Reversed edges arriving at the same
  // dest share one channel (their overlap is a legal fan-in trunk).

  var band_slots = {}      // band → [slot_key] in allocation order
  var slot_index = {}      // slot_key → index within its band
  function alloc_slot(band, key) {
    if (slot_index[key] !== undefined) return
    if (!band_slots[band]) band_slots[band] = []
    slot_index[key] = band_slots[band].length
    band_slots[band].push(key)
  }

  // Approach tracks: one slot per (band, to_node)
  for (var key in needs_approach) {
    var na = needs_approach[key]
    alloc_slot(na.band, 'app|' + na.band + '|' + na.to_node)
  }

  // Reversed-edge h-channels: one per edge. Sharing a channel between
  // edges hides whichever turn ends up mid-channel (it renders as a plain
  // crossing), so channels stay per-edge; only the vertical drop/rise
  // trunks are shared.
  for (var i = 0; i < all_edges.length; i++) {
    if (!reversed_set[all_edges[i].id]) continue
    var chain = edge_chain[all_edges[i].id]
    var orig_from = chain[chain.length - 1], orig_to = chain[0]
    var band = Math.max(row_of[orig_from], row_of[orig_to])
    alloc_slot(band, 'rev|' + band + '|' + all_edges[i].id)
  }

  // Self-loop channels
  for (var i = 0; i < self_loops.length; i++) {
    var band = row_of[self_loops[i].from.id]
    alloc_slot(band, 'sl|' + band + '|' + self_loops[i].id)
  }

  // ── Row heights ─────────────────────────────────────────────────────
  // ROW_HEIGHT per row; a band's slots sit at comp_y+5, +7, +9, ... so a
  // band with n slots extends its row by 2n-2 beyond the one free slot.

  var row_h_count = {}
  for (var b in band_slots)
    row_h_count[b] = Math.max(0, 2 * band_slots[b].length - 2)

  var row_y_offset = []
  var cum_y = HEADER_HEIGHT
  for (var r = 0; r < total_rows; r++) {
    row_y_offset.push(cum_y)
    cum_y += ROW_HEIGHT + (row_h_count[r] || 0)
  }

  function comp_y(row) { return row_y_offset[row] !== undefined ? row_y_offset[row] : HEADER_HEIGHT }
  function wire_y(row) { return comp_y(row) + 3 }
  function slot_y(band, key) { return comp_y(band) + 5 + 2 * slot_index[key] }

  // Concrete approach y and jog ladder ordinals
  var approach_y_for = {}  // hop key → y
  var jog_x_for = {}       // hop key → arrival ladder ordinal (0, 1, ...)
  for (var key in needs_approach) {
    var na = needs_approach[key]
    approach_y_for[key] = slot_y(na.band, 'app|' + na.band + '|' + na.to_node)
    jog_x_for[key] = arrival_ordinal[na.gap + '|jog|' + na.to_node] || 0
  }

  // ── Place components ──────────────────────────────────────────────

  elements = []
  for (var i = 1; i < layers.length - 1; i++) {
    for (var j = 0; j < layers[i].length; j++) {
      var cid = layers[i][j]
      if (dummy_set[cid]) continue
      var row = row_of[cid]
      var cx = layer_x[i]
      var cy = comp_y(row) + 1
      var cw = comp_w(cid)
      var wy = cy + 2
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

  // ── Connection paths ────────────────────────────────────────────────

  var conn_paths = {}
  function add_path(conn_id, x, y) {
    if (!conn_paths[conn_id]) conn_paths[conn_id] = []
    conn_paths[conn_id].push({ x: x, y: y })
  }

  // ── Route all edges via dummy chains ───────────────────────────────
  // Forward edges: walk chain left-to-right (out → in).
  // Reversed edges: walk chain right-to-left (out → in of original direction).
  // This avoids station body penetration at endpoints.

  function route_forward_chain(e) {
    var chain = edge_chain[e.id]
    var path = []
    for (var j = 0; j < chain.length - 1; j++) {
      var from_node = chain[j], to_node = chain[j + 1]
      var fl = layer_of[from_node], tl = layer_of[to_node]
      var fr = row_of[from_node], tr = row_of[to_node]

      var from_x, to_x
      if (dummy_set[from_node]) {
        from_x = path.length > 0 ? path[path.length - 1].x : layer_x[fl]
      } else if (port_by_id[from_node]) {
        from_x = (fl === 0) ? 1 : width - 2
      } else {
        from_x = layer_x[fl] + comp_w(from_node)  // comp out.x
      }

      if (dummy_set[to_node]) {
        to_x = layer_x[tl]
      } else if (port_by_id[to_node]) {
        to_x = (tl === layers.length - 1) ? width - 2 : 1
      } else {
        to_x = layer_x[tl]  // comp in.x
      }

      var from_wy = wire_y(fr)
      var to_wy = wire_y(tr)

      if (fr === tr) {
        if (j === 0) path.push({ x: from_x, y: from_wy })
        path.push({ x: to_x, y: from_wy })
      } else {
        var ch_x = v_channel_x[e.id + '_hop' + j]
        if (ch_x === undefined) ch_x = Math.floor((from_x + to_x) / 2)
        var app_y = approach_y_for[e.id + '_hop' + j]
        if (j === 0) path.push({ x: from_x, y: from_wy })
        path.push({ x: ch_x, y: from_wy })
        var hop_key = e.id + '_hop' + j
        if (app_y !== undefined) {
          // Approach track: arrive at a dedicated y, then jog to wire_y at
          // the dest's arrival-ladder column (to_x - 3 - 2*ordinal), then a
          // short horizontal into to_x that leaves a visible dash before
          // the station paren.
          var jog_off = jog_x_for[hop_key] || 0
          var jog_x = to_x - 3 - 2 * jog_off
          path.push({ x: ch_x, y: app_y })
          if (jog_x !== ch_x) path.push({ x: jog_x, y: app_y })
          path.push({ x: jog_x, y: to_wy })
          if (jog_x !== to_x) path.push({ x: to_x, y: to_wy })
        } else {
          path.push({ x: ch_x, y: to_wy })
          path.push({ x: to_x, y: to_wy })
        }
      }
    }
    return path
  }

  function route_reversed_chain(e) {
    // Reversed edges (back-edges, contract returns): original FROM.out → TO.in.
    // Route entirely via a below-station h-channel to avoid station body
    // penetration. Pattern: FROM.out → right → below → left → up → TO.in
    var chain = edge_chain[e.id]
    var orig_from = chain[chain.length - 1]  // original connection's FROM
    var orig_to = chain[0]                   // original connection's TO

    // FROM endpoint (right side: out.x)
    var from_out_x, from_wy
    if (port_by_id[orig_from]) {
      from_out_x = port_by_id[orig_from].dir === 'left' ? 1 : width - 2
    } else {
      from_out_x = layer_x[layer_of[orig_from]] + comp_w(orig_from)
    }
    from_wy = wire_y(row_of[orig_from])

    // TO endpoint (left side: in.x)
    var to_in_x, to_wy
    if (port_by_id[orig_to]) {
      to_in_x = port_by_id[orig_to].dir === 'left' ? 1 : width - 2
    } else {
      to_in_x = layer_x[layer_of[orig_to]]
    }
    to_wy = wire_y(row_of[orig_to])

    var path = []
    path.push({ x: from_out_x, y: from_wy })

    var max_row = Math.max(row_of[orig_from], row_of[orig_to])
    var below_y = slot_y(max_row, 'rev|' + max_row + '|' + e.id)
    // Drop column allocated by the channel system (shares the source's
    // forward down-trunk when one exists)
    var from_clear_x = v_channel_x['rev_' + e.id] !== undefined
      ? v_channel_x['rev_' + e.id] : from_out_x + 2
    // Port dest: rise one column clear of the wall and T into the port's
    // wire with a final one-cell horizontal. Station/subspace dest: rise
    // at the dest's arrival-ladder column, leaving a dash before the paren.
    var to_clear_x
    if (port_by_id[orig_to]) {
      to_clear_x = to_in_x + 1
    } else {
      var rise_ord = arrival_ordinal[(layer_of[orig_to] - 1) + '|rev|' + orig_to] || 0
      to_clear_x = Math.max(2, to_in_x - 3 - 2 * rise_ord)
    }

    // FROM: out → right → down to below
    if (!port_by_id[orig_from]) {
      path.push({ x: from_clear_x, y: from_wy })
      path.push({ x: from_clear_x, y: below_y })
    } else {
      // Right-port source: branch off the port's mouth one column clear of
      // the wall (mirror of the left-port T-junction) and drop below
      path.push({ x: from_out_x - 1, y: from_wy })
      path.push({ x: from_out_x - 1, y: below_y })
    }

    // Horizontal along below_y to TO clearance
    path.push({ x: to_clear_x, y: below_y })

    // UP to TO row, then to TO.in
    path.push({ x: to_clear_x, y: to_wy })
    if (to_clear_x !== to_in_x)
      path.push({ x: to_in_x, y: to_wy })

    return path
  }

  for (var i = 0; i < all_edges.length; i++) {
    var e = all_edges[i]
    if (reversed_set[e.id]) {
      conn_paths[e.id] = route_reversed_chain(e)
    } else {
      conn_paths[e.id] = route_forward_chain(e)
    }
  }

  // ── Route self-loops ───────────────────────────────────────────────
  // Self-loops can't use dummies. Route: out → right → down → left → up → in

  for (var i = 0; i < self_loops.length; i++) {
    var slc = self_loops[i]
    var sl_id = slc.from.id
    var sl_wy = wire_y(row_of[sl_id])
    var sl_out_x = comp_right(sl_id)
    var sl_in_x = layer_x[layer_of[sl_id]]
    var sl_row = row_of[sl_id]
    var sl_back_y = slot_y(sl_row, 'sl|' + sl_row + '|' + slc.id)
    var sl_right_vx = v_channel_x['sl_' + slc.id] !== undefined
      ? v_channel_x['sl_' + slc.id] : sl_out_x + 2
    var sl_rise_ord = arrival_ordinal[(layer_of[sl_id] - 1) + '|rev|' + sl_id] || 0
    var sl_left_vx = Math.max(2, sl_in_x - 3 - 2 * sl_rise_ord)
    add_path(slc.id, sl_out_x, sl_wy)
    add_path(slc.id, sl_right_vx, sl_wy)
    add_path(slc.id, sl_right_vx, sl_back_y)
    add_path(slc.id, sl_left_vx, sl_back_y)
    add_path(slc.id, sl_left_vx, sl_wy)
    add_path(slc.id, sl_in_x, sl_wy)
  }


  // ── Place port elements ────────────────────────────────────────────
  // Left ports at x=0, right ports at x=width-1, using row assignments
  // from the virtual layers.

  var emitted_ports = {}
  for (var i = 0; i < used_left_ports.length; i++) {
    var p = used_left_ports[i]
    var py = wire_y(row_of[p.id])
    elements.push({ type: 'port', x: 0, y: py, dir: 'left', key: p.key, id: p.id, wire_x: 1 })
    emitted_ports[p.id] = true
  }
  for (var i = 0; i < used_right_ports.length; i++) {
    var p = used_right_ports[i]
    var py = wire_y(row_of[p.id])
    elements.push({ type: 'port', x: width - 1, y: py, dir: 'right', key: p.key, id: p.id, wire_x: width - 2 })
    emitted_ports[p.id] = true
  }

  // ── Standalone ports (not in any connection) ───────────────────────

  var left_standalone = []
  var right_standalone = []
  for (var i = 0; i < ports.length; i++) {
    if (used_ports[ports[i].id]) continue
    if (ports[i].dir === 'left') left_standalone.push(ports[i])
    else right_standalone.push(ports[i])
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

  var port_rows = Math.max(left_standalone.length, right_standalone.length)
  var sy = content_y
  var li = 0, ri = 0
  while (li < left_standalone.length || ri < right_standalone.length) {
    if (li < left_standalone.length) {
      elements.push({ type: 'port', x: 0, y: sy, dir: 'left', key: left_standalone[li].key, wire_x: 1 })
      li++
    }
    if (ri < right_standalone.length) {
      elements.push({ type: 'port', x: width - 1, y: sy, dir: 'right', key: right_standalone[ri].key, wire_x: width - 2 })
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

      // Invariant 6: attach clearance. A station's in-paren is drawn one
      // cell left of in.x and stamps over the wire, so an arriving wire
      // must make its last turn at in.x-3 or further to leave a visible
      // dash; a departing wire must run to out.x+2 or further before
      // turning. Subspaces draw 'o' at the attach cell (in needs 2).
      // Ports are exempt (contract returns T-junction into the port wire).
      if (to_el.type !== 'port') {
        var need_in = to_el.type === 'station' ? 3 : 2
        var prev = pts[pts.length - 2]
        if (prev.y !== last.y || last.x - prev.x < need_in)
          throw new Error('Invariant attach: ' + conn + ' enters ' + tc.to.id + ' with last turn at (' +
                          prev.x + ',' + prev.y + ') — needs a horizontal of ' + need_in + '+ into (' + last.x + ',' + last.y + ')')
      }
      if (from_el.type === 'station') {
        var second = pts[1]
        if (second.y !== first.y || second.x - first.x < 2)
          throw new Error('Invariant attach: ' + conn + ' leaves ' + tc.from.id + ' with first turn at (' +
                          second.x + ',' + second.y + ') — needs a horizontal of 2+ from (' + first.x + ',' + first.y + ')')
      }
    }
  }

  // Invariant: no opposing directions on shared wire segments
  // Two connections sharing a cell must flow the same direction on each axis,
  // UNLESS they share an endpoint (fan-out/fan-in trunk splitting both ways),
  // OR the cell is a port's mouth (within 1 of its wire_x) and both
  // connections attach to that port in either role — requests leave and
  // returns T-junction in over the same 1-2 cells.
  var check_ports = []
  for (var i = 0; i < laid.elements.length; i++)
    if (laid.elements[i].type === 'port' && laid.elements[i].id) check_ports.push(laid.elements[i])
  function port_pair_ok(x, y, a_from, a_to, b) {
    for (var i = 0; i < check_ports.length; i++) {
      var p = check_ports[i]
      if (p.id !== a_from && p.id !== a_to) continue
      if (p.id !== b.from && p.id !== b.to) continue
      if (p.y === y && Math.abs(x - p.wire_x) <= 1) return true
    }
    return false
  }
  var h_dir_at = {}  // 'x,y' → { dir, conn, from, to }
  var v_dir_at = {}
  for (var i = 0; i < paths.length; i++) {
    var pts = paths[i].path, conn = paths[i].conn, pfrom = paths[i].from, pto = paths[i].to
    for (var j = 0; j < pts.length - 1; j++) {
      var x0 = pts[j].x, y0 = pts[j].y, x1 = pts[j + 1].x, y1 = pts[j + 1].y
      if (y0 === y1) {
        var hd = x1 > x0 ? 'right' : 'left'
        var xmin = Math.min(x0, x1), xmax = Math.max(x0, x1)
        for (var x = xmin; x <= xmax; x++) {
          var k = x + ',' + y0
          if (h_dir_at[k] && h_dir_at[k].dir !== hd) {
            var shared = (pfrom === h_dir_at[k].from || pto === h_dir_at[k].to) ||
                         port_pair_ok(x, y0, pfrom, pto, h_dir_at[k])
            if (!shared) throw new Error('Invariant opposing-h: ' + conn + ' goes ' + hd + ' at (' + x + ',' + y0 + ') but ' + h_dir_at[k].conn + ' goes ' + h_dir_at[k].dir)
          }
          if (!h_dir_at[k]) h_dir_at[k] = { dir: hd, conn: conn, from: pfrom, to: pto }
        }
      } else if (x0 === x1) {
        var vd = y1 > y0 ? 'down' : 'up'
        var ymin = Math.min(y0, y1), ymax = Math.max(y0, y1)
        for (var y = ymin; y <= ymax; y++) {
          var k = x0 + ',' + y
          if (v_dir_at[k] && v_dir_at[k].dir !== vd) {
            var shared = (pfrom === v_dir_at[k].from || pto === v_dir_at[k].to)
            if (!shared) throw new Error('Invariant opposing-v: ' + conn + ' goes ' + vd + ' at (' + x0 + ',' + y + ') but ' + v_dir_at[k].conn + ' goes ' + v_dir_at[k].dir)
          }
          if (!v_dir_at[k]) v_dir_at[k] = { dir: vd, conn: conn, from: pfrom, to: pto }
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

  // Invariant 3: at least one empty space between parallel wires.
  // Two parallel segments in adjacent columns/rows with overlapping extent
  // read as one thick wire. Same-cell overlap is covered by the shared-wire
  // check above; this catches the distance-1 case, with no shared-endpoint
  // exception (same-endpoint wires should merge into a trunk, not sit
  // side by side).
  var all_v = [], all_h = []
  for (var i = 0; i < paths.length; i++) {
    var pts = paths[i].path
    for (var j = 0; j < pts.length - 1; j++) {
      var x0 = pts[j].x, y0 = pts[j].y, x1 = pts[j + 1].x, y1 = pts[j + 1].y
      if (x0 === x1 && y0 !== y1)
        all_v.push({ conn: paths[i].conn, x: x0, min: Math.min(y0, y1), max: Math.max(y0, y1) })
      else if (y0 === y1 && x0 !== x1)
        all_h.push({ conn: paths[i].conn, y: y0, min: Math.min(x0, x1), max: Math.max(x0, x1) })
    }
  }
  for (var i = 0; i < all_v.length; i++) {
    for (var j = i + 1; j < all_v.length; j++) {
      var a = all_v[i], b = all_v[j]
      if (Math.abs(a.x - b.x) !== 1) continue
      if (a.min > b.max || b.min > a.max) continue
      throw new Error('Invariant spacing-v: ' + a.conn + ' vline x=' + a.x + ' and ' + b.conn +
                      ' vline x=' + b.x + ' are adjacent (y ' + Math.max(a.min, b.min) + '..' + Math.min(a.max, b.max) + ')')
    }
  }
  for (var i = 0; i < all_h.length; i++) {
    for (var j = i + 1; j < all_h.length; j++) {
      var a = all_h[i], b = all_h[j]
      if (Math.abs(a.y - b.y) !== 1) continue
      if (a.min > b.max || b.min > a.max) continue
      throw new Error('Invariant spacing-h: ' + a.conn + ' hline y=' + a.y + ' and ' + b.conn +
                      ' hline y=' + b.y + ' are adjacent (x ' + Math.max(a.min, b.min) + '..' + Math.min(a.max, b.max) + ')')
    }
  }

  // Invariant 7: cross-and-merge in one direction only. A cell where a
  // path turns may also carry through-wires (it renders as the turn's
  // arrow), but two different turn directions at one cell are undrawable —
  // UNLESS the turning wires share an endpoint: a fan's internal cells are
  // interchangeable (every reading is a true flow of the shared endpoint),
  // so whichever arrow renders, all destinations stay recoverable.
  var turn_dir_at = {}
  for (var i = 0; i < paths.length; i++) {
    var pts = paths[i].path
    var prev_dir = null
    for (var j = 0; j < pts.length - 1; j++) {
      var a = pts[j], b = pts[j + 1]
      var d = (a.y === b.y && a.x !== b.x) ? (b.x > a.x ? 'right' : 'left')
            : (a.x === b.x && a.y !== b.y) ? (b.y > a.y ? 'down' : 'up') : null
      if (d) {
        if (prev_dir && prev_dir !== d) {
          var k = a.x + ',' + a.y
          var seen = turn_dir_at[k]
          if (seen !== undefined && seen.dir !== d &&
              seen.from !== paths[i].from && seen.to !== paths[i].to)
            throw new Error('Invariant turn: two turn directions at (' + k + '): ' +
                            seen.dir + ' and ' + d + ' (' + seen.conn + ', ' + paths[i].conn + ')')
          turn_dir_at[k] = { dir: d, from: paths[i].from, to: paths[i].to, conn: paths[i].conn }
        }
        prev_dir = d
      }
    }
  }

  // Invariant 4: wire clearance from the box boundary. Vertical wires must
  // not run flush against a side wall; horizontal wires must not run flush
  // under the top border. Horizontal wires directly above the bottom border
  // are allowed — the underscore floor reads as already having space.
  for (var i = 0; i < all_v.length; i++) {
    if (all_v[i].x <= 1 || all_v[i].x >= laid.width - 2)
      throw new Error('Invariant wall: ' + all_v[i].conn + ' vline x=' + all_v[i].x +
                      ' runs flush against the wall (width ' + laid.width + ')')
  }
  for (var i = 0; i < all_h.length; i++) {
    if (all_h[i].y <= 1)
      throw new Error('Invariant wall: ' + all_h[i].conn + ' hline y=' + all_h[i].y + ' runs flush under the top border')
  }
}
