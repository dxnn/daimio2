import D from '../daimio/daimio.js'
import { extract, layout, topo_sort } from '../site/js/space_layout.js'
import { render, render_space, render_all } from '../site/js/space_ascii.js'
import { parse_ascii } from '../site/js/space_ascii_parse.js'
import { readdirSync, readFileSync, existsSync } from 'fs'

var pass = 0, fail = 0, failures = []

function test(label, actual, expected) {
  var a = typeof actual === 'string' ? actual : JSON.stringify(actual)
  var e = typeof expected === 'string' ? expected : JSON.stringify(expected)
  if (a === e) { pass++ }
  else { fail++; failures.push({ label, expected: e, actual: a }) }
}

// === Extract: empty space ===
var empty = { ports: {}, state: {}, routes: [], dialect: {}, stations: {}, subspaces: {} }
var topo = extract('myspace', empty)
test('extract empty: name', topo.name, 'myspace')
test('extract empty: ports', topo.ports, [])
test('extract empty: stations', topo.stations, [])
test('extract empty: subspaces', topo.subspaces, [])
test('extract empty: connections', topo.connections, [])
test('extract empty: state', topo.state, {})

// === Extract: ports ===
var with_ports = { ports: { 'in': ['in'], 'out:display': ['dom-set-text'], 'out:err': ['err'] },
                   state: {}, routes: [], dialect: {}, stations: {}, subspaces: {} }
var topo_p = extract('s', with_ports)
test('port count', topo_p.ports.length, 3)
test('port 0 key', topo_p.ports[0].key, 'in')
test('port 0 dir', topo_p.ports[0].dir, 'left')
test('port 0 flavour', topo_p.ports[0].flavour, 'in')
test('port 1 key', topo_p.ports[1].key, 'out:display')
test('port 1 dir', topo_p.ports[1].dir, 'right')
test('port 1 flavour', topo_p.ports[1].flavour, 'dom-set-text')
test('port 2 key', topo_p.ports[2].key, 'out:err')
test('port 2 dir', topo_p.ports[2].dir, 'right')
test('port 2 flavour', topo_p.ports[2].flavour, 'err')

// === Extract: stations ===
var with_stations = { ports: {}, state: {}, routes: [], dialect: {},
                      stations: { proc: { value: '{__ | add 1}' },
                                  sender: { value: '{__ | >@foo | >@bar}', extraports: ['foo'] } },
                      subspaces: {} }
var topo_s = extract('s', with_stations)
test('station count', topo_s.stations.length, 2)
test('station 0 name', topo_s.stations[0].name, 'proc')
test('station 0 source', topo_s.stations[0].source, '{__ | add 1}')
test('station 0 ports empty', topo_s.stations[0].ports, [])
test('station 1 name', topo_s.stations[1].name, 'sender')
test('station 1 source', topo_s.stations[1].source, '{__ | >@foo | >@bar}')
test('station 1 has foo', topo_s.stations[1].ports.indexOf('foo') >= 0, true)
test('station 1 has bar', topo_s.stations[1].ports.indexOf('bar') >= 0, true)
test('station 1 port count', topo_s.stations[1].ports.length, 2)

// === Extract: connections (FAF) ===
var def_conn = 'counter\n  @in\n  @out\n  @in -> {1 | add 1} -> @out'
var seedlikes_conn = D.seedlikes_from_string(def_conn)
var topo_c = extract('counter', seedlikes_conn.counter)
test('conn count', topo_c.connections.length, 2)
test('conn 0 type', topo_c.connections[0].type, 'faf')
test('conn 0 from is port', topo_c.connections[0].from.port, 'in')
test('conn 0 to port', topo_c.connections[0].to.port, '_in')
test('conn 1 from port', topo_c.connections[1].from.port, '_out')
test('conn 1 to port', topo_c.connections[1].to.port, 'out')
// Verify from/to ids reference actual components
test('conn 0 from id matches port', topo_c.ports.some(function(p) { return p.id === topo_c.connections[0].from.id }), true)
test('conn 0 to id matches station', topo_c.stations.some(function(s) { return s.id === topo_c.connections[0].to.id }), true)

