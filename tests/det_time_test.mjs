// Time / clock determinism — run: node tests/det_time_test.mjs
// {time now} is the effectful time command: it reads "now" through D.now(),
// which the runner overrides (the `now` option) to a fixed value — the
// deterministic stand-in for the Outside providing the time. Under a frozen
// clock the result is identical on every run. This is the virtual-time
// foundation: the runner controls the clock.
//
// ({time stampwrap} is pure — it wraps a given stamp and never reads the clock;
// its tests live in d2_spec_test.mjs.)

import { det_test, det_replay, arrive, known_failures, run } from './det_harness.mjs'

var CLOCK = `outer
  @go from-js
  @out det-out
  clock {time now | peek :stamp}
  @go -> clock -> @out`

// The Outside (here, the runner) delivers "now"; a frozen clock => fixed result.
// 1600000000000 ms = stamp 1600000000 (2020-09-13 12:26:40 UTC).
det_test('time: {time now} reads the runner-provided clock [effect-outside-time]', {
  seed: CLOCK,
  schedule: [ arrive('go', 'x') ],
  now: 1600000000000,
  assert: function(t, e) { e.outputs('out', [1600000000]) },
})

// Replay under a frozen clock is byte-identical (I17 applied to effectful time).
det_replay('time: {time now} is byte-identical under a frozen clock [sched-deterministic]', {
  seed: CLOCK,
  schedule: [ arrive('go', 'x') ],
  now: 1600000000000,
})

// ── cmd:time:now port routing (RED until effectful round-trips work) ──
// {time now} is effectful — its value should come from the Outside via its
// cmd:time:now port. Wire that port to a handler that answers with a known
// time; the pipeline should then use the HANDLER's value, not the local clock.
// Today {time now} runs its fun fallback (reads D.now) and never routes, so the
// handler's value is ignored. RED now; green once the cmd port routes (and the
// fun fallback is removed). The clock is frozen so the fallback's value (stamp
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

;[
  'time: {time now} routes through its cmd:time:now port to a handler [demandport-wire]',
].forEach(function(l) { known_failures.add(l) })

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
