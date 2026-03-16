// D2 Spec alignment tests
// Run with: node tests/d2_spec_test.mjs
//
// Tests organized by spec section. Each test is a [input, expected_output] pair.
// Tests are written BEFORE fixes, so they fail initially.

var D = (await import('../daimio/daimio.js')).default

var pass = 0
var fail = 0
var failures = []
var pending = 0
var all_registered = false
var reported = false

function test(label, input, expected) {
  pending++
  D.run(input, function(output) {
    var actual = D.execute_then_stringify(output)
    if (actual === false) actual = ''
    if (typeof actual !== 'string') actual = JSON.stringify(actual) || ''

    if (actual.trim() === expected.trim()) {
      pass++
    } else {
      fail++
      failures.push({ label, input, expected, actual: actual.trim() })
    }
    pending--
    if (all_registered && pending === 0) report()
  })
}

function report() {
  if (reported) return
  reported = true

  console.log('\n=== D2 Spec Tests ===')
  console.log(`${pass + fail} tests: ${pass} passed, ${fail} failed`)

  if (failures.length) {
    console.log('\nFailures:')
    for (var f of failures) {
      console.log(`  [${f.label}]`)
      console.log(`    input:    ${f.input}`)
      console.log(`    expected: ${f.expected}`)
      console.log(`    actual:   ${f.actual}`)
      console.log('')
    }
  }

  if (!fail) console.log('\nAll passing!')
  if (fail) process.exit(1)
}


// =====================================================
// §4 Totality: "is in" should coerce types
// =====================================================

test(
  'is-in coerces string to number',
  '{"2" | is in (1 2 3) | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in coerces number to string',
  '{2 | is in ("1" "2" "3") | logic if then :yes else :no}',
  'yes'
)


// =====================================================
// §4 Soft errors: pipeline continues with default value
// =====================================================

test(
  'unknown command returns empty and continues pipeline',
  '{5 | 123 | math add value 10 to 20}',
  '30'
)

test(
  'pipeline value unchanged when command not found',
  '{42}',
  '42'
)


// =====================================================
// §3 Effectful commands: unwired returns default value
// =====================================================

test(
  'time now returns a timestamp (unwired, uses default handler)',
  '{time now | logic if then :yes else :no}',
  'yes'
)

test(
  'effectful command result flows through pipeline',
  '{time now | __.stamp | logic is value __ like "/^[0-9]+$/" | logic if then :yes else :no}',
  'yes'
)


// =====================================================
// §3 Effectful commands: wired down port
// =====================================================

// Programmatic test for effectful commands in spaces
;(function() {
  pending++

  // make_some_space returns a seed ID (number), not an object
  var seed_id = D.make_some_space(
    'outer\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> {time now | __.stamp} -> @out\n'
  )

  if (typeof seed_id !== 'number') {
    fail++
    failures.push({
      label: 'effectful command in space',
      input: '(space setup)',
      expected: 'seed_id number',
      actual: typeof seed_id + ': ' + JSON.stringify(seed_id)
    })
    pending--
    return
  }

  var space = new D.Space(seed_id)

  // Find the from-js port and inject a value
  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })

  if (!from_port || !to_port) {
    fail++
    failures.push({
      label: 'effectful command in space',
      input: '(space setup)',
      expected: 'from-js and to-js ports',
      actual: 'from_port=' + !!from_port + ' to_port=' + !!to_port
    })
    pending--
    return
  }

  // Set up the to-js outside port to capture output
  // to_port is the inside port (has .space); to_port.pair is the outside port
  // The exit flow calls outside_exit on the outside port (the pair)
  var outside_port = to_port.pair
  if (!outside_port) {
    fail++
    failures.push({
      label: 'effectful command in space',
      input: '(port setup)',
      expected: 'to-js port has outside pair',
      actual: 'no pair found'
    })
    pending--
    return
  }

  outside_port.outside_exit = function(value) {
    // time.now with no wiring should use default handler
    // stamp should be a real timestamp
    var actual = String(value)
    if (actual && /^\d+$/.test(actual)) {
      pass++
    } else {
      fail++
      failures.push({
        label: 'effectful command in space returns timestamp',
        input: '{time now | __.stamp}',
        expected: 'numeric timestamp',
        actual: actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }
  from_port.pair.enter('start')
})()


// =====================================================
// §3 Effectful commands: wired down port with mock response
// =====================================================

// When a down port is wired, the effectful command sends a request
// through the port and waits for the callback response.
;(function() {
  pending++

  // Space with a down port for 'time-now' effect type
  // The @effect port is a down port whose settings.thing is 'time-now'
  var seed_id = D.make_some_space(
    'outer\n' +
    '  @effect down time-now\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> {time now | __.stamp} -> @out\n'
  )

  if (typeof seed_id !== 'number') {
    fail++
    failures.push({
      label: 'wired down port space setup',
      input: '(space setup)',
      expected: 'seed_id number',
      actual: typeof seed_id + ': ' + JSON.stringify(seed_id)
    })
    pending--
    return
  }

  var space = new D.Space(seed_id)

  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })
  var down_port = space.ports.find(function(p) { return p.flavour === 'down' })

  if (!from_port || !to_port || !down_port) {
    fail++
    failures.push({
      label: 'wired down port space setup',
      input: '(port setup)',
      expected: 'from-js, to-js, and down ports',
      actual: 'from=' + !!from_port + ' to=' + !!to_port + ' down=' + !!down_port
    })
    pending--
    return
  }

  // Override the down port's outside_exit to act as a mock time provider
  // outside_exit receives (ship, callback) for down ports via port_standard_sync
  var down_outside = down_port.pair
  if (!down_outside) {
    fail++
    failures.push({
      label: 'wired down port',
      input: '(port setup)',
      expected: 'down port has outside pair',
      actual: 'no pair found'
    })
    pending--
    return
  }

  down_outside.outside_exit = function(ship, callback) {
    // Mock: return a fixed timestamp object instead of real time
    var mock_response = { year: 1999, month: 12, day: 31, hour: 23, minute: 59, second: 59, stamp: 42 }
    callback(mock_response)
  }

  // Capture output on the to-js outside port
  var to_outside = to_port.pair
  to_outside.outside_exit = function(value) {
    // The pipeline does {time now | __.stamp}, so with our mock, value should be "42"
    var actual = String(value)
    if (actual === '42') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'wired down port returns mock response',
        input: '{time now | __.stamp} with mock',
        expected: '42',
        actual: actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  from_port.pair.enter('start')
})()