// === Extract: subspaces ===
var def_sub = 'inner\n  @in\n  @out\n  @in -> {__ | add 1} -> @out\nouter\n  @in\n  @out\n  @in -> inner.in\n  inner.out -> @out'
var seedlikes_sub = D.seedlikes_from_string(def_sub)
var topo_sub = extract('outer', seedlikes_sub.outer)
test('subspace count', topo_sub.subspaces.length, 1)
test('subspace ref', topo_sub.subspaces[0], 'inner')
test('sub conn count', topo_sub.connections.length, 2)
test('sub conn 0 to id is subspace', topo_sub.connections[0].to.id, 'inner')
test('sub conn 0 to port', topo_sub.connections[0].to.port, 'in')
test('sub conn 1 from id is subspace', topo_sub.connections[1].from.id, 'inner')
test('sub conn 1 from port', topo_sub.connections[1].from.port, 'out')

// === Layout: empty space ===
var topo_empty = extract('myspace', { ports: {}, state: {}, routes: [], dialect: {}, stations: {}, subspaces: {} })
var laid_empty = layout(topo_empty)
test('layout empty: has elements', Array.isArray(laid_empty.elements), true)
test('layout empty: has box', laid_empty.elements.some(function(e) { return e.type === 'box' }), true)
test('layout empty: box has name', laid_empty.elements.some(function(e) { return e.type === 'box' && e.name === 'myspace' }), true)
test('layout empty: width >= 12', laid_empty.width >= 12, true)
test('layout empty: height', laid_empty.height, 3)

// === Layout: standalone ports ===
var topo_ports = extract('s', { ports: { 'in': ['in'], 'out': ['out'], 'in:click': ['in'] }, state: {}, routes: [], dialect: {}, stations: {}, subspaces: {} })
var laid_ports = layout(topo_ports)
test('layout ports: has left port', laid_ports.elements.some(function(e) { return e.type === 'port' && e.dir === 'left' }), true)
test('layout ports: has right port', laid_ports.elements.some(function(e) { return e.type === 'port' && e.dir === 'right' }), true)
test('layout ports: left port at x=0', laid_ports.elements.filter(function(e) { return e.type === 'port' && e.dir === 'left' }).every(function(e) { return e.x === 0 }), true)
test('layout ports: right port at x=width-1', laid_ports.elements.filter(function(e) { return e.type === 'port' && e.dir === 'right' }).every(function(e) { return e.x === laid_ports.width - 1 }), true)
test('layout ports: port count', laid_ports.elements.filter(function(e) { return e.type === 'port' }).length, 3)
test('layout ports: height accommodates ports', laid_ports.height >= 5, true)

// === Layout: single chain ===
var def_chain = 'counter\n  @in\n  @out\n  @in -> {1 | add $count | >$count} -> @out'
var sl_chain = D.seedlikes_from_string(def_chain)
var topo_chain = extract('counter', sl_chain.counter)
var laid_chain = layout(topo_chain, { max_source: 0 })
test('chain layout: has station', laid_chain.elements.some(function(e) { return e.type === 'station' }), true)
test('chain layout: has paths', laid_chain.paths.length >= 2, true)
test('chain layout: has left port', laid_chain.elements.some(function(e) { return e.type === 'port' && e.dir === 'left' }), true)
test('chain layout: has right port', laid_chain.elements.some(function(e) { return e.type === 'port' && e.dir === 'right' }), true)
test('chain layout: station has source', laid_chain.elements.some(function(e) { return e.type === 'station' && e.source }), true)
test('chain layout: width accommodates chain', laid_chain.width >= 40, true)
test('chain layout: height accommodates chain', laid_chain.height >= 7, true)

// === Layout: two chains stacked ===
var def_two = 's\n  @in:a\n  @out:a\n  @in:b\n  @out:b\n  @in:a -> {1} -> @out:a\n  @in:b -> {2} -> @out:b'
var sl_two = D.seedlikes_from_string(def_two)
var topo_two = extract('s', sl_two.s)
var laid_two = layout(topo_two)
test('two chains: two stations', laid_two.elements.filter(function(e) { return e.type === 'station' }).length, 2)
test('two chains: four ports', laid_two.elements.filter(function(e) { return e.type === 'port' }).length, 4)
test('two chains: height > single chain', laid_two.height > laid_chain.height, true)

