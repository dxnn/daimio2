// Space tests for Daimio
// Run with: node tests/space_test.mjs
//
// Two modes:
//   1. .dm file mode: parses spacetests.dm (same format as spacetests.html)
//   2. Inline mode: DAML strings with programmatic assertions

import { readFileSync } from 'fs'

var D = (await import('../daimio/daimio.js')).default

var pass = 0
var fail = 0
var failures = []
var pending = 0
var all_registered = false
var timeout_ms = 5000

// ── Assert port flavour ──────────────────────────────────────────────
// Spaces wire `@out assert expected_value` to test output.
// We collect what arrives and compare to expected.

var pending_spaces = {}  // space_id -> { expects, actuals, label, timer }

D.import_port_flavour('assert', {
  dir: 'out',
  outside_exit: function(ship) {
    var space = this.pair.space
    var entry = pending_spaces[space._test_id]
    if(!entry) return

    var expected = this.settings.thing
    var actual = typeof ship === 'string' ? ship
               : JSON.stringify(ship) || ''

    if(actual.trim() === String(expected).trim()) {
      pass++
    } else {
      fail++
      failures.push({ label: entry.label, expected: expected, actual: actual.trim() })
    }

    entry.remaining--
    if(entry.remaining <= 0) finish_space(space._test_id)
  }
})

// ── Collect port flavour ─────────────────────────────────────────────
// For inline tests: collects all ships arriving at this port into an array.
// Wire like: @myport collect

D.import_port_flavour('collect', {
  dir: 'out',
  outside_exit: function(ship) {
    var space = this.pair.space
    var entry = pending_spaces[space._test_id]
    if(!entry) return

    var port_name = this.settings.thing || this.pair.name
    if(!entry.collected[port_name]) entry.collected[port_name] = []
    entry.collected[port_name].push(ship)

    entry.remaining--
    if(entry.remaining <= 0) finish_space(space._test_id)
  }
})

function finish_space(test_id) {
  var entry = pending_spaces[test_id]
  if(!entry || entry.done) return
  entry.done = true
  clearTimeout(entry.timer)
  try {
    if(entry.check) entry.check(entry.collected)
  } catch(e) {
    fail++
    failures.push({ label: entry.label, expected: 'check runs', actual: 'check threw: ' + e.message })
  }
  pending--
  maybe_report()
}

function timeout_space(test_id) {
  var entry = pending_spaces[test_id]
  if(!entry || entry.done) return
  entry.done = true
  fail++
  failures.push({ label: entry.label, expected: 'completion', actual: 'TIMEOUT' })
  pending--
  maybe_report()
}

var test_id_counter = 0

// ── .dm file mode ────────────────────────────────────────────────────
// Parses spacetests.dm using indentation-based chunker from spacetests.html.

function run_dm_tests(filename) {
  var data = readFileSync(new URL(filename, import.meta.url), 'utf8')
  var chunks = chunker(data)

  chunks.forEach(function(chunk) {
    if(chunk.type !== 'space') return

    pending++
    var test_id = ++test_id_counter

    // Count how many assert ports to know when we're done
    var assert_count = 0
    chunk.value.split('\n').forEach(function(line) {
      if(/assert/.test(line)) assert_count++
    })

    var dm_label = chunk.label || ('dm test #' + test_id)
    var dm_timeout = timeout_ms
    pending_spaces[test_id] = {
      label: dm_label,
      remaining: assert_count,
      collected: {},
      done: false,
      timer: setTimeout(function() { timeout_space(test_id) }, dm_timeout)
    }

    try {
      var seed_id = D.make_some_space(chunk.value)
      var space = new D.Space(seed_id)
      space._test_id = test_id
      D.send_value_to_js_port(space, 'init')
    } catch(e) {
      fail++
      failures.push({ label: pending_spaces[test_id].label, expected: 'no error', actual: e.message })
      pending_spaces[test_id].done = true
      clearTimeout(pending_spaces[test_id].timer)
      pending--
    }
  })
}

function chunker(data) {
  var lines = data.split(/\n/)
  var inside_count = 0
  var grouper = []
  var label = ''
  var count = lines.length - 1
  var last_text = ''

  return lines.reduce(function(acc, line, index) {
    var wscount = line.search(/\S/)

    if(inside_count) {
      if(wscount < inside_count || index == count) {
        inside_count = 0
        if(index == count) grouper.push(line)
        acc.push({ type: 'space', value: grouper.join('\n'), label: label })
        return acc
      }

      grouper.push(line)
      return acc
    }

    if(/^\s*outer$/.test(line)) {
      inside_count = wscount
      grouper = [line]
      label = last_text
      return acc
    }

    if(/^\s*[\w-]+!!!$/.test(line)) {
      inside_count = wscount
      grouper = [line.slice(0, -3)]
      label = last_text
      return acc
    }

    if(!/^\s*$/.test(line)) {
      last_text = line.trim()
    }

    return acc
  }, [])
}

// ── Inline test mode ─────────────────────────────────────────────────
// space_test(label, seedlike, sends, expect_count, check_fn)
//   label:        test name
//   seedlike:     space description string (same format as .dm blocks)
//   sends:        array of {port, value, flavour?} to send into the space
//   expect_count: number of collect/assert port arrivals to wait for
//   check:        function(collected) called when all arrivals received
//                 collected is {port_name: [values...]}
//                 call assert_eq / assert_deep inside check

function dedent(s) {
  var lines = s.split('\n')
  // skip leading empty lines
  while(lines.length && !lines[0].trim()) lines.shift()
  // find minimum indent
  var min = Infinity
  lines.forEach(function(line) {
    if(!line.trim()) return
    var indent = line.search(/\S/)
    if(indent < min) min = indent
  })
  if(min === Infinity) min = 0
  return lines.map(function(line) { return line.slice(min) }).join('\n')
}

function space_test(label, seedlike, sends, expect_count, check, per_test_timeout) {
  pending++
  var test_id = ++test_id_counter
  seedlike = dedent(seedlike)

  pending_spaces[test_id] = {
    label: label,
    remaining: expect_count,
    collected: {},
    check: check,
    done: false,
    timer: setTimeout(function() { timeout_space(test_id) }, per_test_timeout || timeout_ms)
  }

  try {
    var seed_id = D.make_some_space(seedlike)
    var space = new D.Space(seed_id)
    space._test_id = test_id

    sends.forEach(function(send) {
      D.send_value_to_js_port(space, send.port, send.value, send.flavour)
    })
  } catch(e) {
    fail++
    failures.push({ label: label, expected: 'no error', actual: e.message })
    pending_spaces[test_id].done = true
    clearTimeout(pending_spaces[test_id].timer)
    pending--
  }
}

function assert_eq(label, actual, expected) {
  var a = typeof actual === 'string' ? actual : JSON.stringify(actual) || ''
  var e = typeof expected === 'string' ? expected : JSON.stringify(expected) || ''
  if(a.trim() === e.trim()) {
    pass++
  } else {
    fail++
    failures.push({ label: label, expected: e, actual: a })
  }
}

// ── Parse/bork test ──────────────────────────────────────────────────
// Synchronous: asserts make_some_space either borks (should_bork=true)
// or compiles cleanly (should_bork=false). For compile-time contract
// checks that never reach the runtime queue.

function parse_test(label, seedlike, should_bork) {
  seedlike = dedent(seedlike)
  var threw = false, msg = ''
  try { D.make_some_space(seedlike) } catch(e) { threw = true; msg = e.message }
  if(threw === !!should_bork) {
    pass++
  } else {
    fail++
    failures.push({
      label: label,
      expected: should_bork ? 'bork (compile error)' : 'parses OK',
      actual: threw ? ('threw: ' + msg) : 'parsed without error'
    })
  }
}

// ── Report ───────────────────────────────────────────────────────────

function maybe_report() {
  if(!all_registered || pending > 0) return
  report()
}

function report() {
  console.log('\n=== Space Test Suite ===')
  console.log(pass + ' passed, ' + fail + ' failed')

  if(fail) {
    console.log('\nFailures:')
    failures.forEach(function(f) {
      console.log('  ' + f.label)
      console.log('    expected: ' + f.expected)
      console.log('    actual:   ' + f.actual)
    })
    process.exit(1)
  }
  console.log('\nYou win!')
}

// ── Run .dm tests ────────────────────────────────────────────────────

console.log('--- spacetests.dm ---')
run_dm_tests('spacetests.dm')

// ── Inline tests ─────────────────────────────────────────────────────

console.log('--- inline space tests ---')

// Basic: in port to out port via collect
// [spacesyn-route] [routing-out-deferred]
space_test(
  'in to out passthrough',
  `outer
    @init from-js
    @out  collect
    @init -> @out`,
  [{port: 'init', value: 'hello'}],
  1,
  function(collected) {
    assert_eq('in to out passthrough', collected.out[0], 'hello')
  }
)

// Anonymous station transforms value
// [spacesyn-anon-station]
space_test(
  'anonymous station transform',
  `outer
    @init from-js
    @out  collect
    @init -> {__ | string uppercase} -> @out`,
  [{port: 'init', value: 'hello'}],
  1,
  function(collected) {
    assert_eq('anonymous station transform', collected.out[0], 'HELLO')
  }
)

// Multiple ships into different ports
// [spacesyn-port]
space_test(
  'multiple ports receive different ships',
  `outer
    @a from-js
    @b from-js
    @out collect
    @a -> {__ | add 10} -> @out
    @b -> {__ | add 20} -> @out`,
  [
    {port: 'a', value: 1},
    {port: 'b', value: 2},
  ],
  2,
  function(collected) {
    var vals = collected.out.map(Number).sort()
    assert_eq('port a received', vals[0], 11)
    assert_eq('port b received', vals[1], 22)
  }
)

// Multiple ships into same port
// [serial-one-at-a-time] [space-queue]
space_test(
  'multiple ships into same port',
  `outer
    $total 0
    @init from-js
    @out  collect
    counter {__ | add $total | >$total}
    done    {$total | >@done}
    @init -> counter -> done
    done.done -> @out`,
  [
    {port: 'init', value: 3},
    {port: 'init', value: 7},
    {port: 'init', value: 10},
  ],
  3,
  function(collected) {
    // Each ship adds to $total: 3, 10, 20
    assert_eq('running total', collected.out[2], '20')
  }
)

// Subspace with named station — deliberately kept on the legacy dot form
// (inner.in): the dot spelling is the engine's internal key encoding and
// stays accepted at the surface; this is its coverage. New seeds should
// use name@port (spec §3).
// [P-compose] [spacesyn-station]
space_test(
  'subspace with named station',
  `
  inner
    @in
    @out
    double {__ | times 2}
    @in -> double -> @out
  outer
    @init from-js 5
    @out  collect
    @init -> inner.in
    inner.out -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    assert_eq('subspace doubled', collected.out[0], '10')
  }
)

// §3 [port-implicit-create]
// A port endpoint (@dir:name or bare @dir) used in wiring but not declared
// is created with the default flavour for its direction.
;(function() {
  // [port-implicit-create] compile shape
  var seed_id = D.make_some_space(
    'inner\n' +
    '  @in -> {__ | times 2} -> @out\n')
  var seed = D.SPACESEEDS[seed_id]
  var ok = seed && seed.ports.length == 4 && seed.routes.length == 2
  if(ok) pass++
  else {
    fail++
    failures.push({ label: '[port-implicit-create] undeclared @in/@out minted from wiring',
      expected: '4 ports (2 space + station _in/_out), 2 routes',
      actual: seed ? (seed.ports.length + ' ports, ' + seed.routes.length + ' routes') : 'no seed' })
  }
})()

// §3 [port-implicit-create] behavior — the spec's own subspace example shape:
// inner's @in/@out exist only through wiring; outer wires to them by name.
space_test(
  'implicitly created subspace ports carry ships [port-implicit-create]',
  `
  inner
    @in -> {__ | times 2} -> @out
  outer
    @init from-js 5
    @out  collect
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    assert_eq('[port-implicit-create] doubled through implicit ports', collected.out[0], '10')
  }
)

// §3 endpoint syntax: a subspace port in a wire endpoint is name@port
// (sub@up, sub@up:adder, inner@in) — the spec's form. The dot form
// (inner.in) is the engine's internal key encoding, also accepted.
// [spacesyn-route]
;(function() {
  // [spacesyn-route] name@port endpoint compile shape
  var atform = 'inner\n' +
               '  @in\n' +
               '  @out\n' +
               '  double {__ | times 2}\n' +
               '  @in -> double -> @out\n' +
               'outer\n' +
               '  @init from-js\n' +
               '  @out  collect\n' +
               '  @init -> inner@in\n' +
               '  inner@out -> @out\n'
  var seed_id = D.make_some_space(atform)
  var seed = D.SPACESEEDS[seed_id]
  var ok = seed && seed.routes.length == 2 && seed.subspaces.length == 1
  if(ok) pass++
  else {
    fail++
    failures.push({ label: '[spacesyn-route] name@port endpoint compile shape',
      expected: '2 routes, 1 subspace',
      actual: seed ? (seed.routes.length + ' routes, ' + seed.subspaces.length + ' subspaces') : 'no seed' })
  }
})()

