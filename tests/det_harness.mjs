// Deterministic test harness for Daimio.  Schedule → Drive → Trace → Assert,
// with a fresh, isolated space per run.  See tests/DET_HARNESS.md for the design.
//
// v1 rides on existing engine mechanism plus three additive hooks
// (D.Space#is_idle, D.make_execution_space, D.settle).  Tests that need
// machinery not yet built — the scheduler's ordering guarantees, virtual
// time, qname ids, black holes, socket-load, sender-at-entry — are RED
// guides: they fail for the right reason and their labels live in the
// caller's `known_failures` set (self-managed known/novel, like the other
// suites).  run_all counts this suite as 0 known.

var D = (await import('../daimio/daimio.js')).default

// ── state ─────────────────────────────────────────────────────────────
var queue = []            // pending test thunks: fn(done)
var pass = 0, fail = 0
var failures = []
var current = null        // running test context: { label, trace, responses }
export var known_failures = new Set()   // caller fills before run()

// ── helpers ─────────────────────────────────────────────────────────────
function str(v) { return typeof v === 'string' ? v : (JSON.stringify(v) || '') }

function dedent(s) {
  var lines = s.split('\n')
  while(lines.length && !lines[0].trim()) lines.shift()
  var min = Infinity
  lines.forEach(function(l) { if(l.trim()) { var i = l.search(/\S/); if(i < min) min = i } })
  if(min === Infinity) min = 0
  return lines.map(function(l) { return l.slice(min) }).join('\n')
}

function record_fail(label, expected, actual) {
  fail++
  failures.push({ label: label, expected: str(expected), actual: str(actual) })
}
function check(label, actual, expected) {
  if(str(actual).trim() === str(expected).trim()) pass++
  else record_fail(label, expected, actual)
}

function render_trace(trace) { return trace.map(function(e) { return e.port + '=' + str(e.value) }) }

function is_subsequence(trace, pairs) {
  var i = 0
  for(var t = 0; t < trace.length && i < pairs.length; t++)
    if(trace[t].port === pairs[i][0] && str(trace[t].value).trim() === str(pairs[i][1]).trim()) i++
  return i === pairs.length
}

// ── trace / world flavours ───────────────────────────────────────────────
// Observation points are wired `@out det-out` in the seed; every arrival
// appends to the running test's ordered trace.
D.import_port_flavour('det-out', {
  dir: 'out',
  outside_exit: function(ship) {
    if(current) current.trace.push({ port: this.settings.thing || this.pair.name, value: ship })
  }
})

// Error ships (wire `@err det-err`); recorded under an `err:` port key.
D.import_port_flavour('det-err', {
  dir: 'out',
  outside_exit: function(ship) {
    if(current) current.trace.push({ port: 'err:' + (this.settings.thing || this.pair.name), value: ship })
  }
})

// Mock world for `respond`: services an outward request on a down/command
// port with the next scripted response for that port.  (v1: down-port
// round-trips aren't implemented, so respond-based tests are RED.)
D.import_port_flavour('det-world', {
  dir: 'out',
  outside_exit: function(ship, callback) {
    var port = this.settings.thing || this.pair.name
    if(current) current.trace.push({ port: 'world:' + port, value: ship })
    var rs = current && current.responses && current.responses[port]
    if(rs && rs.length && typeof callback === 'function') callback(rs.shift().value)
  }
})

// ── schedule constructors ─────────────────────────────────────────────────
export function arrive(port, value)      { return { kind: 'arrive', port: port, value: value } }
export function respond(o)               { return { kind: 'respond', port: o.port, nth: o.nth, value: o.value, delay: o.delay } }
export function timeout(o)               { return { kind: 'timeout', port: o.port, at: o.at } }
export function world_in(port, value)    { return { kind: 'world_in', port: port, value: value } }
export function socket_load(port, src, o){ return { kind: 'socket_load', port: port, src: src, mode: (o && o.mode) || 'drain' } }

// ── driver ──────────────────────────────────────────────────────────────
function apply_event(space, ev) {
  switch(ev.kind) {
    case 'arrive':      D.send_value_to_js_port(space, ev.port, ev.value); break
    case 'world_in':    D.send_value_to_js_port(space, ev.port, ev.value); break
    case 'socket_load': D.send_value_to_js_port(space, ev.port, ev.src, 'socket-load'); break
    case 'timeout':     throw new Error('timeout events need virtual time (not in v1)')
    default:            throw new Error('unknown schedule event: ' + ev.kind)
  }
}