// === Render: empty space ===
var r_empty = render_space('myspace', { ports: {}, state: {}, routes: [], dialect: {}, stations: {}, subspaces: {} })
test('render empty: is string', typeof r_empty, 'string')
test('render empty: has top border', r_empty.indexOf('___') >= 0, true)
test('render empty: has name', r_empty.indexOf('myspace') >= 0, true)
test('render empty: has bottom border', r_empty.split('\n').pop().indexOf('___') >= 0, true)
test('render empty: correct structure',
  r_empty,
  [
    ' _ myspace _',
    '|           |',
    '|___________|',
  ].join('\n')
)

// === JSON serializability ===
var def_json = 'counter\n  @in\n  @out\n  $count 0\n  @in -> {1 | add 1} -> @out'
var sl_json = D.seedlikes_from_string(def_json)
var topo_json = extract('counter', sl_json.counter)
test('extract JSON round-trips',
  JSON.stringify(JSON.parse(JSON.stringify(topo_json))),
  JSON.stringify(topo_json))
var laid_json = layout(topo_json)
test('layout JSON round-trips',
  JSON.stringify(JSON.parse(JSON.stringify(laid_json))),
  JSON.stringify(laid_json))

// === Pipeline independence ===
var topo_a = extract('a', D.seedlikes_from_string('a\n  @in\n  @out\n  @in -> {1} -> @out').a)
var laid_a = layout(topo_a)
var ascii_a = render(laid_a)
test('pipeline: render accepts layout output', typeof ascii_a, 'string')
test('pipeline: render produces content', ascii_a.length > 0, true)

// === Render: path-based vline ===
var vline_layout = {
  id: 'v', name: 'v', width: 5, height: 5,
  elements: [
    { type: 'box', x: 0, y: 0, width: 5, height: 5 }
  ],
  paths: [
    { conn: 'test', path: [{x: 2, y: 1}, {x: 2, y: 3}] }
  ]
}
var r_vline = render(vline_layout)
test('vline: renders vertical bars', r_vline.split('\n').filter(function(l) { return l[2] === '|' }).length >= 1, true)

// === topo_sort: linear chain ===
var def_topo = 'ts\n  @in\n  @out\n  @in -> {a} -> {b} -> @out'
var sl_topo = D.seedlikes_from_string(def_topo)
var topo_ts = extract('ts', sl_topo.ts)
var sorted = topo_sort(topo_ts)
test('topo linear: two layers', sorted.layers.length, 2)
test('topo linear: layer 0 has one item', sorted.layers[0].length, 1)
test('topo linear: layer 1 has one item', sorted.layers[1].length, 1)

// === topo_sort: fan-in (two stations feed one) ===
var def_fan = 'fi\n  @in:a\n  @in:b\n  @out\n  @in:a -> {a} -> merge\n  @in:b -> {b} -> merge\n  merge {c}\n  merge -> @out'
var sl_fan = D.seedlikes_from_string(def_fan)
var topo_fan = extract('fi', sl_fan.fi)
var sorted_fan = topo_sort(topo_fan)
// stations a and b should be layer 0, merge should be layer 1
test('topo fan-in: a in layer 0', sorted_fan.layer_of[topo_fan.stations[0].id], 0)
test('topo fan-in: b in layer 0', sorted_fan.layer_of[topo_fan.stations[1].id], 0)
test('topo fan-in: merge in layer 1', sorted_fan.layer_of[topo_fan.stations[2].id], 1)

// === topo_sort: no connections ===
var topo_nc = extract('nc', { ports: {}, state: {}, routes: [], dialect: {},
  stations: { a: { value: '{a}' }, b: { value: '{b}' } }, subspaces: {} })
var sorted_nc = topo_sort(topo_nc)
test('topo no-conn: all in layer 0', sorted_nc.layers.length, 1)
test('topo no-conn: two items in layer 0', sorted_nc.layers[0].length, 2)

