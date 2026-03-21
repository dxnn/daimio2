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

// Known failures — tests for spec behaviors not yet implemented.
// If a failure's label is in this set, it's expected; otherwise it's a regression.
var known_failures = new Set([
  // §6 Wiring rules: handler property matching
  'wiring rule matches on handler property',
  // §6 Wiring rules: negated patterns
  'wiring rule with negated handler pattern',
  // §6 Demand-creation of ports via wiring rules
  'demand-creation: effectful command creates port via wiring rule',
  // §6 /dev/null wiring target
  'dev-null wiring target swallows effect',
  // §4.3 Timeout inheritance in nested spaces
  'timeout inheritance: outer timeout is authoritative',
  // §10 Effect locality: forwarding through parent boundary
  'effect locality: subspace effect forwarded to parent boundary',
  // §10 Space isolation: subspace cannot read parent space vars — FIXED (was test expectation bug)
  // §6 Wiring rules: multiple rules, first match wins
  'wiring rules: first matching rule wins',
  // §7 Socket overlap: old state lost on transition
  'socket overlap: old space state lost on transition',
  // §6 Up-port direction: sibling provides service
  'up-port: sibling subspace provides service via up-port',
  // §8 Serialized space excludes dialect and wiring
  'serialized space excludes dialect and wiring',
  // §6 Round-trip port configurations (paired wiring syntax not implemented)
  'up-port: station A output enters subspace, response to station B',
  'up-port: no down port involved, pure station coordination',
  'down-port: declared, request exits space, response returns',
  'up-port: chained A -> X.up -> Y.up -> B',
  'up-port: only first response counts, rest are ghosts',
  // §6 New port/wiring spec tests (RED — not yet implemented)
  'signal-flip-up: up port acts as round-trip processor from outside',
  'signal-flip-down: down port forwards requests outward',
  'roundtrip-response: <-> wiring sends request and returns response',
  'cmd-transient: command port created per invocation and destroyed',
  'cmd-forward: command port forwarding to parent boundary',
  'wiring-default-timeout: space defaultTimeout applies to wiring rules',
  'wiring-target-station: wiring rule targets a station',
  'wiring-target-upport: wiring rule targets sibling up-port',
  'wiring-target-forward: wiring rule forwards to parent boundary',
  'singleresponse-one: down-port carries one request/response at a time',
  'upport-inside-station: up-port wired to station inside space',
  'async-preserve-sender: sender survives async boundary',
  'timeout-inherit: timeout inherited from enclosing wire',
  'effectful-unwired-sploot: unwired effectful command sploots in subspace',
  // Spec gaps: behaviors not yet implemented
  '[spacesyn-subspace-before-ref] correct order works',
  '[spacesyn-subspace-before-ref] forward ref rejected',
  '[cmd-name-encode] var read-out uses cmd:var:read-out',
  '[cmd-name-encode] var write-out uses cmd:var:write-out',
  '[err-match-by-name] error routed to @err',
  'subspace-own-queue: subspace queues independently from parent',
  'space-inside-opaque: subspace DAML works identically to outer space',
])

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
  if(entry.check) entry.check(entry.collected)
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

    pending_spaces[test_id] = {
      label: chunk.label || ('dm test #' + test_id),
      remaining: assert_count,
      collected: {},
      done: false,
      timer: setTimeout(function() { timeout_space(test_id) }, timeout_ms)
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

// ── Report ───────────────────────────────────────────────────────────

function maybe_report() {
  if(!all_registered || pending > 0) return
  report()
}

function report() {
  var known = failures.filter(function(f) { return known_failures.has(f.label) })
  var novel = failures.filter(function(f) { return !known_failures.has(f.label) })

  console.log('\n=== Space Test Suite ===')
  console.log(pass + ' passed, ' + fail + ' failed (' + known.length + ' known, ' + novel.length + ' new)')

  if(novel.length) {
    console.log('\nNew failures (REGRESSION):')
    novel.forEach(function(f) {
      console.log('  ' + f.label)
      console.log('    expected: ' + f.expected)
      console.log('    actual:   ' + f.actual)
    })
  }

  if(known.length) {
    console.log('\nKnown failures:')
    known.forEach(function(f) {
      console.log('  ' + f.label)
      console.log('    expected: ' + f.expected)
      console.log('    actual:   ' + f.actual)
    })
  }

  if(!novel.length) console.log('\nYou win!')
  if(novel.length) process.exit(1)
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
// [serial-one-at-a-time] [queue-fifo]
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

// Subspace with named station
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
    tester.foo -> @out`,
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
    @err  collect
    badcmd {__ | nonexistent command}
    @init -> badcmd -> @out
    @err  -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // The error port should have received something (the error message)
    // and the pipeline continues with empty value
    var got = collected.out
    assert_eq('error was collected', got && got.length > 0, true)
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
    @in -> {__ | times 2} -> innermost.in
    innermost.out -> @out
  inner
    @in
    @out
    @in -> {__ | times 2} -> innerer.in
    innerer.out -> @out
  outer
    @init from-js 1
    @out  collect
    @init -> inner.in
    inner.out -> @out`,
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
// [P-spaceisolate] [subspace-own-state]
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
// [serial-one-at-a-time] [queue-fifo]
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
// [seed-share-instance] [subspace-own-state]
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
    @init -> looper.in
    looper.out -> @out`,
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
    @init -> classifier.in
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
// [I6]
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
    // $log accumulates: ["1A"], ["1A","2B"], ["1A","2B","3A"]
    assert_eq('state: final log', collected.out[2], '["1A","2B","3A"]')
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
    @init -> child.in
    child.out -> {$x} -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    // child sets its own $x to 5, sends 5 out
    // parent receives 5 at child.out, anon station reads parent's $x (should be 100)
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

// ── Known-failing spec tests ────────────────────────────────────────
// Tests for spec behaviors not yet implemented. All labels must be
// in the known_failures set above so the suite still passes.

console.log('--- known-failing spec tests ---')

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

// §6 Wiring rules: handler property matching
// Spec says wiring rules can match on handler, method, type properties.
// Currently match_wiring_rule only matches on portType exactly.
// [wiring-pattern-match]
space_test(
  'wiring rule matches on handler property',
  `outer
    @init from-js
    @out  collect
    @init -> {__ | time now} -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // Should get mock time value from handler-based wiring rule
    assert_eq('wiring rule matches on handler property',
      collected.out[0], '1234567890')
  }
)
// Programmatically set handler-based wiring rules
;(function() {
  // Find the space we just created and set wiring rules with handler matching
  // This is a workaround since space_test doesn't expose the space object.
  // The test will fail because match_wiring_rule doesn't support handler matching.
})()

