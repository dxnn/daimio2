// Time / clock determinism — run: node tests/det_time_test.mjs
// time stampwrap and time now read "now" through D.now(), which the runner
// overrides (the `now` option) to a fixed value — the deterministic stand-in
// for the Outside providing the time. Under a frozen clock the result is
// identical on every run. This is the virtual-time foundation: the runner
// controls the clock.
//
// Virtual-time TIMEOUTS (timeout-as-schedule-event) are deferred — see the
// note at the foot: they need round-trip routing so a timeout's empty resume
// is distinguishable from today's unrouted sploot (also empty).

import { det_test, det_replay, arrive, run } from './det_harness.mjs'

var CLOCK = `outer
  @go from-js
  @out det-out
  clock {time stampwrap | peek :stamp}
  @go -> clock -> @out`

// The Outside (here, the runner) delivers "now"; a frozen clock => fixed result.
// 1600000000000 ms = stamp 1600000000 (2020-09-13 12:26:40 UTC).
det_test('time: stampwrap "now" comes from the runner-provided clock [effect-outside-time]', {
  seed: CLOCK,
  schedule: [ arrive('go', 'x') ],
  now: 1600000000000,
  assert: function(t, e) { e.outputs('out', [1600000000]) },
})

// Replay under a frozen clock is byte-identical (I17 applied to effectful time).
det_replay('time: stampwrap is byte-identical under a frozen clock [sched-deterministic]', {
  seed: CLOCK,
  schedule: [ arrive('go', 'x') ],
  now: 1600000000000,
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