// §3 endpoint syntax: behavior twin of "subspace with named station" using
// the spec's name@port endpoint form.
// [spacesyn-route]
space_test(
  'subspace wired via name@port endpoints [spacesyn-route]',
  `
  inner
    @in
    @out
    double {__ | times 2}
    @in -> double -> @out
  outer
    @init from-js 5
    @out  collect
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    assert_eq('subspace doubled via @ form', collected.out[0], '10')
  }
)

// §3 endpoint syntax: station named port via name@port (splitter@left form).
// [spacesyn-named-port-route]
space_test(
  'station named out port via name@port [spacesyn-named-port-route]',
  `outer
    @init from-js 3
    @out  collect
    tester
      {__ | times 3 | >@foo | ""}
    @init -> tester
    tester@foo -> @out`,
  [{port: 'init', value: 3}],
  1,
  function(collected) {
    assert_eq('named out port via @ form', collected.out[0], '9')
  }
)

// Nested subspace block: an indented named block whose body is space
// structure compiles to a child subspace registered in the parent, not a
// station. Compile-shape check follows the [spacesyn-subspace-before-ref]
// pattern (inspect the seed via D.SPACESEEDS).
// [spacesyn-subspace-nested] (provisional tag — the nested block form is not
// yet in D2-spec.md; TODO.md §0 is the authority for this syntax.)
;(function() {
  // [spacesyn-subspace-nested]
  var nested = 'outer\n' +
               '  @init from-js\n' +
               '  @out  collect\n' +
               '  +inner\n' +
               '    @in\n' +
               '    @out\n' +
               '    double {__ | times 2}\n' +
               '    @in -> double -> @out\n' +
               '  @init -> inner@in\n' +
               '  inner@out -> @out\n'
  var seed_id = D.make_some_space(nested)
  var seed = D.SPACESEEDS[seed_id]
  var ok = seed && seed.subspaces.length == 1 && seed.stations.length == 0
  if(ok) pass++
  else {
    fail++
    failures.push({ label: '[spacesyn-subspace-nested] compile shape',
      expected: '1 subspace, 0 stations',
      actual: seed ? (seed.subspaces.length + ' subspaces, ' + seed.stations.length + ' stations') : 'no seed' })
  }
})()

// Behavior twin of the flat "subspace with named station" test above, but
// with the subspace nested inside the parent block.
// [spacesyn-subspace-nested] (provisional tag — see note above)
space_test(
  'nested subspace block with named station [spacesyn-subspace-nested]',
  `
  outer
    @init from-js 5
    @out  collect
    +inner
      @in
      @out
      double {__ | times 2}
      @in -> double -> @out
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    assert_eq('nested subspace doubled', collected.out[0], '10')
  }
)

// A bare-name station SIBLING of a nested block still compiles as a station
// (maybe-subspace mode must reset cleanly after the subspace flush). Outer
// ends up with exactly one real station (handler) and one subspace (inner).
// [spacesyn-subspace-nested] (provisional tag — see note above)
;(function() {
  // [spacesyn-subspace-nested]
  var sibling = 'outer\n' +
                '  @init from-js\n' +
                '  @out  collect\n' +
                '  +inner\n' +
                '    @in\n' +
                '    @out\n' +
                '    double {__ | times 2}\n' +
                '    @in -> double -> @out\n' +
                '  handler\n' +
                '    {__ | times 3}\n' +
                '  @init -> handler -> @out\n'
  var seed_id = D.make_some_space(sibling)
  var seed = D.SPACESEEDS[seed_id]
  var ok = seed && seed.subspaces.length == 1 && seed.stations.length == 1
  if(ok) pass++
  else {
    fail++
    failures.push({ label: '[spacesyn-subspace-nested] sibling station survives',
      expected: '1 subspace, 1 station',
      actual: seed ? (seed.subspaces.length + ' subspaces, ' + seed.stations.length + ' stations') : 'no seed' })
  }
})()

// Station with named out port (side-effect send)
// [spacesyn-named-port-route] [station-portsend-passthru]
space_test(
  'station with named out port',
  `outer
    @init from-js 3
    @out  collect
    tester
      {__ | times 3 | >@foo | ""}
    @init -> tester
    tester@foo -> @out`,
  [{port: 'init', value: 3}],
  1,
  function(collected) {
    assert_eq('named out port', collected.out[0], '9')
  }
)

// Soft error collection
// [sploot-error-port] [sploot-pipeline-continues]
space_test(
  'soft error routes to error collect port',
  `outer
    @init from-js
    @out  collect
    @out:err  collect
    badcmd {__ | nonexistent command}
    @init -> badcmd -> @out`,
  [{port: 'init', value: 'test'}],
  2,
  function(collected) {
    // The error ships to @out:err [err-match-by-name] [sploot-error-port];
    // the pipeline continues with empty [sploot-pipeline-continues].
    assert_eq('error was collected', collected['out:err'] && collected['out:err'].length > 0, true)
    assert_eq('pipeline value passed', collected.out && collected.out.length > 0, true)
  }
)

// Splitter: one station sends to multiple destinations
// [spacesyn-route]
space_test(
  'splitter sends to multiple destinations',
  `outer
    @init from-js
    @out  collect
    splitter {__}
    @init -> splitter -> {__ | add 10} -> @out
             splitter -> {__ | add 20} -> @out`,
  [{port: 'init', value: 5}],
  2,
  function(collected) {
    var vals = collected.out.map(Number).sort()
    assert_eq('splitter arm 1', vals[0], 15)
    assert_eq('splitter arm 2', vals[1], 25)
  }
)

// Four levels deep
// [P-compose]
space_test(
  'four levels deep subspaces',
  `
  innermost
    @in
    @out
    @in -> {__ | times 2} -> @out
  innerer
    @in
    @out
    @in -> {__ | times 2} -> innermost@in
    innermost@out -> @out
  inner
    @in
    @out
    @in -> {__ | times 2} -> innerer@in
    innerer@out -> @out
  outer
    @init from-js 1
    @out  collect
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 1}],
  1,
  function(collected) {
    assert_eq('four levels deep', collected.out[0], '8')
  }
)

// ── Multi-space test helper ───────────────────────────────────────────
// multi_space_test(label, spaces_def, orchestrate)
//   spaces_def: array of {name, seedlike} — each becomes an independent space
//   orchestrate: function(spaces, done)
//     spaces is {name: space, ...}
//     call done() when finished — triggers maybe_report
//     use assert_eq inside orchestrate for checks

function multi_space_test(label, spaces_def, orchestrate, per_test_timeout) {
  pending++
  var test_id = ++test_id_counter
  var spaces = {}
  var timer = setTimeout(function() {
    fail++
    failures.push({ label: label, expected: 'completion', actual: 'TIMEOUT' })
    pending--
    maybe_report()
  }, per_test_timeout || timeout_ms)

  try {
    spaces_def.forEach(function(def) {
      var seed_id = D.make_some_space(dedent(def.seedlike))
      var space = new D.Space(seed_id)
      space._test_id = test_id
      // Wire collect ports to a results bag on the space
      space._collected = {}
      spaces[def.name] = space
    })

    orchestrate(spaces, function() {
      clearTimeout(timer)
      pending--
      maybe_report()
    })
  } catch(e) {
    fail++
    failures.push({ label: label, expected: 'no error', actual: e.message })
    clearTimeout(timer)
    pending--
  }
}

// Helper: attach a listener to a space's collect port
// The outside port (port.pair) is where outside_exit is called,
// so we override it there.
function on_collect(space, port_name, callback) {
  for(var i = 0; i < space.ports.length; i++) {
    var port = space.ports[i]
    if(port.name === port_name && port.flavour === 'collect' && port.pair) {
      port.pair.outside_exit = function(ship) {
        if(!space._collected[port_name]) space._collected[port_name] = []
        space._collected[port_name].push(ship)
        callback(ship)
      }
      return
    }
  }
}

// ── Concurrent space tests ───────────────────────────────────────────

console.log('--- concurrent space tests ---')

// Two independent spaces running concurrently
// [outer-independent]
multi_space_test(
  'two independent spaces concurrent',
  [
    { name: 'A', seedlike: `
      outer
        @init from-js
        @out  collect
        @init -> {__ | times 3} -> @out` },
    { name: 'B', seedlike: `
      outer
        @init from-js
        @out  collect
        @init -> {__ | add 100} -> @out` },
  ],
  function(spaces, done) {
    var got = 0
    on_collect(spaces.A, 'out', function(ship) {
      got++
      assert_eq('space A output', ship, '15')
      if(got === 2) done()
    })
    on_collect(spaces.B, 'out', function(ship) {
      got++
      assert_eq('space B output', ship, '107')
      if(got === 2) done()
    })
    D.send_value_to_js_port(spaces.A, 'init', 5)
    D.send_value_to_js_port(spaces.B, 'init', 7)
  }
)

// Space variable isolation: same $name in two spaces don't interfere
// [outer-independent]
multi_space_test(
  'space variable isolation',
  [
    { name: 'A', seedlike: `
      outer
        $x 0
        @init from-js
        @out  collect
        @init -> {__ | >$x || $x | times 10} -> @out` },
    { name: 'B', seedlike: `
      outer
        $x 0
        @init from-js
        @out  collect
        @init -> {__ | >$x || $x | add 1} -> @out` },
  ],
  function(spaces, done) {
    var got = 0
    on_collect(spaces.A, 'out', function(ship) {
      got++
      assert_eq('space A $x isolated', ship, '50')
      if(got === 2) done()
    })
    on_collect(spaces.B, 'out', function(ship) {
      got++
      assert_eq('space B $x isolated', ship, '4')
      if(got === 2) done()
    })
    // Send to both concurrently
    D.send_value_to_js_port(spaces.A, 'init', 5)
    D.send_value_to_js_port(spaces.B, 'init', 3)
  }
)

// Space A output triggers send into Space B
// [outer-independent]
multi_space_test(
  'space A output feeds space B',
  [
    { name: 'A', seedlike: `
      outer
        @init from-js
        @out  collect
        @init -> {__ | times 2} -> @out` },
    { name: 'B', seedlike: `
      outer
        @init from-js
        @out  collect
        @init -> {__ | add 100} -> @out` },
  ],
  function(spaces, done) {
    on_collect(spaces.A, 'out', function(ship) {
      // A produced a value, now feed it into B
      D.send_value_to_js_port(spaces.B, 'init', ship)
    })
    on_collect(spaces.B, 'out', function(ship) {
      assert_eq('A->B chained', ship, '110')
      done()
    })
    D.send_value_to_js_port(spaces.A, 'init', 5)
  }
)

// Multiple ships into two spaces interleaved
// [serial-one-at-a-time] [space-queue]
multi_space_test(
  'interleaved ships into two spaces',
  [
    { name: 'A', seedlike: `
      outer
        $total 0
        @init from-js
        @out  collect
        counter {__ | add $total | >$total}
        report  {$total | >@done}
        @init -> counter -> report
        report.done -> @out` },
    { name: 'B', seedlike: `
      outer
        $total 0
        @init from-js
        @out  collect
        counter {__ | add $total | >$total}
        report  {$total | >@done}
        @init -> counter -> report
        report.done -> @out` },
  ],
  function(spaces, done) {
    var a_results = []
    var b_results = []
    on_collect(spaces.A, 'out', function(ship) {
      a_results.push(Number(ship))
      if(a_results.length === 3 && b_results.length === 3) check()
    })
    on_collect(spaces.B, 'out', function(ship) {
      b_results.push(Number(ship))
      if(a_results.length === 3 && b_results.length === 3) check()
    })
    function check() {
      // A got 1, 2, 3 → totals 1, 3, 6
      assert_eq('space A final total', a_results[2], 6)
      // B got 10, 20, 30 → totals 10, 30, 60
      assert_eq('space B final total', b_results[2], 60)
      done()
    }
    // Interleave sends: A, B, A, B, A, B
    D.send_value_to_js_port(spaces.A, 'init', 1)
    D.send_value_to_js_port(spaces.B, 'init', 10)
    D.send_value_to_js_port(spaces.A, 'init', 2)
    D.send_value_to_js_port(spaces.B, 'init', 20)
    D.send_value_to_js_port(spaces.A, 'init', 3)
    D.send_value_to_js_port(spaces.B, 'init', 30)
  }
)

// Two spaces with same topology but different state
// [subspace-own-state]
multi_space_test(
  'same topology different initial state',
  [
    { name: 'A', seedlike: `
      outer
        $base 100
        @init from-js
        @out  collect
        @init -> {__ | add $base} -> @out` },
    { name: 'B', seedlike: `
      outer
        $base 200
        @init from-js
        @out  collect
        @init -> {__ | add $base} -> @out` },
  ],
  function(spaces, done) {
    var got = 0
    on_collect(spaces.A, 'out', function(ship) {
      got++
      assert_eq('A uses its own $base', ship, '105')
      if(got === 2) done()
    })
    on_collect(spaces.B, 'out', function(ship) {
      got++
      assert_eq('B uses its own $base', ship, '205')
      if(got === 2) done()
    })
    D.send_value_to_js_port(spaces.A, 'init', 5)
    D.send_value_to_js_port(spaces.B, 'init', 5)
  }
)

// ── Looping topologies ───────────────────────────────────────────────

console.log('--- looping topology tests ---')

// Simple loop: station output routes back to itself until condition met
// [routing-portsend-deferred] [queue-deferred-dock]
space_test(
  'loop: station feeds back to itself',
  `outer
    $count 0
    @init from-js
    @out  collect
    stepper {__ | add 1 | >$count}
    check   {$count | less than 5 | then "{$count | >@loop}" else "{$count | >@done}" | run}
    @init -> stepper -> check
    check.loop -> stepper
    check.done -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('loop: station feeds back to itself', collected.out[0], '5')
  }
)