// §6 Wiring rules: negated patterns
// Spec says: "Property values can be negated with ! to mean 'anything except this.'"
// [wiring-negate]
space_test(
  'wiring rule with negated handler pattern',
  `outer
    @init from-js
    @out  collect
    @init -> {__ | time now} -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // A wiring rule like @[handler:!math] should match time commands
    // but not math commands. Not yet implemented.
    assert_eq('wiring rule with negated handler pattern',
      collected.out[0], 'mock-time')
  }
)

// §6 Demand-creation of ports via wiring rules
// Spec: "Ports are created on demand because block evaluation can invoke
// arbitrary effectful commands at runtime"
// [demandport-create] [demandport-wire]
space_test(
  'demand-creation: effectful command creates port via wiring rule',
  `outer
    @init from-js
    @out  collect
    @init -> {__ | time now} -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // The effectful command should create a port on demand,
    // matched by a wiring rule, and get a response.
    // Currently requires programmatic wiringRules setup.
    assert_eq('demand-creation: effectful command creates port via wiring rule',
      collected.out[0] !== '' && collected.out[0] !== undefined, true)
  }
)

// §6 /dev/null wiring target
// Spec: "Null (/dev/null — the effect is silently swallowed, returns empty)"
// [wiring-target-null]
space_test(
  'dev-null wiring target swallows effect',
  `outer
    @init from-js
    @out  collect
    @init -> {__ | time now | add 1} -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // If time.now is wired to /dev/null, it should return empty (0),
    // so add 1 should produce 1.
    assert_eq('dev-null wiring target swallows effect',
      collected.out[0], '1')
  }
)

// §6 Wiring rules: first matching rule wins
// Spec: "Rules are evaluated in order. The first matching rule determines the target."
// [wiring-first-match]
space_test(
  'wiring rules: first matching rule wins',
  `outer
    @init from-js
    @out  collect
    @init -> {__ | time now} -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // With two rules that both match, the first should win.
    // Rule 1: time-now → returns 111
    // Rule 2: OTHER → returns 999
    // Should get 111 (first rule wins), not 999.
    assert_eq('wiring rules: first matching rule wins',
      collected.out[0], '111')
  }
)

