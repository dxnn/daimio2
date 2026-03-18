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
  'is-in coerces string to number [coerce-list] [P-total]',
  '{"2" | is in (1 2 3) | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in coerces number to string [coerce-list] [P-total]',
  '{2 | is in ("1" "2" "3") | logic if then :yes else :no}',
  'yes'
)

// --- logic is: non-array "in" param (totality) ---

// keyed list (object) as "in" — should search object values
test(
  'is-in: keyed list finds matching value [coerce-list] [P-total]',
  '{:x | time stampwrap | >data || logic is value 3 in _data | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in: keyed list rejects missing value [coerce-list] [P-total]',
  '{:x | time stampwrap | >data || logic is value :nope in _data | logic if then :yes else :no}',
  'no'
)

// scalar "in" — list type coerces to single-element array
test(
  'is-in: scalar number matches itself [coerce-list] [P-total]',
  '{logic is value 42 in 42 | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in: scalar number rejects non-match [coerce-list] [P-total]',
  '{logic is value 42 in 99 | logic if then :yes else :no}',
  'no'
)

test(
  'is-in: scalar string matches itself [coerce-list] [P-total]',
  '{logic is value :a in :a | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in: scalar string rejects non-match [coerce-list] [P-total]',
  '{logic is value :a in :b | logic if then :yes else :no}',
  'no'
)

// normal array — existing behavior preserved
test(
  'is-in: array finds member [P-total]',
  '{logic is value 2 in (1 2 3) | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in: array rejects non-member [P-total]',
  '{logic is value 9 in (1 2 3) | logic if then :yes else :no}',
  'no'
)

// empty list — always false
test(
  'is-in: empty list returns false [coerce-list] [P-total]',
  '{logic is value 1 in () | logic if then :yes else :no}',
  'no'
)

// block as "in" — coerced to empty array
test(
  'is-in: block as in returns false [coerce-list] [P-total]',
  '{logic is value 1 in "{1}" | logic if then :yes else :no}',
  'no'
)

// loose equality (== not ===) for string/number coercion
test(
  'is-in: string value found in number list via coercion [coerce-list] [P-total]',
  '{logic is value :2 in (1 2 3) | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in: number value found in string list via coercion [coerce-list] [P-total]',
  '{logic is value 2 in (:1 :2 :3) | logic if then :yes else :no}',
  'yes'
)

// zero membership
test(
  'is-in: zero found in list containing zero [coerce-list] [P-total]',
  '{logic is value 0 in (0 1 2) | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in: zero not found in list without zero [coerce-list] [P-total]',
  '{logic is value 0 in (1 2 3) | logic if then :yes else :no}',
  'no'
)

// original crash: pipe value is object, fills "in" implicitly
test(
  'is-in: object via pipe does not crash [coerce-list] [P-total]',
  '{:x | time stampwrap | logic is value __in | logic if then :yes else :no}',
  'no'
)


// =====================================================
// §4 Soft errors: pipeline continues with default value
// =====================================================

test(
  'unknown command returns empty and continues pipeline [sploot-value-cmd] [sploot-pipeline-continues]',
  '{5 | 123 | math add value 10 to 20}',
  '30'
)

test(
  'pipeline value unchanged when command not found [literal-produces-value]',
  '{42}',
  '42'
)


// =====================================================
// §3 Effectful commands: unwired returns default value
// =====================================================

test(
  'time now returns a timestamp (unwired, uses default handler) [effectful-unwired-sploot] [P-liveness]',
  '{time now | logic if then :yes else :no}',
  'yes'
)

test(
  'effectful command result flows through pipeline [pipe-flow] [P-total]',
  '{time now | __.stamp | logic is value __ like "/^[0-9]+$/" | logic if then :yes else :no}',
  'yes'
)


// =====================================================
// §3 Effectful commands: wired down port
// =====================================================

