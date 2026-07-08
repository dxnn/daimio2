// World-I/O determinism — run: node tests/det_world_test.mjs
// The App boundary has two directions:
//   - emission (fire-and-forget): a ship reaching a world out-flavour port
//     leaves the runtime and is observed by the App. Works today (it is the
//     same path det-out uses) — a green anchor for the mechanism.
//   - round-trip (request/response): an effectful command's cmd: port routes
//     through the parent's <-> wiring to a handler / the world, which returns
//     one response. Routing is unimplemented today (a <->-wired request never
//     reaches its target and sploots), so those guides are RED. The det-world
//     flavour + respond() scaffolding are ready for when routing lands.

import { det_test, arrive, respond, world_in, known_failures, run } from './det_harness.mjs'

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

// ── Round-trip (RED): a scripted response flows back into the pipeline ──
// caller issues an effectful request; the App (det-world) answers 'TICK';
// caller continues and joins '!'. RED: the request never routes today.
det_test('world: an effectful request receives its scripted response [roundtrip-response]', {
  seed: `outer
    @go from-js
    @out det-out
    @clock det-world
    caller {var read-out name :t | string join value "!"}
    caller@cmd:var:read-out <-> @clock
    @go -> caller -> @out`,
  schedule: [ arrive('go', 'x'), respond({ port: 'clock', nth: 1, value: 'TICK' }) ],
  assert: function(t, e) { e.outputs('out', ['TICK!']) },
})

// [P-singleresponse] Only the first response to a round-trip counts; a second
// is a ghost. RED: routing unimplemented (can't deliver even the first).
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

;[
  'world: an effectful request receives its scripted response [roundtrip-response]',
  'world: only the first response to a round-trip counts [P-singleresponse]',
].forEach(function(l) { known_failures.add(l) })

run()

// ── Deferred (compound dependency) ─────────────────────────────────────────
// [sched-reentry-uniform] / [sched-advance] — a down-port response re-docks by
//   max(counter, response#)+1 and a held station holds the space: needs round-
//   trip routing AND scheduler numbers.
// [blackhole-in-exit] / [blackhole-out-enter] / [blackhole-uncorrelated] —
//   world crossing through a black hole: needs the (( )) form to parse (the
//   compile borks are guarded in space_test).
// [timeout-ghost-drop] / [request-cycle-timeout] — need virtual time.