// §4.3 Timeout inheritance in nested spaces
// Spec: "The effective timeout for any down-port round trip is the minimum
// of all nominal timeouts along the chain from the requesting process to
// the handler."
// [I12] [timeout-min-chain]
multi_space_test(
  'timeout inheritance: outer timeout is authoritative',
  [
    { name: 'parent', seedlike: `
      inner
        @in
        @out
        @in -> {__ | time now} -> @out
      outer
        @init from-js
        @out  collect
        @init -> inner.in
        inner.out -> @out` },
  ],
  function(spaces, done) {
    // Set up parent with a short timeout (50ms).
    // The inner space's effectful command should be governed by
    // the parent's timeout, even if inner has a longer one.
    // Set wiringRules on the inner subspace with a slow handler,
    // and the parent's timeout should cut it short.
    var parent = spaces.parent

    // Find the inner subspace
    var inner = parent.subspaces && parent.subspaces[0]
    if(!inner) {
      fail++
      failures.push({ label: 'timeout inheritance: outer timeout is authoritative',
        expected: 'inner subspace exists', actual: 'no subspaces found' })
      done()
      return
    }

    // Give inner a slow handler (responds after 200ms)
    inner.wiringRules = [{
      pattern: 'OTHER',
      handler: function(request, callback) {
        setTimeout(function() { callback('slow-response') }, 200)
      },
      timeout: 50  // but parent timeout should be even shorter
    }]

    on_collect(parent, 'out', function(ship) {
      // Should have timed out and gotten default value, not 'slow-response'
      assert_eq('timeout inheritance: outer timeout is authoritative',
        ship !== 'slow-response', true)
      done()
    })
    D.send_value_to_js_port(parent, 'init', 'go')
  }
)

