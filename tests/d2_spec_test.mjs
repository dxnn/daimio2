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
// Done registering tests
// =====================================================

all_registered = true
if (pending === 0) report()
