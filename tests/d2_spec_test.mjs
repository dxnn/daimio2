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
// Done registering tests
// =====================================================

all_registered = true
if (pending === 0) report()