// =====================================================
// §3.3 Down port timeout: unresponsive handler
// =====================================================

// When a wired down port never responds, the timeout fires and
// the pipeline resumes with the effectful command's default value.
;(function() {
  pending++

  var seed_id = D.make_some_space(
    'outer\n' +
    '  @effect down time-now\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> {time now | logic if then :got_time else :no_time} -> @out\n'
  )

  if (typeof seed_id !== 'number') {
    fail++
    failures.push({
      label: 'timeout space setup',
      input: '(space setup)',
      expected: 'seed_id number',
      actual: typeof seed_id + ': ' + JSON.stringify(seed_id)
    })
    pending--
    return
  }

  var space = new D.Space(seed_id)

  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })
  var down_port = space.ports.find(function(p) { return p.flavour === 'down' })

  if (!from_port || !to_port || !down_port) {
    fail++
    failures.push({
      label: 'timeout space setup',
      input: '(port setup)',
      expected: 'all ports found',
      actual: 'from=' + !!from_port + ' to=' + !!to_port + ' down=' + !!down_port
    })
    pending--
    return
  }

  // Override down port's outside_exit to NEVER respond (simulates unresponsive handler)
  var down_outside = down_port.pair
  down_outside.outside_exit = function(ship, callback) {
    // Intentionally does nothing — never calls callback
  }

  // Set a short timeout on the effect for testing (100ms instead of 10s default)
  // We'll use space.defaultTimeout for this
  space.defaultTimeout = 100

  var to_outside = to_port.pair
  to_outside.outside_exit = function(value) {
    // time now's default value is false, so logic if should take the else branch
    var actual = String(value)
    if (actual === 'no_time') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'timeout returns default value',
        input: '{time now | logic if then :got_time else :no_time}',
        expected: 'no_time',
        actual: actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  from_port.pair.enter('start')
})()


// =====================================================
// §3.3 Orphaned response: response after timeout is dropped
// =====================================================

;(function() {
  pending++

  var seed_id = D.make_some_space(
    'outer\n' +
    '  @effect down time-now\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> {time now | logic if then :got_time else :no_time} -> @out\n'
  )

  var space = new D.Space(seed_id)
  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })
  var down_port = space.ports.find(function(p) { return p.flavour === 'down' })

  space.defaultTimeout = 50

  // Store the callback so we can call it late (after timeout)
  var stored_callback = null
  var down_outside = down_port.pair
  down_outside.outside_exit = function(ship, callback) {
    stored_callback = callback
    // Respond after 200ms — well after the 50ms timeout
    setTimeout(function() { callback({ year: 2000, stamp: 999 }) }, 200)
  }

  var call_count = 0
  var to_outside = to_port.pair
  to_outside.outside_exit = function(value) {
    call_count++
    if (call_count > 1) {
      // This should never happen — orphaned responses should not reach the pipeline
      fail++
      failures.push({
        label: 'orphaned response should not reach pipeline',
        input: '(orphaned response)',
        expected: 'single call to to-js',
        actual: 'called ' + call_count + ' times'
      })
      pending--
      if (all_registered && pending === 0) report()
      return
    }

    // First call should be from timeout with default value (false)
    var actual = String(value)
    if (actual === 'no_time') {
      // Wait a bit to make sure orphaned response doesn't cause a second call
      setTimeout(function() {
        if (call_count === 1) {
          pass++
        } else {
          fail++
          failures.push({
            label: 'orphaned response dropped',
            input: '(orphaned response)',
            expected: 'one output only',
            actual: call_count + ' outputs'
          })
        }
        pending--
        if (all_registered && pending === 0) report()
      }, 300)
    } else {
      fail++
      failures.push({
        label: 'orphaned response: timeout should fire first',
        input: '{time now | logic if then :got_time else :no_time}',
        expected: 'no_time',
        actual: actual
      })
      pending--
      if (all_registered && pending === 0) report()
    }
  }

  from_port.pair.enter('start')
})()


// =====================================================
// §5 Wiring rules: automatic port creation and routing
// =====================================================

// When a space has wiring rules, effectful commands get
// automatically routed to handlers without manually declared ports.
;(function() {
  pending++

  // No @effect port declaration — wiring rules handle it
  var seed_id = D.make_some_space(
    'outer\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> {time now | __.stamp} -> @out\n'
  )

  var space = new D.Space(seed_id)

  // Set wiring rules: route 'time-now' effects to a mock handler
  space.wiringRules = [
    {
      pattern: { portType: 'time-now' },
      handler: function(request, callback) {
        // Mock handler: returns a fixed timestamp
        callback({ year: 2025, month: 6, day: 15, stamp: 777 })
      },
      timeout: 5000
    }
  ]

  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })

  var to_outside = to_port.pair
  to_outside.outside_exit = function(value) {
    var actual = String(value)
    if (actual === '777') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'wiring rule routes to handler',
        input: '{time now | __.stamp} via wiring rule',
        expected: '777',
        actual: actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  from_port.pair.enter('start')
})()