// Register responses, then inject each non-respond event and settle
// between events (deterministic schedule-level interleaving). cb(ok, why).
function drive(space, schedule, cb) {
  current.responses = {}
  schedule.filter(function(e) { return e.kind === 'respond' }).forEach(function(e) {
    (current.responses[e.port] = current.responses[e.port] || []).push(e)
  })
  var events = schedule.filter(function(e) { return e.kind !== 'respond' })
  var i = 0
  function step() {
    if(i >= events.length) return cb(true)
    try { apply_event(space, events[i++]) }
    catch(e) { return cb(false, e.message) }
    D.settle(space, function(settled) {
      if(!settled) return cb(false, 'did not settle')
      step()
    })
  }
  step()
}

// ── test kinds ────────────────────────────────────────────────────────────
// Isolated DAML eval — output compared to `expected`. For the svar-sensitive
// tests: each gets its own execution space, so nothing leaks between tests.
export function det_daml(label, expr, expected) {
  queue.push(function(done) {
    try {
      var space = D.make_execution_space()
      D.run(expr, space, null, function(out) {
        var actual = D.execute_then_stringify(out)
        if(actual === false) actual = ''
        if(typeof actual !== 'string') actual = JSON.stringify(actual) || ''
        check(label, actual, expected)
        done()
      })
    } catch(e) { record_fail(label, 'no error', e.message); done() }
  })
}

// Space + schedule; assert on the captured trace via the `expect` object.
export function det_test(label, opts) {
  queue.push(function(done) {
    current = { label: label, trace: [] }
    var space
    try { space = new D.Space(D.make_some_space(dedent(opts.seed))) }
    catch(e) { record_fail(label, 'no error', e.message); current = null; return done() }
    drive(space, opts.schedule || [], function(ok, why) {
      if(!ok) record_fail(label, 'run to completion', why)
      else if(opts.assert) {
        try { opts.assert(current.trace, make_expect(label)) }
        catch(e) { record_fail(label, 'assert', e.message) }
      }
      current = null
      done()
    })
  })
}

// Run the same (seed, schedule) twice; the two traces must be identical.
export function det_replay(label, opts) {
  queue.push(function(done) {
    run_once(opts, function(ok1, t1) {
      if(!ok1) { record_fail(label, 'run 1 completes', t1); return done() }
      run_once(opts, function(ok2, t2) {
        if(!ok2) { record_fail(label, 'run 2 completes', t2); return done() }
        check(label, render_trace(t1).join(' | '), render_trace(t2).join(' | '))
        done()
      })
    })
  })
}

function run_once(opts, cb) {
  current = { label: '(replay)', trace: [] }
  var space
  try { space = new D.Space(D.make_some_space(dedent(opts.seed))) }
  catch(e) { current = null; return cb(false, e.message) }
  drive(space, opts.schedule || [], function(ok, why) {
    var trace = current.trace
    current = null
    cb(ok, ok ? trace : why)
  })
}

function make_expect(label) {
  return {
    eq:      function(actual, expected) { check(label, actual, expected) },
    outputs: function(port, values)     { check(label, current.trace.filter(function(e) { return e.port === port }).map(function(e) { return e.value }), values) },
    order:   function(pairs)            { if(is_subsequence(current.trace, pairs)) pass++
                                          else record_fail(label, 'subsequence ' + str(pairs), render_trace(current.trace).join(' | ')) },
    trace:   function(pairs)            { check(label, render_trace(current.trace).join(' | '), pairs.map(function(p) { return p[0] + '=' + str(p[1]) }).join(' | ')) },
  }
}

// ── runner / report ───────────────────────────────────────────────────────
function run_next() {
  D.setImmediate(function() {
    if(!queue.length) return report()
    var t = queue.shift()
    t(run_next)
  })
}

export function run() { run_next() }

function report() {
  var known = failures.filter(function(f) { return known_failures.has(f.label) })
  var novel = failures.filter(function(f) { return !known_failures.has(f.label) })

  console.log('\n=== Determinism Harness ===')
  console.log((pass + fail) + ' checks: ' + pass + ' passed, ' + fail + ' failed (' + known.length + ' known, ' + novel.length + ' new)')

  if(novel.length) {
    console.log('\nNew failures (REGRESSION):')
    novel.forEach(function(f) {
      console.log('  ' + f.label)
      console.log('    expected: ' + f.expected)
      console.log('    actual:   ' + f.actual)
    })
  }
  if(known.length) {
    console.log('\nKnown failures (RED guides):')
    known.forEach(function(f) { console.log('  ' + f.label) })
  }
  if(!novel.length) console.log('\nYou win!')
  if(novel.length) process.exit(1)
}