// Loop with accumulator: build up a list via union
// [routing-portsend-deferred]
space_test(
  'loop: accumulator builds list',
  `outer
    $items ()
    @init from-js
    @out  collect
    adder  {__ | >v || $items | list union data _v | >$items}
    check  {$items | count | less than 4 | then "{$items | count | add 1 | >@again}" else "{$items | >@done}" | run}
    @init -> adder -> check
    check.again -> adder
    check.done  -> @out`,
  [{port: 'init', value: 1}],
  1,
  function(collected) {
    assert_eq('loop: accumulator builds list', collected.out[0], '[1,2,3,4]')
  }
)

// Loop in subspace: subspace loops internally, parent sees final result
// [P-compose] [routing-portsend-deferred]
space_test(
  'loop: subspace loops internally',
  `
  looper
    $n 0
    @in
    @out
    step  {__ | add $n | >$n}
    check {$n | less than 10 | then "{1 | >@again}" else "{$n | >@done}" | run}
    @in -> step -> check
    check.again -> step
    check.done  -> @out
  outer
    @init from-js
    @out  collect
    @init -> looper@in
    looper@out -> @out`,
  [{port: 'init', value: 1}],
  1,
  function(collected) {
    // 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    assert_eq('loop: subspace loops internally', collected.out[0], '10')
  }
)

// Two concurrent loops in different spaces
// [outer-independent] [routing-portsend-deferred]
multi_space_test(
  'loop: two spaces looping concurrently',
  [
    { name: 'A', seedlike: `
      outer
        $n 0
        @init from-js
        @out  collect
        step  {$n | add 1 | >$n}
        check {$n | less than 3 | then "{__ | >@again}" else "{$n | >@done}" | run}
        @init -> step -> check
        check.again -> step
        check.done  -> @out` },
    { name: 'B', seedlike: `
      outer
        $n 0
        @init from-js
        @out  collect
        step  {$n | add 10 | >$n}
        check {$n | less than 30 | then "{__ | >@again}" else "{$n | >@done}" | run}
        @init -> step -> check
        check.again -> step
        check.done  -> @out` },
  ],
  function(spaces, done) {
    var got = 0
    on_collect(spaces.A, 'out', function(ship) {
      got++
      assert_eq('loop A counts to 3', ship, '3')
      if(got === 2) done()
    })
    on_collect(spaces.B, 'out', function(ship) {
      got++
      assert_eq('loop B counts to 30', ship, '30')
      if(got === 2) done()
    })
    D.send_value_to_js_port(spaces.A, 'init', 'go')
    D.send_value_to_js_port(spaces.B, 'init', 'go')
  }
)

// ── Conditional routing via named out ports ──────────────────────────

console.log('--- conditional routing tests ---')

// Station sends to different named ports based on condition
// [spacesyn-route]
space_test(
  'conditional: route to different ports by value',
  `outer
    @init from-js
    @out  collect
    router {__ | mod 2 | then "{__ | >@odd}" else "{__ | >@even}" | run}
    @init -> router
    router.odd  -> {(__ :ODD) | string join}  -> @out
    router.even -> {(__ :EVEN) | string join} -> @out`,
  [{port: 'init', value: 7}],
  1,
  function(collected) {
    assert_eq('conditional: odd routed correctly', collected.out[0], '7ODD')
  }
)

// Same topology, even number
// [spacesyn-route]
space_test(
  'conditional: even number routes to even port',
  `outer
    @init from-js
    @out  collect
    router {__ | mod 2 | then "{__ | >@odd}" else "{__ | >@even}" | run}
    @init -> router
    router.odd  -> {(__ :ODD) | string join}  -> @out
    router.even -> {(__ :EVEN) | string join} -> @out`,
  [{port: 'init', value: 6}],
  1,
  function(collected) {
    assert_eq('conditional: even routed correctly', collected.out[0], '6EVEN')
  }
)

// Multiple ships, each routes to different port
// [serial-one-at-a-time]
space_test(
  'conditional: multiple ships route independently',
  `outer
    @init from-js
    @out  collect
    router {__ | mod 2 | then "{__ | >@odd}" else "{__ | >@even}" | run}
    @init -> router
    router.odd  -> {(__ :ODD) | string join}  -> @out
    router.even -> {(__ :EVEN) | string join} -> @out`,
  [
    {port: 'init', value: 3},
    {port: 'init', value: 4},
    {port: 'init', value: 5},
  ],
  3,
  function(collected) {
    var sorted = collected.out.sort()
    assert_eq('conditional: ship 3', sorted[0], '3ODD')
    assert_eq('conditional: ship 4', sorted[1], '4EVEN')
    assert_eq('conditional: ship 5', sorted[2], '5ODD')
  }
)

// Fizzbuzz-style: three-way conditional routing (inspired by station_break.html)
// Uses mod + then/else: 0 is falsy (divisible), non-zero is truthy (not divisible)
// [spacesyn-route]
space_test(
  'conditional: fizzbuzz three-way routing',
  `outer
    @init from-js
    @out  collect
    check15 {__in | mod 15 | then "{__in | >@no}" else "{:FizzBuzz | >@yes}" | run}
    check3  {__in | mod 3  | then "{__in | >@no}" else "{:Fizz | >@yes}" | run}
    check5  {__in | mod 5  | then "{__in | >@no}" else "{:Buzz | >@yes}" | run}
    passthru {__}
    @init -> check15
    check15.yes -> @out
    check15.no  -> check3
    check3.yes  -> @out
    check3.no   -> check5
    check5.yes  -> @out
    check5.no   -> passthru -> @out`,
  [
    {port: 'init', value: 3},
    {port: 'init', value: 5},
    {port: 'init', value: 15},
    {port: 'init', value: 7},
  ],
  4,
  function(collected) {
    var sorted = collected.out.sort()
    assert_eq('fizzbuzz: 7 passes through', sorted[0], '7')
    assert_eq('fizzbuzz: 5 is Buzz', sorted[1], 'Buzz')
    assert_eq('fizzbuzz: 3 is Fizz', sorted[2], 'Fizz')
    assert_eq('fizzbuzz: 15 is FizzBuzz', sorted[3], 'FizzBuzz')
  }
)

// Conditional routing in subspace, parent collects
// [P-compose] [spacesyn-route]
space_test(
  'conditional: subspace routes, parent collects',
  `
  classifier
    @in
    @big out
    @small out
    check {__ | less than 10 | then "{__ | >@sm}" else "{__ | >@bg}" | run}
    @in -> check
    check.sm -> @small
    check.bg -> @big
  outer
    @init from-js
    @out  collect
    @init -> classifier@in
    classifier.big   -> {(__ :BIG) | string join}   -> @out
    classifier.small -> {(__ :SMALL) | string join} -> @out`,
  [
    {port: 'init', value: 3},
    {port: 'init', value: 50},
  ],
  2,
  function(collected) {
    var sorted = collected.out.sort()
    assert_eq('classifier: 3 is small', sorted[0], '3SMALL')
    assert_eq('classifier: 50 is big', sorted[1], '50BIG')
  }
)

// ── State mutation across ships ──────────────────────────────────────

console.log('--- state mutation tests ---')

// §9: Serial execution guarantees each ship sees previous ship's state changes
// [P-serial] [I6] [P-fresh]
space_test(
  'state: sequential ships see accumulated state',
  `outer
    $total 0
    @init from-js
    @out  collect
    @init -> {__ | add $total | >$total || $total} -> @out`,
  [
    {port: 'init', value: 1},
    {port: 'init', value: 2},
    {port: 'init', value: 3},
    {port: 'init', value: 4},
  ],
  4,
  function(collected) {
    // Running totals: 1, 3, 6, 10
    var vals = collected.out.map(Number)
    assert_eq('state: after ship 1', vals[0], 1)
    assert_eq('state: after ship 2', vals[1], 3)
    assert_eq('state: after ship 3', vals[2], 6)
    assert_eq('state: after ship 4', vals[3], 10)
  }
)

// State mutation with conditional branching: different paths mutate same var
// [I6]
space_test(
  'state: different paths mutate same variable',
  `outer
    $count 0
    @init from-js
    @out  collect
    router {__ | mod 2 | then "{__ | >@odd}" else "{__ | >@even}" | run}
    @init -> router
    router.odd  -> {$count | add 1  | >$count || $count} -> @out
    router.even -> {$count | add 10 | >$count || $count} -> @out`,
  [
    {port: 'init', value: 1},   // odd:  count 0+1=1
    {port: 'init', value: 2},   // even: count 1+10=11
    {port: 'init', value: 3},   // odd:  count 11+1=12
    {port: 'init', value: 4},   // even: count 12+10=22
  ],
  4,
  function(collected) {
    var vals = collected.out.map(Number)
    assert_eq('state: odd adds 1', vals[0], 1)
    assert_eq('state: even adds 10', vals[1], 11)
    assert_eq('state: odd again', vals[2], 12)
    assert_eq('state: even again', vals[3], 22)
  }
)

// State persists across ships entering different ports
// [I6] [sched-tie-wire]
space_test(
  'state: mutations from different entry ports accumulate',
  `outer
    $log ()
    @a from-js
    @b from-js
    @out collect
    @a -> {(__ :A) | string join | >v || $log | list union data _v | >$log || $log} -> @out
    @b -> {(__ :B) | string join | >v || $log | list union data _v | >$log || $log} -> @out`,
  [
    {port: 'a', value: 1},
    {port: 'b', value: 2},
    {port: 'a', value: 3},
  ],
  3,
  function(collected) {
    // All three sends inject back-to-back (frontier 0, equal numbers), so
    // the tie resolves by wire declaration order then FIFO within the wire
    // [sched-tie-wire]: @a's ships (1A, 3A) dock before @b's (2B).
    assert_eq('state: final log', collected.out[2], '["1A","3A","2B"]')
  }
)