// Programmatic test for effectful commands in spaces
;(function() {
  // [P-duality] [handler-down-callback]
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
  // [P-handlersub] [handler-substitute]
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
  // [P-liveness] [timeout-resume-empty]
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
  // [timeout-ghost-drop]
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
  // [wiring-pattern-match] [demandport-create]
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
  // [wiring-other-fallback]
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
  // [sploot-error-port]
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
  'var write sets space variable [socket-crossboundary-var] [svar-write-path]',
  '{var write name :testvar value 42 | var read name :testvar}',
  '42'
)

test(
  'var read returns empty for unset variable [svar-read-unbound-sploot]',
  '{var read name :nonexistent}',
  ''
)


// =====================================================
// §6 Cross-boundary state: var read/write (wired)
// =====================================================

// When wired, var read/write go through down ports to a parent handler.
;(function() {
  // [socket-crossboundary-var] [P-spaceisolate]
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
  'space var copy: poke does not mutate original [P-copy] [I14]',
  '{(1 2 3) | >$x | poke 4 | >$y || $x | add}',
  '6'
)

test(
  'space var copy: remove does not mutate original [P-copy] [I14]',
  '{(1 2 3) | >$x | list remove by_value 2 || $x | add}',
  '6'
)


// =====================================================
// §6 Socket loading: load DAML source as subspace
// =====================================================

// loadSubspace parses DAML source and installs a new subspace at runtime.
;(function() {
  // [socket-load]
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
  // [socket-load] [socket-wiring-demand]
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
  // [serial-one-at-a-time] [queue-fifo]
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
  '>$x.path passes through original value [svar-write-path] [station-portsend-passthru]',
  '{* (:a 1) | >$pt1 | 42 | >$pt1.sub || $pt1}',
  '{"a":1,"sub":42}'
)

// The 42 should flow through, not the full {sub:42} object
test(
  '>$x.path passthrough value is the pipe input, not the poked object [svar-write-path] [station-portsend-passthru]',
  '{* (:a 1) | >$pt2 | 55 | >$pt2.b}',
  '55'
)

test(
  '>$x.path passthrough with nested path [svar-write-path] [station-portsend-passthru]',
  '{* (:a 1) | >$pt3 | :hello | >$pt3.b.c}',
  'hello'
)

test(
  '>$x.path self-reference poke passes through original [svar-write-path] [station-portsend-passthru]',
  '{* (:a 1 :b 2) | >$pt4 | >$pt4.c}',
  '{"a":1,"b":2}'
)


// =====================================================
// Key-preserving operations: reverse, sort, group by
// =====================================================

// Reverse on a keyed list should preserve keys (reverse insertion order).
test(
  'reverse preserves keys on keyed list [P-copy]',
  '{* (:x 3 :y 2 :z 4 :q 1) | list reverse}',
  '{"q":1,"z":4,"y":2,"x":3}'
)

// Reverse on an unkeyed list still returns an array.
test(
  'reverse on unkeyed list returns array [P-copy]',
  '{(3 2 4 1) | list reverse}',
  '[1,4,2,3]'
)

// Sort on a keyed list should preserve keys (reorder by value).
test(
  'sort preserves keys on keyed list [P-copy]',
  '{* (:c 3 :b 2 :a 1) | list sort}',
  '{"a":1,"b":2,"c":3}'
)

// Sort on an unkeyed list still returns an array.
test(
  'sort on unkeyed list returns array [P-copy]',
  '{(3 2 4 1) | list sort}',
  '[1,2,3,4]'
)

// Group by always returns an object (keyed list), even with integer keys.
// Note: integer-like string keys may be reordered by JS engines.
test(
  'group by with integer keys returns object [P-copy]',
  '{(1 2 3 4 5 6) | list group by "{__ | mod 2}"}',
  '{"0":[2,4,6],"1":[1,3,5]}'
)

// Group by with string keys returns object.
test(
  'group by with string keys returns object [P-copy]',
  '{( {* (:a :x :b 1)} {* (:a :z :b 2)} {* (:a :x :b 3)} ) | list group by :a}',
  '{"x":[{"a":"x","b":1},{"a":"x","b":3}],"z":[{"a":"z","b":2}]}'
)


// =====================================================
// Undefined pipeline variables: should behave as zero/empty
// =====================================================

// An undefined pipeline variable used as a math param should
// act as zero (false), not cause the pipe value to leak through.
test(
  'undefined pipeline var in range acts as zero [pvar-unbound-empty]',
  '{9 | range _asdf}',
  '[]'
)

test(
  'undefined pipeline var in subtract acts as zero [pvar-unbound-empty]',
  '{(1 2 3) | subtract _zxcv}',
  '[1,2,3]'
)

test(
  'undefined space var in subtract acts as zero [pvar-unbound-empty]',
  '{(1 2 3) | subtract $jklj}',
  '[1,2,3]'
)

test(
  'undefined pipeline var in add acts as zero [pvar-unbound-empty]',
  '{5 | add _nope}',
  '5'
)


// =====================================================
// || double pipe: error after || should not leak value
// =====================================================

// When the segment after || produces an error and is removed,
// the pre-|| value should not leak through as output.
test(
  'double pipe blocks value leak on error [pipe-barrier-vars] [compile-barrier-break]',
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
  'quote preserves original source despite synonymization [blockid-same] [P-contentaddr]',
  '{"{777}" | quote}',
  '{777}'
)
test(
  'quote preserves original source for alias-like blocks [blockid-same] [P-contentaddr]',
  '{"{xxx}" | quote}',
  '{xxx}'
)


// =====================================================
// Inner block scope inheritance
// =====================================================

// Inner blocks should automatically inherit parent pipeline variables.
test(
  'inner block inherits parent pipeline var [scope-pvar-inherit]',
  '{5 | >foo | (1 2 3) | map block "{__ | add _foo}"}',
  '[6,7,8]'
)

// Nested inheritance: grandchild block gets grandparent variable.
test(
  'nested inheritance: grandchild gets grandparent var [scope-pvar-inherit]',
  '{10 | >x | (1 2 3) | map block "{__ | >y | (1) | map block "{_y | add _x}"}"}',
  '[[11],[12],[13]]'
)

// Caller scope overrides inherited variable.
test(
  'caller scope overrides inherited var [scope-pvar-inherit]',
  '{99 | >x | (1 2 3) | map block "{_x}"}',
  '[99,99,99]'
)

// Pipeline var not used in same pipeline, only in inner block.
test(
  'pipeline var only used in inner block [scope-pvar-inherit] [P-blockscope]',
  '{42 | >secret | "{_secret}" | run}',
  '42'
)

// process.run with value param sets __in.
test(
  'process.run value param sets __in [pipe-dunderin]',
  '{"{__ | add 1}" | run value 7}',
  '8'
)

// Sort by keys using inherited variable.
test(
  'sort by keys via inherited variable [scope-pvar-inherit]',
  '{* (:c 3 :b 2 :a 4) | >l | list keys | sort | map block "{_l.{_value}}"}',
  '[4,2,3]'
)


// =====================================================
// §1 Peek: Name selector
// =====================================================

test(
  'peek Name: existing key [peek-key-hit] [keycoerce-string-keyed]',
  '{* (:a 1 :b 2 :c 3) | list peek path :b}',
  '2'
)

test(
  'peek Name: missing key returns empty [peek-key-miss]',
  '{* (:a 1 :b 2) | list peek path :z}',
  ''
)

test(
  'peek Name: nested key path [peek-key-hit]',
  '{* (:a {* (:x 10 :y 20)}) | list peek path (:a :y)}',
  '20'
)

test(
  'peek Name: missing nested key returns empty [peek-key-miss]',
  '{* (:a {* (:x 10)}) | list peek path (:a :z)}',
  ''
)

test(
  'peek Name: on non-collection returns empty [peek-scalar]',
  '{42 | list peek path :a}',
  ''
)


// =====================================================
// §1 Peek: Pos selector
// =====================================================

test(
  'peek Pos: existing position [peek-pos-hit] [pos-one-indexed]',
  '{(10 20 30) | list peek path "#2"}',
  '20'
)

test(
  'peek Pos: negative position (from end) [peek-pos-hit] [pos-negative]',
  '{(10 20 30) | list peek path "#-1"}',
  '30'
)

test(
  'peek Pos: out of bounds returns empty [peek-pos-miss]',
  '{(10 20 30) | list peek path "#5"}',
  ''
)

test(
  'peek Pos: nested position path [peek-pos-hit]',
  '{((1 2) (3 4) (5 6)) | list peek path ("#2" "#1")}',
  '3'
)


// =====================================================
// §1 Peek: Star selector
// =====================================================

test(
  'peek Star: all children of list [peek-star]',
  '{(10 20 30) | list peek path "*"}',
  '[10,20,30]'
)

test(
  'peek Star: all children of keyed list [peek-star]',
  '{* (:a 1 :b 2) | list peek path "*"}',
  '[1,2]'
)

test(
  'peek Star: empty list returns empty list [peek-star]',
  '{() | list peek path "*"}',
  '[]'
)

// Note: 42 is coerced to [42] by list type before peek sees it
test(
  'peek Star: on scalar (list-coerced) returns its children [peek-star] [coerce-list]',
  '{42 | list peek path "*"}',
  '[42]'
)

test(
  'peek Star: nested star-then-key [peek-star] [peek-key-hit]',
  '{(  {* (:x 1)} {* (:x 2)} {* (:x 3)}  ) | list peek path ("*" :x)}',
  '[1,2,3]'
)

test(
  'peek Star: nested star-then-pos [peek-star] [peek-pos-hit]',
  '{((10 20) (30 40) (50 60)) | list peek path ("*" "#2")}',
  '[20,40,60]'
)

// Star expands children, then Name on scalars returns empty for each
// Empty values stringify to nothing, so the result is an empty-looking list
test(
  'peek Star: star of scalars then Name returns empties [peek-star] [peek-scalar]',
  '{(1 2 3) | list peek path ("*" :a)}',
  '[]'
)


// =====================================================
// §1 Peek: Par selector
// =====================================================

test(
  'peek Par: multiple keys [peek-par]',
  '{* (:a 1 :b 2 :c 3) | list peek path ((:a :c))}',
  '[1,3]'
)

test(
  'peek Par: multiple positions [peek-par]',
  '{(10 20 30 40) | list peek path (("#1" "#3"))}',
  '[10,30]'
)


// =====================================================
// §1 Poke: Name selector — creates if missing
// =====================================================

test(
  'poke Name: update existing key [poke-key-update]',
  '{* (:a 1 :b 2) | list poke path :b value 99}',
  '{"a":1,"b":99}'
)

test(
  'poke Name: create missing key [poke-key-create]',
  '{* (:a 1) | list poke path :b value 99}',
  '{"a":1,"b":99}'
)

test(
  'poke Name: create nested path from existing [poke-key-create]',
  '{* (:a 1) | list poke path (:b :c) value 99}',
  '{"a":1,"b":{"c":99}}'
)

test(
  'poke Name: into empty creates structure [poke-key-empty]',
  '{() | list poke path (:x) value 42}',
  '{"x":42}'
)

test(
  'poke Name: deep nested create from empty [poke-key-empty]',
  '{() | list poke path (:a :b :c) value 42}',
  '{"a":{"b":{"c":42}}}'
)

test(
  'poke Name: key on array converts to object [WRONG:poke-key-unkeyed-fail] [sploot-passthru-poke]',
  '{(1 2 3) | list poke path :x value 99}',
  '{"0":1,"1":2,"2":3,"x":99}'
)

test(
  'poke Name: key on array mid-path converts to object [WRONG:poke-key-unkeyed-fail] [sploot-passthru-poke]',
  '{(10 20) | list poke path (:x :y) value 99}',
  '{"0":10,"1":20,"x":{"y":99}}'
)

test(
  'poke Name: scalar mid-path affine replaces with empty [poke-key-scalar-affine]',
  '{* (:a 42) | list poke path (:a :b) value 99}',
  '{"a":{"b":99}}'
)

test(
  'poke Name: scalar mid-path traversal skips [poke-key-scalar-traversal]',
  '{* (:a 42 :b 7) | list poke path ("*" :x) value 99}',
  '{"a":42,"b":7}'
)

test(
  'poke Name: scalar mid-path traversal with objects skips scalars [poke-key-scalar-traversal]',
  '{* (:a {* (:z 1)} :b 7) | list poke path ("*" :x) value 99}',
  '{"a":{"z":1,"x":99},"b":7}'
)


// =====================================================
// §1 Poke: Pos selector — modifies existing only
// =====================================================

test(
  'poke Pos: update existing position [poke-pos-update] [pos-one-indexed]',
  '{(10 20 30) | list poke path "#2" value 99}',
  '[10,99,30]'
)

test(
  'poke Pos: out-of-bounds position is no-op [poke-pos-oob]',
  '{(10 20) | list poke path "#4" value 99}',
  '[10,20]'
)

test(
  'poke Pos: position on empty list is no-op [poke-pos-empty]',
  '{() | list poke path "#2" value 99}',
  '[]'
)

test(
  'poke Pos: nested position path [poke-pos-update]',
  '{((1 2) (3 4)) | list poke path ("#2" "#1") value 99}',
  '[[1,2],[99,4]]'
)

test(
  'poke Pos: keyed list by insertion order [poke-pos-update] [pos-one-indexed]',
  '{* (:a 10 :b 20 :c 30) | list poke path "#2" value 99}',
  '{"a":10,"b":99,"c":30}'
)

test(
  'poke Pos: negative position from end [poke-pos-update] [pos-negative]',
  '{(10 20 30) | list poke path "#-1" value 99}',
  '[10,20,99]'
)

test(
  'poke Pos: negative position second from end [poke-pos-update] [pos-negative]',
  '{(10 20 30) | list poke path "#-2" value 99}',
  '[10,99,30]'
)

test(
  'poke Pos: mid-path in bounds traverses child [poke-pos-update]',
  '{((1 2) (3 4) (5 6)) | list poke path ("#2" "#2") value 99}',
  '[[1,2],[3,99],[5,6]]'
)

test(
  'poke Pos: mid-path out of bounds is no-op [poke-pos-oob]',
  '{((1 2) (3 4)) | list poke path ("#5" "#1") value 99}',
  '[[1,2],[3,4]]'
)


// =====================================================
// §1 Poke: Star — modify existing only, never create
// =====================================================

test(
  'poke Star: set all children [poke-star]',
  '{(1 2 3) | list poke path "*" value 0}',
  '[0,0,0]'
)

test(
  'poke Star: set all children of keyed list [poke-star]',
  '{* (:a 1 :b 2) | list poke path "*" value 0}',
  '{"a":0,"b":0}'
)

test(
  'poke Star: on empty list is no-op [poke-star-empty]',
  '{() | list poke path "*" value 99}',
  '[]'
)

test(
  'poke Star: nested star-then-pos modifies existing children [poke-star]',
  '{((1 2) (3 4)) | list poke path ("*" "#1") value 99}',
  '[[99,2],[99,4]]'
)

// Spec: star on scalar children is traversal → skip scalars (not replace).
// poke([1,2,3], ["*", :a], 99) → [1,2,3] because 1,2,3 are scalars
// and traversal (through Star) skips scalars.
test(
  'poke Star: star on scalars with further Name skips (traversal rule) [poke-star] [poke-star-scalar] [poke-key-scalar-traversal]',
  '{(1 2 3) | list poke path ("*" :a) value 99}',
  '[1,2,3]'
)

test(
  'poke Star: nested star-star on collections modifies all [poke-star]',
  '{((1 2) (3 4)) | list poke path ("*" "*") value 0}',
  '[[0,0],[0,0]]'
)

test(
  'poke Star: nested star-star on scalars is no-op [poke-star] [poke-star-scalar] [poke-key-scalar-traversal]',
  '{(1 2 3) | list poke path ("*" "*") value 0}',
  '[1,2,3]'
)

test(
  'poke Star: pos-then-star modifies one child [poke-star]',
  '{((1 2) (3 4)) | list poke path ("#2" "*") value 0}',
  '[[1,2],[0,0]]'
)

test(
  'poke Star: star into empty nested is no-op [poke-star] [poke-star-empty]',
  '{() | list poke path ("*" "*") value 99}',
  '[]'
)

test(
  'poke Star: star then key on objects sets key on each [poke-star] [poke-key-create]',
  '{({* (:x 1)} {* (:x 2)}) | list poke path ("*" :y) value 99}',
  '[{"x":1,"y":99},{"x":2,"y":99}]'
)

test(
  'poke Star: star on single scalar element skips [poke-star] [poke-star-scalar] [poke-midpath-local]',
  '{(42) | list poke path ("*" :a) value 99}',
  '[42]'
)

test(
  'poke Star: star on mixed scalars and objects skips scalars [poke-star] [poke-star-scalar] [poke-midpath-local]',
  '{(1 {* (:a 2)} 3) | list poke path ("*" :x) value 99}',
  '[1,{"a":2,"x":99},3]'
)

test(
  'poke Star: key then star sets all nested children [poke-star]',
  '{* (:a (1 2 3)) | list poke path (:a "*") value 0}',
  '{"a":[0,0,0]}'
)

test(
  'poke Star: star-star-star on nested collections [poke-star]',
  '{(((1 2) (3 4)) ((5 6))) | list poke path ("*" "*" "*") value 0}',
  '[[[0,0],[0,0]],[[0,0]]]'
)


// =====================================================
// §1 Poke: scalar base destroyed
// =====================================================

// Note: list poke coerces scalar to [scalar] via list type before D.poke sees it.
// The scalar-destroy behavior applies when D.poke receives a raw scalar (e.g. >$x.path).
// Through list poke, the string is wrapped as ["hello"], so poke operates on an array.
test(
  'poke: scalar base via list poke (coerced to array) [WRONG:poke-key-unkeyed-fail] [sploot-passthru-poke]',
  '{:hello | list poke path :a value 99}',
  '{"0":"hello","a":99}'
)

// >$x.path desugars to list poke, which coerces string to [string].
// So string scalars are preserved (wrapped), unlike blocks which coerce to [].
test(
  'poke: string base via >$x.path (coerced to array) [WRONG:poke-key-scalar-affine]',
  '{:hello | >$sp1 || 99 | >$sp1.a || $sp1}',
  '{"0":"hello","a":99}'
)

// Block base is destroyed because list type coerces Block to []
test(
  'poke: block base via >$x.path (block destroyed) [poke-key-scalar-affine]',
  '{"{:foo}x" | >$sp2 || 99 | >$sp2.a || $sp2}',
  '{"a":99}'
)


// =====================================================
// §1 Poke: Par selector
// =====================================================

test(
  'poke Par: multiple existing keys [poke-par-sequential]',
  '{* (:a 1 :b 2 :c 3) | list poke path ((:a :b)) value 99}',
  '{"a":99,"b":99,"c":3}'
)

test(
  'poke Par: create missing keys [poke-par-sequential]',
  '{* (:a 1) | list poke path ((:b :c)) value 99}',
  '{"a":1,"b":99,"c":99}'
)

test(
  'poke Par: multiple existing positions [poke-par-sequential]',
  '{(10 20 30 40) | list poke path (("#1" "#3")) value 99}',
  '[99,20,99,40]'
)

test(
  'poke Par: mixed key and position [poke-par-sequential]',
  '{* (:a 1 :b 2 :c 3) | list poke path ((:a "#3")) value 99}',
  '{"a":99,"b":2,"c":99}'
)

// Par is sequential: first sub-path sets #1 to 99, second sets #2 to 99
// Verify via peek that both positions were set
test(
  'poke Par: sequential left-to-right [poke-par-sequential]',
  '{(10 20 30) | list poke path (("#1" "#2")) value 99}',
  '[99,99,30]'
)

test(
  'poke Par: some out-of-bounds positions still set in-bounds [poke-par-sequential]',
  '{* (:a 1 :b 2 :c 3) | list poke path ((:b "#6" "#4")) value 999}',
  '{"a":1,"b":999,"c":3}'
)

test(
  'poke Par: mid-path then key on each [poke-par-sequential]',
  '{* (:a {* (:x 1)} :b {* (:x 2)}) | list poke path ((:a :b) :x) value 99}',
  '{"a":{"x":99},"b":{"x":99}}'
)

test(
  'poke Par: nested Par (Par then Par) [poke-par-sequential]',
  '{* (:a {* (:x 1 :y 2)} :b {* (:x 3 :y 4)}) | list poke path ((:a :b) (:x :y)) value 0}',
  '{"a":{"x":0,"y":0},"b":{"x":0,"y":0}}'
)

test(
  'poke Par: Par then star [poke-par-sequential]',
  '{* (:a (1 2) :b (3 4)) | list poke path ((:a :b) "*") value 0}',
  '{"a":[0,0],"b":[0,0]}'
)

test(
  'poke Par: star then Par [poke-par-sequential]',
  '{({* (:a 1 :b 2)} {* (:a 3 :b 4)}) | list poke path ("*" (:a :b)) value 0}',
  '[{"a":0,"b":0},{"a":0,"b":0}]'
)

test(
  'poke Par: empty Par is no-op [poke-par-sequential]',
  '{(1 2 3) | list poke path (()) value 99}',
  '[1,2,3]'
)

test(
  'poke Par: single-element Par same as plain key [poke-par-sequential]',
  '{* (:a 1 :b 2) | list poke path ((:a)) value 99}',
  '{"a":99,"b":2}'
)

test(
  'poke Par: duplicate sub-paths (idempotent) [poke-par-sequential]',
  '{* (:a 1 :b 2) | list poke path ((:a :a)) value 99}',
  '{"a":99,"b":2}'
)

test(
  'poke Par: position on array then Par keys creates structure [poke-par-sequential]',
  '{* (:a 1 :b 2 :c 3) | list poke path ("#2" (:d :e)) value 999}',
  '{"a":1,"b":{"d":999,"e":999},"c":3}'
)

test(
  'poke Par: nested Par on arrays [poke-par-sequential]',
  '{((2 1) (3 4) (4 5)) | list poke path (("#1" "#3") ("#2" "#4")) value 999}',
  '[[2,999],[3,4],[4,999]]'
)


// =====================================================
// §1 Poke: combinations and edge cases
// =====================================================

test(
  'poke Combo: key then position [poke-key-hit] [poke-pos-update]',
  '{* (:a (10 20 30)) | list poke path (:a "#2") value 99}',
  '{"a":[10,99,30]}'
)

test(
  'poke Combo: position then key [poke-pos-update] [poke-key-update]',
  '{({* (:x 1)} {* (:x 2)}) | list poke path ("#1" :x) value 99}',
  '[{"x":99},{"x":2}]'
)

test(
  'poke Combo: key then star [poke-key-hit] [poke-star]',
  '{* (:a (1 2 3)) | list poke path (:a "*") value 0}',
  '{"a":[0,0,0]}'
)

test(
  'poke Combo: deeply nested 4-level path [poke-key-hit] [poke-pos-update]',
  '{* (:a {* (:b {* (:c (1 2))})}) | list poke path (:a :b :c "#1") value 99}',
  '{"a":{"b":{"c":[99,2]}}}'
)

// >$xxx.#3 desugars to: save pipe, list poke data $xxx path ("#3") value pipe, >$xxx, restore pipe
// "{:foo}x" is a block → list coerces to [] → poke at #3 on empty → out of bounds → no-op → $xxx = []
test(
  'poke Combo: >$var.path block base with position out of bounds is no-op [WRONG:poke-pos-oob]',
  '{"{:foo}x" | >$xxx || 123 | >$xxx.#3 | $xxx}',
  '[]'
)

// Same but with a plain string: list coerces "hello" to ["hello"] → #3 out of bounds → no-op
test(
  'poke Combo: >$var.path string base with position out of bounds is no-op [WRONG:poke-pos-oob]',
  '{:hello | >$yyy || 123 | >$yyy.#3 | $yyy}',
  '["hello"]'
)


// =====================================================
// §1 Lens laws: PutGet — peek(poke(v, p, x), p) = x
// =====================================================

test(
  'PutGet: Name path [law-putget]',
  '{* (:a 1 :b 2) | list poke path :b value 42 | list peek path :b}',
  '42'
)

test(
  'PutGet: Pos path [law-putget]',
  '{(10 20 30) | list poke path "#2" value 42 | list peek path "#2"}',
  '42'
)

test(
  'PutGet: nested Name path [law-putget]',
  '{* (:a {* (:x 1)}) | list poke path (:a :x) value 42 | list peek path (:a :x)}',
  '42'
)

test(
  'PutGet: Name path creates then reads back [law-putget]',
  '{* (:a 1) | list poke path :z value 42 | list peek path :z}',
  '42'
)


// =====================================================
// §1 Lens laws: PutPut — poke(poke(v, p, x), p, y) = poke(v, p, y)
// =====================================================

test(
  'PutPut: last write wins for Name [law-putput]',
  '{* (:a 1) | list poke path :a value 10 | list poke path :a value 20}',
  '{"a":20}'
)

test(
  'PutPut: last write wins for Pos [law-putput]',
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
  'Star PutGet: poke star then peek star [law-putget] [poke-star] [peek-star]',
  '{(1 2 3) | list poke path "*" value 0 | list peek path "*"}',
  '[0,0,0]'
)

test(
  'Star PutPut: double star poke, last wins [law-putput] [poke-star]',
  '{(1 2 3) | list poke path "*" value 5 | list poke path "*" value 9}',
  '[9,9,9]'
)


// =====================================================
// §4 Totality: parser handles invalid block names
// =====================================================

// {begin $foo} has a non-\w+ name — parser should not crash
test(
  'parser: invalid block name does not crash [P-total] [parse-command]',
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
  'parse: trailing unmatched { is literal text [parse-unmatched-open]',
  'hello { world',
  'hello { world'
)

test(
  'parse: unmatched { among valid commands [parse-unmatched-open]',
  '{:ok} then { oops',
  'ok then { oops'
)

// --- Unmatched '{' does NOT eat subsequent valid commands ---

test(
  'parse: unmatched { followed by valid command [parse-unmatched-open]',
  'hey { wow {3 | math add value 2} bye',
  'hey { wow 5 bye'
)

test(
  'parse: unmatched { between two valid commands [parse-unmatched-open]',
  '{:a} { {3 | add 4}',
  'a { 7'
)

test(
  'parse: multiple unmatched { each become literal text [parse-unmatched-open]',
  'a { b { c',
  'a { b { c'
)

test(
  'parse: unmatched { then valid command then unmatched { [parse-unmatched-open]',
  '{ {3 | add 1} {',
  '{ 4 {'
)

// --- Lone '}' is literal text ---

test(
  'parse: lone } is literal text [parse-unmatched-close]',
  'hello } world',
  'hello } world'
)

test(
  'parse: } before valid command [parse-unmatched-close]',
  '} {3 | add 1}',
  '} 4'
)

test(
  'parse: } after valid command [parse-unmatched-close]',
  '{3 | add 1} }',
  '4 }'
)

// --- Structural brace matching vs quotes ---
// Brace matching is purely structural (no quote awareness).
// These tests document the current behavior, which can be
// surprising when braces appear inside string literals.

test(
  'parse: basic string in command [parse-brace-structural]',
  '{"hello"}',
  'hello'
)

test(
  'parse: { inside string breaks structural match [parse-brace-structural]',
  '{"he{lo"}',
  '{"he'
)

test(
  'parse: } inside string closes structural match early [parse-brace-structural]',
  '{"he}lo"}',
  'lo"}'
)

test(
  'parse: matched {} inside string balances structurally [parse-brace-structural]',
  '{"{}"}',
  ''
)

test(
  'parse: lone quote in braces [parse-brace-structural]',
  '{"}"}',
  '"}'
)

test(
  'parse: nested braces inside string balance structurally [parse-brace-structural]',
  '{"a{b}c"}',
  'ac'
)

test(
  'parse: block-like string evaluates [parse-block-quoted]',
  '{"{3 | add 1}"}',
  '4'
)

test(
  'parse: lone } among text and commands [parse-unmatched-close]',
  'x}y{3 | add 1}z',
  'x}y4z'
)

// Braces inside strings can break the enclosing pipeline by
// misaligning the structural brace match.

test(
  'parse: } in string eats rest of pipeline [parse-brace-structural]',
  '{"x}y" | (1 2)}',
  'y" | (1 2)}'
)

test(
  'parse: { in string eats rest of pipeline [parse-brace-structural]',
  '{"x{y" | (1 2)}',
  '{"x'
)

test(
  'parse: matched {} in string preserves pipeline [parse-brace-structural]',
  '{"x{}y" | (1 2)}',
  '[1,2]'
)

// --- Trivial inputs ---

test(
  'parse: empty input returns empty [P-total]',
  '',
  ''
)

test(
  'parse: plain text no braces [literal-produces-value]',
  'hello world',
  'hello world'
)

test(
  'parse: just whitespace [literal-produces-value]',
  '   ',
  '   '
)

test(
  'parse: empty command [P-total]',
  '{}',
  ''
)

test(
  'parse: double open brace [parse-unmatched-open]',
  '{{',
  '{{'
)

test(
  'parse: double close brace [parse-unmatched-close]',
  '}}',
  '}}'
)

test(
  'parse: close then open brace [parse-unmatched-close] [parse-unmatched-open]',
  '}{',
  '}{'
)

// --- Nested braces ---

test(
  'parse: double-wrapped command [parse-brace-structural]',
  '{{3 | add 1}}',
  '4'
)

test(
  'parse: adjacent commands [parse-brace-structural]',
  '{3 | add 1}{5 | add 2}',
  '47'
)

test(
  'parse: three adjacent commands [parse-brace-structural]',
  '{1}{2}{3}',
  '123'
)

// --- Namedblock priority over regular command ---

test(
  'parse: namedblock takes priority [parse-begin-end-match]',
  '{begin foo}hello{end foo}',
  'hello'
)

test(
  'parse: namedblock with commands inside [parse-begin-end-match]',
  '{begin foo}x {3 | add 1} y{end foo}',
  'x 4 y'
)

test(
  'parse: namedblock empty body [parse-begin-end-match]',
  '{begin foo}{end foo}',
  ''
)

test(
  'parse: namedblock with numeric name [parse-begin-end-match]',
  '{begin 123}body{end 123}',
  'body'
)

test(
  'parse: nested different-name namedblocks [parse-begin-end-match]',
  '{begin a}x{begin b}y{end b}z{end a}',
  'xyz'
)

test(
  'parse: nested same-name takes first end tag [parse-begin-end-match]',
  '{begin a}x{end a}y{end a}',
  'xy'
)

test(
  'parse: end tag without begin is a command [parse-command]',
  '{end foo}',
  ''
)

test(
  'parse: begin with no space is regular command [parse-command]',
  '{beginfoo}',
  ''
)

test(
  'parse: namedblock end tag inside opening pipeline is not matched [parse-begin-end-match]',
  '{begin name | "{end name}" | 123}yo{end name}',
  '123'
)

// When {begin NAME} has no matching {end NAME}, the balanced span
// is treated as a regular command. 'begin' is not a handler, so it
// soft-errors and produces empty. The rest is literal text.
test(
  'parse: namedblock missing end tag falls back to command [parse-begin-no-end]',
  '{begin foo} oops no end tag',
  ' oops no end tag'
)

test(
  'parse: begin no end with valid command after [parse-begin-no-end]',
  '{begin foo}body {3 | add 1} trail',
  'body 4 trail'
)

test(
  'parse: mismatched begin/end names falls back to command [parse-begin-no-end]',
  '{begin foo}{end bar}',
  ''
)

test(
  'parse: mismatched names with stuff after [parse-begin-no-end]',
  '{begin foo}{end bar} and {3 | add 1}',
  ' and 4'
)

// --- Nested braces ---

test(
  'parse: nested braces match correctly [parse-brace-structural]',
  '{(1 2 3) | map block "{__ | add 1}"}',
  '[2,3,4]'
)

test(
  'parse: adjacent commands both parse [parse-brace-structural]',
  '{3 | add 1}{:x}',
  '4x'
)

// --- Mixed unmatched and valid braces ---

test(
  'parse: text, command, unmatched, command, text [parse-unmatched-open] [parse-brace-structural]',
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
  'from code: open curly brace [parse-code-curlies]',
  '{string from code 123}',
  '{'
)

test(
  'from code: close curly brace [parse-code-curlies]',
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
  'from code: open curly stored in pipeline var [parse-code-curlies]',
  '{string from code 123 | >brace || _brace}',
  '{'
)

test(
  'from code: close curly stored in space var [parse-code-curlies]',
  '{string from code 125 | >$cb || $cb}',
  '}'
)

test(
  'from code: both curlies round-trip through vars [parse-code-curlies]',
  '{string from code 123 | >$ob || string from code 125 | >$cb || ($ob :hi $cb) | join}',
  '{hi}'
)


// =====================================================
// string from code: assemble DAML command and run it
// =====================================================

test(
  'from code: assemble DAML from curly chars and execute [parse-code-curlies] [P-uniformeval]',
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
  '[]'
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

// --- scalar data (not list-of-lists) → [] ---

test('zip: scalar number',
  '{zip 42}',
  '[]'
)

test('zip: scalar string',
  '{zip :hello}',
  '[]'
)

test('zip: scalar negative number',
  '{zip -7}',
  '[]'
)

test('zip: scalar 1',
  '{zip 1}',
  '[]'
)

// --- flat list (elements aren't arrays) → [] ---

test('zip: flat string list',
  '{(:a :b :c) | zip}',
  '[]'
)

test('zip: flat number list',
  '{(42 43 44) | zip}',
  '[]'
)

// --- falsy/empty data → [] ---

test('zip: zero',
  '{zip 0}',
  '[]'
)

// --- empty inner lists ---

test('zip: single empty inner list',
  '{(()) | zip}',
  '[]'
)

test('zip: two empty inner lists',
  '{(() ()) | zip}',
  '[]'
)

test('zip: first inner list empty',
  '{(() (1 2)) | zip}',
  '[]'
)

test('zip: second inner list empty',
  '{((1 2) ()) | zip}',
  '[[1,null],[2,null]]'
)

// --- mixed types (first element is array, others aren't) ---

test('zip: mixed array and string in list',
  '{((1 2) :a (3 4)) | zip}',
  '[[1,"a",3],[2,null,4]]'
)

// --- ragged inner lists ---

test('zip: three lists different lengths',
  '{((1 2) (3 4 5 6) (7)) | zip}',
  '[[1,3,7],[2,4,null]]'
)

// --- also param edge cases ---

test('zip: scalar data with also list',
  '{42 | zip also (1 2 3)}',
  '[[1,42],[2,null],[3,null]]'
)

test('zip: list data with scalar also',
  '{(1 2 3) | zip also 42}',
  '[[42,1]]'
)

test('zip: scalar data with scalar also',
  '{42 | zip also 99}',
  '[[99,42]]'
)

test('zip: also shorter than data',
  '{(1 2 3) | zip also (4 5)}',
  '[[4,1],[5,2]]'
)

// --- single-element inner lists ---

test('zip: single-element inner lists',
  '{((1) (2) (3)) | zip}',
  '[[1,2,3]]'
)

test('zip: single-element string inner lists',
  '{((:a) (:b)) | zip}',
  '[["a","b"]]'
)

// --- nested arrays (valid list-of-lists-of-lists) ---

test('zip: nested arrays as elements',
  '{(((1 2) (3 4)) ((5 6) (7 8))) | zip}',
  '[[[1,2],[5,6]],[[3,4],[7,8]]]'
)


// =====================================================
// No-mutation tests for mutable-list commands
// =====================================================

// map: source list unchanged after mapping
test('map: no mutation [P-copy] [I14]',
  '{(1 2 3) | >$x || $x | list map block "{__ | add 10}" || $x}',
  '[1,2,3]'
)

// filter: source list unchanged after filtering
test('filter: no mutation [P-copy] [I14]',
  '{(1 2 3 4 5) | >$x || $x | list filter block "{__ | mod 2}" || $x}',
  '[1,2,3,4,5]'
)

// sort: source list unchanged after sorting
test('sort: no mutation [P-copy] [I14]',
  '{(3 1 2) | >$x || $x | list sort || $x}',
  '[3,1,2]'
)

// rekey: source list unchanged after rekeying
test('rekey: no mutation [P-copy] [I14]',
  '{list pair data (:a 1 :b 2) | >$x || $x | list rekey by "{__ | add 10}" || $x}',
  '{"a":1,"b":2}'
)

// group: source list unchanged after grouping
test('group: no mutation [P-copy] [I14]',
  '{list pair data (:a 1 :b 2) | >$x || $x | list group by "{__ | mod 2}" || $x}',
  '{"a":1,"b":2}'
)


// =====================================================
// §Map: path parameter + _index/_path injection
// =====================================================

// Backward compatibility (no path = default star)
test('map: no path, array [map-default-star]',
  '{(1 2 3) | list map block "{__ | add 10}"}',
  '[11,12,13]'
)
test('map: no path, object [map-default-star]',
  '{* (:x 1 :y 2) | list map block "{__ | add 10}"}',
  '{"x":11,"y":12}'
)

// Explicit star
test('map: explicit star path [map-default-star]',
  '{(1 2 3) | list map path ("*") block "{__ | add 10}"}',
  '[11,12,13]'
)

// Key path
test('map: key path hits [map-no-add]',
  '{* (:a 1 :b 2) | list map path (:a) block "{__ | add 10}"}',
  '{"a":11,"b":2}'
)
test('map: key path misses [map-no-add]',
  '{* (:a 1 :b 2) | list map path (:c) block "{__ | add 10}"}',
  '{"a":1,"b":2}'
)

// Position path
test('map: position path [map-no-add]',
  '{(10 20 30) | list map path ("#2") block "{__ | add 100}"}',
  '[10,120,30]'
)

// Nested paths
test('map: nested key+star [map-no-add] [peek-star]',
  '{* (:items (1 2 3)) | list map path (:items "*") block "{__ | add 10}"}',
  '{"items":[11,12,13]}'
)
test('map: star+position [map-no-add] [peek-star]',
  '{((1 2) (3 4)) | list map path ("*" "#1") block "{__ | add 100}"}',
  '[[101,2],[103,4]]'
)
test('map: star+key across objects [map-no-add] [peek-star]',
  '{* (:a {* (:x 1 :y 2)} :b {* (:x 3)}) | list map path ("*" :x) block "{__ | add 10}"}',
  '{"a":{"x":11,"y":2},"b":{"x":13}}'
)

// Scalar mid-path (unchanged)
test('map: scalar mid-path, all scalars [map-scalar-unchanged]',
  '{(1 2 3) | list map path ("*" :foo) block "{__ | add 10}"}',
  '[1,2,3]'
)
test('map: scalar mid-path, mixed [map-scalar-unchanged]',
  '{* (:a 42 :b {* (:x 1)}) | list map path ("*" :x) block "{__ | add 10}"}',
  '{"a":42,"b":{"x":11}}'
)

// Par
test('map: par path',
  '{* (:a 1 :b 2 :c 3) | list map path ((:a :c)) block "{__ | add 10}"}',
  '{"a":11,"b":2,"c":13}'
)

// _path injection
test('map: _path at top level [map-block-scope] [scope-inject-index]',
  '{(10 20 30) | list map block "{_path}"}',
  '[["0"],["1"],["2"]]'
)

// _index injection
test('map: _index array [scope-inject-index]',
  '{(:x :y :z) | list map block "{_index}"}',
  '[0,1,2]'
)
test('map: _index object [scope-inject-index]',
  '{* (:a 10 :b 20) | list map block "{_index}"}',
  '{"a":0,"b":1}'
)

// _key injection (existing behavior preserved)
test('map: _key object [scope-inject-key]',
  '{* (:a 1 :b 2) | list map block "{_key}"}',
  '{"a":"a","b":"b"}'
)

// Position resolves to 0-indexed key in _path
test('map: position resolves in _path [map-block-scope]',
  '{(10 20 30) | list map path ("#2") block "{_path}"}',
  '[10,["1"],30]'
)

// Empty collection
test('map: empty collection [map-default-star]',
  '{() | list map path ("*") block "{__ | add 10}"}',
  '[]'
)

// Deep rebuild
test('map: deep rebuild with position [map-no-add]',
  '{* (:a (1 2 3) :b (4 5 6)) | list map path (:a "#2") block "{__ | math multiply value 10}"}',
  '{"a":[1,20,3],"b":[4,5,6]}'
)

// No mutation
test('map: no mutation with path [P-copy] [I14]',
  '{* (:a (1 2 3)) | >$x || $x | list map path (:a "*") block "{__ | add 10}" || $x}',
  '{"a":[1,2,3]}'
)


// =====================================================
// list reduce: non-array data (totality)
// =====================================================

// normal array — existing behavior
test('reduce: sum array [P-total]',
  '{(1 2 3 4) | list reduce block "{_total | add _value}"}',
  '10'
)

test('reduce: two elements [P-total]',
  '{(10 5) | list reduce block "{_total | add _value}"}',
  '15'
)

// single element — returned as-is, no block invocation
test('reduce: single element array [P-total]',
  '{(42) | list reduce block "{_total | add _value}"}',
  '42'
)

// empty list — returns empty list
test('reduce: empty list [P-total] [empty-coerce-list]',
  '{() | list reduce block "{_total | add _value}"}',
  '[]'
)

// scalar data — list coercion wraps in array, single element returned
test('reduce: scalar number [P-total] [coerce-list]',
  '{99 | list reduce block "{_total | add _value}"}',
  '99'
)

test('reduce: scalar string [P-total] [coerce-list]',
  '{:hello | list reduce block "{_total | add _value}"}',
  'hello'
)

// keyed list (object) — values extracted and reduced
test('reduce: keyed list sums values [P-total]',
  '{(:a 1 :b 2 :c 3) | * | list reduce block "{_total | add _value}"}',
  '6'
)

test('reduce: two-element keyed list [P-total]',
  '{(:x 10 :y 20) | * | list reduce block "{_total | add _value}"}',
  '30'
)

// keyed list with string values
test('reduce: keyed list string concat [P-total]',
  '{(:a :foo :b :bar) | * | list reduce block "{(_total _value) | string join}"}',
  'foobar'
)

// reduce via pipeline var holding object
test('reduce: object from pipeline var [P-total]',
  '{(:p 5 :q 3) | * | >obj || _obj | list reduce block "{_total | add _value}"}',
  '8'
)

// object from effectful command (the original crash pattern)
test('reduce: object piped into reduce does not crash [P-total]',
  '{:x | time stampwrap | list reduce block "{_total | add _value}" | logic is value __ like "/^[0-9]+$/" | logic if then :yes else :no}',
  'yes'
)

// reduce preserves order of array
test('reduce: subtraction is order-dependent [P-total]',
  '{(100 30 20 10) | list reduce block "{_total | math subtract value _value}"}',
  '40'
)

// =====================================================
// OPT_simple_math: NaN guard on optimized add/multiply
// =====================================================

// original bug: log(0) = -Infinity, -Infinity * 0 = NaN
test('opt math: log then multiply 0 [P-total] [total-cmd-value]',
  '{math log | multiply 0}',
  '0'
)

test('opt math: log value 0 then multiply 0 [P-total] [total-cmd-value]',
  '{math log value 0 | multiply 0}',
  '0'
)

// +Infinity * 0 = NaN
test('opt math: pow overflow then multiply 0 [P-total] [total-cmd-value]',
  '{math pow value 10 exp 999 | multiply 0}',
  '0'
)

// -Infinity from divide, then * 0
test('opt math: negative infinity times 0 [P-total] [total-cmd-value]',
  '{0 | math subtract value 1 | math divide value 0 | multiply 0}',
  '0'
)

// ±Infinity + 0 should stay ±Infinity (not NaN, not clamped)
test('opt math: negative infinity add 0 [P-total] [total-cmd-value]',
  '{math log | add 0}',
  '-Infinity'
)

test('opt math: positive infinity add 0 [P-total] [total-cmd-value]',
  '{math pow value 10 exp 999 | add 0}',
  'Infinity'
)

// normal optimized multiply
test('opt math: multiply normal [P-total] [total-cmd-value]',
  '{5 | multiply 3}',
  '15'
)

test('opt math: multiply negative [P-total] [total-cmd-value]',
  '{-5 | multiply 3}',
  '-15'
)

test('opt math: multiply by 0 [P-total] [total-cmd-value]',
  '{999 | multiply 0}',
  '0'
)

test('opt math: multiply negative by 0 [P-total] [total-cmd-value]',
  '{-999 | multiply 0}',
  '0'
)

test('opt math: zero times large [P-total] [total-cmd-value]',
  '{0 | multiply 999}',
  '0'
)

// normal optimized add
test('opt math: add normal [P-total] [total-cmd-value]',
  '{5 | add 3}',
  '8'
)

test('opt math: add to zero [P-total] [total-cmd-value]',
  '{0 | add 0}',
  '0'
)

test('opt math: add cancellation [P-total] [total-cmd-value]',
  '{-3 | add 3}',
  '0'
)

// non-number pipe falls back to command (not optimized fast path)
test('opt math: string times number [P-total] [total-cmd-value] [coerce-number]',
  '{:hello | multiply 5}',
  '0'
)

test('opt math: string plus number [P-total] [total-cmd-value] [coerce-number]',
  '{:hello | add 5}',
  '5'
)

// =====================================================
// list poke: star path on scalar/null children (totality)
// =====================================================

// original crash: star expands scalar children, poke tries to set property on null
test('poke: star path on scalar does not crash [P-total] [poke-key-scalar-traversal]',
  '{-Infinity | list poke path ("*" :b) value 1}',
  '[""]'
)

test('poke: star path on number does not crash [P-total] [poke-key-scalar-traversal]',
  '{42 | list poke path ("*" :c) value 1}',
  '[42]'
)

test('poke: star path on string does not crash [P-total] [poke-key-scalar-traversal]',
  '{:hello | list poke path ("*" :b) value 1}',
  '["hello"]'
)

test('poke: deep star path on scalar does not crash [P-total] [poke-key-scalar-traversal]',
  '{-Infinity | list poke path ("*" -1 :c) value :y}',
  '[""]'
)

// =====================================================
// string transform: empty from with large to (totality)
// =====================================================

// original crash: empty from → /(?:)/g, huge to string → "Invalid string length"
test('transform: empty from returns value unchanged [P-total]',
  '{string transform value :hello to :X}',
  'hello'
)

test('transform: large to with empty from does not crash [P-total]',
  '{process dialect | string transform to __ | logic is value __ like "/list/" | logic if then :yes else :no}',
  'yes'
)

// normal transform still works
test('transform: basic replacement [P-total]',
  '{string transform value :abcabc from :b to :B}',
  'aBcaBc'
)

// =====================================================
// math min/max: large array stack overflow (totality)
// =====================================================

// original crash: Math.min.apply(null, hugeArray) blows the call stack
test('min: large array does not stack overflow [P-total]',
  '{list range length 200000 | math min}',
  '1'
)

test('max: large array does not stack overflow [P-total]',
  '{list range length 200000 | math max}',
  '200000'
)

// normal behavior preserved
test('min: small array [P-total]',
  '{math min value (5 3 8 1)}',
  '1'
)

test('max: small array [P-total]',
  '{math max value (5 3 8 1)}',
  '8'
)

test('min: with also param [P-total]',
  '{math min value 5 also 3}',
  '3'
)

test('max: with also param [P-total]',
  '{math max value 5 also 8}',
  '8'
)

test('min: single element [P-total]',
  '{math min value 42}',
  '42'
)

test('max: single element [P-total]',
  '{math max value 42}',
  '42'
)

// =====================================================
// list merge/group/rekey: null items in data (totality)
// =====================================================

// merge: null item from unset pipeline var via __
test('merge: null item in data does not crash [P-total]',
  '{_x | list merge data (__ :a :b) block "{__}"}',
  'ab'
)

test('merge: null item mid-data [P-total]',
  '{_x | list merge data (:key 0.001 __ 42) block "{__}"}',
  'key0.00142'
)

// group: null item with string by path
test('group: null item with string by does not crash [P-total]',
  '{_x | list group by :a data (:foo __ :bar) | logic if then :yes else :no}',
  'yes'
)

test('group: null item with numeric by path [P-total]',
  '{>@result | list group by 999999 data (:a -100 __ -100) | logic if then :yes else :no}',
  'yes'
)

// rekey: null item with string by path
test('rekey: null item with string by does not crash [P-total]',
  '{_x | list rekey data (__ :a :b) by :foo | logic if then :yes else :no}',
  'yes'
)

// =====================================================
// logic switch: null-prototype objects (totality)
// =====================================================

// original crash: splooted object (null prototype) in value list, == throws on ToPrimitive
// match comes AFTER the object entry, so crash prevents reaching it
test('switch: null-proto object before match in value list [P-total]',
  '{(:x :y) | * | >obj || logic switch on :b value (_obj :wrong :b :yes)}',
  'yes'
)

// null-proto object as the "on" value compared against primitives
test('switch: null-proto object as on value [P-total]',
  '{(:a :b) | * | logic switch value 1 | logic if then :yes else :no}',
  'no'
)

// object in value list with no match — should return false, not crash
test('switch: null-proto object in value list no match [P-total]',
  '{(:x :y) | * | >obj || logic switch on :z value (_obj :wrong :b :also_wrong) | logic if then :yes else :no}',
  'no'
)

// normal switch still works
test('switch: normal string match [P-total]',
  '{logic switch on :b value (:a :alpha :b :beta)}',
  'beta'
)

test('switch: normal number match [P-total]',
  '{logic switch on 2 value (1 :one 2 :two 3 :three)}',
  'two'
)

test('switch: no match returns false [P-total]',
  '{logic switch on :z value (:a 1 :b 2) | logic if then :yes else :no}',
  'no'
)

// =====================================================
// list sort: null elements in data (totality)
// =====================================================

// original crash: unset _key → null in list, sort by string path hits null["-1"]
test('sort: null element with string by path [P-total]',
  '{_key | list sort data (__ :foo :bar) by -1}',
  '["bar","foo",""]'
)

test('sort: null element with block by [P-total]',
  '{_key | list sort data (__ :foo :bar) by "{__ | multiply -1}"}',
  '["bar","foo",""]'
)

test('sort: null element no by (natural sort) [P-total]',
  '{_key | list sort data (__ :b :a)}',
  '["","a","b"]'
)

test('sort: null element mid-list [P-total]',
  '{_key | (3 __ 1) | list sort}',
  '["",1,3]'
)

test('sort: multiple null elements [P-total]',
  '{_key | (__ __ :a) | list sort}',
  '["","","a"]'
)

test('sort: null from pipe into sort with by [P-total]',
  '{_key | (__ :a :b) | list sort by -1}',
  '["b","a",""]'
)

// =====================================================
// list union: null elements in values array (totality)
// =====================================================

// original crash: >$x returns null, __ picks it up, union iterates null
test('union: null element from >$ pipe value [P-total]',
  '{>$data | union (__ -100 "abc def")}',
  '["",-100,"abc def"]'
)

test('union: null __ with number in list [P-total]',
  '{>$x | union (__ 2)}',
  '["",2]'
)

test('union: null __ mid-list [P-total]',
  '{>$x | union (1 __ 3)}',
  '[1,"",3]'
)

test('union: pre-evaluated list with null element [P-total]',
  '{>$x | (__ 1) | list union}',
  '["",1]'
)

test('union: multiple null elements [P-total]',
  '{>$x | union (__ __)}',
  '["",""]'
)

// also param with null-bearing list
test('union: also list contains null element [P-total]',
  '{>$x | list union data (1 2) also (__ 3)}',
  '["",3,1,2]'
)

// nested lists with null
test('union: nested lists with null element [P-total]',
  '{>$x | union ((__ 1) (2 3))}',
  '["",1,2,3]'
)

// --- existing behavior preserved ---

test('union: basic list of lists [P-total]',
  '{((1 2) (3 4)) | list union}',
  '[1,2,3,4]'
)

test('union: data + also [P-total]',
  '{(1 2 3) | list union also (4 5)}',
  '[4,5,1,2,3]'
)

test('union: empty string elements [P-total]',
  '{(("" 1) (2 3)) | list union}',
  '["",1,2,3]'
)

test('union: zero elements [P-total]',
  '{((0 1) (2 3)) | list union}',
  '[0,1,2,3]'
)

test('union: scalar data [P-total]',
  '{42 | list union}',
  '[42]'
)

test('union: empty list [P-total]',
  '{() | list union}',
  '[]'
)

test('union: no args [P-total]',
  '{list union}',
  '[]'
)

// sparse array from poke — holes at indices 0-3
test('union: sparse array does not crash [P-total]',
  '{ list poke path (4) value () | union }',
  '[]'
)

// sparse array with object element — hits keyed-list union path
test('union: sparse array with object does not crash [P-total]',
  '{ list poke path (4 :0 :x) value :key | list union }',
  '{"0":{"x":"key"}}'
)

test('union: large array does not stack overflow [P-total]',
  '{range 200000 | union | list count}',
  '200000'
)

// =====================================================
// §I1 Effect separation: every command has fun XOR effect
// =====================================================

;(function() { // [P-effectpartition]
  pending++

  // Known violations: commands that currently have BOTH fun and effect.
  // The spec says effectful commands have no fun (§4 line 629), but these
  // use fun as a default handler when the port is unwired.
  var known_both = ['time.now', 'var.read', 'var.write']

  var pure = 0, effectful = 0, both = 0, neither = 0
  var unexpected_both = []
  var unexpected_neither = []

  for (var handler in D.Commands) {
    var methods = D.Commands[handler].methods
    if (!methods) continue
    for (var method in methods) {
      var m = methods[method]
      var has_fun = typeof m.fun === 'function'
      var has_effect = !!m.effect
      var name = handler + '.' + method

      if (has_fun && has_effect) {
        both++
        if (known_both.indexOf(name) === -1) unexpected_both.push(name)
      } else if (has_fun) {
        pure++
      } else if (has_effect) {
        effectful++
      } else {
        neither++
        unexpected_neither.push(name)
      }
    }
  }

  var ok = unexpected_both.length === 0 && unexpected_neither.length === 0
  if (ok) {
    pass++
  } else {
    fail++
    var msg = ''
    if (unexpected_both.length) msg += 'unexpected fun+effect: ' + unexpected_both.join(', ') + '. '
    if (unexpected_neither.length) msg += 'no fun or effect: ' + unexpected_neither.join(', ')
    failures.push({
      label: 'effect separation: fun XOR effect',
      input: '(structural check of D.Commands)',
      expected: 'every command has fun XOR effect (known_both: ' + known_both.join(', ') + ')',
      actual: msg
    })
  }
  pending--
  if (all_registered && pending === 0) report()
})()


// =====================================================
// §I2 Handler independence: same program, different handlers, same responses → same behavior
// =====================================================

// Two spaces run the same DAML. Each has a different handler for time-now
// that logs requests and replays the same canned response.
// The request logs and outputs must be identical.

;(function() { // [P-handlersub] [handler-substitute]
  pending++

  var daml = '{time now | __.stamp | math add value 1}'
  var seed_template =
    'NAME\n' +
    '  @effect down time-now\n' +
    '  @init from-js start\n' +
    '  @out  to-js\n' +
    '  @init -> ' + daml + ' -> @out\n'

  var seed_id_a = D.make_some_space(seed_template.replace('NAME', 'handler_indep_a'))
  var seed_id_b = D.make_some_space(seed_template.replace('NAME', 'handler_indep_b'))

  if (typeof seed_id_a !== 'number' || typeof seed_id_b !== 'number') {
    fail++
    failures.push({
      label: 'handler independence: space setup',
      input: '(space setup)',
      expected: 'two seed_id numbers',
      actual: 'a=' + seed_id_a + ' b=' + seed_id_b
    })
    pending--
    return
  }

  var space_a = new D.Space(seed_id_a)
  var space_b = new D.Space(seed_id_b)

  var log_a = [], log_b = []
  var output_a = null, output_b = null
  var done_a = false, done_b = false

  function setup_space(space, log, handler_fn, on_output) {
    var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
    var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })
    var down_port = space.ports.find(function(p) { return p.flavour === 'down' })

    if (!from_port || !to_port || !down_port) return false

    down_port.pair.outside_exit = function(ship, callback) {
      log.push(JSON.parse(JSON.stringify(ship)))
      handler_fn(ship, callback)
    }

    to_port.pair.outside_exit = function(value) {
      on_output(String(value))
    }

    from_port.pair.enter('start')
    return true
  }

  function check_done() {
    if (!done_a || !done_b) return

    var logs_match = JSON.stringify(log_a) === JSON.stringify(log_b)
    var outputs_match = output_a === output_b && output_a === '43'

    if (logs_match && outputs_match) {
      pass++
    } else {
      fail++
      var msg = ''
      if (!logs_match) msg += 'request logs differ: A=' + JSON.stringify(log_a) + ' B=' + JSON.stringify(log_b) + '. '
      if (!outputs_match) msg += 'outputs: A=' + output_a + ' B=' + output_b + ' (expected 43)'
      failures.push({
        label: 'handler independence: same responses → same behavior',
        input: daml,
        expected: 'identical request logs and output=43',
        actual: msg
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  // Handler A: responds synchronously
  var ok_a = setup_space(space_a, log_a, function(ship, callback) {
    callback({ stamp: 42 })
  }, function(v) { output_a = v; done_a = true; check_done() })

  // Handler B: responds via setTimeout (different implementation, same value)
  var ok_b = setup_space(space_b, log_b, function(ship, callback) {
    setTimeout(function() { callback({ stamp: 42 }) }, 1)
  }, function(v) { output_b = v; done_b = true; check_done() })

  if (!ok_a || !ok_b) {
    fail++
    failures.push({
      label: 'handler independence: port setup',
      input: '(port setup)',
      expected: 'all ports found',
      actual: 'a=' + ok_a + ' b=' + ok_b
    })
    pending--
  }
})()


// =====================================================
// §I3 Serializability: same DAML in independent spaces → same behavior
// =====================================================

// Two completely independent spaces, constructed separately, run the same DAML source.
// Recording handlers provide identical canned responses.
// Request logs and outputs must be identical.

;(function() { // [P-portable] [outer-independent]
  pending++

  var daml = '{time now | __.stamp | math add value 10}'

  function make_space(name) {
    var seed_id = D.make_some_space(
      name + '\n' +
      '  @effect down time-now\n' +
      '  @init from-js start\n' +
      '  @out  to-js\n' +
      '  @init -> ' + daml + ' -> @out\n'
    )
    if (typeof seed_id !== 'number') return null
    return new D.Space(seed_id)
  }

  var space_a = make_space('serial_a')
  var space_b = make_space('serial_b')

  if (!space_a || !space_b) {
    fail++
    failures.push({
      label: 'serializability: space setup',
      input: '(space setup)',
      expected: 'two independent spaces',
      actual: 'a=' + !!space_a + ' b=' + !!space_b
    })
    pending--
    return
  }

  var log_a = [], log_b = []
  var output_a = null, output_b = null
  var done_a = false, done_b = false

  function wire_space(space, log, on_output) {
    var from_port = space.ports.find(function(p) { return p.flavour === 'from-js' })
    var to_port = space.ports.find(function(p) { return p.flavour === 'to-js' })
    var down_port = space.ports.find(function(p) { return p.flavour === 'down' })

    if (!from_port || !to_port || !down_port) return false

    down_port.pair.outside_exit = function(ship, callback) {
      log.push(JSON.parse(JSON.stringify(ship)))
      callback({ stamp: 42 })
    }

    to_port.pair.outside_exit = function(value) {
      on_output(String(value))
    }

    from_port.pair.enter('start')
    return true
  }

  function check_done() {
    if (!done_a || !done_b) return

    var logs_match = JSON.stringify(log_a) === JSON.stringify(log_b)
    var outputs_match = output_a === output_b && output_a === '52'

    if (logs_match && outputs_match) {
      pass++
    } else {
      fail++
      var msg = ''
      if (!logs_match) msg += 'request logs differ: A=' + JSON.stringify(log_a) + ' B=' + JSON.stringify(log_b) + '. '
      if (!outputs_match) msg += 'outputs: A=' + output_a + ' B=' + output_b + ' (expected 52)'
      failures.push({
        label: 'serializability: independent spaces, same DAML → same behavior',
        input: daml,
        expected: 'identical request logs and output=52',
        actual: msg
      })
    }
    pending--
    if (all_registered && pending === 0) report()
  }

  var ok_a = wire_space(space_a, log_a, function(v) { output_a = v; done_a = true; check_done() })
  var ok_b = wire_space(space_b, log_b, function(v) { output_b = v; done_b = true; check_done() })

  if (!ok_a || !ok_b) {
    fail++
    failures.push({
      label: 'serializability: port setup',
      input: '(port setup)',
      expected: 'all ports found',
      actual: 'a=' + ok_a + ' b=' + ok_b
    })
    pending--
  }
})()


// =====================================================
// §11 Required param missing → sploot
// =====================================================

test(
  'required param missing: sploots to empty',
  '{list remove by_value (1) | logic if then :got else :empty}',
  'empty'
)

// =====================================================
// §11 Unknown param names silently ignored
// =====================================================

test(
  'unknown param name: does not affect result',
  '{math add value 3 to 4 fakeparam 99}',
  '7'
)

test(
  'unknown param name: command still runs normally',
  '{string uppercase value :hello extraparam :ignored}',
  'HELLO'
)


// =====================================================
// §10 Lens law: GetPut — poke(v, p, peek(v, p)) = v
// =====================================================

test(
  'GetPut: Name path on existing key',
  '{* (:a 1 :b 2) | >$v || $v.a | >peeked || $v | poke _peeked path :a}',
  '{"a":1,"b":2}'
)

test(
  'GetPut: Pos path on existing position',
  '{(10 20 30) | >$v || $v | list peek path ("#2") | >peeked || $v | list poke value _peeked path ("#2")}',
  '[10,20,30]'
)


// =====================================================
// §10 Lens law: DeleteGet — peek(delete(v, p), p) = Empty
// =====================================================

test(
  'DeleteGet: remove key then peek returns empty',
  '{* (:a 1 :b 2 :c 3) | list remove by_key :b | list peek path (:b)}',
  ''
)


// =====================================================
// §10 Lens law: DeleteDel — delete(delete(v, p), p) = delete(v, p)
// =====================================================

test(
  'DeleteDel: double remove is idempotent',
  '{* (:a 1 :b 2) | list remove by_key :b | list remove by_key :b}',
  '{"a":1}'
)


// =====================================================
// §10 Lens law: MapId — map(v, p, "{__}") = v
// =====================================================

test(
  'MapId: identity map preserves list',
  '{(1 2 3) | list map block "{__}"}',
  '[1,2,3]'
)

test(
  'MapId: identity map preserves keyed list',
  '{* (:a 1 :b 2) | list map block "{__}"}',
  '{"a":1,"b":2}'
)


// =====================================================
// §10 Lens law: PokeAsMap divergence
// =====================================================

test(
  'PokeAsMap divergence: poke creates missing key',
  '{* (:a 1) | poke 99 path :z}',
  '{"a":1,"z":99}'
)

test(
  'PokeAsMap divergence: map skips missing key',
  '{* (:a 1) | list map path (:z) block "{99}"}',
  '{"a":1}'
)


// =====================================================
// §7/§10 Pipeline vars survive async boundary
// =====================================================

test(
  'pipeline vars survive async: set before sleep, read after',
  '{42 | >foo || :ok | process sleep for 0 || _foo | add _foo}',
  '84'
)


// =====================================================
// §1 Space var consistency across async
// =====================================================

test(
  'space var consistent across async boundary',
  '{99 | >$x || $x | process sleep for 0 || $x}',
  '99'
)


// =====================================================
// §11 Pipeline var SSA: rebinding produces error
// =====================================================

test(
  'pipeline var SSA: double bind keeps first value',
  '{1 | >x | 2 | >x || _x}',
  '1'
)


// =====================================================
// Done registering tests
// =====================================================

all_registered = true
if (pending === 0) report()
