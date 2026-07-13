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

// ── Timeout inheritance along chains ───────────────────────────────────────
// A wire's nominal timeout is its own explicit value, else inherited from
// the nearest enclosing wire with one, else the default [timeout-inherit];
// the effective timeout of a round trip is the min along the chain
// [timeout-min-chain]. For cmd rule chains the requester registers one
// deadline, so it must be the min of the explicit timeouts along the
// walked rules — an inner forward rule's explicit value counts.

// Inner forward rule explicit, outer rule unset: the inner 3000 governs
// (an unset outer inherits inward-nothing; it cannot stretch the inner
// wire's explicit bound to the default).
det_test('timeout: inner forward rule explicit governs an unset outer [timeout-min-chain]', {
  seed: `outer
    @go from-js
    @out det-out
    @world det-world
    +worker
      @in
      @out
      caller {var read-out name :x | logic if then :got else :empty}
      @in -> caller -> @out
      caller@cmd:var:* <-> @cmd 3000
    worker@cmd:var:* <-> @world
    @go -> worker@in
    worker@out -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 3001 }),          // default (10s) has NOT passed
  ],
  assert: function(t, e) { e.outputs('out', ['empty']) },
})

// Both explicit: min wins — the outer 8000 cannot extend the inner 3000,
// and the inner 3000 tightens the outer.
det_test('timeout: effective is the min along a rule chain [timeout-min-chain]', {
  seed: `outer
    @go from-js
    @out det-out
    @world det-world
    +worker
      @in
      @out
      caller {var read-out name :x | logic if then :got else :empty}
      @in -> caller -> @out
      caller@cmd:var:* <-> @cmd 3000
    worker@cmd:var:* <-> @world 8000
    @go -> worker@in
    worker@out -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 3001 }),          // neither 8000 nor the default has passed
  ],
  assert: function(t, e) { e.outputs('out', ['empty']) },
})

// Unset inner forward rule inherits the outer's explicit value: the walked
// chain's only explicit is the outer 5000, so the requester fires there.
det_test('timeout: unset forward rule inherits the enclosing explicit [timeout-inherit]', {
  seed: `outer
    @go from-js
    @out det-out
    @world det-world
    +worker
      @in
      @out
      caller {var read-out name :x | logic if then :got else :empty}
      @in -> caller -> @out
      caller@cmd:var:* <-> @cmd
    worker@cmd:var:* <-> @world 5000
    @go -> worker@in
    worker@out -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 5001 }),
  ],
  assert: function(t, e) { e.outputs('out', ['empty']) },
})

// Contract chains need no requester-side min: every traversed hop carries
// its own deadline, so the outer wire's 5000 fires at its own port and the
// empty propagates back through the inner (unset) hop's response leg —
// min-chain arises from the mechanics (§7.2). This guards the propagation.
det_test('timeout: an enclosing contract timeout reaches through an unset inner wire [timeout-inherit] [timeout-min-chain]', {
  seed: `outer
    @go from-js
    @out det-out
    +provider
      @up
    +middle
      @in
      @out
      +consumer
        @in -> @down:ask -> @out
      @in -> consumer@in
      consumer@out -> @out
      consumer@down:ask <-> @down:fwd
    middle@down:fwd <-> provider@up  5000
    @go -> middle@in
    middle@out -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'ping'),
    timeout({ at: 1600000000000 + 5001 }),          // default (10s) has NOT passed
  ],
  assert: function(t, e) { e.outputs('out', ['']) },
})

// ── Effectful sleep ────────────────────────────────────────────────────────
// {process sleep} is effectful: the request {handler, method, for, then}
// rides cmd:process:sleep to a wired handler [effcmd-process-sleep]. The
// canonical world handler is a `clock`-flavoured down port, which answers
// the request's `then` value once `for` milliseconds have passed — on the
// virtual clock, so wall timers drive it in production and this harness
// drives it here. Unwired, a sleep sploots like any effect: no engine
// timer ever runs.

det_test('sleep: unwired {process sleep} sploots, no engine timer runs [effectful-unwired-sploot]', {
  seed: `outer
    @go from-js
    @out det-out
    sleeper {process sleep for 5000 then :woke | logic if then :woke else :sploot}
    @go -> sleeper -> @out`,
  now: 1600000000000,
  schedule: [ arrive('go', 'x') ],
  assert: function(t, e) { e.outputs('out', ['sploot']) },
})