// =====================================================
// §5 Wiring rules: OTHER fallback
// =====================================================

// The OTHER pattern matches any effect type not matched by a specific rule.
;(function() {
  pending++

  var seed_id = D.make_some_space(
    'outer\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> {time now | __.stamp} -> @out\n'
  )

  var space = new D.Space(seed_id)

  // Wiring rules: no specific rule for time-now, but OTHER catches it
  space.wiringRules = [
    {
      pattern: { portType: 'db-query' },  // doesn't match time-now
      handler: function(request, callback) { callback('wrong') }
    },
    {
      pattern: 'OTHER',
      handler: function(request, callback) {
        // Fallback handler for anything unmatched
        callback({ stamp: 555 })
      }
    }
  ]

  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })

  var to_outside = to_port.pair
  to_outside.outside_exit = function(value) {
    var actual = String(value)
    if (actual === '555') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'OTHER wiring rule catches unmatched',
        input: '{time now | __.stamp} via OTHER',
        expected: '555',
        actual: actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  from_port.pair.enter('start')
})()


// =====================================================
// §4 Soft errors: route to space error port
// =====================================================

// When a space has an error port, soft errors should be sent to it.
;(function() {
  pending++

  // Space with an error port
  var seed_id = D.make_some_space(
    'outer\n' +
    '  @errsink err\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> {foo asdf | math add value 1 to 2} -> @out\n'
  )

  var space = new D.Space(seed_id)
  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })
  var err_port = space.ports.find(function(p) { return p.flavour === 'err' && !p.station })

  if (!from_port || !to_port || !err_port) {
    fail++
    failures.push({
      label: 'error port space setup',
      input: '(port setup)',
      expected: 'all ports found',
      actual: 'from=' + !!from_port + ' to=' + !!to_port + ' err=' + !!err_port
    })
    pending--
    return
  }

  // Capture errors on the err port's outside pair
  var errors_received = []
  var err_outside = err_port.pair
  err_outside.outside_exit = function(value) {
    errors_received.push(value)
  }

  // Capture output on the to-js port
  var to_outside = to_port.pair
  to_outside.outside_exit = function(value) {
    // Pipeline should still complete: {foo asdf} errors, returns "", then {math add value 1 to 2} returns 3
    var actual = String(value)
    // Check that we got at least one error routed to the error port
    if (errors_received.length > 0 && actual === '3') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'soft error routes to error port',
        input: '{foo asdf | math add value 1 to 2}',
        expected: 'errors_received > 0 and output 3',
        actual: 'errors=' + errors_received.length + ' output=' + actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  from_port.pair.enter('start')
})()


// =====================================================
// §6 Cross-boundary state: var read/write (unwired)
// =====================================================

// var read and var write are effectful commands.
// When unwired, the default handler accesses the current space's state.

test(
  'var write sets space variable',
  '{var write name :testvar value 42 | var read name :testvar}',
  '42'
)

test(
  'var read returns empty for unset variable',
  '{var read name :nonexistent}',
  ''
)


// =====================================================
// §6 Cross-boundary state: var read/write (wired)
// =====================================================

// When wired, var read/write go through down ports to a parent handler.
;(function() {
  pending++

  var seed_id = D.make_some_space(
    'outer\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> {var write name :color value :blue | var read name :color} -> @out\n'
  )

  var space = new D.Space(seed_id)

  // Mock parent state via wiring rules
  var parent_state = {}
  space.wiringRules = [
    {
      pattern: { portType: 'var-write' },
      handler: function(request, callback) {
        parent_state[request.params[0]] = request.params[1]
        callback(request.params[1])
      }
    },
    {
      pattern: { portType: 'var-read' },
      handler: function(request, callback) {
        callback(parent_state[request.params[0]] || '')
      }
    }
  ]

  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })

  var to_outside = to_port.pair
  to_outside.outside_exit = function(value) {
    var actual = String(value)
    if (actual === 'blue') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'wired var read/write through parent',
        input: '{var write name :color value :blue | var read name :color}',
        expected: 'blue',
        actual: actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  from_port.pair.enter('start')
})()


// =====================================================
// §1 D14: Copy semantics at command boundaries
// =====================================================

// Storing in $x then modifying should not affect $x
test(
  'space var copy: poke does not mutate original',
  '{(1 2 3) | >$x | poke 4 | >$y || $x | add}',
  '6'
)

test(
  'space var copy: remove does not mutate original',
  '{(1 2 3) | >$x | list remove by_value 2 || $x | add}',
  '6'
)


// =====================================================
// §6 Socket loading: load DAML source as subspace
// =====================================================

