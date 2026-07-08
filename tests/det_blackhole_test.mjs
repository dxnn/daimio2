// Black-hole crossing behavior — run: node tests/det_blackhole_test.mjs
// A black hole (( )) is a subspace with the real world inside: a ship into its
// in-port is emitted to the world (fire-and-forget); a world value at its
// out-port enters the parent as a ship. The COMPILE borks (station/state/wire
// inside, up/down port, root, socket-load port, (( )) endpoint) are guarded in
// space_test.mjs; these are the runtime CROSSING guides.
//
// ALL RED — triple-blocked, and deliberately written to document the target:
//   1. make_some_space does not parse subspaces at all today (an indented block
//      becomes a station; a (( )) block likewise) — TODO "subspace parsing".
//   2. subspace routing is unimplemented — a ship can't cross a boundary.
//   3. black-hole semantics (the (( )) flag + world-face flavours) don't exist.
// Each seed is written the spec-correct way, so the guides become live and
// correct once that chain lands. The det-world flavour observes world emissions.

import { det_test, arrive, world_in, sender, known_failures, run } from './det_harness.mjs'

// [blackhole-in-exit] a ship at the in-port is emitted to the world, gone,
// fire-and-forget (no response, nothing re-enters the parent).
det_test('black hole: a ship at the in-port is emitted to the world [blackhole-in-exit]', {
  seed: `outer
    @go from-js
    ((relay))
      @in:feed det-world
    @go -> relay@in:feed`,
  schedule: [ arrive('go', 'EMITME') ],
  assert: function(t, e) { e.outputs('world:feed', ['EMITME']) },
})

// [blackhole-out-enter] a world value at the out-port becomes a ship that
// exits into the parent's wiring, queued like any external arrival.
det_test('black hole: a world value at the out-port enters the parent [blackhole-out-enter]', {
  seed: `outer
    @out det-out
    ((relay))
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
    ((relay))
      @out:news websock-in
    who {process sender}
    relay@out:news -> who -> @out`,
  schedule: [ world_in('news', 'x') ],
  assert: function(t, e) { e.outputs('out', ['relay@out:news']) },
})

;[
  'black hole: a ship at the in-port is emitted to the world [blackhole-in-exit]',
  'black hole: a world value at the out-port enters the parent [blackhole-out-enter]',
  'black hole: an emerging ship takes the out-port qname as sender [blackhole-sender-outer]',
].forEach(function(l) { known_failures.add(l) })

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
