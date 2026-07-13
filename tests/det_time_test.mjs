// Time / clock determinism — run: node tests/det_time_test.mjs
// {time now} is the effectful time command: its value must come from the
// Outside through its cmd:time:now port ([demandport-wire] below). Its interim
// fun fallback (the D.now bridge) is gone per the effect partition
// (P-effectpartition, TODO Q4) — unwired, it sploots to empty, so no engine
// clock can leak in. D.now itself remains as the virtual-time foundation.
//
// ({time stampwrap} is pure — it wraps a given stamp and never reads the clock;
// its tests live in d2_spec_test.mjs.)

import { det_test, det_replay, arrive, known_failures, run } from './det_harness.mjs'

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

run()

// ── Deferred: virtual-time timeouts ────────────────────────────────────────
// [timeout-resume-empty] / [timeout-ghost-drop] / [sched-timeout-event] /
// [request-cycle-timeout] — a timeout firing is a scheduled external event; a
// request whose timeout beats its response resumes EMPTY and the late response
// ghosts. These can't be honest guides yet: with round-trip routing
// unimplemented, an unrouted request already sploots to empty, so "timed out
// (empty)" is indistinguishable from "unrouted (empty)" — a timeout-wins guide
// would pass for the wrong reason. They land with round-trip routing (so the
// response-wins case yields a distinguishable value) plus the vtime scheduler.
// The harness already accepts timeout()/respond() schedule events for then.