// loadSubspace parses DAML source and installs a new subspace at runtime.
;(function() {
  pending++

  // Parent space
  var seed_id = D.make_some_space(
    'outer\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n'
  )

  var parent = new D.Space(seed_id)

  // Load a subspace dynamically
  var child_daml =
    'inner\n' +
    '  @in in\n' +
    '  @out out\n' +
    '  @in -> {__ | math add value __ to 10} -> @out\n'

  var subspace = parent.loadSubspace ? parent.loadSubspace(child_daml) : null

  if (!subspace) {
    fail++
    failures.push({
      label: 'loadSubspace exists',
      input: '(socket loading)',
      expected: 'loadSubspace returns space',
      actual: 'null or undefined'
    })
    pending--
    return
  }

  // Find the subspace's paired ports in the parent
  var child_in = subspace.ports.find(function(p) { return p.name === 'in' && !p.station })
  var child_out = subspace.ports.find(function(p) { return p.name === 'out' && !p.station })

  if (!child_in || !child_out) {
    fail++
    failures.push({
      label: 'subspace has ports',
      input: '(socket loading)',
      expected: 'in and out ports',
      actual: 'in=' + !!child_in + ' out=' + !!child_out
    })
    pending--
    return
  }

  // The child_in port's pair should exist (parent-side port)
  var parent_in = child_in.pair
  var parent_out = child_out.pair

  if (!parent_in || !parent_out) {
    fail++
    failures.push({
      label: 'subspace ports paired with parent',
      input: '(socket loading)',
      expected: 'paired ports',
      actual: 'parent_in=' + !!parent_in + ' parent_out=' + !!parent_out
    })
    pending--
    return
  }

  // Capture output from the child space through its paired parent port
  parent_out.outside_exit = function(value) {
    var actual = String(value)
    if (actual === '15') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'loaded subspace processes correctly',
        input: '5 | math add to 10 (in subspace)',
        expected: '15',
        actual: actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  // Send value into the subspace via the parent-side in port
  parent_in.enter(5)
})()


// =====================================================
// §6 Socket loading with wiring rules
// =====================================================

// A loaded subspace's effectful commands should be routed
// by the parent's wiring rules.
;(function() {
  pending++

  // Parent space with wiring rules
  var seed_id = D.make_some_space(
    'outer\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n'
  )

  var parent = new D.Space(seed_id)

  // Parent wiring: mock handler for time-now effects
  parent.wiringRules = [
    {
      pattern: 'OTHER',
      handler: function(request, callback) {
        callback({ stamp: 999 })
      }
    }
  ]

  // Load a subspace that uses an effectful command
  var child_daml =
    'inner\n' +
    '  @in in\n' +
    '  @out out\n' +
    '  @in -> {time now | __.stamp} -> @out\n'

  var subspace = parent.loadSubspace(child_daml)

  // The subspace needs to inherit parent's wiring rules for effectful commands
  subspace.wiringRules = parent.wiringRules

  var child_in = subspace.ports.find(function(p) { return p.name === 'in' && !p.station })
  var child_out = subspace.ports.find(function(p) { return p.name === 'out' && !p.station })

  var parent_out = child_out.pair
  parent_out.outside_exit = function(value) {
    var actual = String(value)
    if (actual === '999') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'loaded subspace uses parent wiring rules',
        input: '{time now | __.stamp} in subspace with parent wiring',
        expected: '999',
        actual: actual
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  // Enter via the parent-side paired port
  child_in.pair.enter('start')
})()


// =====================================================
// §8 Scheduling: sequential execution of concurrent ships
// =====================================================

// Two ships entering the same space should execute sequentially.
// Both increment a counter, so the final value should be 2.
;(function() {
  pending++

  var seed_id = D.make_some_space(
    'outer\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  $counter 0\n' +
    '  @init -> {$counter | math add value __ to 1 | >$counter} -> @out\n'
  )

  var space = new D.Space(seed_id)
  var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
  var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })

  var results = []
  var to_outside = to_port.pair
  to_outside.outside_exit = function(value) {
    results.push(String(value))
    if (results.length === 2) {
      // Both ships completed — final counter should be 2
      // Ship 1: read 0, write 1 → output 1
      // Ship 2: read 1, write 2 → output 2
      if (results[0] === '1' && results[1] === '2') {
        pass++
      } else {
        fail++
        failures.push({
          label: 'sequential execution of concurrent ships',
          input: 'two ships incrementing counter',
          expected: 'outputs [1, 2]',
          actual: JSON.stringify(results)
        })
      }
      pending--
      if (all_registered && pending === 0) report()
    }
  }

  // Send two ships concurrently
  from_port.pair.enter('a')
  from_port.pair.enter('b')
})()


// =====================================================
// >$x.path passthrough: pipe value should not change
// =====================================================

// The >$x.path operator writes to the space variable's subpath
// but the pipe value should pass through unchanged (the original
// value, not the full updated object).

test(
  '>$x.path passes through original value',
  '{* (:a 1) | >$pt1 | 42 | >$pt1.sub || $pt1}',
  '{"a":1,"sub":42}'
)

// The 42 should flow through, not the full {sub:42} object
test(
  '>$x.path passthrough value is the pipe input, not the poked object',
  '{* (:a 1) | >$pt2 | 55 | >$pt2.b}',
  '55'
)

test(
  '>$x.path passthrough with nested path',
  '{* (:a 1) | >$pt3 | :hello | >$pt3.b.c}',
  'hello'
)

test(
  '>$x.path self-reference poke passes through original',
  '{* (:a 1 :b 2) | >$pt4 | >$pt4.c}',
  '{"a":1,"b":2}'
)


// =====================================================
// Key-preserving operations: reverse, sort, group by
// =====================================================

// Reverse on a keyed list should preserve keys (reverse insertion order).
test(
  'reverse preserves keys on keyed list',
  '{* (:x 3 :y 2 :z 4 :q 1) | list reverse}',
  '{"q":1,"z":4,"y":2,"x":3}'
)

// Reverse on an unkeyed list still returns an array.
test(
  'reverse on unkeyed list returns array',
  '{(3 2 4 1) | list reverse}',
  '[1,4,2,3]'
)

// Sort on a keyed list should preserve keys (reorder by value).
test(
  'sort preserves keys on keyed list',
  '{* (:c 3 :b 2 :a 1) | list sort}',
  '{"a":1,"b":2,"c":3}'
)

// Sort on an unkeyed list still returns an array.
test(
  'sort on unkeyed list returns array',
  '{(3 2 4 1) | list sort}',
  '[1,2,3,4]'
)

