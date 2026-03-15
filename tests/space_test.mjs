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

function space_test(label, seedlike, sends, expect_count, check) {
  pending++
  var test_id = ++test_id_counter
  seedlike = dedent(seedlike)

  pending_spaces[test_id] = {
    label: label,
    remaining: expect_count,
    collected: {},
    check: check,
    done: false,
    timer: setTimeout(function() { timeout_space(test_id) }, timeout_ms)
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
  console.log('\n=== Space Test Suite ===')
  console.log(pass + ' passed, ' + fail + ' failed')

  if(fail) {
    console.log('\nFailures:')
    failures.forEach(function(f) {
      console.log('  ' + f.label)
      console.log('    expected: ' + f.expected)
      console.log('    actual:   ' + f.actual)
    })
  }

  if(!fail) console.log('\nYou win!')
  if(fail) process.exit(1)
}

// ── Run .dm tests ────────────────────────────────────────────────────

console.log('--- spacetests.dm ---')
run_dm_tests('spacetests.dm')

// ── Inline tests ─────────────────────────────────────────────────────

console.log('--- inline space tests ---')

// Basic: in port to out port via collect
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

function multi_space_test(label, spaces_def, orchestrate) {
  pending++
  var test_id = ++test_id_counter
  var spaces = {}
  var timer = setTimeout(function() {
    fail++
    failures.push({ label: label, expected: 'completion', actual: 'TIMEOUT' })
    pending--
    maybe_report()
  }, timeout_ms)

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

// ── Done registering ─────────────────────────────────────────────────

all_registered = true
maybe_report()
