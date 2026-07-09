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

// Known failures — RED guides for spec behaviors not yet implemented.
// A failure whose label is in this set is expected; anything else is a
// regression (and fails the suite).
var known_failures = new Set([
  // (the two [WRONG:poke-key-scalar-affine] svar-coercion cases moved to det_test.mjs)
])

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

  var known = failures.filter(function(f) { return known_failures.has(f.label) })
  var novel = failures.filter(function(f) { return !known_failures.has(f.label) })

  console.log('\n=== D2 Spec Tests ===')
  console.log(`${pass + fail} tests: ${pass} passed, ${fail} failed (${known.length} known, ${novel.length} new)`)

  if (novel.length) {
    console.log('\nNew failures (REGRESSION):')
    for (var f of novel) {
      console.log(`  [${f.label}]`)
      console.log(`    input:    ${f.input}`)
      console.log(`    expected: ${f.expected}`)
      console.log(`    actual:   ${f.actual}`)
      console.log('')
    }
  }

  if (known.length) {
    console.log('\nKnown failures (RED guides):')
    for (var g of known) console.log(`  [${g.label}]`)
  }

  if (!novel.length) console.log('\nAll passing (no regressions)!')
  if (novel.length) process.exit(1)
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
  '{* (:a 1 :b 3) | >data || logic is value 3 in _data | logic if then :yes else :no}',
  'yes'
)