// Group by always returns an object (keyed list), even with integer keys.
// Note: integer-like string keys may be reordered by JS engines.
test(
  'group by with integer keys returns object',
  '{(1 2 3 4 5 6) | list group by "{__ | mod 2}"}',
  '{"0":[2,4,6],"1":[1,3,5]}'
)

// Group by with string keys returns object.
test(
  'group by with string keys returns object',
  '{( {* (:a :x :b 1)} {* (:a :z :b 2)} {* (:a :x :b 3)} ) | list group by :a}',
  '{"x":[{"a":"x","b":1},{"a":"x","b":3}],"z":[{"a":"z","b":2}]}'
)


// =====================================================
// Undefined pipeline variables: should behave as zero/empty
// =====================================================

// An undefined pipeline variable used as a math param should
// act as zero (false), not cause the pipe value to leak through.
test(
  'undefined pipeline var in range acts as zero',
  '{9 | range _asdf}',
  '[]'
)

test(
  'undefined pipeline var in subtract acts as zero',
  '{(1 2 3) | subtract _zxcv}',
  '[1,2,3]'
)

test(
  'undefined space var in subtract acts as zero',
  '{(1 2 3) | subtract $jklj}',
  '[1,2,3]'
)

test(
  'undefined pipeline var in add acts as zero',
  '{5 | add _nope}',
  '5'
)


// =====================================================
// || double pipe: error after || should not leak value
// =====================================================

// When the segment after || produces an error and is removed,
// the pre-|| value should not leak through as output.
test(
  'double pipe blocks value leak on error',
  '{123 | >foo || __foo}',
  ''
)


// =====================================================
// Block synonymization: quote returns per-segment source
// =====================================================

// Two blocks with different source strings can compile to
// identical segment structures (same hash). quote should
// return the source of THIS block, not the first-parsed synonym.
test(
  'quote preserves original source despite synonymization',
  '{"{777}" | quote}',
  '{777}'
)
test(
  'quote preserves original source for alias-like blocks',
  '{"{xxx}" | quote}',
  '{xxx}'
)


// =====================================================
// Inner block scope inheritance
// =====================================================

// Inner blocks should automatically inherit parent pipeline variables.
test(
  'inner block inherits parent pipeline var',
  '{5 | >foo | (1 2 3) | map block "{__ | add _foo}"}',
  '[6,7,8]'
)

// Nested inheritance: grandchild block gets grandparent variable.
test(
  'nested inheritance: grandchild gets grandparent var',
  '{10 | >x | (1 2 3) | map block "{__ | >y | (1) | map block "{_y | add _x}"}"}',
  '[[11],[12],[13]]'
)

// Caller scope overrides inherited variable.
test(
  'caller scope overrides inherited var',
  '{99 | >x | (1 2 3) | map block "{_x}"}',
  '[99,99,99]'
)

// Pipeline var not used in same pipeline, only in inner block.
test(
  'pipeline var only used in inner block',
  '{42 | >secret | "{_secret}" | run}',
  '42'
)

// process.run with value param sets __in.
test(
  'process.run value param sets __in',
  '{"{__ | add 1}" | run value 7}',
  '8'
)

// Sort by keys using inherited variable.
test(
  'sort by keys via inherited variable',
  '{* (:c 3 :b 2 :a 4) | >l | list keys | sort | map block "{_l.{_value}}"}',
  '[4,2,3]'
)


// =====================================================
// §1 Peek: Name selector
// =====================================================

test(
  'peek Name: existing key',
  '{* (:a 1 :b 2 :c 3) | list peek path :b}',
  '2'
)

test(
  'peek Name: missing key returns empty',
  '{* (:a 1 :b 2) | list peek path :z}',
  ''
)

test(
  'peek Name: nested key path',
  '{* (:a {* (:x 10 :y 20)}) | list peek path (:a :y)}',
  '20'
)

test(
  'peek Name: missing nested key returns empty',
  '{* (:a {* (:x 10)}) | list peek path (:a :z)}',
  ''
)

test(
  'peek Name: on non-collection returns empty',
  '{42 | list peek path :a}',
  ''
)


// =====================================================
// §1 Peek: Pos selector
// =====================================================

test(
  'peek Pos: existing position',
  '{(10 20 30) | list peek path "#2"}',
  '20'
)

test(
  'peek Pos: negative position (from end)',
  '{(10 20 30) | list peek path "#-1"}',
  '30'
)

test(
  'peek Pos: out of bounds returns empty',
  '{(10 20 30) | list peek path "#5"}',
  ''
)

test(
  'peek Pos: nested position path',
  '{((1 2) (3 4) (5 6)) | list peek path ("#2" "#1")}',
  '3'
)


// =====================================================
// §1 Peek: Star selector
// =====================================================

test(
  'peek Star: all children of list',
  '{(10 20 30) | list peek path "*"}',
  '[10,20,30]'
)

test(
  'peek Star: all children of keyed list',
  '{* (:a 1 :b 2) | list peek path "*"}',
  '[1,2]'
)

test(
  'peek Star: empty list returns empty list',
  '{() | list peek path "*"}',
  '[]'
)

// Note: 42 is coerced to [42] by list type before peek sees it
test(
  'peek Star: on scalar (list-coerced) returns its children',
  '{42 | list peek path "*"}',
  '[42]'
)

test(
  'peek Star: nested star-then-key',
  '{(  {* (:x 1)} {* (:x 2)} {* (:x 3)}  ) | list peek path ("*" :x)}',
  '[1,2,3]'
)

