// Socket-load behavior — run: node tests/det_socket_test.mjs
// A socket is a !-sigiled slot (§3/§8) whose frame — name, parent wiring,
// and two implicit port-likes (slot@socket-load, slot@socket-load-smash) —
// persists across loads. Incoming Astroglot REPLACES everything else:
// stations, internal wiring, sub-subspaces, initial state, and all declared
// ports, instantiated fresh; the payload's top-level label is discarded.
// Runtime loads never bork — bad input sploots [socket-load-sploot].
// Delivery: socket_load(port, src) sends the Astroglot to an outer port
// wired to the slot's port-like.

import { det_test, det_replay, arrive, socket_load, respond_now, known_failures, run } from './det_harness.mjs'

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

// [socket-load-sploot] a runtime load never borks: invalid Astroglot
// sploots with a soft error and the CURRENT content is untouched — a
// later ship exercises the original body.
det_test('socket-load: invalid Astroglot sploots and leaves content untouched [socket-load-sploot]', {
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
    socket_load('load', '!!!not astroglot@@@'),
    arrive('go', 'ping'),
  ],
  assert: function(t, e) { e.outputs('out', ['ORIGINAL']) },
})

// ── Transitions under busy content ─────────────────────────────────────────
// Busy = the content's station is waiting on an effectful request parked at
// an unscripted det-world port (rule slot@cmd:var:* <-> @world).

// [socket-smash] the new content replaces the old AT ONCE: the old waiting
// process ceases to exist and its later response ghosts; the next ship
// exercises the new content.
det_test('socket-smash: busy old content is destroyed; late response ghosts [socket-smash]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    @world det-world
    !slot
      body {var read-out name :x | logic if then :OLD-GOT else :OLD-EMPTY}
      @in:x -> body -> @out:y
    slot@cmd:var:* <-> @world
    @load -> slot@socket-load-smash
    @go -> slot@in:x
    slot@out:y -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'first'),                                    // docks, waits at @world
    socket_load('load', 'x\n  body {:NEW}\n  @in:x -> body -> @out:y'),
    arrive('go', 'second'),                                   // exercises the NEW content
    respond_now('world', '42'),                               // late: the old waiter is gone
  ],
  assert: function(t, e) { e.outputs('out', ['NEW']) },
})

// [socket-drain] (default) the old content finishes its in-flight work first;
// ships arriving mid-drain buffer at the socket and release into the new
// content; nothing in flight is lost.
det_test('socket-drain: old content finishes, buffered arrivals release into new [socket-drain]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    @world det-world
    !slot
      body {var read-out name :x | logic if then :OLD-GOT else :OLD-EMPTY}
      @in:x -> body -> @out:y
    slot@cmd:var:* <-> @world
    @load -> slot@socket-load
    @go -> slot@in:x
    slot@out:y -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'first'),                                    // docks, waits at @world
    socket_load('load', 'x\n  body {:NEW}\n  @in:x -> body -> @out:y'),
    arrive('go', 'second'),                                   // buffers at the draining socket
    respond_now('world', '42'),                               // old completes: OLD-GOT, then swap +
  ],                                                          // the buffered ship exercises NEW
  assert: function(t, e) { e.outputs('out', ['OLD-GOT', 'NEW']) },
})

// [blackhole-no-socket-load] (load side) a black hole cannot be loaded into
// a socket: the load sploots and the current content is untouched.
det_test('socket-load: loading a black hole sploots [blackhole-no-socket-load]', {
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
    socket_load('load', '*hole\n  @in:feed websock-out'),
    arrive('go', 'ping'),
  ],
  assert: function(t, e) { e.outputs('out', ['ORIGINAL']) },
})

// [sched-transition-keys] a transition under load is deterministic:
// byte-identical replay for a fixed schedule + response script.
det_replay('socket-drain: transition replay is byte-identical [sched-transition-keys]', {
  seed: `outer
    @go from-js
    @load from-js
    @out det-out
    @world det-world
    !slot
      body {var read-out name :x | logic if then :OLD-GOT else :OLD-EMPTY}
      @in:x -> body -> @out:y
    slot@cmd:var:* <-> @world
    @load -> slot@socket-load
    @go -> slot@in:x
    slot@out:y -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'first'),
    socket_load('load', 'x\n  body {:NEW}\n  @in:x -> body -> @out:y'),
    arrive('go', 'second'),
    respond_now('world', '42'),
  ],
})

run()

// ── Deferred transition guides ──────────────────────────────────────────────
// (both former deferrals — [sched-transition-keys] replay and the
// [blackhole-no-socket-load] load-side sploot — are live guides above)