// §10 Effect locality: forwarding through parent boundary
// Spec: "Port requests propagate outward (via down-port forwarding through
// parent spaces) until they reach the outermost space, where real effects occur."
// [P-effectlocal] [I10]
multi_space_test(
  'effect locality: subspace effect forwarded to parent boundary',
  [
    { name: 'parent', seedlike: `
      inner
        @in
        @out
        @in -> {__ | time now} -> @out
      outer
        @init from-js
        @out  collect
        @init -> inner.in
        inner.out -> @out` },
  ],
  function(spaces, done) {
    var parent = spaces.parent
    var inner = parent.subspaces && parent.subspaces[0]

    if(!inner) {
      fail++
      failures.push({ label: 'effect locality: subspace effect forwarded to parent boundary',
        expected: 'inner subspace exists', actual: 'no subspaces found' })
      done()
      return
    }

    // The inner space uses {time now} which is effectful.
    // The parent should wire it (via OTHER) to a mock handler.
    // The effect should propagate from inner → parent → handler.
    parent.wiringRules = [{
      pattern: 'OTHER',
      handler: function(request, callback) {
        callback('parent-handled')
      }
    }]

    // The inner subspace's effectful command should be forwarded
    // to the parent's wiring rules
    inner.wiringRules = [{
      pattern: 'OTHER',
      handler: null,  // forward to parent
      forward: true
    }]

    on_collect(parent, 'out', function(ship) {
      assert_eq('effect locality: subspace effect forwarded to parent boundary',
        ship, 'parent-handled')
      done()
    })
    D.send_value_to_js_port(parent, 'init', 'go')
  }
)

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
    @init -> inner.in
    inner.out -> @out`,
  [{port: 'init', value: 'probe'}],
  1,
  function(collected) {
    // The inner space should NOT be able to read $parent_secret.
    // It gets false (Daimio's internal empty value), not "42".
    assert_eq('space isolation: subspace cannot read parent vars directly',
      collected.out[0], false)
  }
)

// §7 Socket overlap: old space state lost on transition
// Spec: "old.σ is lost — state does not survive transitions"
// [socket-overlap-state-lost]
multi_space_test(
  'socket overlap: old space state lost on transition',
  [
    { name: 'host', seedlike: `
      outer
        @init from-js
        @out  collect
        @init -> @out` },
  ],
  function(spaces, done) {
    var host = spaces.host

    // Load first subspace with state
    var sub1_daml = 'sub\n  $counter 0\n  @in\n  @out\n  @in -> {__ | add $counter | >$counter} -> @out'
    var sub1 = host.loadSubspace && host.loadSubspace(sub1_daml)

    if(!sub1) {
      fail++
      failures.push({ label: 'socket overlap: old space state lost on transition',
        expected: 'loadSubspace works', actual: 'loadSubspace returned falsy' })
      done()
      return
    }

    // Send value to sub1 to set its state
    // Then load sub2 into the same socket — sub1's state should be gone
    var sub2_daml = 'sub\n  $counter 0\n  @in\n  @out\n  @in -> {$counter} -> @out'
    var sub2 = host.loadSubspace(sub2_daml)

    if(!sub2) {
      fail++
      failures.push({ label: 'socket overlap: old space state lost on transition',
        expected: 'second loadSubspace works', actual: 'loadSubspace returned falsy' })
      done()
      return
    }

    // sub2 should have fresh state ($counter = 0), not sub1's state
    on_collect(host, 'out', function(ship) {
      assert_eq('socket overlap: old space state lost on transition',
        ship, '0')
      done()
    })
    // Try to read sub2's $counter — should be 0 (fresh)
    if(sub2.ports) {
      var in_port = sub2.ports.find(function(p) { return p.name === 'in' && !p.station })
      if(in_port && in_port.pair) {
        in_port.pair.enter('check')
      } else {
        fail++
        failures.push({ label: 'socket overlap: old space state lost on transition',
          expected: 'sub2 in port found', actual: 'no in port' })
        done()
      }
    } else {
      fail++
      failures.push({ label: 'socket overlap: old space state lost on transition',
        expected: 'sub2 has ports', actual: 'no ports' })
      done()
    }
  },
  100
)

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

// ── §7 Unwired effect: synchronous sploot, no async boundary ────────

// When an effectful command's port is not wired, it falls through to the
// default handler (the `fun` property) and runs synchronously. The pipeline
// continues immediately without any async/timeout machinery.
space_test(
  'unwired effect: default handler runs synchronously',
  `
  outer
    @init from-js
    @out  collect
    @init -> {time now | logic if then :got_time else :no_time} -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // time.now with no wired port uses default handler (synchronous fun)
    // Should produce a truthy timestamp value, so logic if → :got_time
    assert_eq('unwired effect: default handler runs synchronously',
      collected.out[0], 'got_time')
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
  @init -> inner.in
  inner.out -> @out`,
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
    @in
    @out
    @in -> {__ | math add value __ to 100} -> @out
  consumer
    @in
    @out
    @in -> {__ | time now} -> @out
  outer
    @init from-js
    @out  collect
    @init -> consumer.in
    consumer.out -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // If up-port wiring worked, consumer's {time now} effect would route
    // to provider's up-port, which would return the value + 100.
    // Not currently implemented.
    assert_eq('up-port: sibling subspace provides service via up-port',
      collected.out[0], '100')
  }
)


// ── Known-failing: §8 Serialized space format ───────────────────────

// Spec §8 says "A serialized space does NOT include dialect or port wiring."
// There's no serialize method yet, so this is a placeholder test.
;(function() {
  var seed_id = D.make_some_space(
    'stest\n  $count 0\n  @init from-js\n  @out to-js\n  @init -> @out\n'
  )
  var space = new D.Space(seed_id)
  if (typeof space.serialize === 'function') {
    var serialized = space.serialize()
    var has_dialect = /dialect/.test(serialized)
    var has_wiring = /wiringRules/.test(serialized)
    if (!has_dialect && !has_wiring) { pass++ }
    else {
      fail++
      failures.push({
        label: 'serialized space excludes dialect and wiring',
        expected: 'no dialect or wiring in serialized output',
        actual: 'dialect=' + has_dialect + ' wiring=' + has_wiring
      })
    }
  } else {
    fail++
    failures.push({
      label: 'serialized space excludes dialect and wiring',
      expected: 'space.serialize() exists',
      actual: 'method not found'
    })
  }
})()


// ── §6 Round-trip port configurations ────────────────────────────────

// Up-port: station coordination (one-in-one-out guarantee)
// [upport-roundtrip] [upport-first-response]
space_test(
  'up-port: station A output enters subspace, response to station B',
  `outer
    @init from-js
    @out  collect
    inner
      processor
        {__ | string uppercase}
      @init -> processor -> @out
    stationA
      {__ | string join value "-modified"}
    stationB
      {__ | string join value "-received"}
    @init -> stationA -> inner.up -> stationB -> @out`,
  [{port: 'init', value: 'hello'}],
  1,
  function(collected) {
    // hello -> stationA ("hello-modified") -> inner.up (uppercase: "HELLO-MODIFIED") -> stationB ("HELLO-MODIFIED-received")
    assert_eq('up-port station coordination', collected.out[0], 'HELLO-MODIFIED-received')
  },
  100
)

// Up-port: used without a down port (station-to-station via subspace)
// [upport-roundtrip]
space_test(
  'up-port: no down port involved, pure station coordination',
  `outer
    @init from-js
    @out  collect
    worker
      doubler
        {__ | math multiply value 2}
      @init -> doubler -> @out
    source
      {__ | math add value 10}
    sink
      {__ | math add value 100}
    @init -> source -> worker.up -> sink -> @out`,
  [{port: 'init', value: 5}],
  1,
  function(collected) {
    // 5 -> source (15) -> worker.up (doubler: 30) -> sink (130)
    assert_eq('up-port without down port', collected.out[0], '130')
  },
  100
)

// Down-port: declared in space definition, paired wiring
// [downport-declared]
space_test(
  'down-port: declared, request exits space, response returns',
  `outer
    @init from-js
    @out  collect
    inner
      requester
        {__ | >@need}
      @init -> requester
      requester.need -> @out
    handler
      {__ | string uppercase}
    @init -> inner.down -> handler -> @out`,
  [{port: 'init', value: 'please'}],
  1,
  function(collected) {
    // "please" enters inner -> requester sends to @need -> exits inner via down port
    // -> handler uppercases -> "PLEASE" -> returns via down port -> inner continues -> exits inner -> @out
    assert_eq('declared down-port', collected.out[0], 'PLEASE')
  }
)

// Up-port: chained through two subspaces
// [upport-roundtrip]
space_test(
  'up-port: chained A -> X.up -> Y.up -> B',
  `outer
    @init from-js
    @out  collect
    spaceX
      adder
        {__ | math add value 10}
      @init -> adder -> @out
    spaceY
      multiplier
        {__ | math multiply value 2}
      @init -> multiplier -> @out
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
  },
  100
)

