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

    connections.push({ from: from, to: to, type: type })
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

export function layout(topology) {
  var name = topology.name
  var ports = topology.ports || []
  var stations = topology.stations || []
  var connections = topology.connections || []
  var elements = []

  // Build adjacency: forward map from "id:port" to connection
  var forward = {}
  for (var i = 0; i < connections.length; i++) {
    var c = connections[i]
    forward[c.from.id + ':' + c.from.port] = c
  }

  // Build port/station lookup by id
  var port_by_id = {}
  for (var i = 0; i < ports.length; i++)
    port_by_id[ports[i].id] = ports[i]

  var station_by_id = {}
  for (var i = 0; i < stations.length; i++)
    station_by_id[stations[i].id] = stations[i]

  // Build subspace lookup set
  var subspaces = topology.subspaces || []
  var subspace_set = {}
  for (var i = 0; i < subspaces.length; i++)
    subspace_set[subspaces[i]] = true

  // Detect chains starting from left-dir ports
  var chains = []
  var used_ports = {}
  var used_stations = {}
  var used_subspaces = {}

  for (var i = 0; i < ports.length; i++) {
    var start_port = ports[i]
    if (start_port.dir !== 'left') continue
    if (used_ports[start_port.id]) continue

    // Try to walk a chain from this port
    var conn = forward[start_port.id + ':' + start_port.key]
    if (!conn) continue

    // First target must be a station _in or subspace in
    var target_id = conn.to.id
    var is_station = station_by_id[target_id] && conn.to.port === '_in'
    var is_subspace = subspace_set[target_id] && conn.to.port === 'in'
    if (!is_station && !is_subspace) continue

    var chain_elements = []
    var current_id = target_id

    // Walk through stations and subspaces
    while (current_id) {
      if (station_by_id[current_id]) {
        chain_elements.push({ type: 'station', station: station_by_id[current_id] })
        // Cross from _in to _out implicitly, then find outgoing connection
        var out_conn = forward[current_id + ':_out']
        if (!out_conn) break
        var next_id = out_conn.to.id
        if (port_by_id[next_id]) {
          // Reached an end port — chain complete
          var end_port = port_by_id[next_id]
          chains.push({ left: start_port, right: end_port, elements: chain_elements })
          used_ports[start_port.id] = true
          used_ports[end_port.id] = true
          for (var j = 0; j < chain_elements.length; j++) {
            if (chain_elements[j].type === 'station')
              used_stations[chain_elements[j].station.id] = true
            else
              used_subspaces[chain_elements[j].name] = true
          }
          break
        } else if (station_by_id[next_id] && out_conn.to.port === '_in') {
          current_id = next_id
        } else if (subspace_set[next_id] && out_conn.to.port === 'in') {
          current_id = next_id
        } else {
          break
        }
      } else if (subspace_set[current_id]) {
        chain_elements.push({ type: 'subspace', name: current_id })
        // Cross from in to out, then find outgoing connection
        var out_conn = forward[current_id + ':out']
        if (!out_conn) break
        var next_id = out_conn.to.id
        if (port_by_id[next_id]) {
          // Reached an end port — chain complete
          var end_port = port_by_id[next_id]
          chains.push({ left: start_port, right: end_port, elements: chain_elements })
          used_ports[start_port.id] = true
          used_ports[end_port.id] = true
          for (var j = 0; j < chain_elements.length; j++) {
            if (chain_elements[j].type === 'station')
              used_stations[chain_elements[j].station.id] = true
            else
              used_subspaces[chain_elements[j].name] = true
          }
          break
        } else if (station_by_id[next_id] && out_conn.to.port === '_in') {
          current_id = next_id
        } else if (subspace_set[next_id] && out_conn.to.port === 'in') {
          current_id = next_id
        } else {
          break
        }
      } else {
        break
      }
    }
  }

  // Compute chain row dimensions
  var chain_rows = []
  var max_chain_width = 0
  for (var i = 0; i < chains.length; i++) {
    var chain = chains[i]
    var total_w = 1 + 3 // left port + first hline
    for (var j = 0; j < chain.elements.length; j++) {
      var el = chain.elements[j]
      var el_w = el.type === 'station' ? el.station.source.length + 6 : el.name.length + 8
      if (j > 0) total_w += 3 // hline between elements
      total_w += el_w
    }
    total_w += 3 + 1 // last hline + right port
    chain_rows.push({ chain: chain, width: total_w })
    if (total_w > max_chain_width) max_chain_width = total_w
  }

  // Separate remaining (standalone) left and right ports
  var left_ports = []
  var right_ports = []
  for (var i = 0; i < ports.length; i++) {
    if (used_ports[ports[i].id]) continue
    if (ports[i].dir === 'left') left_ports.push(ports[i])
    else right_ports.push(ports[i])
  }

  // Box sizing
  var min_width = Math.max(name.length + 4, 12)
  var content_width = Math.max(min_width, max_chain_width)
  var width = content_width

  // Lay out chain rows, each 6 lines tall, starting after top edge + name row
  var row_y = 2
  for (var i = 0; i < chain_rows.length; i++) {
    var cr = chain_rows[i]
    var chain = cr.chain
    var cx = 0

    // Left port on the content line (line 3 of 6, so row_y + 3)
    elements.push({ type: 'port', x: cx, y: row_y + 3, dir: 'left', key: chain.left.key })
    cx += 1

    // hline before first station
    elements.push({ type: 'hline', x: cx, y: row_y + 3, length: 3 })
    cx += 3

    for (var j = 0; j < chain.elements.length; j++) {
      if (j > 0) {
        // hline between elements
        elements.push({ type: 'hline', x: cx, y: row_y + 3, length: 3 })
        cx += 3
      }
      var cel = chain.elements[j]
      if (cel.type === 'station') {
        var src = cel.station.source
        var station_w = src.length + 6
        elements.push({ type: 'station', x: cx, y: row_y + 1, width: station_w, height: 4, source: src })
        cx += station_w
      } else {
        var sub_w = cel.name.length + 8
        elements.push({ type: 'subspace_box', x: cx, y: row_y + 1, width: sub_w, height: 4, name: cel.name })
        cx += sub_w
      }
    }

    // hline after last station
    elements.push({ type: 'hline', x: cx, y: row_y + 3, length: 3 })
    cx += 3

    // Right port
    elements.push({ type: 'port', x: cx, y: row_y + 3, dir: 'right', key: chain.right.key })

    row_y += 6
  }

  // Standalone port rows
  var port_rows = Math.max(left_ports.length, right_ports.length)
  var standalone_start_y = row_y
  var li = 0, ri = 0
  var sy = standalone_start_y
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

  // State variable rows
  var state = topology.state || {}
  var state_keys = Object.keys(state)
  var state_rows = state_keys.length
  for (var i = 0; i < state_keys.length; i++) {
    var stext = '$' + state_keys[i] + ': ' + JSON.stringify(state[state_keys[i]])
    elements.push({ type: 'text', x: 2, y: sy + i, text: stext })
    // Ensure box is wide enough for state text
    var needed = stext.length + 4
    if (needed > width) width = needed
  }

  // Total height: top(1) + name(1) + chain rows + standalone port rows + state rows + bottom(1)
  var height = 2 + chains.length * 6 + port_rows + state_rows + 1
  if (chains.length === 0 && port_rows === 0 && state_rows === 0) height = 3

  // Box
  elements.unshift({ type: 'box', x: 0, y: 0, width: width, height: height })

  // Label
  elements.splice(1, 0, { type: 'label', x: 2, y: 1, text: name })

  return { id: topology.id, name: name, width: width, height: height, elements: elements }
}

export function render(laid_out) {
  var w = laid_out.width
  var h = laid_out.height
  var elements = laid_out.elements

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
      // Top row: space at x, then underscores
      for (var x = el.x + 1; x <= el.x + el.width - 2; x++)
        grid[el.y][x] = '_'
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

    else if (el.type === 'station') {
      var sx = el.x, sy = el.y, sw = el.width
      // Line 0: underscores from x+1 to x+width-2
      for (var x = sx + 1; x <= sx + sw - 2; x++)
        grid[sy][x] = '_'
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

export function render_space(name, seedlike) {
  return render(layout(extract(name, seedlike)))
}

export function render_all(seedlikes) {
  return Object.keys(seedlikes).map(function(n) { return render_space(n, seedlikes[n]) }).join('\n\n')
}