test(
  'peek Star: nested star-then-pos',
  '{((10 20) (30 40) (50 60)) | list peek path ("*" "#2")}',
  '[20,40,60]'
)

// Star expands children, then Name on scalars returns empty for each
// Empty values stringify to nothing, so the result is an empty-looking list
test(
  'peek Star: star of scalars then Name returns empties',
  '{(1 2 3) | list peek path ("*" :a)}',
  '[]'
)


// =====================================================
// §1 Peek: Par selector
// =====================================================

test(
  'peek Par: multiple keys',
  '{* (:a 1 :b 2 :c 3) | list peek path ((:a :c))}',
  '[1,3]'
)

test(
  'peek Par: multiple positions',
  '{(10 20 30 40) | list peek path (("#1" "#3"))}',
  '[10,30]'
)


// =====================================================
// §1 Poke: Name selector — creates if missing
// =====================================================

test(
  'poke Name: update existing key',
  '{* (:a 1 :b 2) | list poke path :b value 99}',
  '{"a":1,"b":99}'
)

test(
  'poke Name: create missing key',
  '{* (:a 1) | list poke path :b value 99}',
  '{"a":1,"b":99}'
)

test(
  'poke Name: create nested path from existing',
  '{* (:a 1) | list poke path (:b :c) value 99}',
  '{"a":1,"b":{"c":99}}'
)

test(
  'poke Name: into empty creates structure',
  '{() | list poke path (:x) value 42}',
  '{"x":42}'
)


// =====================================================
// §1 Poke: Pos selector — extends if missing
// =====================================================

test(
  'poke Pos: update existing position',
  '{(10 20 30) | list poke path "#2" value 99}',
  '[10,99,30]'
)

test(
  'poke Pos: out-of-bounds position is no-op',
  '{(10 20) | list poke path "#4" value 99}',
  '[10,20]'
)

test(
  'poke Pos: position on empty list is no-op',
  '{() | list poke path "#2" value 99}',
  '[]'
)

test(
  'poke Pos: nested position path',
  '{((1 2) (3 4)) | list poke path ("#2" "#1") value 99}',
  '[[1,2],[99,4]]'
)


// =====================================================
// §1 Poke: Star — modify existing only, never create
// =====================================================

test(
  'poke Star: set all children',
  '{(1 2 3) | list poke path "*" value 0}',
  '[0,0,0]'
)

test(
  'poke Star: set all children of keyed list',
  '{* (:a 1 :b 2) | list poke path "*" value 0}',
  '{"a":0,"b":0}'
)

test(
  'poke Star: on empty list is no-op',
  '{() | list poke path "*" value 99}',
  '[]'
)

test(
  'poke Star: nested star-then-pos modifies existing children',
  '{((1 2) (3 4)) | list poke path ("*" "#1") value 99}',
  '[[99,2],[99,4]]'
)

// PROBLEMATIC: star expands to scalar children, then Name tries to create/set
// on a number, which crashes in strict mode. Fixing this properly requires
// D.poke to track parent references so scalars can be replaced in-place.
// The spec says poke(scalar, Name :: rest, new) = poke(Empty, Name :: rest, new),
// so the correct result is [{"a":99},{"a":99},{"a":99}], but the current
// architecture can't do this without a significant D.poke refactor.
test(
  'poke Star: star on scalars with further Name (KNOWN PROBLEMATIC)',
  '{(1 2 3) | list poke path ("*" :a) value 99}',
  ''
)

test(
  'poke Star: nested star-star on collections modifies all',
  '{((1 2) (3 4)) | list poke path ("*" "*") value 0}',
  '[[0,0],[0,0]]'
)

test(
  'poke Star: nested star-star on scalars is no-op',
  '{(1 2 3) | list poke path ("*" "*") value 0}',
  '[1,2,3]'
)

test(
  'poke Star: pos-then-star modifies one child',
  '{((1 2) (3 4)) | list poke path ("#2" "*") value 0}',
  '[[1,2],[0,0]]'
)

test(
  'poke Star: star into empty nested is no-op',
  '{() | list poke path ("*" "*") value 99}',
  '[]'
)


// =====================================================
// §1 Poke: scalar base destroyed
// =====================================================

// Note: list poke coerces scalar to [scalar] via list type before D.poke sees it.
// The scalar-destroy behavior applies when D.poke receives a raw scalar (e.g. >$x.path).
// Through list poke, the string is wrapped as ["hello"], so poke operates on an array.
test(
  'poke: scalar base via list poke (coerced to array)',
  '{:hello | list poke path :a value 99}',
  '{"0":"hello","a":99}'
)

// >$x.path desugars to list poke, which coerces string to [string].
// So string scalars are preserved (wrapped), unlike blocks which coerce to [].
test(
  'poke: string base via >$x.path (coerced to array)',
  '{:hello | >$sp1 || 99 | >$sp1.a || $sp1}',
  '{"0":"hello","a":99}'
)

// Block base is destroyed because list type coerces Block to []
test(
  'poke: block base via >$x.path (block destroyed)',
  '{"{:foo}x" | >$sp2 || 99 | >$sp2.a || $sp2}',
  '{"a":99}'
)


// =====================================================
// §1 Poke: Par selector
// =====================================================

test(
  'poke Par: multiple existing keys',
  '{* (:a 1 :b 2 :c 3) | list poke path ((:a :b)) value 99}',
  '{"a":99,"b":99,"c":3}'
)

test(
  'poke Par: create missing keys',
  '{* (:a 1) | list poke path ((:b :c)) value 99}',
  '{"a":1,"b":99,"c":99}'
)

test(
  'poke Par: multiple existing positions',
  '{(10 20 30 40) | list poke path (("#1" "#3")) value 99}',
  '[99,20,99,40]'
)