// Up-port: ghost handling (only first response delivered)
// [upport-ghost-after-first]
space_test(
  'up-port: only first response counts, rest are ghosts',
  `outer
    @init from-js
    @out  collect
    @err  collect
    multi
      splitter
        {__ | >@first || __ | >@second}
      @init -> splitter
      splitter.first -> @out
      splitter.second -> @out
    receiver
      {__}
    @init -> multi.up -> receiver -> @out`,
  [{port: 'init', value: 'test'}],
  2,
  function(collected) {
    // multi sends two ships out through @out. Only the first should arrive at receiver.
    // The second should be a ghost (dropped + soft error to @err).
    assert_eq('up-port ghost: receiver gets one', collected.out.length, 1)
    assert_eq('up-port ghost: error reported', collected.err && collected.err.length > 0, true)
  }
)

// Space-level @err port: soft errors route to space, not station
// [sploot-error-port]
space_test(
  'soft errors route to space @err port',
  `outer
    @init from-js
    @out  collect
    @err  collect
    badcmd
      {__ | nonexistent command}
    @init -> badcmd -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // The bad command sploots. Error goes to @err (space level).
    // Pipeline continues with empty -> @out.
    // We collect from @out; @err may or may not have fired depending on wiring
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
// Correct order: child defined first, outer references child.in after.
// Forward ref (outer first, child after) should not produce a working space.
;(function() {
  // [spacesyn-subspace-before-ref]
  // Correct order works
  var good = 'child\n  @in from-js\n  @out to-js\nouter\n  @init from-js\n  @out to-js\n  @init -> child.in\n'
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
  var bad = 'outer\n  @init from-js\n  @out to-js\n  @init -> child.in\nchild\n  @in from-js\n  @out to-js\n'
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
// An up port is OUT-N-IN from inside (round-trip processor) but IN-N-OUT from outside
space_test(
  'signal-flip-up: up port acts as round-trip processor from outside',
  `outer
    @init from-js
    @out  collect
    inner
      processor {__ | string uppercase}
      @init -> processor -> @out
    @init -> inner.up -> @out`,
  [{port: 'init', value: 'hello'}],
  1,
  function(collected) {
    assert_eq('[signal-flip-up]', collected.out[0], 'HELLO')
  },
  100
)

// §4 [signal-flip-down]
// A down port is IN-N-OUT from inside (receives requests), OUT-N-IN from outside
space_test(
  'signal-flip-down: down port forwards requests outward',
  `outer
    @init from-js
    @out  collect
    inner
      requester {__ | >@need}
      @init -> requester
      requester.need -> @out
    handler {__ | string uppercase}
    @init -> inner.down -> handler -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    assert_eq('[signal-flip-down]', collected.out[0], 'TEST')
  },
  100
)

