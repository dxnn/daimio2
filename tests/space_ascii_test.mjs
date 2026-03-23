import D from '../daimio/daimio.js'
import { extract, layout, render, render_space, render_all, topo_sort } from '../daimio/space_ascii.js'
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
test('chain layout: has hlines', laid_chain.elements.filter(function(e) { return e.type === 'hline' }).length >= 2, true)
test('chain layout: has left port', laid_chain.elements.some(function(e) { return e.type === 'port' && e.dir === 'left' }), true)
test('chain layout: has right port', laid_chain.elements.some(function(e) { return e.type === 'port' && e.dir === 'right' }), true)
test('chain layout: station has source', laid_chain.elements.some(function(e) { return e.type === 'station' && e.source }), true)
test('chain layout: width accommodates chain', laid_chain.width >= 40, true)
test('chain layout: height accommodates chain', laid_chain.height >= 8, true)

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
    ' _ myspace __',
    '|            |',
    '|____________|',
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

// === Render: vline element ===
var vline_layout = {
  id: 'v', name: 'v', width: 5, height: 5,
  elements: [
    { type: 'box', x: 0, y: 0, width: 5, height: 5 },
    { type: 'vline', x: 2, y: 1, length: 3 }
  ]
}
var r_vline = render(vline_layout)
test('vline: renders vertical bars', r_vline.split('\n').filter(function(l) { return l[2] === '|' }).length, 3)

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