// === topo_sort: empty ===
var topo_emp = extract('e', { ports: {}, state: {}, routes: [], dialect: {}, stations: {}, subspaces: {} })
var sorted_emp = topo_sort(topo_emp)
test('topo empty: no layers', sorted_emp.layers.length, 0)

// === Layout v2: orphan station ===
var topo_orphan = extract('orp', { ports: { 'in': ['in'], 'out': ['out'] }, state: {}, routes: [],
  dialect: {}, stations: { lonely: { value: '{orphan}' } }, subspaces: {} })
var laid_orphan = layout(topo_orphan)
test('orphan: has station element', laid_orphan.elements.some(function(e) { return e.type === 'station' }), true)
test('orphan: has port elements', laid_orphan.elements.filter(function(e) { return e.type === 'port' }).length, 2)
var r_orphan = render(laid_orphan)
test('orphan: renders', typeof r_orphan, 'string')
test('orphan: has station source', r_orphan.indexOf('{orphan}') >= 0, true)

// === Cycle: topo_sort detects back-edges ===
var def_cycle = [
  'cyc',
  '  @in',
  '  @out',
  '  counter {count}',
  '  sleeper {sleep}',
  '  @in -> counter',
  '  counter -> sleeper',
  '  sleeper -> counter',
  '  counter -> @out'
].join('\n')
var sl_cyc = D.seedlikes_from_string(def_cycle)
var topo_cyc = extract('cyc', sl_cyc.cyc)
var sorted_cyc = topo_sort(topo_cyc)
test('cycle: topo_sort succeeds', sorted_cyc.layers.length >= 1, true)
test('cycle: has back_edges', sorted_cyc.back_edges.length >= 1, true)
test('cycle: all components have layers',
  topo_cyc.stations.every(function(s) { return sorted_cyc.layer_of[s.id] !== undefined }), true)

// === Cycle: self-loop topo_sort ===
var def_self = [
  'self',
  '  @in',
  '  @out',
  '  proc {x}',
  '  @in -> proc',
  '  proc -> proc',
  '  proc -> @out'
].join('\n')
var sl_self = D.seedlikes_from_string(def_self)
var topo_self = extract('self', sl_self.self)
var sorted_self = topo_sort(topo_self)
test('self-loop: topo_sort succeeds', sorted_self.layers.length >= 1, true)
test('self-loop: has back_edge', sorted_self.back_edges.length >= 1, true)

// === Connection ids ===
test('conn has id', topo_c.connections[0].id, 'c0')
test('conn 1 has id', topo_c.connections[1].id, 'c1')

// === Contract pair linking ===
var def_contract = 'cs\n  @up:req\n  proc {handle}\n  @up:req <-> proc'
var sl_contract = D.seedlikes_from_string(def_contract)
var topo_ct = extract('cs', sl_contract.cs)
var contracts = topo_ct.connections.filter(function(c) { return c.type === 'contract' })
test('contract: two contract connections', contracts.length, 2)
test('contract: both have ids', contracts[0].id !== undefined && contracts[1].id !== undefined, true)
test('contract: pair links match', contracts[0].pair === contracts[1].id && contracts[1].pair === contracts[0].id, true)

// === FAF has no pair ===
test('faf: no pair field', topo_c.connections[0].pair, undefined)

// === Truncation ===
var def_trunc = 'tr\n  @in\n  @out\n  @in -> {this is a very long station source} -> @out'
var r_trunc = render_space('tr', D.seedlikes_from_string(def_trunc).tr)
test('truncate: default truncates long source', r_trunc.indexOf('\u2026') >= 0, true)
test('truncate: full source not present', r_trunc.indexOf('very long station source}') < 0, true)
var r_notrunc = render_space('tr', D.seedlikes_from_string(def_trunc).tr, { max_source: 0 })
test('truncate: max_source 0 shows full', r_notrunc.indexOf('{this is a very long station source}') >= 0, true)
var r_short = render_space('tr', D.seedlikes_from_string(def_trunc).tr, { max_source: 10 })
test('truncate: max_source 10 shorter', r_short.indexOf('\u2026') >= 0, true)