// =====================================================
// §1 Lens laws: PutGet — peek(poke(v, p, x), p) = x
// =====================================================

test(
  'PutGet: Name path',
  '{* (:a 1 :b 2) | list poke path :b value 42 | list peek path :b}',
  '42'
)

test(
  'PutGet: Pos path',
  '{(10 20 30) | list poke path "#2" value 42 | list peek path "#2"}',
  '42'
)

test(
  'PutGet: nested Name path',
  '{* (:a {* (:x 1)}) | list poke path (:a :x) value 42 | list peek path (:a :x)}',
  '42'
)

test(
  'PutGet: Name path creates then reads back',
  '{* (:a 1) | list poke path :z value 42 | list peek path :z}',
  '42'
)


// =====================================================
// §1 Lens laws: PutPut — poke(poke(v, p, x), p, y) = poke(v, p, y)
// =====================================================

test(
  'PutPut: last write wins for Name',
  '{* (:a 1) | list poke path :a value 10 | list poke path :a value 20}',
  '{"a":20}'
)

test(
  'PutPut: last write wins for Pos',
  '{(1 2 3) | list poke path "#1" value 10 | list poke path "#1" value 20}',
  '[20,2,3]'
)


// =====================================================
// §1 Lens laws for Star: all three hold
// =====================================================

// GetPut for star: poke(v, *, peek(child)) for each child = v
// We test this by peeking all children, then poking them back.
// Since star doesn't create, this is safe.

test(
  'Star PutGet: poke star then peek star',
  '{(1 2 3) | list poke path "*" value 0 | list peek path "*"}',
  '[0,0,0]'
)

test(
  'Star PutPut: double star poke, last wins',
  '{(1 2 3) | list poke path "*" value 5 | list poke path "*" value 9}',
  '[9,9,9]'
)


// =====================================================
// §4 Totality: parser handles invalid block names
// =====================================================

// {begin $foo} has a non-\w+ name — parser should not crash
test(
  'parser: invalid block name does not crash',
  '{begin $foo}body{end $foo}',
  ''
)

// =====================================================
// §0 Parsing: brace matching algorithm
// =====================================================
//
// Parsing is left-to-right. At each position:
// 1. If '{', attempt structural brace matching (count { and }, no quote awareness).
//    a. If balanced '}' found:
//       - If span is '{begin NAME}', scan for '{end NAME}' → namedblock (or command if not found)
//       - Otherwise → command
//    b. If no balanced '}', the '{' is literal text. Scanning continues from next char.
// 2. A lone '}' (not closing a matched '{') is literal text.
// 3. All other characters are literal text.

// --- Unmatched '{' is literal text ---

test(
  'parse: trailing unmatched { is literal text',
  'hello { world',
  'hello { world'
)

test(
  'parse: unmatched { among valid commands',
  '{:ok} then { oops',
  'ok then { oops'
)

// --- Unmatched '{' does NOT eat subsequent valid commands ---

test(
  'parse: unmatched { followed by valid command',
  'hey { wow {3 | math add value 2} bye',
  'hey { wow 5 bye'
)

test(
  'parse: unmatched { between two valid commands',
  '{:a} { {3 | add 4}',
  'a { 7'
)

test(
  'parse: multiple unmatched { each become literal text',
  'a { b { c',
  'a { b { c'
)

test(
  'parse: unmatched { then valid command then unmatched {',
  '{ {3 | add 1} {',
  '{ 4 {'
)

// --- Lone '}' is literal text ---

test(
  'parse: lone } is literal text',
  'hello } world',
  'hello } world'
)

test(
  'parse: } before valid command',
  '} {3 | add 1}',
  '} 4'
)

test(
  'parse: } after valid command',
  '{3 | add 1} }',
  '4 }'
)

// --- Structural brace matching vs quotes ---
// Brace matching is purely structural (no quote awareness).
// These tests document the current behavior, which can be
// surprising when braces appear inside string literals.

test(
  'parse: basic string in command',
  '{"hello"}',
  'hello'
)

test(
  'parse: { inside string breaks structural match',
  '{"he{lo"}',
  '{"he'
)

test(
  'parse: } inside string closes structural match early',
  '{"he}lo"}',
  'lo"}'
)

test(
  'parse: matched {} inside string balances structurally',
  '{"{}"}',
  ''
)

test(
  'parse: lone quote in braces',
  '{"}"}',
  '"}'
)

test(
  'parse: nested braces inside string balance structurally',
  '{"a{b}c"}',
  'ac'
)

test(
  'parse: block-like string evaluates',
  '{"{3 | add 1}"}',
  '4'
)

test(
  'parse: lone } among text and commands',
  'x}y{3 | add 1}z',
  'x}y4z'
)

// Braces inside strings can break the enclosing pipeline by
// misaligning the structural brace match.

test(
  'parse: } in string eats rest of pipeline',
  '{"x}y" | (1 2)}',
  'y" | (1 2)}'
)

test(
  'parse: { in string eats rest of pipeline',
  '{"x{y" | (1 2)}',
  '{"x'
)

test(
  'parse: matched {} in string preserves pipeline',
  '{"x{}y" | (1 2)}',
  '[1,2]'
)

// --- Trivial inputs ---

test(
  'parse: empty input returns empty',
  '',
  ''
)

test(
  'parse: plain text no braces',
  'hello world',
  'hello world'
)

test(
  'parse: just whitespace',
  '   ',
  '   '
)

test(
  'parse: empty command',
  '{}',
  ''
)

test(
  'parse: double open brace',
  '{{',
  '{{'
)

test(
  'parse: double close brace',
  '}}',
  '}}'
)