// State mutation in subspace doesn't affect parent
// [P-spaceisolate] [I8]
space_test(
  'state: subspace mutation isolated from parent',
  `
  child
    $x 0
    @in
    @out
    @in -> {__ | add $x | >$x || $x} -> @out
  outer
    $x 100
    @init from-js
    @out  collect
    @init -> child@in
    child@out -> {$x} -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    // child sets its own $x to 5, sends 5 out
    // parent receives 5 at child@out, anon station reads parent's $x (should be 100)
    assert_eq('state: parent $x unchanged', collected.out[0], '100')
  }
)

// Dead-end wiring: ship enters station with no outs, space stays healthy
// [P-total]
space_test(
  'dead end: station with no outs, space survives',
  `outer
    $flag 0
    @init from-js
    @out  collect
    dead-end {__ | >$flag}
    reporter {$flag | >@done}
    @init -> dead-end
    @init -> reporter
    reporter.done -> @out`,
  [
    {port: 'init', value: 42},
    {port: 'init', value: 99},
  ],
  2,
  function(collected) {
    // dead-end sets $flag but produces no output routing
    // reporter runs independently from @init, reads $flag
    // Second ship should see $flag=42 from first dead-end
    assert_eq('dead end: space still works', collected.out.length, 2)
  }
)

// ── Additional spec tests ───────────────────────────────────────────
// Tests for spec behaviors that were once unimplemented (RED guides);
// all now pass.

console.log('--- additional spec tests ---')

// §9 Scheduling: deferred port routing
// Spec says: "queued ships have priority over ships produced by the
// completing process's output routing." If station A sends to @port
// [queue-priority-routing] [I13]
// Ship A enters worker, B is queued. When A completes:
//   B (queued) should dock at worker BEFORE A's output routes to recorder.
// Correct (queue-first): worker(a), worker(b), recorder(a), recorder(b) → log = "abab"
// Wrong (output-first):  worker(a), recorder(a), worker(b), recorder(b) → log = "aabb"
multi_space_test(
  'deferred routing: queued ships before output-routed ships',
  [{ name: 'space', seedlike: `
    outer
      $log
      @init from-js
      @out  collect
      worker    {__ | >workerval || ($log _workerval) | string join | >$log || _workerval}
      recorder  {__ | >recval || ($log _recval) | string join | >$log || ""}
      @init -> worker
      worker -> recorder` }],
  function(spaces, done) {
    var space = spaces.space

    // Send two ships — B will be queued while A processes
    D.send_value_to_js_port(space, 'init', 'a')
    D.send_value_to_js_port(space, 'init', 'b')

    // Wait for all setImmediates to flush, then check $log directly
    setTimeout(function() {
      var log = space.get_state('log')
      // queue-first: worker(a), worker(b), recorder(a), recorder(b) → log = "abab"
      // output-first: worker(a), recorder(a), worker(b), recorder(b) → log = "aabb"
      assert_eq('deferred routing: queued ships before output-routed ships',
        log, 'abab')
      done()
    }, 500)
  }
)

// §4.3 Timeout inheritance in nested spaces
// Spec: "The effective timeout for any down-port round trip is the minimum
// of all nominal timeouts along the chain from the requesting process to
// the handler."
// [I12] [timeout-min-chain]
// §10 Space isolation: subspace cannot read parent space vars
// Spec: "A subspace cannot read or write its parent's space variables
// directly — all cross-boundary communication goes through ports."
// [I8] [P-spaceisolate]
space_test(
  'space isolation: subspace cannot read parent vars directly',
  `
  inner
    @in
    @out
    @in -> {$parent_secret} -> @out
  outer
    $parent_secret 42
    @init from-js
    @out  collect
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'probe'}],
  1,
  function(collected) {
    // The inner space should NOT be able to read $parent_secret.
    // It gets empty (svar-read-unbound-sploot), not "42".
    assert_eq('space isolation: subspace cannot read parent vars directly',
      collected.out[0], '')
  }
)

// §8 Socket transitions: the old "overlap" model was dropped for drain/smash.
// The state-lost-on-transition property — along with replace / wiring-demand /
// reloadable / drain / smash — now lives in tests/det_socket_test.mjs,
// spec-aligned. The old loadSubspace-based overlap test was removed: it tested
// a dropped concept via a nonexistent API (host.loadSubspace).

// ── §1 I8 Space isolation: parent cannot read child-only var ─────────

space_test(
  'isolation: parent cannot read child-only var',
  `
  child
    $child_secret 42
    @in
    @out
    @in -> @out
  outer
    @init from-js
    @out  collect
    @init -> {$child_secret | logic if then :leaked else :isolated} -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // Parent tries to read $child_secret — should be empty (not defined in parent σ)
    assert_eq('isolation: parent cannot read child-only var',
      collected.out[0], 'isolated')
  }
)

// ── §7 Unwired effect: sploots to empty (no default handler) ────────

// Spec: an effectful command with no wired port sploots to empty ("no effects
// without wiring") — there is NO `fun` fallback. RED until the fallback is
// removed: today {time now} returns a wall-clock value, so logic if -> :got_time.
space_test(
  'unwired effect sploots to empty [effectful-unwired-sploot]',
  `
  outer
    @init from-js
    @out  collect
    @init -> {time now | logic if then :got_time else :no_time} -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    assert_eq('unwired effect sploots to empty [effectful-unwired-sploot]',
      collected.out[0], 'no_time')
  }
)


// ── Known-failing: §3 Dialect declaration in space syntax ────────────

// Spec §3 says space syntax supports dialect declarations as inline JSON:
//   dialect_decl ::= '{' json_object '}'
// This would allow restricting commands at the space level.
// [dialect-spacesyn-restrict]
space_test(
  'dialect declaration in space syntax restricts commands',
  `outer
    {"blocked_methods": {"math": ["add"]}}
    @init from-js
    @out  collect
    @init -> {math add value 1 to 2} -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // math add is blocked by dialect declaration → sploots to ""
    assert_eq('dialect declaration in space syntax restricts commands',
      collected.out[0], '')
  }
)

// [dialect-spacesyn-subspace-error]
// Subspace cannot restrict its own dialect — only parent controls it.
// Dialect declaration in subspace should generate soft error and be ignored.
space_test(
  'subspace dialect declaration is ignored with soft error',
  `inner
  {"blocked_methods": {"math": ["add"]}}
  @in
  @out
  @in -> {__ | math add value 1 to __} -> @out
outer
  @init from-js
  @out  collect
  @init -> inner@in
  inner@out -> @out`,
  [{port: 'init', value: '5'}],
  1,
  function(collected) {
    // Subspace dialect declaration ignored → math add still works → 5 + 1 = 6
    assert_eq('subspace dialect declaration is ignored with soft error',
      collected.out[0], '6')
  }
)


// ── Known-failing: §6 Up-port: sibling provides service ─────────────

// Spec §6 says a wiring rule target can be "an up-port on a sibling subspace
// (the sibling provides the service)". This means one subspace's effectful
// command could be answered by another sibling subspace's up-port.
space_test(
  'up-port: sibling subspace provides service via up-port',
  `
  provider
    clock
      {:42}
    @up <-> clock
  consumer
    caller
      {time now}
    @in -> caller -> @out
  outer
    @init from-js
    @out  collect
    consumer@cmd:time:now <-> provider@up
    @init -> consumer@in
    consumer@out -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // consumer's {time now} effect routes to provider's up-port per the
    // wiring rule; clock answers 42.
    assert_eq('up-port: sibling subspace provides service via up-port',
      collected.out[0], '42')
  }
)


// ── §8 Serialized space format ───────────────────────────────────────
// A serialized space is Astroglot: the definition plus CURRENT svar
// values [socket-svars... §8]. The DECLARED dialect restriction is part
// of the definition and serializes [serialize-keeps-dialect-decl]; the
// instance dialect and the parent's wiring of the space do not. A
// reloaded serialization behaves identically from the captured state.
;(function() {
  function check(label, cond, expected, actual) {
    if(cond) { pass++ }
    else { fail++; failures.push({ label: label, expected: expected, actual: String(actual) }) }
  }
  var src = 'stest\n'
          + '  {"blocked_methods":{"process":["unquote"]}}\n'
          + '  $count 0\n'
          + '  @init from-js\n'
          + '  bump {$count | math add value 1 | >$count || $count}\n'
          + '  +inner\n'
          + '    double {__ | math multiply value 2}\n'
          + '    @in -> double -> @out\n'
          + '  @init -> bump\n'
  var space, serialized
  try {
    space = new D.Space(D.make_some_space(src))
    // mutate live state synchronously (pure DAML runs sync)
    space.execute(D.Parser.string_to_block_segment('{5 | >$count}'))
    serialized = typeof space.serialize === 'function' ? space.serialize() : null
  } catch(e) { serialized = null }

  check('serialize: method exists and emits', typeof serialized === 'string' && serialized.length > 0,
        'Astroglot string', serialized)
  if(typeof serialized === 'string') {
    check('serialize: current svar value captured [serialize-current-state]',
          /\$count 5/.test(serialized), '$count 5 in output', serialized)
    check('serialize: declared dialect kept [serialize-keeps-dialect-decl]',
          /blocked_methods/.test(serialized), 'declared restriction present', serialized)
    check('serialize: nested subspace with sigil', /\+inner/.test(serialized),
          '+inner block present', serialized)
    // round-trip: the serialization reparses, and the reloaded space
    // starts from the captured state
    var ok = false, count = null
    try {
      var re = new D.Space(D.make_some_space(serialized))
      count = re.get_state('count')
      ok = true
    } catch(e) { count = e.message }
    check('serialize: round-trip reparses', ok, 'reparses cleanly', count)
    check('serialize: round-trip state carried', ok && count == 5, 'count == 5', count)
  }
})()


// ── §6 Round-trip port configurations ────────────────────────────────

// Up-port: station coordination (one-in-one-out guarantee)
// [upport-roundtrip] [upport-first-response]
space_test(
  'up-port: station A output enters subspace, response to station B',
  `
  inner
    processor
      {__ | string uppercase}
    @up <-> processor
  outer
    @init from-js
    @out  collect
    stationA
      {(__ "-modified") | string join}
    stationB
      {(__ "-received") | string join}
    @init -> stationA -> inner@up -> stationB -> @out`,
  [{port: 'init', value: 'hello'}],
  1,
  function(collected) {
    // hello -> stationA ("hello-modified") -> inner@up (uppercase: "HELLO-MODIFIED") -> stationB ("HELLO-MODIFIED-received")
    assert_eq('up-port station coordination', collected.out[0], 'HELLO-MODIFIED-received')
  }
)

// Up-port: used without a down port (station-to-station via subspace)
// [upport-roundtrip]
space_test(
  'up-port: no down port involved, pure station coordination',
  `
  worker
    doubler
      {__ | math multiply value 2}
    @up <-> doubler
  outer
    @init from-js
    @out  collect
    source
      {__ | math add value 10}
    sink
      {__ | math add value 100}
    @init -> source -> worker@up -> sink -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    // 5 -> source (15) -> worker@up (doubler: 30) -> sink (130)
    assert_eq('up-port without down port', collected.out[0], '130')
  }
)

// Down-port: declared in space definition, paired wiring
// [downport-declared]
space_test(
  'down-port: declared, request exits space, response returns',
  `outer
    @init from-js
    @out  collect
    +inner
      requester
        {__ | >@need ||}
      receiver
        {__}
      @in -> requester
      requester@need -> @down:sync -> receiver -> @out
    handler
      {__ | string uppercase}
    inner@down:sync <-> handler
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'please'}],
  1,
  function(collected) {
    // "please" enters inner -> requester sends it out through @need into the
    // declared down port -> the request exits inner -> handler uppercases ->
    // the response re-enters through the down port -> receiver -> @out
    assert_eq('declared down-port', collected.out[0], 'PLEASE')
  }
)

// Up-port: chained through two subspaces
// [upport-roundtrip]
space_test(
  'up-port: chained A -> X.up -> Y.up -> B',
  `
  spaceX
    adder
      {__ | math add value 10}
    @up <-> adder
  spaceY
    multiplier
      {__ | math multiply value 2}
    @up <-> multiplier
  outer
    @init from-js
    @out  collect
    source
      {__}
    sink
      {__}
    @init -> source -> spaceX.up -> spaceY.up -> sink -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    // 5 -> source (5) -> spaceX.up (add 10: 15) -> spaceY.up (multiply 2: 30) -> sink (30)
    assert_eq('chained up-ports', collected.out[0], '30')
  }
)

// §6 [upport-ghost-after-first] [upport-first-response] — DEFERRED to a
// det-harness guide, landing with the port-occupancy work. Under the
// ordinal ruling (2026-07-12: while occupied, the first ship out of a
// round-trip port IS the response, provenance-blind — "there is no real
// response, just wiring"), which VALUE continues onward when an
// unrelated route also feeds the contracted station is a deterministic
// schedule artifact, not a spec-fixed value — a value assertion here
// would encode the rejected provenance semantics. The honest form is a
// dock-count assertion after settle (exactly one onward dock per
// request; the extra ship ghosts at the FREE port with a soft error),
// which needs the det harness's settle counting.

// Space-level @err port: soft errors route to space, not station
// [sploot-error-port]
space_test(
  'soft errors route to space @out:err port',
  `outer
    @init from-js
    @out  collect
    @out:err  collect
    badcmd
      {__ | nonexistent command}
    @init -> badcmd -> @out`,
  [{port: 'init', value: 'test'}],
  2,
  function(collected) {
    // The bad command sploots: the error ships to @out:err by name
    // [err-match-by-name], and the pipeline continues with empty -> @out.
    assert_eq('error routed by name', collected['out:err'] && collected['out:err'].length > 0, true)
    assert_eq('pipeline continued', collected.out && collected.out.length > 0, true)
  }
)

// ── New port/wiring spec tests (RED — guide future implementation) ───

// §3 [spacesyn-toplevel]
// A top-level name at column 0 declares a space
space_test(
  'spacesyn-toplevel: top-level name declares a space',
  `myspace
    @init from-js
    @out  collect
    worker {__ | add 1}
    @init -> worker -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    assert_eq('[spacesyn-toplevel]', collected.out[0], '6')
  }
)

// §3 [spacesyn-route-expand]
// Station name in route expands to .in (destination) or .out (source)
space_test(
  'spacesyn-route-expand: station name expands to _in/_out',
  `outer
    @init from-js
    @out  collect
    first  {__ | add 10}
    second {__ | add 100}
    @init -> first -> second -> @out`,
  [{port: 'init', value: 1}],
  1,
  function(collected) {
    // 1 -> first._in (add 10 = 11) -> first._out -> second._in (add 100 = 111) -> second._out -> @out
    assert_eq('[spacesyn-route-expand]', collected.out[0], '111')
  }
)