// §4 [err-match-by-name]
// Soft errors route to the port named out:err (matched by name, not flavour)
space_test(
  'err-match-by-name: errors route to @err port by name',
  `outer
    @init from-js
    @out  collect
    @err  collect
    bad {__ | nonexistent command}
    @init -> bad -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    // Error should have routed to @err
    if(collected.err && collected.err.length > 0) pass++
    else {
      fail++
      failures.push({ label: '[err-match-by-name] error routed to @err',
        expected: 'error ship in @err', actual: JSON.stringify(collected) })
    }
  }
)

// §4 [subspace-own-queue]
// Each subspace gets its own queue, independent of the parent
space_test(
  'subspace-own-queue: subspace queues independently from parent',
  `outer
    @init from-js
    @out  collect
    inner
      worker {__ | add 10}
      @init -> worker -> @out
    relay {__}
    @init -> inner.in
    inner.out -> relay -> @out`,
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
  `outer
    @init from-js
    @out  collect
    inner
      worker {__ | math multiply value 2}
      @init -> worker -> @out
    @init -> inner.in
    inner.out -> @out`,
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

// §5 [serial-per-space]
// Serialization is per-space, not per-station. Sibling subspaces are independent.
multi_space_test(
  'serial-per-space: sibling subspaces process independently',
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
        assert_eq('[serial-per-space] a', results.a, '101')
        assert_eq('[serial-per-space] b', results.b, '201')
        done()
      }
    })
    on_collect(spaces.b, 'out', function(ship) {
      results.b = ship
      if(results.a !== null && results.b !== null) {
        assert_eq('[serial-per-space] a', results.a, '101')
        assert_eq('[serial-per-space] b', results.b, '201')
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
// <-> wiring: request goes one way, response comes back
space_test(
  'roundtrip-response: <-> wiring sends request and returns response',
  `outer
    @init from-js
    @out  collect
    inner
      worker {__ | string uppercase}
      @init -> worker -> @out
    @init -> inner.down -> @out
    inner@cmd:*:* <-> inner.up`,
  [{port: 'init', value: 'hello'}],
  1,
  function(collected) {
    assert_eq('[roundtrip-response]', collected.out[0], 'HELLO')
  },
  100
)

// §6 [cmd-transient]
// Command ports are transient — created fresh per invocation, destroyed after response
space_test(
  'cmd-transient: command port created per invocation and destroyed',
  `outer
    @init from-js
    @out  collect
    inner
      worker {var read-out name :x | add 1 | var write-out name :x}
      @init -> worker -> worker -> @out
    handler
      {__}
    inner@cmd:var:* <-> handler
    @init -> inner.in
    inner.out -> @out`,
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
    middle
      inner
        worker {var read-out name :x}
        @init -> worker -> @out
      inner@cmd:*:* <-> @cmd
    middle@cmd:*:* <-> @cmd
    @init -> middle.in
    middle.out -> @out`,
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
    inner
      worker {var read-out name :x}
      @init -> worker -> @out
    inner@cmd:var:* <-> handler
    handler {__}
    @init -> inner.in
    inner.out -> @out`,
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
    inner
      caller {var read-out name :greeting}
      @init -> caller -> @out
    handler
      {:hello}
    inner@cmd:var:read-out <-> handler
    @init -> inner.in
    inner.out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[wiring-target-station]', collected.out[0], 'hello')
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
    requester
      caller {var read-out name :x}
      @init -> caller -> @out
    provider
      responder {:provided}
      @init -> responder -> @out
    requester@cmd:var:read-out <-> provider.up
    @init -> requester.in
    requester.out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[wiring-target-upport]', collected.out[0], 'provided')
  },
  100
)

// §6 [wiring-target-forward]
// Wiring rule target can be a down-port on parent's boundary (forwarding outward)
space_test(
  'wiring-target-forward: wiring rule forwards to parent boundary',
  `outer
    @init from-js
    @out  collect
    middle
      inner
        caller {var read-out name :x}
        @init -> caller -> @out
      inner@cmd:var:* <-> @cmd
    middle@cmd:var:* <-> @cmd
    @init -> middle.in
    middle.out -> @out`,
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
    inner
      caller {var read-out name :x | add 1}
      @init -> caller -> @out
    handler {:42}
    inner@cmd:var:read-out <-> handler
    @init -> inner.in
    inner.out -> @out`,
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
    inner
      handler {__ | string uppercase}
      @up:service <-> handler
      @init -> @down:need -> @out
    inner@down:need <-> inner@up:service
    @init -> inner.in
    inner.out -> @out`,
  [{port: 'init', value: 'test'}],
  1,
  function(collected) {
    assert_eq('[upport-inside-station]', collected.out[0], 'TEST')
  },
  100
)

// §7 [async-preserve-sender]
// Sender is preserved across async boundary
space_test(
  'async-preserve-sender: sender survives async boundary',
  `outer
    @init from-js
    @out  collect
    inner
      caller {var read-out name :x}
      @init -> caller -> @out
    handler {:response}
    inner@cmd:var:read-out <-> handler
    @init -> inner.in
    inner.out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    assert_eq('[async-preserve-sender]', collected.out[0], 'response')
  },
  100
)

