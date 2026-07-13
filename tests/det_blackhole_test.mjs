// Black-hole crossing behavior — run: node tests/det_blackhole_test.mjs
// A black hole (( )) is a subspace with the real world inside: a ship into its
// in-port is emitted to the world (fire-and-forget); a world value at its
// out-port enters the parent as a ship. The COMPILE borks (station/state/wire
// inside, up/down port, root, socket-load port, (( )) endpoint) are guarded in
// space_test.mjs; these are the runtime CROSSING guides.
//
// GREEN since 2026-07-12: the *name sigil compiles holes, exits at hole
// ports fire the flavour's world-face bound inward, and hole out-ports are
// App entry surfaces (send_value_to_js_port reaches them; entering ships
// take the out-port's qname as sender). det-world observes world emissions.

import { det_test, arrive, world_in, sender, known_failures, run } from './det_harness.mjs'

// [blackhole-in-exit] a ship at the in-port is emitted to the world, gone,
// fire-and-forget (no response, nothing re-enters the parent).
det_test('black hole: a ship at the in-port is emitted to the world [blackhole-in-exit]', {
  seed: `outer
    @go from-js
    *relay
      @in:feed det-world
    @go -> relay@in:feed`,
  schedule: [ arrive('go', 'EMITME') ],
  assert: function(t, e) { e.outputs('world:in:feed', ['EMITME']) },  // det-world keys by the port's full name
})

// [blackhole-out-enter] a world value at the out-port becomes a ship that
// exits into the parent's wiring, queued like any external arrival.
det_test('black hole: a world value at the out-port enters the parent [blackhole-out-enter]', {
  seed: `outer
    @out det-out
    *relay
      @out:news websock-in
    relay@out:news -> @out`,
  schedule: [ world_in('news', 'FROM-WORLD') ],
  assert: function(t, e) { e.outputs('out', ['FROM-WORLD']) },
})

// [blackhole-sender-outer] a ship emerging from the out-port is an entry, not
// propagation: senderless, it takes the out-port's qualified name as sender.
det_test('black hole: an emerging ship takes the out-port qname as sender [blackhole-sender-outer]', {
  seed: `outer
    @out det-out
    *relay
      @out:news websock-in
    who {process sender}
    relay@out:news -> who -> @out`,
  schedule: [ world_in('news', 'x') ],
  assert: function(t, e) { e.outputs('out', ['relay@out:news']) },
})

// (no known failures — the crossing guides went green with the world-face
// binding, 2026-07-12 late)

run()

// ── Deferred crossing assertions (same triple block) ───────────────────────
// [blackhole-uncorrelated] in/out streams are independent — no mechanism pairs
//   an entering ship with an emerging one; request/response across a hole is
//   not modeled. (Test: N ships in, M values out; the M bear no ordering/id
//   link to the N — a negative, best asserted once crossing works.)
// [blackhole-substitutable] a hole and a mock subspace with the same port
//   signature are indistinguishable to the parent (opacity, I8) — the mock leg
//   is the ground truth; needs subspace routing for the mock and world I/O for
//   the hole.
// [blackhole-no-interior] no interior process ever runs — inferable only from
//   the absence of interior side effects; needs the hole to actually exist.