det_test('sleep: the clock answers `then` when the duration passes [effcmd-process-sleep] [sched-timeout-event]', {
  seed: `outer
    @go from-js
    @out det-out
    @clock clock
    sleeper {process sleep for 5000 then :woke}
    sleeper@cmd:process:sleep <-> @clock
    @go -> sleeper -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 5001 }),          // the rule default (10s) has NOT passed
  ],
  assert: function(t, e) { e.outputs('out', ['woke']) },
})

// Pipeline vars survive the async boundary a sleep creates within one
// process (§7/§10) — migrated from the bare-run corpus when sleep went
// effectful (a bare sleep sploots; the boundary needs a wired clock).
det_test('sleep: pipeline vars survive async — set before sleep, read after', {
  seed: `outer
    @go from-js
    @out det-out
    @clock clock
    keeper {42 | >foo || :ok | process sleep for 3000 || _foo | add _foo}
    keeper@cmd:process:sleep <-> @clock
    @go -> keeper -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 3001 }),
  ],
  assert: function(t, e) { e.outputs('out', [84]) },
})

// Space vars stay consistent across the boundary (§1) — same migration.
det_test('sleep: space var consistent across the async boundary', {
  seed: `outer
    @go from-js
    @out det-out
    @clock clock
    keeper {99 | >$x || $x | process sleep for 3000 || $x}
    keeper@cmd:process:sleep <-> @clock
    @go -> keeper -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 3001 }),
  ],
  assert: function(t, e) { e.outputs('out', [99]) },
})

// A slept pipeline replays byte-identical under the virtual clock (I17).
det_replay('sleep: a slept pipeline replays byte-identical [sched-deterministic]', {
  seed: `outer
    @go from-js
    @out det-out
    @clock clock
    sleeper {process sleep for 5000 then :woke}
    sleeper@cmd:process:sleep <-> @clock
    @go -> sleeper -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 5001 }),
  ],
})

// ── Request cycles ─────────────────────────────────────────────────────────
// A request cycle is a legal topology that resolves by timeout
// [request-cycle-timeout]: alpha's station requests into beta, whose
// handler requests back into alpha — the back-request queues behind
// alpha's held wait [serial-one-at-a-time], so nothing can answer. The
// first deadline sploots alpha's waiter to empty, freeing alpha; the
// queued back-request then docks and is served, but every late response
// finds its requester already resumed and ghosts [timeout-ghost-drop].
// Liveness holds: the run settles, one empty output emerges.
det_test('timeout: a request cycle resolves to empty by timeout [request-cycle-timeout]', {
  seed: `outer
    @go from-js
    @out det-out
    +alpha
      @in
      @out
      @up
      a {var read-out name :x | logic if then :got_a else :empty_a}
      answer {__ | peek :name}
      @in -> a -> @out
      @up <-> answer
      a@cmd:var:* <-> @cmd
    +beta
      @up
      b {var read-out name :y | logic if then :got_b else :empty_b}
      @up <-> b
      b@cmd:var:* <-> @cmd
    alpha@cmd:var:* <-> beta@up
    beta@cmd:var:* <-> alpha@up
    @go -> alpha@in
    alpha@out -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 10001 }),
  ],
  assert: function(t, e) { e.outputs('out', ['empty_a']) },
})

// The cycle's unwind — deadline order, ghost drops, queue release — replays
// byte-identical (I17).
det_replay('timeout: a request cycle replays byte-identical [sched-deterministic]', {
  seed: `outer
    @go from-js
    @out det-out
    +alpha
      @in
      @out
      @up
      a {var read-out name :x | logic if then :got_a else :empty_a}
      answer {__ | peek :name}
      @in -> a -> @out
      @up <-> answer
      a@cmd:var:* <-> @cmd
    +beta
      @up
      b {var read-out name :y | logic if then :got_b else :empty_b}
      @up <-> b
      b@cmd:var:* <-> @cmd
    alpha@cmd:var:* <-> beta@up
    beta@cmd:var:* <-> alpha@up
    @go -> alpha@in
    alpha@out -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'x'),
    timeout({ at: 1600000000000 + 10001 }),
  ],
})

// (the earlier timeout guides went green with virtual time)

run()