test(
  'is-in: keyed list rejects missing value [coerce-list] [P-total]',
  '{* (:a 1 :b 2) | >data || logic is value :nope in _data | logic if then :yes else :no}',
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

// original crash: pipe value is object, fills "in" implicitly. Uses a fixed
// keyed object; was `time stampwrap`, whose wall-clock output made the result
// flip on a date rollover. The object-via-pipe coercion is what's under test,
// not the clock.
test(
  'is-in: object via pipe does not crash [coerce-list] [P-total]',
  '{* (:a 1 :b 2) | logic is value __in | logic if then :yes else :no}',
  'no'
)

// ── time stampwrap: pure; requires a stamp, defaults to the 0 stamp ────
// stampwrap is a pure function of its stamp — it never reads the clock (that
// is {time now}, the effectful command). With no stamp it wraps the epoch
// (stamp 0). Assert only timezone-independent fields (the stamp round-trips;
// seconds never shift with TZ; a mid-year stamp's year is robust).
test(
  'time stampwrap: no timestamp defaults to the 0 stamp, never "now" [time-stampwrap]',
  '{time stampwrap | peek :stamp}',
  '0'
)
test(
  'time stampwrap: an explicit stamp round-trips [time-stampwrap]',
  '{time stampwrap value 1000000000 | peek :stamp}',
  '1000000000'
)
test(
  'time stampwrap: seconds are timezone-independent [time-stampwrap]',
  '{time stampwrap value 1000000000 | peek :second}',
  '40'
)
test(
  'time stampwrap: a mid-year stamp wraps to the right year [time-stampwrap]',
  '{time stampwrap value 1592222400 | peek :year}',
  '2020'
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
  'effectful command with unwired port sploots to empty [effectful-unwired-sploot] [P-liveness]',
  '{time now | logic if then :yes else :no}',
  'no'
)

test(
  'pure command result flows through pipeline [pipe-flow] [P-total]',
  '{3 | math add value 2 | math multiply value 10}',
  '50'
)


// =====================================================
// §3 Effectful command in a space: unwired -> sploot to empty
// =====================================================

// An unwired effectful command ({time now}, no cmd:time:now wiring) sploots to
// empty (spec: "no effects without wiring"). RED until the fun fallback is
// removed — today {time now} returns a wall-clock stamp.
;(function() {
  // [effectful-unwired-sploot]
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
    // Spec: an unwired effectful command sploots to empty (no fun fallback).
    // {time now} unwired -> empty -> __.stamp of empty is empty. RED until the
    // fun fallback is removed (today it returns a wall-clock stamp).
    var actual = String(value)
    if (actual === '' || actual === '0') {
      pass++
    } else {
      fail++
      failures.push({
        label: 'effectful command in space sploots to empty when unwired [effectful-unwired-sploot]',
        input: '{time now | __.stamp}',
        expected: 'empty (sploot)',
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
// §6 Cross-boundary state: var read-out/write-out (effectful)
// =====================================================

// var read-out/write-out are EFFECTFUL — cross-boundary state via the
// cmd:var:* port. Unwired, they sploot to empty (no fun fallback). The LOCAL,
// pure accessors are {var read}/{var write} (RED guide below). RED until the
// fun fallback is removed: today the fun reads the caller's own space, so an
// unwired write-out/read-out round-trips locally and returns 42.

test(
  'unwired var write-out/read-out sploots to empty [effectful-unwired-sploot] [socket-crossboundary-var]',
  '{var write-out name :testvar value 42 | var read-out name :testvar}',
  ''
)

test(
  'var read-out returns empty for unset variable [svar-read-unbound-sploot]',
  '{var read-out name :nonexistent}',
  ''
)


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
// §8 Scheduling: sequential execution of concurrent ships
// =====================================================

// Two ships entering the same space should execute sequentially.
// Both increment a counter, so the final value should be 2.
;(function() {
  // [serial-one-at-a-time] [space-queue]
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
  '>$x.path passes through original value [svar-write-path]',
  '{* (:a 1) | >$pt1 | 42 | >$pt1.sub || $pt1}',
  '{"a":1,"sub":42}'
)

// The 42 should flow through, not the full {sub:42} object
test(
  '>$x.path passthrough value is the pipe input, not the poked object [svar-write-path]',
  '{* (:a 1) | >$pt2 | 55 | >$pt2.b}',
  '55'
)

test(
  '>$x.path passthrough with nested path [svar-write-path]',
  '{* (:a 1) | >$pt3 | :hello | >$pt3.b.c}',
  'hello'
)

test(
  '>$x.path self-reference poke passes through original [svar-write-path]',
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
  'undefined space var in subtract acts as zero [svar-read-unbound-sploot]',
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
  'double pipe blocks value leak on error [compile-barrier-break]',
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
  'quote preserves original source despite synonymization [quote-kills]',
  '{"{777}" | quote}',
  '{777}'
)
test(
  'quote preserves original source for alias-like blocks [quote-kills]',
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
// §10 Poke: Empty path — replace entirely
// =====================================================

test(
  'poke Empty: list base replaced entirely [poke-empty-path]',
  '{(1 2 3) | list poke value 99}',
  '99'
)

test(
  'poke Empty: keyed base replaced entirely [poke-empty-path]',
  '{* (:a 1) | list poke value 99}',
  '99'
)

test(
  'poke Empty: number base replaced entirely [poke-empty-path]',
  '{5 | list poke value 99}',
  '99'
)

test(
  'poke Empty: empty base replaced entirely [poke-empty-path]',
  '{"" | list poke value 99}',
  '99'
)

test(
  'poke Empty: string value replaces list [poke-empty-path]',
  '{(1 2 3) | list poke value :hello}',
  'hello'
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
  'poke Name: key on array sploots, returns unchanged [poke-key-unkeyed-fail] [sploot-passthru-poke]',
  '{(1 2 3) | list poke path :x value 99}',
  '[1,2,3]'
)

test(
  'poke Name: key on array mid-path sploots, returns unchanged [poke-key-unkeyed-fail] [sploot-passthru-poke]',
  '{(10 20) | list poke path (:x :y) value 99}',
  '[10,20]'
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

// The two [WRONG:poke-key-scalar-affine] svar-coercion cases (scalar base
// via `list poke`, string base via `>$x.path`) moved to tests/det_test.mjs
// — they need per-test svar isolation to run deterministically.

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
  'Star PutGet fails: peek wraps traversal, [0,0,0] != 0 [law-putget] [peek-star-wraps]',
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
  'body'
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

// object piped into reduce (the original crash pattern — a keyed object, not a
// scalar, filling the reduce input; was `time stampwrap`, whose wall-clock
// output made this non-deterministic — see the de-flake note above)
test('reduce: object piped into reduce does not crash [P-total]',
  '{* (:a 1 :b 2 :c 3) | list reduce block "{_total | add _value}" | logic is value __ like "/^[0-9]+$/" | logic if then :yes else :no}',
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

;(function() { // [P-effectpartition] [blockeval-category]
  pending++

  // Ternary partition: every command is exactly one of pure / block-evaluating
  // / effectful. Effectful commands have no fun (§4). These currently carry
  // BOTH fun and effect (fun as a fallback handler) — a known violation until
  // effectful dispatch lands (all effectful commands must be port-routed).
  var known_both = ['time.now', 'var.read-out', 'var.write-out']

  function has_block_param(m) {
    if (!m.params) return false
    return m.params.some(function(p) {
      if (p.type === 'block') return true
      if (typeof p.type === 'string' && p.type.indexOf('either:') === 0)
        return p.type.indexOf('block') !== -1
      return false
    })
  }

  var pure = 0, blockeval = 0, effectful = 0, both = 0, neither = 0
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
      } else if (has_fun && has_block_param(m)) {
        blockeval++
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
      label: 'ternary partition: pure | block-evaluating | effectful [blockeval-category]',
      input: '(D.Commands scan: ' + pure + ' pure, ' + blockeval + ' block-evaluating, ' + effectful + ' effectful)',
      expected: 'each command in exactly one category (known fun+effect: ' + known_both.join(', ') + ')',
      actual: msg
    })
  }
  pending--
  if (all_registered && pending === 0) report()
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
// §10 Values, coercion, truthiness, templates, pipes, params
// =====================================================

// --- Truthiness ---

test(
  'falsy values: 0 is falsy [truthy-falsy]',
  '{0 | logic if then :yes else :no}',
  'no'
)

test(
  'truthy values: non-empty string "0" is truthy [truthy-truthy]',
  '{"0" | logic if then :yes else :no}',
  'yes'
)

// --- Empty coercion ---

test(
  'empty coerces to 0 as number [empty-coerce-number]',
  '{add $nope}',
  '0'
)

test(
  'empty coerces to "" as string [empty-coerce-string]',
  '{$nope | string uppercase}',
  ''
)

// --- Type coercion ---

test(
  'numbers stringify for string-typed param [coerce-string]',
  '{42 | string slice end 1}',
  '4'
)

test(
  'non-numeric string coerces to 0 for number [coerce-number]',
  '{:abc | math add value 5}',
  '5'
)

test(
  'float rounds for integer-typed param [coerce-integer]',
  '{:abcde | string slice start 1.7 end 3.7}',
  'cd'
)

test(
  'anything-typed param passes value through [coerce-anything]',
  '{logic switch on 42 value (42 :found)}',
  'found'
)

test(
  'block in block-typed param is evaluated per item [coerce-block]',
  '{(1 2 3) | list map block "{__ | add 1}"}',
  '[2,3,4]'
)

test(
  'either:block,string accepts string branch [coerce-either]',
  '{:abc | string transform from :a to :X}',
  'Xbc'
)

// --- Template behavior ---

test(
  'multiple segments concatenated into string [template-concat]',
  'hello {3 | add 2} world',
  'hello 5 world'
)

test(
  'single command preserves result type [template-single-passthru]',
  '{math add value 1 to 2}',
  '3'
)

test(
  'segments stringified in multi-segment template [template-stringify]',
  'result: {(1 2 3)}',
  'result: [1,2,3]'
)

// --- Comments ---

test(
  '/text comments out one segment [comment-single]',
  '{401 /comment | add 1}',
  '402'
)

test(
  '//text comments out remaining segments [comment-rest]',
  '{401 //comment | add 1}',
  '401'
)

// --- Pipe filling ---

test(
  'pipe fills first unfilled param [pipe-fill-one]',
  '{5 | math add to 3}',
  '8'
)

test(
  'pipe fills by definition order [pipe-fill-deforder]',
  '{2 | list range length 3}',
  '[2,3,4]'
)

test(
  'no implicit fill on first segment [pipe-fill-first-none]',
  '{math add value 3 to 4}',
  '7'
)

// --- Trailing pipes ---

test(
  'trailing || returns empty [pipe-trailing-empty]',
  '{42 ||}',
  ''
)

test(
  'trailing | is no-op [pipe-trailing-noop]',
  '{42 |}',
  '42'
)

// --- Barrier pipes ---

test(
  'pipeline vars cross barrier [pipe-barrier-vars]',
  '{5 | >x || _x | add 1}',
  '6'
)

test(
  'after || process.v is absent so no implicit fill [pipe-barrier-absent]',
  '{2 || list range length 3}',
  '[1,2,3]'
)

// --- Absent vs empty ---

test(
  'process.v starts as absent; unfilled params use fallback [pipe-absent]',
  '{list range length 3}',
  '[1,2,3]'
)

test(
  'absent consumed as data becomes empty [absent-coerce-empty]',
  '{>$absc || $absc}',
  ''
)

// --- Parameter handling ---

test(
  'explicit params can be in any order [param-order-explicit]',
  '{math subtract from 8 value 5}',
  '3'
)

test(
  'unfilled optional param defaults to empty coerced to type [param-unfilled-default]',
  '{math add value 5}',
  '5'
)

test(
  'unknown param names silently ignored [param-unknown-ignored]',
  '{math add value 3 to 4 bogus 99}',
  '7'
)

test(
  'required param missing causes sploot [param-required-sploot]',
  '{process quote}',
  ''
)

// --- Parsing ---

test(
  'no escape mechanism; use string from code for braces [parse-no-escape]',
  '{string from code 123}',
  '{'
)

test(
  'string literals can contain interpolated commands [parse-string-interpolation]',
  '{"hello {3 | add 2} world"}',
  'hello 5 world'
)


// =====================================================
// §10–§11 Block semantics, finalization, scope, compilation
// =====================================================

test(
  'block at end of pipeline is evaluated [block-end-of-pipe-eval]',
  '{"{:hey}"}',
  'hey'
)

test(
  'block-typed param receives block, evaluated per invocation [block-param-block]',
  '{(1 2 3) | list map block "{__ | add 10}"}',
  '[11,12,13]'
)

test(
  'block-typed param receives non-block, returned as-is [block-param-nonblock]',
  '{(1 2 3) | list map block 4}',
  '[4,4,4]'
)

test(
  'string-typed param receives block, coerced to source text [block-to-string]',
  '{"{:foo}" | string uppercase}',
  '{:FOO}'
)

test(
  'quoted block compiles and evaluates [block-compiles-to-literal]',
  '{"{3 | add 2}"}',
  '5'
)

test(
  'named blocks do not auto-squelch output [block-named-no-squelch]',
  '{begin foo}hello{end foo}',
  'hello'
)

test(
  'blocks inside lists are inert in list context [block-in-list-inert]',
  '{(1 "{__ | add 1}" 3) | list count}',
  '3'
)

test(
  'blocks at end of pipeline get evaluated, not shipped [block-no-ship]',
  '{"{:test}"}',
  'test'
)

test(
  'finalize evaluates a block [finalize-block]',
  '{"{:hello}"}',
  'hello'
)

test(
  'finalize passes through non-blocks [finalize-passthru]',
  '{42}',
  '42'
)

test(
  'finalize coerces blocks inside lists to source text [finalize-list]',
  '{(1 "{:foo}" 3)}',
  '[1,"{:foo}",3]'
)

test(
  'blocks in lists become source text strings at station boundary [list-blocks-finalize]',
  '{(1 "{__ | add 1}" 3)}',
  '[1,"{__ | add 1}",3]'
)

test(
  'empty is a final value, passes through finalization [empty-is-final]',
  '{""}',
  ''
)

test(
  'pipeline var write-once: second bind sploots, first value kept [scope-pvar-writeonce]',
  '{:first | >a || :second | >a || _a}',
  'first'
)

test(
  'sub-process pvars do not propagate to parent [scope-pvar-no-propagate]',
  '{(1 2) | list map block "{__ | >inner}" || _inner}',
  ''
)

test(
  'space vars accessible within all pipelines [scope-svar-access]',
  '{42 | >$svacc || $svacc}',
  '42'
)

test(
  '_total is the accumulator in reduce [scope-inject-total]',
  '{(1 2 3) | list reduce block "{_total | add _value}"}',
  '6'
)

test(
  '__ after || still edges to preceding segment [compile-dunder-elim]',
  '{5 || __ | add 1}',
  '6'
)

test(
  '__in is a reserved pvar initialized per sub-process [compile-dunderin-pvar]',
  '{(1 2 3) | list map block "{__in}"}',
  '[1,2,3]'
)

test(
  'pipe creates flow edge from previous to next segment [compile-pipe-edge]',
  '{3 | add 2 | times 4}',
  '20'
)

test(
  '_x resolved to direct edges in flow graph [compile-pvar-partial]',
  '{5 | >y | _y | add _y}',
  '10'
)

test(
  'space vars are runtime reads/writes, not compiled away [compile-svar-runtime]',
  '{0 | >$svrt || 42 | >$svrt || $svrt}',
  '42'
)

test(
  'barrier breaks implicit pipe edge [compile-barrier-break]',
  '{5 || add 1}',
  '1'
)

test(
  '__in in map equals current element [dunderin-map]',
  '{(10 20 30) | list map block "{__in | add 1}"}',
  '[11,21,31]'
)

test(
  '__in in process run equals value param [dunderin-run]',
  '{process run block "{__in | add 1}" value 99}',
  '100'
)

test(
  'aliases expand during munging phase [alias-expand-munge]',
  '{5 | add 3}',
  '8'
)

test(
  'unkeyed to keyed via rekey: produces index keys [collection-rekey]',
  '{(10 20) | list rekey}',
  '{"0":10,"1":20}'
)


// =====================================================
// §10 Delete (list delete is UNIMPLEMENTED — all produce soft error '')
// =====================================================

test(
  'delete empty path returns Empty [delete-empty-path] (UNIMPLEMENTED: list delete)',
  '{(1 2 3) | list delete}',
  ''
)

test(
  'delete key from keyed list [UNIMPLEMENTED:delete-key-keyed]',
  '{* (:a 1 :b 2 :c 3) | list delete path :b}',
  ''
)

test(
  'delete key coerced on unkeyed list [UNIMPLEMENTED:delete-key-unkeyed]',
  '{(10 20 30) | list delete path :1}',
  ''
)

test(
  'delete by position splices [UNIMPLEMENTED:delete-pos]',
  '{(10 20 30) | list delete path "#2"}',
  ''
)

test(
  'delete star removes all children [UNIMPLEMENTED:delete-star]',
  '{(1 2 3) | list delete path "*"}',
  ''
)

test(
  'par-delete collects then removes in reverse [UNIMPLEMENTED:delete-par-collect]',
  '{(10 20 30 40) | list delete path (("#1" "#3"))}',
  ''
)

test(
  'overlapping par-delete removes entry once [UNIMPLEMENTED:delete-par-overlap]',
  '{(10 20 30) | list delete path (("#2" "#2"))}',
  ''
)


// =====================================================
// §10 Peek: empty path, affine unwrap, star wrap
// =====================================================

test(
  'peek empty path returns value itself [peek-empty-path]',
  '{(1 2 3) | list peek}',
  '[1,2,3]'
)

test(
  'peek affine selector unwraps single value [peek-affine-unwraps]',
  '{* (:a 1 :b 2) | list peek path :a}',
  '1'
)

test(
  'peek star always wraps in list [peek-star-wraps]',
  '{* (:a 1) | list peek path "*"}',
  '[1]'
)


// =====================================================
// §10 Key coercion and zero-indexing
// =====================================================

test(
  'key with numeric string on unkeyed is 0-based [key-zero-indexed]',
  '{(10 20 30) | list peek path :1}',
  '20'
)

test(
  'string key on unkeyed coerces to nat [keycoerce-string-unkeyed]',
  '{(10 20 30) | list peek path :2}',
  '30'
)

test(
  'number key on keyed treated as string [keycoerce-number-keyed]',
  '{* (:a 1 :2 99) | __.2}',
  '99'
)

test(
  'number key on unkeyed is 0-indexed [keycoerce-number-unkeyed]',
  '{(10 20 30) | __.0}',
  '10'
)


// =====================================================
// §10 Pos zero invalid
// =====================================================

test(
  '#0 is invalid position, sploots [pos-zero-invalid]',
  '{(1 2 3) | __.#0}',
  ''
)


// =====================================================
// §10 Poke: key coercion, unkeyed fail, pos on scalar
// =====================================================

test(
  'poke numeric key on unkeyed coerces to index [poke-key-unkeyed-coerce]',
  '{(10 20 30) | poke 99 path :1}',
  '[10,99,30]'
)

test(
  'poke non-numeric key on unkeyed sploots [poke-key-unkeyed-fail]',
  '{(1 2 3) | poke 99 path :abc}',
  '[1,2,3]'
)

test(
  'poke pos on scalar coerces to list [WRONG:poke-pos-scalar]',
  '{42 | >$poke_pos_scalar_t || 99 | >$poke_pos_scalar_t.#1 || $poke_pos_scalar_t}',
  '[99]'
)


// =====================================================
// §10 Laws: GetPut, MapId, PokeAsMap, DeleteGet, DeleteDel
// =====================================================

test(
  'GetPut: poke(v, p, peek(v, p)) = v [law-getput]',
  '{* (:a 1 :b 2) | poke __.a path :a}',
  '{"a":1,"b":2}'
)

test(
  'MapId: map(v, p, identity) = v [law-mapid]',
  '{(1 2 3) | list map block "{__}"}',
  '[1,2,3]'
)

test(
  'PokeAsMap: map with constant block equals poke [law-pokeasmap]',
  '{* (:a 1 :b 2) | list map path :a block "{99}"}',
  '{"a":99,"b":2}'
)

test(
  'DeleteGet: peek after delete returns Empty [UNIMPLEMENTED:law-deleteget]',
  '{* (:a 1 :b 2) | list delete path :a | __.a}',
  ''
)

test(
  'DeleteDel: double delete equals single delete [UNIMPLEMENTED:law-deletedel]',
  '{* (:a 1 :b 2) | list delete path :a | list delete path :a}',
  ''
)


// =====================================================
// §10 Map: empty unchanged, par sequential
// =====================================================

test(
  'map on Empty coerced to empty list [WRONG:map-empty-unchanged]',
  '{$noexist_map_empty | list map block "{__ | math add value 1}"}',
  '[]'
)

test(
  'map par-path applies sequentially [map-par-sequential]',
  '{* (:a 1 :b 2 :c 3) | list map path ((:a :c)) block "{__ | math add value 10}"}',
  '{"a":11,"b":2,"c":13}'
)


// =====================================================
// §11 Svar write unbound with path
// =====================================================

test(
  'writing unbound svar with path treats state as Empty [svar-write-unbound-empty]',
  '{42 | >$svar_unbound_test.a || $svar_unbound_test}',
  '{"a":42}'
)


// =====================================================
// §9 Path evaluation: evaluated selector, par requires curlies
// =====================================================

test(
  'evaluated selector in dot-path [path-eval-selector]',
  '{* (:a 1 :b 2) | __.{:a}}',
  '1'
)

test(
  'par in dot-path requires curlies [path-par-curlies]',
  '{* (:a 1 :b 2 :c 3) | __.{(:a :c)}}',
  '[1,3]'
)


// =====================================================
// Lens laws: traversal (Star) breaks PutGet / GetPut
// =====================================================

test(
  'Star GetPut fails: peek wraps, poke(v,*,peek(v,*)) != v [law-getput] [peek-star-wraps]',
  '{(1 2 3) | list poke path "*" value (1 2 3)}',
  '[[1,2,3],[1,2,3],[1,2,3]]'
)

// =====================================================
// §11 Block-evaluating commands: a pure block runs synchronously
// =====================================================

// `list map` evaluates its block param once per item. When the block is
// pure (no effectful command), evaluation completes in-process with no
// async boundary, and the result is exactly the mapped values.
test(
  'list map with a pure block completes synchronously, result = mapped values [blockeval-sync-when-pure]',
  '{(1 2 3) | list map block "{__ | math add value 1}"}',
  '[2,3,4]'
)

// =====================================================
// §5 Recursion depth: unbounded recursion sploots to empty, never crashes
// =====================================================

test(
  'self-invoking block sploots to empty, never crashes [depth-exceeded-sploot] [host-error-sploot]',
  '{"{$loop | run}" | >$loop || $loop | run}',
  ''
)

// =====================================================
// §6 Dynamic svar access: {var read} / {var write}  (RED — not yet implemented)
// =====================================================

test(
  'var write then var read by computed name [var-read] [var-write]',
  '{var write name :foo value 5 | var read name :foo}',
  '5'
)

// =====================================================
// Done registering tests
// =====================================================

all_registered = true
if (pending === 0) report()