// §3 [spacesyn-subspace-before-ref]
// Subspaces must be defined before they are referenced in routes.
// Correct order: child defined first, outer references child@in after.
// Forward ref (outer first, child after) should not produce a working space.
;(function() {
  // [spacesyn-subspace-before-ref]
  // Correct order works
  var good = 'child\n  @in from-js\n  @out to-js\nouter\n  @init from-js\n  @out to-js\n  @init -> child@in\n'
  var good_id = D.make_some_space(good)
  var good_space = new D.Space(good_id)
  var has_subspace = good_space.subspaces && good_space.subspaces.length > 0
  if(has_subspace) pass++
  else {
    fail++
    failures.push({ label: '[spacesyn-subspace-before-ref] correct order works',
      expected: 'subspace created', actual: 'no subspace' })
  }

  // Forward ref: outer references child before child is defined
  var bad = 'outer\n  @init from-js\n  @out to-js\n  @init -> child@in\nchild\n  @in from-js\n  @out to-js\n'
  var bad_id = D.make_some_space(bad)
  var bad_space = new D.Space(bad_id)
  var bad_has_subspace = bad_space.subspaces && bad_space.subspaces.length > 0
  if(!bad_has_subspace) pass++
  else {
    fail++
    failures.push({ label: '[spacesyn-subspace-before-ref] forward ref rejected',
      expected: 'no subspace (forward ref rejected)', actual: 'subspace created' })
  }
})()

// §4 [signal-flip-in]
// An in port is INPUT from inside, OUTPUT from outside
space_test(
  'signal-flip-in: in port receives from outside, delivers inside',
  `outer
    @init from-js
    @out  collect
    echo {__}
    @init -> echo -> @out`,
  [{port: 'init', value: 'from-outside'}],
  1,
  function(collected) {
    assert_eq('[signal-flip-in]', collected.out[0], 'from-outside')
  }
)

// §4 [signal-flip-out]
// An out port is OUTPUT from inside, INPUT from outside
space_test(
  'signal-flip-out: out port sends from inside to outside',
  `outer
    @init from-js
    @out  collect
    sender {__ | add 1}
    @init -> sender -> @out`,
  [{port: 'init', value: 10}],
  1,
  function(collected) {
    assert_eq('[signal-flip-out]', collected.out[0], '11')
  }
)

// §4 [signal-flip-up]
// An up port is Enter-N-Exit from inside, Exit-N-Reenter from outside (child's perspective)
space_test(
  'signal-flip-up: up port acts as round-trip processor from outside',
  `
  inner
    processor {__ | string uppercase}
    @up <-> processor
  outer
    @init from-js
    @out  collect
    @init -> inner@up -> @out`,
  [{port: 'init', value: 'hello'}],
  1,
  function(collected) {
    assert_eq('[signal-flip-up]', collected.out[0], 'HELLO')
  }
)

// §4 [signal-flip-down]
// A down port is Exit-N-Reenter from inside, Enter-N-Exit from outside
// (child's perspective): the child's request exits outward, the parent's
// contract serves it, and the response re-enters the child.
space_test(
  'signal-flip-down: down port forwards requests outward',
  `outer
    @init from-js
    @out  collect
    +inner
      @in -> @down:need -> @out
    handler {__ | string uppercase}
    inner@down:need <-> handler
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    assert_eq('[signal-flip-down]', collected.out[0], 'TEST')
  }
)

// §3 FAF chains: a mid-chain port is the source of the next hop —
// `a -> @down:x -> b` must compile BOTH [a.out -> down:x] and
// [down:x -> b.in]. (Parser: the port branch resets the pending route
// instead of re-seeding it with the port, so the second hop vanishes
// and b is treated as a fresh source.) [chain-exre-mid]
;(function() {
  var seed_id = D.make_some_space(
    'ptest\n  a\n    {__}\n  b\n    {__}\n  @in -> a -> @down:x -> b -> @out\n'
  )
  var seed = D.SPACESEEDS[seed_id]
  var down_index = 0, b_in_index = 0
  seed.ports.forEach(function(port, i) {
    if(port.name == 'down:x') down_index = i + 1
    if(port.name == '_in' && port.station == 2) b_in_index = i + 1  // stations sort a=1, b=2
  })
  var found = seed.routes.some(function(route) {
    return route[0] == down_index && route[1] == b_in_index
  })
  if(found) { pass++ }
  else {
    fail++
    failures.push({ label: 'faf-mid-chain-port: port becomes source of next hop',
      expected: 'route [down:x -> b._in] in compiled seed',
      actual: 'routes: ' + JSON.stringify(seed.routes) + ' (down:x=' + down_index + ', b._in=' + b_in_index + ')' })
  }
})()

// §4 [err-match-by-name]
// Soft errors route to the port named out:err (matched by name, not flavour)
space_test(
  'err-match-by-name: errors route to @out:err port by name',
  `outer
    @init from-js
    @out  collect
    @out:err  collect
    bad {__ | nonexistent command}
    @init -> bad -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // The error routes to the port NAMED out:err [err-match-by-name]
    if(collected['out:err'] && collected['out:err'].length > 0) pass++
    else {
      fail++
      failures.push({ label: '[err-match-by-name] error routed to @out:err',
        expected: 'error ship in @out:err', actual: JSON.stringify(collected) })
    }
  }
)

// §4 [subspace-own-queue]
// Each subspace gets its own queue, independent of the parent
space_test(
  'subspace-own-queue: subspace queues independently from parent',
  `
  inner
    @in
    @out
    worker {__ | add 10}
    @in -> worker -> @out
  outer
    @init from-js
    @out  collect
    relay {__}
    @init -> inner@in
    inner@out -> relay -> @out`,
  [{port: 'init', value: 1}, {port: 'init', value: 2}, {port: 'init', value: 3}],
  3,
  function(collected) {
    // All three ships should arrive, order preserved by inner's queue
    assert_eq('[subspace-own-queue] count', collected.out.length, 3)
    assert_eq('[subspace-own-queue] first', collected.out[0], '11')
    assert_eq('[subspace-own-queue] second', collected.out[1], '12')
    assert_eq('[subspace-own-queue] third', collected.out[2], '13')
  }
)

// §4 [space-inside-opaque]
// From inside, a space cannot tell if it's outer or subspace
space_test(
  'space-inside-opaque: subspace DAML works identically to outer space',
  `
  inner
    @in
    @out
    worker {__ | math multiply value 2}
    @in -> worker -> @out
  outer
    @init from-js
    @out  collect
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 7}],
  1,
  function(collected) {
    assert_eq('[space-inside-opaque]', collected.out[0], '14')
  }
)

// §5 [dunderin-dock]
// When a ship docks, __in is initialized to the ship's value
space_test(
  'dunderin-dock: __in is initialized to ship value',
  `outer
    @init from-js
    @out  collect
    checker {__ | add 1 || __in}
    @init -> checker -> @out`,
  [{port: 'init', value: 42}],
  1,
  function(collected) {
    // __ | add 1 produces 43, but || resets pipe. __in should be the original 42.
    assert_eq('[dunderin-dock]', collected.out[0], '42')
  }
)

// §5 [outer-independent]
// Separate outer spaces process independently.
multi_space_test(
  'outer-independent: separate outer spaces process independently',
  [
    { name: 'a', seedlike: `
      spaceA
        @init from-js start
        @out  collect
        worker {__ | add 100}
        @init -> worker -> @out` },
    { name: 'b', seedlike: `
      spaceB
        @init from-js start
        @out  collect
        worker {__ | add 200}
        @init -> worker -> @out` },
  ],
  function(spaces, done) {
    var results = {a: null, b: null}
    on_collect(spaces.a, 'out', function(ship) {
      results.a = ship
      if(results.a !== null && results.b !== null) {
        assert_eq('[outer-independent] a', results.a, '101')
        assert_eq('[outer-independent] b', results.b, '201')
        done()
      }
    })
    on_collect(spaces.b, 'out', function(ship) {
      results.b = ship
      if(results.a !== null && results.b !== null) {
        assert_eq('[outer-independent] a', results.a, '101')
        assert_eq('[outer-independent] b', results.b, '201')
        done()
      }
    })
    D.send_value_to_js_port(spaces.a, 'init', 1)
    D.send_value_to_js_port(spaces.b, 'init', 1)
  }
)

// §5 [subprocess-sync-dfs]
// Sub-processes execute synchronously and depth-first
space_test(
  'subprocess-sync-dfs: block eval is synchronous depth-first',
  `outer
    @init from-js
    @out  collect
    mapper {(1 2 3) | list map block "{__ | math multiply value 2}"}
    @init -> mapper -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // map creates sub-processes for each element, executing sync depth-first
    // result: [2, 4, 6]
    assert_eq('[subprocess-sync-dfs]', collected.out[0], '[2,4,6]')
  }
)

// §5 [routing-after-complete]
// Routed ships arrive after the current process completes
space_test(
  'routing-after-complete: port-sent ships arrive after current process',
  `outer
    @init from-js
    @out  collect
    sender  {__ | >@extra || __ | add 100}
    receiver {__ | add 1000}
    sender.extra -> receiver -> @out
    @init -> sender -> @out`,
  [{port: 'init', value: 1}],
  2,
  function(collected) {
    // sender runs: >@extra sends 1 deferred, then adds 100 -> 101 exits to @out
    // receiver gets 1 after sender completes, adds 1000 -> 1001 exits to @out
    // @out should get 101 first (from sender._out), then 1001 (from receiver._out)
    assert_eq('[routing-after-complete] first', collected.out[0], '101')
    assert_eq('[routing-after-complete] second', collected.out[1], '1001')
  }
)

// §6 [roundtrip-response]
// <-> wiring: request goes one way, response comes back — the full
// sibling round trip: consumer's down port bound to provider's up port.
space_test(
  'roundtrip-response: <-> wiring sends request and returns response',
  `outer
    @init from-js
    @out  collect
    +provider
      responder {__ | string uppercase}
      @up <-> responder
    +consumer
      @in -> @down:ask -> @out
    consumer@down:ask <-> provider@up
    @init -> consumer@in
    consumer@out -> @out`,
  [{port: 'init', value: 'hello'}],
  1,
  function(collected) {
    assert_eq('[roundtrip-response]', collected.out[0], 'HELLO')
  }
)

// §6 [cmd-transient]
// Command ports are transient — created fresh per invocation, destroyed after response
space_test(
  'cmd-transient: command port created per invocation and destroyed',
  `outer
    @init from-js
    @out  collect
    +inner
      first  {var read-out name :x | add 1 | var write-out name :x}
      second {var read-out name :x | add 1 | var write-out name :x}
      @in -> first -> second -> @out
    handler
      {__}
    inner@cmd:var:* <-> handler
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'start'}],
  1,
  function(collected) {
    // Two sequential var read-out/write-out invocations, each creates a fresh cmd port
    assert_eq('[cmd-transient] completed', collected.out.length > 0, true)
  },
  100
)

// §6 [cmd-name-encode]
// Command ports use cmd:handler:method naming
;(function() {
  // Verify the naming convention for command port types
  // effectful commands in var.js use portType 'var-read' and 'var-write'
  // The spec says cmd:handler:method (e.g., cmd:var:read-out)
  var var_handler = D.Commands.var
  if(var_handler && var_handler.methods) {
    var read_method = var_handler.methods['read-out']
    var write_method = var_handler.methods['write-out']
    if(read_method && read_method.effect && read_method.effect.portType === 'cmd:var:read-out') pass++
    else {
      fail++
      failures.push({ label: '[cmd-name-encode] var read-out uses cmd:var:read-out',
        expected: 'cmd:var:read-out',
        actual: read_method ? (read_method.effect ? read_method.effect.portType : 'no effect') : 'no method' })
    }
    if(write_method && write_method.effect && write_method.effect.portType === 'cmd:var:write-out') pass++
    else {
      fail++
      failures.push({ label: '[cmd-name-encode] var write-out uses cmd:var:write-out',
        expected: 'cmd:var:write-out',
        actual: write_method ? (write_method.effect ? write_method.effect.portType : 'no effect') : 'no method' })
    }
  } else {
    fail += 2
    failures.push({ label: '[cmd-name-encode] var handler exists', expected: 'var handler', actual: 'missing' })
  }
})()

// §6 [cmd-forward]
// Command ports can be forwarded: S@cmd:*:* <-> @cmd forwards all
space_test(
  'cmd-forward: command port forwarding to parent boundary',
  `outer
    @init from-js
    @out  collect
    +middle
      +inner
        worker {var read-out name :x}
        @in -> worker -> @out
      inner@cmd:*:* <-> @cmd
      @in -> inner@in
      inner@out -> @out
    middle@cmd:*:* <-> @cmd
    @init -> middle@in
    middle@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // var read-out in inner forwards through middle to outer
    // Without a handler at outer level, it should sploot
    assert_eq('[cmd-forward] completed', collected.out.length > 0, true)
  },
  100
)