// === Wire quality (reported 2026-07-06) ===
// Helpers over layout paths
function verticals(p) {
  var segs = []
  for (var i = 0; i < p.path.length - 1; i++) {
    var a = p.path[i], b = p.path[i + 1]
    if (a.x === b.x && a.y !== b.y)
      segs.push({ x: a.x, min: Math.min(a.y, b.y), max: Math.max(a.y, b.y) })
  }
  return segs
}
function conn_path(laid, cid) {
  return laid.paths.filter(function(p) { return p.conn === cid })[0]
}

// contract: the return wire must not run flush against the wall
var sl_wq1 = D.seedlikes_from_string(readFileSync('tests/space_ascii/contract/source.dm', 'utf8'))
var laid_wq1 = layout(extract('cs', sl_wq1.cs))
var wq1_hug = laid_wq1.paths.some(function(p) {
  return verticals(p).some(function(s) { return s.x <= 1 || s.x >= laid_wq1.width - 2 })
})
test('contract: no vline hugging wall', wq1_hug, false)

// be-span3: C→D has no conflicting wire in its way — must route without a
// jog (a straight line or a single rise; a jogged route has 6+ waypoints)
var sl_wq2 = D.seedlikes_from_string(readFileSync('tests/space_ascii/be-span3/source.dm', 'utf8'))
var laid_wq2 = layout(extract('be_span3', sl_wq2.be_span3))
test('be-span3: C→D routes without jog', conn_path(laid_wq2, 'c3').path.length <= 4, true)

// dense4: wires arriving at A's in (c6, c7, c8) share one trunk column;
// wires departing C's out downward (c5, c7, c9) share one trunk column
var sl_wq3 = D.seedlikes_from_string(readFileSync('tests/space_ascii/dense4/source.dm', 'utf8'))
var topo_wq3 = extract('dense4', sl_wq3.dense4)
var laid_wq3 = layout(topo_wq3)
// The original complaint: several near-parallel verticals serving one
// endpoint (e.g. ^-^-^ into A). Same column = shared trunk = fine; flat
// routes with no vertical = fine; two distinct columns closer than 3
// apart = redundant parallel wiring.
function trunk_spread_ok(cids, last) {
  var xs = []
  cids.forEach(function(cid) {
    var vs = verticals(conn_path(laid_wq3, cid))
    if (vs.length) xs.push(vs[last ? vs.length - 1 : 0].x)
  })
  for (var a = 0; a < xs.length; a++)
    for (var b = a + 1; b < xs.length; b++) {
      var dx = Math.abs(xs[a] - xs[b])
      if (dx > 0 && dx <= 2) return false
    }
  return true
}
test('dense4: arrivals into A not packed side by side', trunk_spread_ok(['c6', 'c7', 'c8'], true), true)
test('dense4: departures from C not packed side by side', trunk_spread_ok(['c5', 'c7', 'c9'], false), true)

// === Turn-arrow convention ===
// A path turning at a cell where wires pass through in both axes renders
// the turn's direction arrow, not O (O is reserved for pure crossings).
var turn_layout = {
  id: 't', name: 't', width: 9, height: 7,
  elements: [{ type: 'box', x: 0, y: 0, width: 9, height: 7 }],
  paths: [
    { conn: 'a', from: 'x', to: 'y', path: [{ x: 1, y: 3 }, { x: 7, y: 3 }] },
    { conn: 'b', from: 'z', to: 'w', path: [{ x: 4, y: 5 }, { x: 4, y: 1 }] },
    { conn: 'c', from: 'x', to: 'w', path: [{ x: 1, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 1 }] }
  ]
}
var r_turn = render(turn_layout)
test('turn convention: merge at crossing renders arrow', r_turn.indexOf('^') >= 0, true)
test('turn convention: no O at the merge cell', r_turn.indexOf('O') < 0, true)