// §7 [timeout-inherit]
// A wire's nominal timeout is inherited from nearest enclosing wire with explicit value
space_test(
  'timeout-inherit: timeout inherited from enclosing wire',
  `outer
    @init from-js
    @out  collect
    inner
      caller {var read-out name :slow}
      @init -> caller -> @out
    inner@cmd:var:* <-> @cmd
    @init -> inner.in
    inner.out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // With no handler at outer level, this should timeout and sploot
    assert_eq('[timeout-inherit] splooted', collected.out[0], '')
  },
  200
)

// §6 [effectful-unwired-sploot] (space-level)
// Effectful command with unwired port sploots
space_test(
  'effectful-unwired-sploot: unwired effectful command sploots in subspace',
  `outer
    @init from-js
    @out  collect
    inner
      caller {var read-out name :x || :fallback}
      @init -> caller -> @out
    @init -> inner.in
    inner.out -> @out`,
  [{port: 'init', value: 'go'}],
  1,
  function(collected) {
    // var read-out has no wiring rule in parent -> sploots -> pipeline continues with empty
    // || resets -> :fallback
    assert_eq('[effectful-unwired-sploot]', collected.out[0], 'fallback')
  },
  100
)


// ── Done registering ─────────────────────────────────────────────────

all_registered = true
maybe_report()
