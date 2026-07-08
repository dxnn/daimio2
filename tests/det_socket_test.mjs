// Socket-load behavior — run: node tests/det_socket_test.mjs
// A socket-load port lets incoming Astroglot REPLACE a subspace's internal
// content: stations, internal wiring, sub-subspaces, initial state, and port
// declarations are all replaced and instantiated fresh; the payload's
// top-level label is discarded (the subspace keeps its parent-given name); the
// parent's wiring of the subspace persists and re-applies to the new content.
// The COMPILE bork (socket-load on the root) is guarded in space_test.mjs.
//
// ALL RED — triple-blocked, written to document the target:
//   1. make_some_space does not parse subspaces (TODO "subspace parsing"), so
//      a socket-load port on a subspace can't even be created.
//   2. subspace routing is unimplemented (Astroglot can't reach the port).
//   3. the socket-load flavour + replace mechanism don't exist.
// Each becomes live once that chain lands. Delivery: socket_load(port, src)
// sends the Astroglot to an outer port wired to the subspace's socket-load port.

import { det_test, arrive, socket_load, known_failures, run } from './det_harness.mjs'

// [socket-load-replace] valid Astroglot replaces the subspace's content; a
// later ship through the slot exercises the NEW content. The sent label is
// discarded — the subspace keeps the name `slot`.
det_test('socket-load: valid Astroglot replaces the subspace content [socket-load-replace]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    slot
      body {:ORIGINAL}
      @in:x -> body -> @out:y
      @reload socket-load
    @load -> slot@reload
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
    slot
      body {:A}
      @in:x -> body -> @out:y
      @reload socket-load
    @load -> slot@reload
    @go -> slot@in:x
    slot@out:y -> @out`,
  schedule: [
    socket_load('load', 'whatever\n  body {:B}\n  @in:x -> body -> @out:y'),
    arrive('go', 'ping'),
  ],
  assert: function(t, e) { e.outputs('out', ['B']) },
})

// [socket-load-reloadable] a subspace stays reloadable only if the loaded
// content itself re-declares a socket-load port; content without one can't be
// reloaded again.
det_test('socket-load: reloadable only if the new content re-declares a socket-load port [socket-load-reloadable]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    slot
      body {:ORIG}
      @in:x -> body -> @out:y
      @reload socket-load
    @load -> slot@reload
    @go -> slot@in:x
    slot@out:y -> @out`,
  schedule: [
    // first load: new content KEEPS a socket-load port -> still reloadable
    socket_load('load', 'whatever\n  body {:FIRST}\n  @in:x -> body -> @out:y\n  @reload socket-load'),
    // second load succeeds because the first re-declared @reload
    socket_load('load', 'whatever\n  body {:SECOND}\n  @in:x -> body -> @out:y'),
    arrive('go', 'ping'),
  ],
  assert: function(t, e) { e.outputs('out', ['SECOND']) },
})

;[
  'socket-load: valid Astroglot replaces the subspace content [socket-load-replace]',
  'socket-load: parent wiring persists and re-applies to new content [socket-wiring-demand]',
  'socket-load: reloadable only if the new content re-declares a socket-load port [socket-load-reloadable]',
].forEach(function(l) { known_failures.add(l) })

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
// svars-do-not-survive — under BOTH modes, the subspace's $vars reset to the
//   new content's initial state (testable at SPACE tier once loads complete).
// [blackhole-no-socket-load] (runtime) loading a (( )) black hole borks the
//   load. (The DEFINITION-form bork is already in space_test.)