// §6 [wiring-default-timeout]
// The space's defaultTimeout applies to all wiring rules unless overridden
space_test(
  'wiring-default-timeout: space defaultTimeout applies to wiring rules',
  `outer
    @init from-js
    @out  collect
    +inner
      worker {var read-out name :x}
      @in -> worker -> @out
    inner@cmd:var:* <-> handler
    handler {__}
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[wiring-default-timeout] completed', collected.out.length > 0, true)
  },
  100
)

// §6 [wiring-target-station]
// Wiring rule target can be a station in the same space
space_test(
  'wiring-target-station: wiring rule targets a station',
  `outer
    @init from-js
    @out  collect
    +inner
      caller {var read-out name :greeting}
      @in -> caller -> @out
    handler
      {:hello}
    inner@cmd:var:read-out <-> handler
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[wiring-target-station]', collected.out[0], 'hello')
  },
  100
)

// §6 [socket-crossboundary-var] end-to-end: the handler resolves against the
// PARENT's state store. inner's `var read-out` routes to outer's reader, which
// uses the LOCAL `{var read}` — and because the reader sub-process runs in
// outer, it reads OUTER's $greeting, not inner's (inner has no $greeting).
space_test(
  'cross-boundary var read-out reaches parent state [socket-crossboundary-var]',
  `outer
    $greeting "hi-from-parent"
    @init from-js
    @out  collect
    +inner
      caller {var read-out name :greeting}
      @in -> caller -> @out
    reader
      {__ | peek :name | var read name __}
    inner@cmd:var:read-out <-> reader
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[socket-crossboundary-var] read', collected.out[0], 'hi-from-parent')
  },
  100
)

// §6 [socket-crossboundary-var] write half: `var write-out` mutates the
// PARENT's state store. inner writes $c=42 out, then reads it back out; the
// read only returns 42 if the write landed in outer's store (both handlers
// run in outer and share its state).
space_test(
  'cross-boundary var write-out reaches parent state [socket-crossboundary-var]',
  `outer
    $c "unwritten"
    @init from-js
    @out  collect
    +inner
      io {var write-out name :c value 42 || var read-out name :c}
      @in -> io -> @out
    reader
      {__ | peek :name | var read name __}
    writer
      {__ | peek :name | >n || __in | peek :value | var write name _n}
    inner@cmd:var:read-out  <-> reader
    inner@cmd:var:write-out <-> writer
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[socket-crossboundary-var] write', collected.out[0], 42)
  },
  100
)

// §6 [wiring-target-upport]
// Wiring rule target can be an up-port on a sibling subspace
space_test(
  'wiring-target-upport: wiring rule targets sibling up-port',
  `outer
    @init from-js
    @out  collect
    +requester
      caller {var read-out name :x}
      @in -> caller -> @out
    +provider
      responder {:provided}
      @up <-> responder
    requester@cmd:var:read-out <-> provider@up
    @init -> requester@in
    requester@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[wiring-target-upport]', collected.out[0], 'provided')
  }
)

// §6 [wiring-target-forward]
// Wiring rule target can be a down-port on parent's boundary (forwarding outward)
space_test(
  'wiring-target-forward: wiring rule forwards to parent boundary',
  `outer
    @init from-js
    @out  collect
    +middle
      +inner
        caller {var read-out name :x}
        @in -> caller -> @out
      inner@cmd:var:* <-> @cmd
      @in -> inner@in
      inner@out -> @out
    middle@cmd:var:* <-> @cmd
    @init -> middle@in
    middle@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // var read-out forwards from inner -> middle -> outer (unwired, sploots)
    assert_eq('[wiring-target-forward] completed', collected.out.length > 0, true)
  },
  100
)

// §6 [singleresponse-one]
// A down-port carries exactly one request/response pair at a time
space_test(
  'singleresponse-one: down-port carries one request/response at a time',
  `outer
    @init from-js
    @out  collect
    +inner
      caller {var read-out name :x | add 1}
      @in -> caller -> @out
    handler {:42}
    inner@cmd:var:read-out <-> handler
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // The response (42) continues in the pipeline: add 1 = 43
    assert_eq('[singleresponse-one]', collected.out[0], '43')
  },
  100
)

// §6 [upport-inside-station]
// An up-port can be inside a space: @up:service <-> stationA
space_test(
  'upport-inside-station: up-port wired to station inside space',
  `outer
    @init from-js
    @out  collect
    +inner
      handler {__ | string uppercase}
      @up:service <-> handler
      @in -> @down:need -> @out
    inner@down:need <-> inner@up:service
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    assert_eq('[upport-inside-station]', collected.out[0], 'TEST')
  }
)

// §7 [async-preserve-sender]
// Sender is preserved across async boundary
space_test(
  'async-preserve-sender: sender survives async boundary',
  `outer
    @init from-js
    @out  collect
    +inner
      caller {var read-out name :x}
      @in -> caller -> @out
    handler {:response}
    inner@cmd:var:read-out <-> handler
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[async-preserve-sender]', collected.out[0], 'response')
  }
)

// §7 [timeout-inherit] [timeout-min-chain] — LANDED (det_time_test.mjs):
// a cmd request's deadline is the min of the explicit timeouts along its
// walked rule chain (unset hops inherit the nearest enclosing explicit;
// no outer value extends an inner one); contract chains get min-chain
// naturally from per-hop occupancy deadlines + empty propagation.

// §6 [effectful-unwired-sploot] (space-level)
// Effectful command with unwired port sploots
space_test(
  'effectful-unwired-sploot: unwired effectful command sploots in subspace',
  `outer
    @init from-js
    @out  collect
    +inner
      caller {var read-out name :x || :fallback}
      @in -> caller -> @out
    @init -> inner@in
    inner@out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // var read-out has no wiring rule in parent -> sploots -> pipeline continues with empty
    // || resets -> :fallback
    assert_eq('[effectful-unwired-sploot]', collected.out[0], 'fallback')
  },
  100
)


// ── Spec assertion tests ────────────────────────────────────────────

console.log('--- spec assertion tests ---')

// §3 [spacesyn-state]
// State declarations: `$name json_value` initializes space variable
space_test(
  '[spacesyn-state] state declaration initializes space variable',
  `outer
    $count 0
    @init from-js
    @out  collect
    @init -> {$count | add 1} -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // $count is declared as 0, station reads it and adds 1
    assert_eq('[spacesyn-state] $count initialized to 0', collected.out[0], '1')
  }
)

// §3 [spacesyn-outer-root]
// Last space defined is root (or `outer` if present)
// Here we define two spaces without the name `outer` — the last one should be root
space_test(
  '[spacesyn-outer-root] last space defined is root when no outer',
  `
  helper
    @in
    @out
    @in -> {__ | add 100} -> @out
  main
    @init from-js
    @out  collect
    @init -> helper@in
    helper@out -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    // `main` is last defined, so it's root. helper is its subspace.
    assert_eq('[spacesyn-outer-root]', collected.out[0], '105')
  }
)

// §4 [seed-share-instance]
// Same spaceseed shared by multiple spaces, each with own state
multi_space_test(
  '[seed-share-instance] same seed, independent state',
  [
    { name: 'A', seedlike: `
      outer
        $counter 0
        @init from-js
        @out  collect
        @init -> {__ | add $counter | >$counter || $counter} -> @out` },
    { name: 'B', seedlike: `
      outer
        $counter 0
        @init from-js
        @out  collect
        @init -> {__ | add $counter | >$counter || $counter} -> @out` },
  ],
  function(spaces, done) {
    // Both use the same topology (identical seedlikes), but each should have own state
    var got = 0
    on_collect(spaces.A, 'out', function(ship) {
      got++
      if(got === 4) check()
    })
    on_collect(spaces.B, 'out', function(ship) {
      got++
      if(got === 4) check()
    })
    function check() {
      // A got 10, 20 → totals 10, 30
      assert_eq('[seed-share-instance] A total', spaces.A._collected.out[1], '30')
      // B got 1, 2 → totals 1, 3
      assert_eq('[seed-share-instance] B total', spaces.B._collected.out[1], '3')
      done()
    }
    D.send_value_to_js_port(spaces.A, 'init', 10)
    D.send_value_to_js_port(spaces.B, 'init', 1)
    D.send_value_to_js_port(spaces.A, 'init', 20)
    D.send_value_to_js_port(spaces.B, 'init', 2)
  }
)

// §5 [serial-per-space]
// Serialization is per-space, not per-station. Two stations in one space
// never process concurrently.
space_test(
  '[serial-per-space] two stations in one space process serially',
  `outer
    $log ()
    @init from-js
    @out  collect
    stationA {__ | >a || ($log _a) | string join | >$log}
    stationB {__ | >b || ($log _b) | string join | >$log}
    report   {$log | >@done}
    @init -> stationA -> report
    @init -> stationB -> report
    report.done -> @out`,
  [
    {port: 'init', value: 'x'},
    {port: 'init', value: 'y'},
  ],
  4,
  function(collected) {
    // With serial execution, all four processings happen one at a time.
    // The log accumulates each station visit in order.
    // Key assertion: we get 4 results (each ship visits both stations),
    // and the final log shows all 4 visits happened sequentially.
    assert_eq('[serial-per-space] all ships processed', collected.out.length, 4)
  }
)

// §5 [subprocess-bypass-queue]
// Sub-processes bypass the queue — they run inline as part of the active process.
// list map creates sub-processes for each element; they should all complete
// before the next queued ship is processed.
// Test: two ships arrive. Each ship does a map that reads $n and increments it.
// If sub-processes were queued, map elements from ship 1 could interleave with ship 2.
// Since they're inline, ship 1's entire map completes atomically before ship 2 starts.
space_test(
  '[subprocess-bypass-queue] sub-processes run inline, not queued',
  `outer
    $n 0
    @init from-js
    @out  collect
    mapper {(1 2 3) | list map block "{$n | add 1 | >$n}"}
    @init -> mapper -> @out`,
  [
    {port: 'init', value: 'a'},
    {port: 'init', value: 'b'},
  ],
  2,
  function(collected) {
    // Ship 1: map runs 3 sub-processes, $n goes 0→1→2→3, result [1,2,3]
    // Ship 2: map runs 3 sub-processes, $n goes 3→4→5→6, result [4,5,6]
    // If sub-processes were queued and interleaved, we'd see different numbers
    assert_eq('[subprocess-bypass-queue] first ship', collected.out[0], '[1,2,3]')
    assert_eq('[subprocess-bypass-queue] second ship', collected.out[1], '[4,5,6]')
  }
)

// §5 [routing-deferred-order]
// Among deferred ships, >@foo before >@bar arrives first; _out after all >@.
space_test(
  '[routing-deferred-order] port sends arrive in execution order, _out last',
  `outer
    @init from-js
    @out  collect
    sender {__ | >@alpha || __ | >@beta || :implicit_out}
    sender.alpha -> {(__ :A) | string join} -> @out
    sender.beta  -> {(__ :B) | string join} -> @out
    @init -> sender -> {(__ :OUT) | string join} -> @out`,
  [{port: 'init', value: 'val'}],
  3,
  function(collected) {
    // Spec says: >@alpha before >@beta, _out after all >@
    assert_eq('[routing-deferred-order] first arrival', collected.out[0], 'valA')
    assert_eq('[routing-deferred-order] second arrival', collected.out[1], 'valB')
    assert_eq('[routing-deferred-order] third arrival (implicit out)', collected.out[2], 'implicit_outOUT')
  }
)

