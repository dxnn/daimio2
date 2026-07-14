// World-I/O determinism — run: node tests/det_world_test.mjs
// The App boundary has two directions:
//   - emission (fire-and-forget): a ship reaching a world out-flavour port
//     leaves the runtime and is observed by the App. Works today (it is the
//     same path det-out uses) — a green anchor for the mechanism.
//   - round-trip (request/response): an effectful command's cmd: port routes
//     through the parent's <-> wiring to a handler / the world, which returns
//     one response. Round-trip routing landed 2026-07-08..12 (cmd rules,
//     port occupancy) — these guides are GREEN.

import { det_test, arrive, respond, world_in, run } from './det_harness.mjs'

// ── Emission (green): a fire-and-forget ship to a world port is observed ──
// det-world records emissions under the 'world:<port>' trace key. This is the
// mechanism [blackhole-in-exit] will use once the (( )) form parses.
det_test('world: a fire-and-forget ship to a world port is observed [effect-boundary-emit]', {
  seed: `outer
    @go from-js
    @world det-world
    emit {:EMITME}
    @go -> emit -> @world`,
  schedule: [ arrive('go', 'x') ],
  assert: function(t, e) { e.outputs('world:world', ['EMITME']) },
})

// ── Round-trip: a scripted response flows back into the pipeline ──
// caller issues an effectful request; the App (det-world) answers 'tick';
// caller continues and uppercases it — proving the response value rides the
// pipe through the segments after the async boundary.
det_test('world: an effectful request receives its scripted response [roundtrip-response]', {
  seed: `outer
    @go from-js
    @out det-out
    @clock det-world
    caller {var read-out name :t | string uppercase}
    caller@cmd:var:read-out <-> @clock
    @go -> caller -> @out`,
  schedule: [ arrive('go', 'x'), respond({ port: 'clock', nth: 1, value: 'tick' }) ],
  assert: function(t, e) { e.outputs('out', ['TICK']) },
})

// [P-singleresponse] Only the first response to a round-trip counts; a second
// is a ghost.
det_test('world: only the first response to a round-trip counts [P-singleresponse]', {
  seed: `outer
    @go from-js
    @out det-out
    @clock det-world
    caller {var read-out name :t}
    caller@cmd:var:read-out <-> @clock
    @go -> caller -> @out`,
  schedule: [
    arrive('go', 'x'),
    respond({ port: 'clock', nth: 1, value: 'FIRST' }),
    respond({ port: 'clock', nth: 2, value: 'SECOND' }),
  ],
  assert: function(t, e) { e.outputs('out', ['FIRST']) },
})

run()

// ── Formerly deferred, all landed ───────────────────────────────────────────
// [sched-reentry-uniform] / [sched-advance] — det_test.mjs (re-entry
//   renumbering + advance guides). [blackhole-*] — det_blackhole_test.mjs.
// [timeout-ghost-drop] / [request-cycle-timeout] — det_time_test.mjs.