// === Vertical ports: up → top border, down → bottom border ===
// Round-trip ports render as 'x' when unwired, '^v' when wired
// (^ = north-flowing wire's cell, v = south-flowing wire's cell).
var def_vport = 'vp\n  @up:req\n  @down:svc\n  @in\n  @out'
var sl_vport = D.seedlikes_from_string(def_vport)
var topo_vp = extract('vp', sl_vport.vp)
test('vport: up dir is top', topo_vp.ports.filter(function(p) { return p.key === 'up:req' })[0].dir, 'top')
test('vport: down dir is bottom', topo_vp.ports.filter(function(p) { return p.key === 'down:svc' })[0].dir, 'bottom')
test('vport: in stays left', topo_vp.ports.filter(function(p) { return p.key === 'in' })[0].dir, 'left')

var r_vp = render_space('vp', sl_vport.vp)
var r_vp_lines = r_vp.split('\n')
test('vport: unwired up renders x on top border', r_vp_lines[0].indexOf('x') >= 0, true)
test('vport: unwired down renders x on bottom border', r_vp_lines[r_vp_lines.length - 1].indexOf('x') >= 0, true)

// Wired down-port contract: ^v on the bottom border AND on the station's
// bottom edge; no side-wall port at all.
var def_dpc = 't\n  @down:svc\n  A {a}\n  @down:svc <-> A'
var sl_dpc = D.seedlikes_from_string(def_dpc)
var r_dpc = render_space('t', sl_dpc.t)
var dpc_lines = r_dpc.split('\n')
test('down contract: ^v on bottom border', /\^v/.test(dpc_lines[dpc_lines.length - 1]), true)
test('down contract: no o anywhere', r_dpc.indexOf('o') < 0, true)
test('down contract: station bottom has ^v', dpc_lines.some(function(l) { return /\\_*\^v_*\//.test(l) }), true)

// Wired up-port contract: ^v on the top border, station keeps paren attach
var def_upc = 'cs\n  @up:req\n  hdl {handle}\n  @up:req <-> hdl'
var sl_upc = D.seedlikes_from_string(def_upc)
var r_upc = render_space('cs', sl_upc.cs)
test('up contract: ^v on top border', /\^v/.test(r_upc.split('\n')[0]), true)
test('up contract: no port o', r_upc.indexOf('o') < 0, true)

// === Fixture tests ===
var fixture_dir = 'tests/space_ascii'
var fixtures = readdirSync(fixture_dir, { withFileTypes: true })
  .filter(function(d) { return d.isDirectory() })
  .map(function(d) { return d.name })
  .sort()

for (var fi = 0; fi < fixtures.length; fi++) {
  var fname = fixtures[fi]
  var fdir = fixture_dir + '/' + fname

  var source = readFileSync(fdir + '/source.dm', 'utf8')
  var options = existsSync(fdir + '/options.json')
    ? JSON.parse(readFileSync(fdir + '/options.json', 'utf8'))
    : {}

  var sl = D.seedlikes_from_string(source)
  var names = Object.keys(sl)

  // Every fixture must have all three output files
  if (!existsSync(fdir + '/extract.json')) test(fname + ': missing extract.json', 'MISSING', 'exists')
  if (!existsSync(fdir + '/layout.json')) test(fname + ': missing layout.json', 'MISSING', 'exists')
  if (!existsSync(fdir + '/render.txt')) test(fname + ': missing render.txt', 'MISSING', 'exists')

  // Check extract.json
  if (existsSync(fdir + '/extract.json')) {
    var expected_extract = readFileSync(fdir + '/extract.json', 'utf8')
    if (names.length === 1) {
      var actual_ext = normalize_extract(JSON.stringify(extract(names[0], sl[names[0]]), null, 2))
      test(fname + ': extract', actual_ext, normalize_extract(expected_extract))
    } else {
      var extracts = {}
      for (var ni = 0; ni < names.length; ni++)
        extracts[names[ni]] = extract(names[ni], sl[names[ni]])
      var actual_ext = normalize_extract(JSON.stringify(extracts, null, 2))
      test(fname + ': extract', actual_ext, normalize_extract(expected_extract))
    }
  }

  // Check layout.json
  if (existsSync(fdir + '/layout.json')) {
    var expected_layout = readFileSync(fdir + '/layout.json', 'utf8')
    if (names.length === 1) {
      var actual_layout = JSON.stringify(layout(extract(names[0], sl[names[0]]), options), null, 2)
      test(fname + ': layout', actual_layout, expected_layout)
    } else {
      var layouts = {}
      for (var ni = 0; ni < names.length; ni++)
        layouts[names[ni]] = layout(extract(names[ni], sl[names[ni]]), options)
      var actual_layout = JSON.stringify(layouts, null, 2)
      test(fname + ': layout', actual_layout, expected_layout)
    }
  }

  // Check render.txt
  if (existsSync(fdir + '/render.txt')) {
    var expected_render = readFileSync(fdir + '/render.txt', 'utf8')
    if (names.length === 1) {
      var actual_render = render_space(names[0], sl[names[0]], options)
      test(fname + ': render', actual_render, expected_render)
    } else {
      var actual_render = render_all(sl, options)
      test(fname + ': render', actual_render, expected_render)
    }
  }
}

// Normalize auto-generated station names (station-DIGITS) to sequential placeholders
// so extract comparisons are stable across runs with different Math.random() seeds.
function normalize_extract(json_str) {
  var seen = {}
  var counter = 0
  return json_str.replace(/station-\d+/g, function(match) {
    if (seen[match] === undefined) seen[match] = 'station-AUTO' + (counter++)
    return seen[match]
  })
}

// === Invariants: run check_invariants on EVERY fixture ===

for (var fi2 = 0; fi2 < fixtures.length; fi2++) {
  var inv_fname = fixtures[fi2]
  var inv_fdir = fixture_dir + '/' + inv_fname
  var inv_source = readFileSync(inv_fdir + '/source.dm', 'utf8')
  var inv_sl = D.seedlikes_from_string(inv_source)
  var inv_names = Object.keys(inv_sl)
  for (var ni = 0; ni < inv_names.length; ni++) {
    var inv_topo = extract(inv_names[ni], inv_sl[inv_names[ni]])
    try {
      layout(inv_topo, { check_invariants: true })
      test(inv_fname + '/' + inv_names[ni] + ': invariants', 'pass', 'pass')
    } catch(e) {
      test(inv_fname + '/' + inv_names[ni] + ': ' + e.message, 'FAIL', 'pass')
    }
  }
}

// Junction geometry: no raw '+' in output (uses junc fixture)
var sl_junc2 = D.seedlikes_from_string(readFileSync(fixture_dir + '/junc/source.dm', 'utf8'))
var r_junc = render(layout(extract('junc', sl_junc2.junc)))
test('junction: no raw + chars', r_junc.indexOf('+') < 0, true)
test('junction: crossing produces O', r_junc.indexOf('O') >= 0, true)

// === Round-trip: render.txt → parse → re-render ===
for (var fi3 = 0; fi3 < fixtures.length; fi3++) {
  var rt_fname = fixtures[fi3]
  var rt_fdir = fixture_dir + '/' + rt_fname
  var rt_options = existsSync(rt_fdir + '/options.json')
    ? JSON.parse(readFileSync(rt_fdir + '/options.json', 'utf8'))
    : {}

  if (!existsSync(rt_fdir + '/render.txt')) continue
  var rt_render = readFileSync(rt_fdir + '/render.txt', 'utf8')

  // Parse the render back to source.dm
  var rt_source = parse_ascii(rt_render, rt_options)

  // Feed through the pipeline: source.dm → seedlikes → extract → layout → render
  var rt_sl = D.seedlikes_from_string(rt_source)
  var rt_names = Object.keys(rt_sl)
  var rt_actual
  if (rt_names.length === 1)
    rt_actual = render_space(rt_names[0], rt_sl[rt_names[0]], rt_options)
  else
    rt_actual = render_all(rt_sl, rt_options)

  test(rt_fname + ': round-trip', rt_actual, rt_render)
}

// Report
console.log('space_ascii_test: ' + pass + '/' + (pass + fail) + ' passed')
if (failures.length) {
  failures.forEach(function(f) {
    console.log('FAIL: ' + f.label)
    console.log('  expected: ' + f.expected)
    console.log('  actual:   ' + f.actual)
  })
  process.exit(1)
}