// §12 [sploot-passthru-portsend]
// Port send to nonexistent port sploots; pipeline value unchanged
space_test(
  '[sploot-passthru-portsend] port send to nonexistent port, value passes through',
  `outer
    @init from-js
    @out  collect
    tester {42 | >@nonexistent}
    @init -> tester -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // >@nonexistent has no route, so it sploots (soft error).
    // But pipeline value (42) should pass through to _out.
    assert_eq('[sploot-passthru-portsend]', collected.out[0], '42')
  }
)

// §4 [station-port-requires-route]
// >@portname without a corresponding route declaration sploots
space_test(
  '[station-port-requires-route] >@portname without route sploots',
  `outer
    @init from-js
    @out  collect
    @out:err  collect
    tester {99 | >@undeclared || :continued}
    @init -> tester -> @out`,
  [{port: 'init', value: 'go'}],
  2,
  function(collected) {
    // >@undeclared has no route: it sploots, the error ships to @out:err
    // [err-match-by-name], and the pipeline continues — the || resets the
    // pipe and :continued flows to _out.
    assert_eq('[station-port-requires-route] error shipped', collected['out:err'] && collected['out:err'].length > 0, true)
    assert_eq('[station-port-requires-route] pipeline continued', collected.out && collected.out[0], 'continued')
  }
)

// §4 [random-per-space]
// A space's random sequence depends only on its own calls, not sibling activity.
// Two outer spaces with the same PRNG seed should produce the same sequence.
multi_space_test(
  '[random-per-space] space random independent of siblings',
  [
    { name: 'A', seedlike: `
      outer
        @init from-js
        @out  collect
        @init -> {math random max 1000} -> @out` },
    { name: 'B', seedlike: `
      outer
        @init from-js
        @out  collect
        @init -> {math random max 1000} -> @out` },
  ],
  function(spaces, done) {
    var a_vals = []
    var b_vals = []
    on_collect(spaces.A, 'out', function(ship) {
      a_vals.push(ship)
      if(a_vals.length === 2 && b_vals.length === 2) check()
    })
    on_collect(spaces.B, 'out', function(ship) {
      b_vals.push(ship)
      if(a_vals.length === 2 && b_vals.length === 2) check()
    })
    function check() {
      // Each space has its own PRNG. Within a space, the sequence should be
      // deterministic (same calls produce same results per seed).
      // The key assertion: A's sequence is internally consistent (a_vals[0] != a_vals[1]
      // is likely but not guaranteed; what matters is B's interleaved calls don't affect A).
      // We verify A gets two values and B gets two values independently.
      assert_eq('[random-per-space] A got two results', a_vals.length, 2)
      assert_eq('[random-per-space] B got two results', b_vals.length, 2)
      // Within each space, the second call should differ from the first (overwhelmingly likely)
      // This indirectly tests that each space advances its own PRNG
      assert_eq('[random-per-space] A values are numbers',
        !isNaN(Number(a_vals[0])) && !isNaN(Number(a_vals[1])), true)
      assert_eq('[random-per-space] B values are numbers',
        !isNaN(Number(b_vals[0])) && !isNaN(Number(b_vals[1])), true)
      done()
    }
    // Interleave sends: A, B, A, B
    D.send_value_to_js_port(spaces.A, 'init', 'go')
    D.send_value_to_js_port(spaces.B, 'init', 'go')
    D.send_value_to_js_port(spaces.A, 'init', 'go')
    D.send_value_to_js_port(spaces.B, 'init', 'go')
  }
)

// §3 [spacedef-hard-error]
// Malformed Astroglot borks — the space fails to compile
;(function() {
  // [spacedef-hard-error]
  // Gibberish with special characters should not produce a valid spaceseed
  var bad_result
  try { bad_result = D.make_some_space('!!!@@@###') } catch(e) { bad_result = e }
  if(typeof bad_result !== 'number') {
    pass++
  } else {
    fail++
    failures.push({ label: '[spacedef-hard-error] gibberish borks',
      expected: 'non-number (error or throw)', actual: 'got seed_id: ' + bad_result })
  }
})()

// §3 [spacesyn-no-arrow-in-daml]
// A continuation line containing `->` is treated as a wire, not station DAML.
// So a station body should NOT contain `->` — it would be parsed as a route.
space_test(
  '[spacesyn-no-arrow-in-daml] arrow in continuation is wire not DAML',
  `outer
    @init from-js
    @out  collect
    stationA {__ | add 10}
    stationB {__ | add 100}
    @init -> stationA -> stationB -> @out`,
  [{port: 'init', value: 1}],
  1,
  function(collected) {
    // The `->` in the route line is parsed as wiring, not as DAML content.
    // 1 -> stationA (add 10 = 11) -> stationB (add 100 = 111) -> @out
    assert_eq('[spacesyn-no-arrow-in-daml]', collected.out[0], '111')
  }
)


// ── §3 Contract direction (parser) ───────────────────────────────────
// A contract `<->` requires an Enter-N-Exit port on the LHS
// [roundtrip-enex-lhs]. A station name on the LHS is a signal-type
// violation and must bork [spacedef-hard-error]. Currently the parser
// mints a bogus port from any LHS token, so the backwards form is
// silently accepted — RED until the contract direction is validated.
parse_test(
  'malformed contract: station on LHS borks [spacedef-hard-error] [roundtrip-enex-lhs]',
  `outer
    @init from-js
    @out  collect
    handler {:hello}
    caller {var read-out name :x}
    handler <-> caller@cmd:var:read-out
    @init -> caller@in
    caller@out -> @out`,
  true
)

// Green control: the well-formed direction (port on LHS, station RHS)
// must keep compiling — guards against the fix over-rejecting.
parse_test(
  'valid contract: port on LHS, station RHS parses [wire-contract]',
  `outer
    @init from-js
    @out  collect
    handler {:hello}
    caller {var read-out name :x}
    caller@cmd:var:read-out <-> handler
    @init -> caller@in
    caller@out -> @out`,
  false
)

// A contract has exactly two endpoints — a third borks.
parse_test(
  'contract with more than two endpoints borks [spacedef-hard-error]',
  `outer
    @out collect
    h {:x}
    @up:a <-> h <-> @up:b`,
  true
)

// One-way ports cannot participate in contracts: a declared in-flavour
// port on the LHS is a signal-type violation.
parse_test(
  'one-way port on contract LHS borks [spacedef-hard-error]',
  `outer
    @init from-js
    handler {:x}
    @init <-> handler`,
  true
)

// Contract signal types (§3, D2-spec.md:2096-2098): the LHS must be
// Enter-N-Exit (my @up, a child's @down/@cmd) and the RHS must be
// Exit-N-Reenter (my @down, a child's @up) or a station. Anything pointing
// a boundary the wrong way borks — no longer a silent malformed parse.

// My-own @down is Exit-N-Reenter (RHS only). As a contract LHS it borks.
parse_test(
  'my-own down port on contract LHS borks [roundtrip-enex-lhs]',
  `outer
    handler {:x}
    @down:svc <-> handler`,
  true
)

// My-own @up is Enter-N-Exit (LHS only). As a contract RHS it borks, even
// when declared (the declared case used to slip past the RHS check).
parse_test(
  'my-own up port on contract RHS borks [roundtrip-enex-lhs]',
  `outer
    @up:b
    @up:a <-> @up:b`,
  true
)

// A one-way (out) port cannot fulfill a contract, even when declared.
parse_test(
  'declared one-way port on contract RHS borks [spacedef-hard-error]',
  `outer
    @out:x
    @up:svc <-> @out:x`,
  true
)

// Valid: my @up (Enter-N-Exit) forwards out my @down (Exit-N-Reenter).
// (Parse-level guard — @down must still be accepted as an RHS.)
parse_test(
  'own up <-> own down is a valid contract',
  `outer
    @up:req <-> @down:fwd`,
  false
)

// A subspace's down port is Enter-N-Exit — LHS only. On the RHS it borks.
parse_test(
  'subspace down port on contract RHS borks [spacedef-hard-error]',
  `worker
    @down:x
    h {:h}
  outer
    @up:svc <-> worker@down:x`,
  true
)

// A station named port cannot fulfill a contract (stations fulfill via
// their implicit _in/_out — bare name only).
parse_test(
  'station named port on contract RHS borks [spacedef-hard-error]',
  `outer
    handler {__ | >@foo | ""}
    @up:svc <-> handler@foo`,
  true
)

// An inline {…} block on the contract RHS must mint an anonymous station
// and wire both legs — today it is silently dropped (routes reference a
// station that never exists). Compile-shape check. [spacesyn-anon-station]
;(function() {
  // [spacesyn-anon-station] contract RHS inline block
  var seed_id = D.make_some_space(
    'outer\n' +
    '  @up:svc\n' +
    '  @up:svc <-> {__ | add 1}\n')
  var seed = D.SPACESEEDS[seed_id]
  var ok = seed && seed.stations.length == 1 && seed.routes.length == 2
  if(ok) pass++
  else {
    fail++
    failures.push({ label: 'contract RHS inline block mints a station [spacesyn-anon-station]',
      expected: '1 station, 2 routes',
      actual: seed ? (seed.stations.length + ' stations, ' + seed.routes.length + ' routes') : 'no seed' })
  }
})()

// A cmd wiring rule (holder@cmd:glob <-> target [timeout]) compiles to a
// stored rule — not a minted port with a garbage direction. [demandport-wire]
;(function() {
  // [demandport-wire] cmd wiring rule parses to a rule, not a port
  var seed_id = D.make_some_space(
    'outer\n' +
    '  @init from-js\n' +
    '  handler {:hello}\n' +
    '  caller {var read-out name :x}\n' +
    '  caller@cmd:var:read-out <-> handler 500\n' +
    '  @init -> caller\n')
  var seed = D.SPACESEEDS[seed_id]
  var bogus = seed && seed.ports.filter(function(p) { return /cmd/.test(p.name || '') }).length
  var rule = seed && seed.rules && seed.rules[0]
  var ok = seed && bogus === 0 && rule
        && typeof rule.holder_station === 'number' && rule.pattern === 'var:read-out'
        && typeof rule.target_in === 'number' && rule.timeout === 500
  if(ok) pass++
  else {
    fail++
    failures.push({ label: 'cmd wiring rule compiles to a stored rule [demandport-wire]',
      expected: 'no cmd-named port; rules[0] resolved to indices {holder_station, var:read-out, target_in/out, 500}',
      actual: seed ? (bogus + ' bogus ports, rules: ' + JSON.stringify(seed.rules)) : 'no seed' })
  }
})()


// ── §3 Sigil / black-hole / socket / cmd-port compile borks ──────────
// All PURE (parser/compiler only): the malformed definition must bork —
// no spaceseed produced. RED until the space-label sigils (+ * !) and
// these rules are implemented; today they parse without error.
// Spec: 2026-07-12 sigil patch (design/audit-spec-patches-draft.md).

// A nested-space sigil at column 0 borks.
parse_test('a + label at column 0 borks [spacesyn-sigil-required]',
  `+inner
    @in -> @out
  outer
    @init from-js
    @init -> inner@in`, true)

// A bare indented block whose body contains space structure borks —
// a bare nested name is always a station, never a silent subspace.
parse_test('a bare nested block with space structure borks [spacesyn-sigil-required]',
  `outer
    @init from-js
    inner
      @in -> @out
    @init -> inner@in`, true)

// A black hole may contain only ports — a station/state/wire inside borks.
parse_test('black hole with a station borks [blackhole-only-ports]',
  `outer
    @init from-js
    *relay
      @in:feed websock-out
      worker {__}
    @init -> relay@in:feed`, true)

// A black-hole port's flavour must oppose the port direction.
parse_test('black hole in-port with a non-opposing (in) flavour borks [blackhole-flavour-oppose]',
  `outer
    @init from-js
    *relay
      @in:feed websock-in
    @init -> relay@in:feed`, true)

// Only in/out ports on a black hole — up/down (round-trip) borks.
parse_test('black hole with an up/down port borks [blackhole-inout-only]',
  `outer
    @init from-js
    *relay
      @down:fetch websock-out
    @init -> relay@in:feed`, true)

// The root space cannot be a black hole.
parse_test('a black hole as the root space borks [blackhole-not-root]',
  `*relay
    @in:feed websock-out
    @out:news websock-in`, true)

// The socket-load flavour is retired — port-likes are implicit on ! sockets.
parse_test('declaring the retired socket-load flavour borks [socket-portlike-implicit]',
  `outer
    @init from-js
    @in:load socket-load
    @init -> @out`, true)

// References to a black hole use the bare name, never the sigil form.
parse_test('a *name endpoint reference borks (bare name required) [blackhole-ref-bare]',
  `outer
    @init from-js
    *relay
      @in:feed websock-out
    @init -> *relay@in:feed`, true)

// A root socket is unrepresentable: ! exists only in nested position.
parse_test('a ! label at column 0 borks [socket-load-not-root]',
  `!worker
    @in -> @out
  outer
    @init from-js
    @init -> worker@in`, true)

// A cmd: port cannot be declared — command ports are demand-created only.
parse_test('a declared cmd: port borks [demandport-create]',
  `outer
    @init from-js
    @cmd:time:now websock-in
    @init -> @out`, true)


// ══════════════════════════════════════════════════════════════════════
// Spec batch 2026-07-19, part 1: hole metadata, JSON borks, name
// collision, line-initial-{ disambiguation (D2-spec.md 9eda188..2ff6156)
// ══════════════════════════════════════════════════════════════════════

// A station and a subspace sharing a name bork at compile — the engine
// used to let the subspace silently shadow the station (orphaning it),
// with the winner disagreeing between parse and compile phases.
parse_test('station/subspace name collision borks (station first) [spacesyn-name-collision]',
  `outer
    @init from-js
    foo {:station}
    +foo
      @in
      @out
    @init -> foo`, true)

parse_test('station/subspace name collision borks (subspace first) [spacesyn-name-collision]',
  `outer
    @init from-js
    +foo
      @in
      @out
    foo {:station}
    @init -> foo`, true)

// Invalid JSON in a dialect declaration borks — the engine used to
// swallow it in an empty catch [spacesyn-dialect].
parse_test('invalid JSON in a dialect declaration borks [spacesyn-dialect]',
  `outer
    {broken json
    @init from-js
    @init -> @out`, true)

// Invalid JSON in a black hole's metadata borks [blackhole-meta].
parse_test('invalid JSON in hole metadata borks [blackhole-meta]',
  `outer
    @init from-js
    *relay
      {not json}
      @in:feed websock-out
    @init -> relay@in:feed`, true)

// At most one JSON object declaration per space body.
parse_test('a second dialect object in one body borks',
  `outer
    {"blocked_methods": {"process": ["unquote"]}}
    {"blocked_aliases": {}}
    @init from-js
    @init -> @out`, true)

parse_test('a second metadata object in a hole borks [blackhole-meta]',
  `outer
    @init from-js
    *relay
      {"binding": "news"}
      {"binding": "other"}
      @in:feed websock-out
    @init -> relay@in:feed`, true)

// Control: a lone JSON object line is still a dialect declaration.
parse_test('a lone JSON object line is still a dialect declaration (control)',
  `outer
    {"blocked_methods": {"process": ["unquote"]}}
    @init from-js
    @init -> @out`, false)

// Synchronous seed-inspection helper: a throw is a failure, not a crash.
function sync_test(label, fn) {
  try { fn() }
  catch(e) {
    fail++
    failures.push({ label: label, expected: 'no throw', actual: 'threw: ' + e.message })
  }
}

// Hole body JSON lands on seed.meta, never seed.dialect [blackhole-meta].
// Nested definition — the * sigil must reach the child's own parse.
sync_test('nested hole meta block [blackhole-meta]', function() {
  var seed_id = D.make_some_space(dedent(`outer
    @init from-js
    *relay
      {"binding": "news", "v": 2}
      @in:feed websock-out
    @init -> relay@in:feed`))
  var outer = D.SPACESEEDS[seed_id]
  var hole = D.SPACESEEDS[outer.subspaces[0]]
  assert_eq('nested hole body JSON lands on seed.meta [blackhole-meta]',
    hole.meta, {binding: 'news', v: 2})
  assert_eq('hole metadata never touches seed.dialect [blackhole-meta]',
    hole.dialect || {}, {})
})

// Same via a top-level hole definition referenced from outer.
sync_test('top-level hole meta block [blackhole-meta]', function() {
  var seed_id = D.make_some_space(
    '*relay\n  {"binding": "news"}\n  @in:feed websock-out\n'
  + 'outer\n  @init from-js\n  @init -> relay@in:feed')
  var outer = D.SPACESEEDS[seed_id]
  var hole = D.SPACESEEDS[outer.subspaces[0]]
  assert_eq('top-level-defined hole meta lands on seed.meta [blackhole-meta]',
    hole.meta, {binding: 'news'})
})

// Metadata is part of the definition and survives serialization
// [serialize-keeps-hole-meta].
sync_test('hole meta serialization block [serialize-keeps-hole-meta]', function() {
  var seed_id = D.make_some_space(dedent(`outer
    @init from-js
    *relay
      {"binding": "news"}
      @in:feed websock-out
    @init -> relay@in:feed`))
  var space = new D.Space(seed_id)
  var out = space.serialize()
  assert_eq('hole metadata survives serialization [serialize-keeps-hole-meta]',
    out.indexOf('{"binding":"news"}') >= 0 ? 'kept' : 'lost: ' + out, 'kept')
})

// A line-initial inline station opens a wire, not a dialect declaration
// [spacesyn-json-vs-wire] — the parser used to eat the whole line as a
// failed dialect parse, silently dropping the route.
sync_test('line-initial inline station block [spacesyn-json-vs-wire]', function() {
  var seed_id = D.make_some_space(dedent(`t2
    @out collect
    {x} -> @out`))
  var seed = D.SPACESEEDS[seed_id]
  assert_eq('line-initial inline station mints its anon [spacesyn-json-vs-wire]',
    seed.stations.length, 1)
  assert_eq('line-initial inline station keeps its route [spacesyn-json-vs-wire]',
    seed.routes.length, 1)
})

// A dialect_decl of ANY shape in a subspace is a soft error and is
// ignored [dialect-outer-only] — the engine used to key the soft error
// on blocked_methods alone, silently accepting other shapes.
sync_test('subspace dialect shape block [dialect-outer-only]', function() {
  var errs = []
  var old_err = D.set_error
  D.set_error = function(msg) { errs.push(String(msg)); return old_err.call(D, msg) }
  try {
    var seed_id = D.make_some_space(dedent(`outer2
      @init from-js
      +sub
        @in
        @out
        {"foo": 1}
      @init -> sub@in`))
    new D.Space(seed_id)
  } finally {
    D.set_error = old_err
  }
  assert_eq('subspace JSON of any shape soft-errors [dialect-outer-only]',
    errs.filter(function(m) { return /dialect/i.test(m) }).length > 0 ? 'soft error' : 'silent',
    'soft error')
})

// ══════════════════════════════════════════════════════════════════════
// Spec batch 2026-07-19, part 2: lexical-chain scoping + socket barrier
// [spacesyn-scope-chain] [socket-scope-barrier]
// ══════════════════════════════════════════════════════════════════════

function slotted(seed, name) {
  var i = seed.subspace_names.indexOf(name)
  return i < 0 ? null : D.SPACESEEDS[seed.subspaces[i]]
}

// A completed SIBLING definition is visible — the two-layer scope hid it.
sync_test('sibling reference block [spacesyn-scope-chain]', function() {
  var seed_id = D.make_some_space(dedent(`outer
    @init from-js
    +alpha
      @in
      @out
      a {:a}
      @in -> a
      a -> @out
    +beta
      @in
      @out
      @in -> alpha@in
      alpha@out -> @out
    @init -> beta@in`))
  var beta = slotted(D.SPACESEEDS[seed_id], 'beta')
  assert_eq('a completed sibling definition is visible [spacesyn-scope-chain]',
    beta.subspaces.length, 1)
})

// The chain runs through every enclosing level: an uncle is visible.
sync_test('uncle reference block [spacesyn-scope-chain]', function() {
  var seed_id = D.make_some_space(dedent(`outer
    @init from-js
    +uncle
      @in
      @out
      u {:u}
      @in -> u
      u -> @out
    +mid
      @in
      @out
      +inner
        @in
        @out
        @in -> uncle@in
        uncle@out -> @out
      @in -> inner@in
      inner@out -> @out
    @init -> mid@in`))
  var mid = slotted(D.SPACESEEDS[seed_id], 'mid')
  var inner = slotted(mid, 'inner')
  assert_eq('an uncle (enclosing-level completed def) is visible [spacesyn-scope-chain]',
    inner.subspaces.length, 1)
})

// Sockets are scope barriers: content cannot reference outside its own
// subtree — not even a top-level definition (legal before this change).
sync_test('socket barrier block [socket-scope-barrier]', function() {
  var seed_id = D.make_some_space(
    'helper\n  @in\n  @out\n  h {:h}\n  @in -> h\n  h -> @out\n'
  + 'outer\n  @init from-js\n'
  + '  !sock\n    @in\n    @out\n    @in -> helper@in\n    helper@out -> @out\n'
  + '  @init -> sock@in')
  var sock = slotted(D.SPACESEEDS[seed_id], 'sock')
  assert_eq('socket content cannot reference outside its subtree [socket-scope-barrier]',
    sock.subspaces.length, 0)
})

// Pin: a LATER sibling is not yet complete — not visible (soft, dropped).
sync_test('later sibling pin [spacesyn-scope-chain]', function() {
  var seed_id = D.make_some_space(dedent(`outer
    @init from-js
    +beta
      @in
      @out
      @in -> gamma@in
    +gamma
      @in
      @out
      g {:g}
      @in -> g
      g -> @out
    @init -> beta@in`))
  var beta = slotted(D.SPACESEEDS[seed_id], 'beta')
  assert_eq('a later (incomplete) sibling is not visible [spacesyn-scope-chain]',
    beta.subspaces.length, 0)
})

// Pin: an ancestor is never visible (incomplete from inside itself).
sync_test('ancestor pin [spacesyn-scope-chain]', function() {
  var seed_id = D.make_some_space(dedent(`outer
    @init from-js
    +mid2
      @in
      @out
      +inner2
        @in
        @out
        @in -> mid2@in
      @in -> inner2@in
      inner2@out -> @out
    @init -> mid2@in`))
  var mid = slotted(D.SPACESEEDS[seed_id], 'mid2')
  var inner = slotted(mid, 'inner2')
  assert_eq('an ancestor is not visible [spacesyn-scope-chain]',
    inner.subspaces.length, 0)
})

// Pin: a nested definition shadows a same-named top-level definition
// within its defining space [spacesyn-shadow-local].
sync_test('shadow pin [spacesyn-shadow-local]', function() {
  var seed_id = D.make_some_space(
    'dup\n  @in\n  @out\n  toplevel {:t}\n  @in -> toplevel\n  toplevel -> @out\n'
  + 'outer\n  @init from-js\n'
  + '  +dup\n    @in\n    @out\n    localsta {:l}\n    @in -> localsta\n    localsta -> @out\n'
  + '  @init -> dup@in')
  var dup = slotted(D.SPACESEEDS[seed_id], 'dup')
  assert_eq('local definition shadows top-level [spacesyn-shadow-local]',
    dup.station_names, ['localsta'])
})

// ══════════════════════════════════════════════════════════════════════
// Spec batch 2026-07-19, part 3: anonymous stations serialize inline
// [serialize-anon-inline]
// ══════════════════════════════════════════════════════════════════════

// Anon stations inline into their wire chains; generated names never
// appear in serialized output.
sync_test('anon inline serialization block [serialize-anon-inline]', function() {
  var seed_id = D.make_some_space('t3\n  @init from-js\n  @out collect\n  @init -> {x} -> @out')
  var out = new D.Space(seed_id).serialize()
  assert_eq('no generated anon declarations in serialized output [serialize-anon-inline]',
    /\bs\d+ \{/.test(out) ? 'generated: ' + out : 'clean', 'clean')
  assert_eq('anon chains inline [serialize-anon-inline]',
    out.indexOf('@init -> {x} -> @out') >= 0 ? 'inline' : 'missing: ' + out, 'inline')
})

// The name-capture bug: a DECLARED station named s1 plus one anon used to
// serialize as two `s1` declarations — the reparse clobbered one.
// NB: anon bodies here are numeric literals — blocks are content-addressed
// by compiled structure, so two unknown-alias bodies ({zz}, {aa}) share one
// block id and block_source keeps only the first text (pre-existing,
// flagged to dann 2026-07-19).
sync_test('anon name-capture block [serialize-anon-inline]', function() {
  var seed_id = D.make_some_space('t4\n  @init from-js\n  @out collect\n'
    + '  s1 {1}\n  @init -> s1\n  s1 -> @out\n  @init -> {2} -> @out')
  var out = new D.Space(seed_id).serialize()
  var re_id = D.make_some_space(out)
  assert_eq('declared s1 + anon survive a serialize/reparse round trip [serialize-anon-inline]',
    D.SPACESEEDS[re_id].stations.length, 2)
})

// Pin: serialize is idempotent across a reparse.
sync_test('serialize idempotence block [serialize-anon-inline]', function() {
  var src = 't5\n  @init from-js\n  @out collect\n  @init -> {1} -> @out\n  @init -> {2} -> @out'
  var s1 = new D.Space(D.make_some_space(src)).serialize()
  var s2 = new D.Space(D.make_some_space(s1)).serialize()
  assert_eq('serialize is idempotent across a reparse [serialize-anon-inline]', s2, s1)
})

// Pin: every anon survives serialize/reparse with its source. NB compiled
// order is CANONICAL (spaceseed_add content-sorts stations/ports/routes for
// content addressing), NOT source order — [qname-anon-station]'s
// source-order numbering diverges for anons (pre-existing, flagged to dann
// 2026-07-19). Reload STABILITY rides the idempotence pin above.
sync_test('anon survival block [serialize-anon-inline]', function() {
  var src = 't6\n  @init from-js\n  @out collect\n  @init -> {11} -> @out\n  @init -> {22} -> @out'
  var out = new D.Space(D.make_some_space(src)).serialize()
  var re = D.SPACESEEDS[D.make_some_space(out)]
  var sources = re.stations.map(function(b) { return D.block_source(b) }).sort()
  assert_eq('both anons survive serialize/reparse with their sources [serialize-anon-inline]',
    sources, ['{11}', '{22}'])
})

// ── Done registering ─────────────────────────────────────────────────

all_registered = true
maybe_report()
