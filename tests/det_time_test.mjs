// Time / clock determinism — run: node tests/det_time_test.mjs
// {time now} is the effectful time command: its value must come from the
// Outside through its cmd:time:now port ([demandport-wire] below). Its interim
// fun fallback (the D.now bridge) is gone per the effect partition
// (P-effectpartition, TODO Q4) — unwired, it sploots to empty, so no engine
// clock can leak in. D.now itself remains as the virtual-time foundation.
//
// ({time stampwrap} is pure — it wraps a given stamp and never reads the clock;
// its tests live in d2_spec_test.mjs.)

import { det_test, det_replay, arrive, timeout, respond_now, known_failures, run } from './det_harness.mjs'

var CLOCK = `outer
  @go from-js
  @out det-out
  clock {time now | peek :stamp}
  @go -> clock -> @out`

// Unwired {time now} sploots — even with a frozen runner clock available, no
// wall-clock or D.now value leaks into the pipeline. The routed-clock
// counterpart (the Outside answering via cmd:time:now) is [demandport-wire].
det_test('time: unwired {time now} sploots, no engine clock leaks [effectful-unwired-sploot] [effect-outside-time]', {
  seed: `outer
    @go from-js
    @out det-out
    clock {time now | logic if then :got_time else :no_time}
    @go -> clock -> @out`,
  schedule: [ arrive('go', 'x') ],
  now: 1600000000000,
  assert: function(t, e) { e.outputs('out', ['no_time']) },
})

// Replay under a frozen clock is byte-identical (I17 applied to effectful time).
det_replay('time: {time now} is byte-identical under a frozen clock [sched-deterministic]', {
  seed: CLOCK,
  schedule: [ arrive('go', 'x') ],
  now: 1600000000000,
})

// ── cmd:time:now port routing (GREEN since effectful round-trips landed) ──
// {time now} is effectful — its value should come from the Outside via its
// cmd:time:now port. Wire that port to a handler that answers with a known
// time; the pipeline should then use the HANDLER's value, not the local clock.
// The fun fallback is gone (P-effectpartition) and the cmd port routes: the
// wiring rule sends the request to the handler station, whose _out value is
// the response. The clock is frozen so any fallback regression (stamp
// 1600000000) is a fixed, clearly-wrong answer vs the handler's 42.
det_test('time: {time now} routes through its cmd:time:now port to a handler [demandport-wire]', {
  seed: `outer
    @go from-js
    @out det-out
    caller {time now | peek :stamp}
    provider {* (:stamp 42)}
    caller@cmd:time:now <-> provider
    @go -> caller -> @out`,
  schedule: [ arrive('go', 'x') ],
  now: 1600000000000,
  assert: function(t, e) { e.outputs('out', [42]) },
})

// ── Virtual-time timeouts ──────────────────────────────────────────────────
// A timeout is a clock event on the schedule [sched-timeout-event]: the
// harness advances the virtual clock and due deadlines fire deterministically.

// A cmd request to a world port that never answers resumes EMPTY when its
// (default 10s) deadline passes. Routing works (see [demandport-wire]
// above), so timed-out-empty is distinguishable from unrouted-empty: a
// response, had it come, would be 42.
det_test('timeout: an unanswered request resumes empty [timeout-resume-empty] [sched-timeout-event]', {
  seed: `outer
    @go from-js
    @out det-out
    @world det-world
    caller {var read-out name :x | logic if then :got else :empty}
    caller@cmd:var:* <-> @world
    @go -> caller -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 10001 }),
  ],
  assert: function(t, e) { e.outputs('out', ['empty']) },
})

// A response that arrives after its request timed out is a ghost — dropped,
// never resuming anything [timeout-ghost-drop]. The caller docks once and
// produces one output.
det_test('timeout: a late response is a ghost [timeout-ghost-drop]', {
  seed: `outer
    @go from-js
    @out det-out
    @world det-world
    caller {var read-out name :x | logic if then :got else :empty}
    caller@cmd:var:* <-> @world
    @go -> caller -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 10001 }),
    respond_now('world', '42'),
  ],
  assert: function(t, e) {
    e.outputs('out', ['empty'])
    e.dockValues(['x'])
  },
})

// An occupied round-trip port whose deadline passes emits the empty response
// onward itself and frees; the requester's pipeline continues with Empty.
// provider@up is declared but unwired inside, so no response ever comes; a
// second empty arriving at the already-freed consumer port ghosts quietly.
det_test('timeout: an occupied round-trip port emits empty and frees [timeout-resume-empty]', {
  seed: `outer
    @go from-js
    @out det-out
    +provider
      @up
    +consumer
      @in -> @down:ask -> @out
    consumer@down:ask <-> provider@up
    @go -> consumer@in
    consumer@out -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'ping'),
    timeout({ at: 1600000000000 + 10001 }),
  ],
  assert: function(t, e) { e.outputs('out', ['']) },
})

// A wire's trailing integer is its nominal timeout in ms — on a contract
// it caps the round trip at both ports [wire-timeout-explicit]. provider@up
// is unwired inside, so no response ever comes; the explicit 5000 fires
// where the 10s default would still be waiting.
det_test('timeout: an explicit wire timeout overrides the default [wire-timeout-explicit] [timeout-min-chain]', {
  seed: `outer
    @go from-js
    @out det-out
    +provider
      @up
    +consumer
      @in -> @down:ask -> @out
    consumer@down:ask <-> provider@up  5000
    @go -> consumer@in
    consumer@out -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'ping'),
    timeout({ at: 1600000000000 + 5001 }),          // default (10s) has NOT passed
  ],
  assert: function(t, e) { e.outputs('out', ['']) },
})

// (the earlier timeout guides went green with virtual time)

run()

// ── Deferred: [request-cycle-timeout] — a cyclic request chain resolves to
// empty by timeout (the first wire to time out frees its space; the rest
// cascade). The mechanism pieces are covered above; an honest cycle guide
// needs two spaces cmd-calling into each other plus queue-behind-wait
// numbering, and belongs with the [sched-reentry-uniform] harness work.
// The harness already accepts timeout()/respond() schedule events for then.