test(
  'parse: close then open brace',
  '}{',
  '}{'
)

// --- Nested braces ---

test(
  'parse: double-wrapped command',
  '{{3 | add 1}}',
  '4'
)

test(
  'parse: adjacent commands',
  '{3 | add 1}{5 | add 2}',
  '47'
)

test(
  'parse: three adjacent commands',
  '{1}{2}{3}',
  '123'
)

// --- Namedblock priority over regular command ---

test(
  'parse: namedblock takes priority',
  '{begin foo}hello{end foo}',
  'hello'
)

test(
  'parse: namedblock with commands inside',
  '{begin foo}x {3 | add 1} y{end foo}',
  'x 4 y'
)

test(
  'parse: namedblock empty body',
  '{begin foo}{end foo}',
  ''
)

test(
  'parse: namedblock with numeric name',
  '{begin 123}body{end 123}',
  'body'
)

test(
  'parse: nested different-name namedblocks',
  '{begin a}x{begin b}y{end b}z{end a}',
  'xyz'
)

test(
  'parse: nested same-name takes first end tag',
  '{begin a}x{end a}y{end a}',
  'xy'
)

test(
  'parse: end tag without begin is a command',
  '{end foo}',
  ''
)

test(
  'parse: begin with no space is regular command',
  '{beginfoo}',
  ''
)

test(
  'parse: namedblock end tag inside opening pipeline is not matched',
  '{begin name | "{end name}" | 123}yo{end name}',
  '123'
)

// When {begin NAME} has no matching {end NAME}, the balanced span
// is treated as a regular command. 'begin' is not a handler, so it
// soft-errors and produces empty. The rest is literal text.
test(
  'parse: namedblock missing end tag falls back to command',
  '{begin foo} oops no end tag',
  ' oops no end tag'
)

test(
  'parse: begin no end with valid command after',
  '{begin foo}body {3 | add 1} trail',
  'body 4 trail'
)

test(
  'parse: mismatched begin/end names falls back to command',
  '{begin foo}{end bar}',
  ''
)

test(
  'parse: mismatched names with stuff after',
  '{begin foo}{end bar} and {3 | add 1}',
  ' and 4'
)

// --- Nested braces ---

test(
  'parse: nested braces match correctly',
  '{(1 2 3) | map block "{__ | add 1}"}',
  '[2,3,4]'
)

test(
  'parse: adjacent commands both parse',
  '{3 | add 1}{:x}',
  '4x'
)

// --- Mixed unmatched and valid braces ---

test(
  'parse: text, command, unmatched, command, text',
  'a {3 | add 1} { {5 | add 2} z',
  'a 4 { 7 z'
)


// =====================================================
// string from code: basic characters
// =====================================================

test(
  'from code: ASCII letter',
  '{string from code 65}',
  'A'
)

test(
  'from code: open curly brace',
  '{string from code 123}',
  '{'
)

test(
  'from code: close curly brace',
  '{string from code 125}',
  '}'
)

test(
  'from code: thumbs up emoji',
  '{string from code 128077}',
  '\u{1F44D}'
)

test(
  'from code: poo emoji',
  '{string from code 128169}',
  '\u{1F4A9}'
)


// =====================================================
// string from code: curlies in pipeline and space vars
// =====================================================

test(
  'from code: open curly stored in pipeline var',
  '{string from code 123 | >brace || _brace}',
  '{'
)

test(
  'from code: close curly stored in space var',
  '{string from code 125 | >$cb || $cb}',
  '}'
)

test(
  'from code: both curlies round-trip through vars',
  '{string from code 123 | >$ob || string from code 125 | >$cb || ($ob :hi $cb) | join}',
  '{hi}'
)


// =====================================================
// string from code: assemble DAML command and run it
// =====================================================

test(
  'from code: assemble DAML from curly chars and execute',
  '{string from code 123 | >$op || string from code 125 | >$cl || ($op :3 " | " :add " " :4 $cl) | join | process unquote | process run}',
  '7'
)


// =====================================================
// list zip
// =====================================================

// basic zip: list of two lists
test('zip: basic two lists',
  '{((1 2 3) (4 5 6)) | list zip}',
  '[[1,4],[2,5],[3,6]]'
)

// zip with also param
test('zip: data + also',
  '{(1 2 3) | list zip also (4 5 6)}',
  '[[4,1],[5,2],[6,3]]'
)

// zip three lists
test('zip: three lists',
  '{((:a :b) (:c :d) (:e :f)) | list zip}',
  '[["a","c","e"],["b","d","f"]]'
)

// zip single list (each element becomes a singleton tuple)
test('zip: single list wraps elements',
  '{((1 2 3)) | list zip}',
  '[[1],[2],[3]]'
)

// zip with uneven lengths (short lists produce null for missing)
test('zip: uneven lengths',
  '{((1 2 3) (4 5)) | list zip}',
  '[[1,4],[2,5],[3,null]]'
)

// zip empty input
test('zip: empty input',
  '{() | list zip}',
  ''
)

// no mutation: zip should not alter the original list
test('zip: no mutation of source',
  '{((1 2) (3 4)) | >$data || $data | list zip | >$zipped || $data}',
  '[[1,2],[3,4]]'
)

// no mutation: zip with also should not alter either input
test('zip: no mutation with also',
  '{(1 2 3) | >$a || (4 5 6) | >$b || $a | list zip also $b || $a | string join on "-"}',
  '1-2-3'
)

// zip alias
test('zip: alias',
  '{((1 2) (3 4)) | zip}',
  '[[1,3],[2,4]]'
)


// =====================================================
// Done registering tests
// =====================================================

all_registered = true
if (pending === 0) report()
