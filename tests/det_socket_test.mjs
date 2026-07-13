// Socket-load behavior — run: node tests/det_socket_test.mjs
// A socket is a !-sigiled slot (§3/§8) whose frame — name, parent wiring,
// and two implicit port-likes (slot@socket-load, slot@socket-load-smash) —
// persists across loads. Incoming Astroglot REPLACES everything else:
// stations, internal wiring, sub-subspaces, initial state, and all declared
// ports, instantiated fresh; the payload's top-level label is discarded.
// Runtime loads never bork — bad input sploots [socket-load-sploot].
// Delivery: socket_load(port, src) sends the Astroglot to an outer port
// wired to the slot's port-like.

import { det_test, arrive, socket_load, known_failures, run } from './det_harness.mjs'

// [socket-load-replace] valid Astroglot replaces the subspace's content; a
// later ship through the slot exercises the NEW content. The sent label is
// discarded — the subspace keeps the name `slot`.
det_test('socket-load: valid Astroglot replaces the subspace content [socket-load-replace]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    !slot
      body {:ORIGINAL}
      @in:x -> body -> @out:y
    @load -> slot@socket-load
    @go -> slot@in:x
    slot@out:y -> @out`,
  schedule: [
    socket_load('load', 'whatever\n  body {:REPLACED}\n  @in:x -> body -> @out:y'),
    arrive('go', 'ping'),
  ],
  assert: function(t, e) { e.outputs('out', ['REPLACED']) },
})

// [socket-wiring-demand] the parent's wiring persists across a load and
// re-applies to the new content; a wire naming a port the new content never
// declares sits inert (I11).
det_test('socket-load: parent wiring persists and re-applies to new content [socket-wiring-demand]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    !slot
      body {:A}
      @in:x -> body -> @out:y
    @load -> slot@socket-load
    @go -> slot@in:x
    slot@out:y -> @out`,
  schedule: [
    socket_load('load', 'whatever\n  body {:B}\n  @in:x -> body -> @out:y'),
    arrive('go', 'ping'),
  ],
  assert: function(t, e) { e.outputs('out', ['B']) },
})

// The frame is permanent, so a socket is ALWAYS reloadable — content never
// controls its own evictability (the old [socket-load-reloadable] rule is
// deleted; the port-likes are implicit) [socket-portlike-implicit].
det_test('socket-load: a socket is always reloadable — the frame persists [socket-portlike-implicit]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    !slot
      body {:ORIG}
      @in:x -> body -> @out:y
    @load -> slot@socket-load
    @go -> slot@in:x
    slot@out:y -> @out`,
  schedule: [
    socket_load('load', 'whatever\n  body {:FIRST}\n  @in:x -> body -> @out:y'),
    socket_load('load', 'whatever\n  body {:SECOND}\n  @in:x -> body -> @out:y'),
    arrive('go', 'ping'),
  ],
  assert: function(t, e) { e.outputs('out', ['SECOND']) },
})

// [socket-svars-reset] space variables never survive a transition — the new
// content starts from its own declared initial state (this replaces the old
// dropped-concept "socket overlap" test that lived in space_test.mjs).
det_test('socket-load: space variables do not survive a transition [socket-svars-reset]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    !slot
      body {$counter}
      @in:x -> body -> @out:y
    @load -> slot@socket-load
    @go -> slot@in:x
    slot@out:y -> @out`,
  schedule: [
    socket_load('load', 'whatever\n  $counter 99\n  body {$counter}\n  @in:x -> body -> @out:y'),
    arrive('go', 'read'),
  ],
  assert: function(t, e) { e.outputs('out', [99]) },   // new content's initial $counter, not the old
})

// (no known failures — the load/replace guides went green with the sigil
// engine + socket port-likes, 2026-07-12)

run()

// ── Deferred transition guides (same triple block + more) ──────────────────
// [socket-drain] (default) the old content finishes its active process and its
//   queue in key order; ships arriving mid-drain buffer (numbers unchanged) and
//   release into the new content, re-docking by max(counter,#)+1; nothing in
//   flight is lost. Needs a BUSY old content (a down-port wait) => round-trip
//   routing + virtual time, on top of the triple block.
// [socket-smash] the new content replaces the old at once; old svars + all
//   non-exited ships are destroyed; a process waiting on a down-port ceases to
//   exist and its later response ghosts. Same heavy deps.
// [sched-transition-keys] a transition is deterministic (byte-identical replay
//   for a fixed schedule + response script).
// [blackhole-no-socket-load] (runtime) loading a (( )) black hole borks the
//   load. (The DEFINITION-form bork is already in space_test.)
