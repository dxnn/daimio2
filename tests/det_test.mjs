// Determinism tests — run with: node tests/det_test.mjs
// Harness + design: tests/det_harness.mjs, tests/DET_HARNESS.md
//
// v1 covers what the current engine supports honestly: per-test svar
// isolation, replay of the deterministic core, and the fan-in dock order
// (which today is an artifact of setImmediate-FIFO, and becomes a spec
// guarantee once the priority-loop scheduler lands). The determinism/
// feature guides that need unbuilt machinery are listed at the bottom —
// each is deferred deliberately, because in v1 it would fail for a harness
// reason rather than for the right reason. They land with their features.

import {
  det_daml, det_test, det_replay,
  arrive, batch, respond, respond_now, timeout, world_in, socket_load,
  known_failures, run,
} from './det_harness.mjs'

// ── Isolation (green) ────────────────────────────────────────────────────
// Each test gets its own execution space, so svars never leak between tests.
// (The second test would read "5" if state leaked from the first.)
det_daml('isolation: write and read $x within one space', '{5 | >$x || $x}', '5')
det_daml('isolation: a fresh space sees no $x from a prior test', '{$x}', '')

// ── Moved from d2_spec_test: affine key-poke on a scalar base ─────────────
// GREEN since the 2026-07-12 pathfinder scalar/Empty refactor: no list
// coercion; the affine scalar-replace rule applies [poke-key-scalar-affine].
det_daml('poke: scalar base promotes to keyed (affine) [poke-key-scalar-affine]',
         '{:hello | list poke path :a value 99}', '{"a":99}')
det_daml('poke: string base via >$x.path promotes to keyed (affine) [poke-key-scalar-affine]',
         '{:hello | >$sp1 || 99 | >$sp1.a || $sp1}', '{"a":99}')

// ── Replay (green): same space + same schedule → identical trace ──────────
// A stateful counter, driven three times, replays byte-for-byte. This is
// the core replay property for the deterministic (no timeout / no world
// race) case, provable on today's engine.
det_replay('replay: stateful counter is byte-identical across runs [sched-deterministic]', {
  seed: `outer
    @go from-js
    @out det-out
    bump {$count | math add value 1 | >$count || $count}
    @go -> bump -> @out`,
  schedule: [ arrive('go', 'x'), arrive('go', 'x'), arrive('go', 'x') ],
})

// Multi-output replay: a fan-in produces two ships; their order is stable
// across runs.
det_replay('replay: fan-in output order is stable across runs [sched-deterministic]', {
  seed: `outer
    @go from-js
    @out det-out
    aa {:A}
    bb {:B}
    @go -> aa -> @out
    @go -> bb -> @out`,
  schedule: [ arrive('go', 'x') ],
})

// ── Scheduler convergence order (green artifact) ──────────────────────────
// A and B fan in; the spec docks them in wire-declaration order (aa before
// bb). This passes today because setImmediate dispatch is FIFO — an
// artifact, not yet a guarantee. Kept green as a regression guard: if the
// dock order ever flips it fails here, and it becomes authoritative when the
// priority-loop scheduler formalizes the (number, wire-decl, FIFO) key.
det_test('scheduler: fan-in docks by wire-declaration order [sched-tie-wire]', {
  seed: `outer
    @go from-js
    @out det-out
    aa {:A}
    bb {:B}
    @go -> aa -> @out
    @go -> bb -> @out`,
  schedule: [ arrive('go', 'x') ],
  assert: function(trace, expect) { expect.outputs('out', ['A', 'B']) },
})

// ── Internal-dock trace: scheduler numbering + qnames (via the dock hook) ─

// [sched-dock-lowest] A space docks its lowest-numbered pending ship next.
// Batch three numbered arrivals at one station; they must dock in NUMBER
// order (4,7,9), not injection order (9,4,7). GREEN since the scheduler landed.
det_test('scheduler: docks lowest-numbered pending ship first [sched-dock-lowest]', {
  seed: `outer
    @go from-js
    @out det-out
    sink {__}
    @go -> sink -> @out`,
  schedule: [ batch(
    arrive('go', 'n9', { number: 9 }),
    arrive('go', 'n4', { number: 4 }),
    arrive('go', 'n7', { number: 7 }),
  ) ],
  assert: function(t, e) { e.dockValues(['n4', 'n7', 'n9']) },
})

// [sched-dock-max] On docking, the process's number = max(space counter,
// ship number) + 1. A fresh space (counter 0) docking a ship numbered 2 gives
// number 3. GREEN since the scheduler landed (dock renumbering).
det_test('scheduler: dock number = max(counter, ship number) + 1 [sched-dock-max]', {
  seed: `outer
    @go from-js
    @out det-out
    sink {__}
    @go -> sink -> @out`,
  schedule: [ arrive('go', 'x', { number: 2 }) ],
  assert: function(t, e) { e.dockNumbers([3]) },
})

// [sched-reentry-uniform] A down-port response re-docks the held process by
// the entry rule: its number becomes max(space counter, response number) + 1
// — post-wait work numbers above everything the space issued during the
// wait. A ship arriving DURING the wait queues and is numbered when it
// actually docks (after the wait), not at arrival; the world response
// carries no number, so it enters at the boundary frontier
// [sched-entry-frontier]. Docks: caller 'a' = 1; the response (frontier 1)
// renumbers the waiting process to 2; queued 'b' docks post-wait at
// max(2, entry 1)+1 = 3; the resumed emission docks relay at max(3, 2)+1 = 4.
det_test('scheduler: a held-space wait renumbers uniformly [sched-reentry-uniform] [sched-dock-max]', {
  seed: `outer
    @go from-js
    @in2 from-js
    @out det-out
    @world det-world
    caller {var read-out name :x | logic if then :got else :empty}
    pass  {__}
    relay {__}
    caller@cmd:var:* <-> @world
    @go -> caller
    caller -> relay -> @out
    @in2 -> pass -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'a'),
    arrive('in2', 'b'),
    respond_now('world', '42'),
  ],
  assert: function(t, e) {
    e.dockTargets(['caller', 'pass', 'relay'])
    e.dockNumbers([1, 3, 4])
  },
})

// A timeout firing is an external event numbered at the boundary frontier —
// the timed-out process renumbers before continuing, like any re-dock
// [sched-reentry-uniform] [sched-entry-frontier]: caller = 1; the deadline
// (frontier 1) renumbers the process to 2; relay docks at max(2, 2)+1 = 3.
det_test('scheduler: a timeout resume renumbers at the frontier [sched-reentry-uniform] [sched-timeout-event]', {
  seed: `outer
    @go from-js
    @out det-out
    @world det-world
    caller {var read-out name :x | logic if then :got else :empty}
    relay {__}
    caller@cmd:var:* <-> @world
    @go -> caller
    caller -> relay -> @out`,
  now: 1600000000000,
  schedule: [
    arrive('go', 'a'),
    timeout({ at: 1600000000000 + 10001 }),
  ],
  assert: function(t, e) {
    e.outputs('out', ['empty'])
    e.dockNumbers([1, 3])
  },
})

// [sched-ship-vtime] A ship's number is carrier metadata, never payload — no
// DAML expression can recover it. GREEN and stable.
det_test('scheduler: a ship number is carrier metadata, not payload [sched-ship-vtime]', {
  seed: `outer
    @go from-js
    @out det-out
    echo {__in}
    @go -> echo -> @out`,
  schedule: [ arrive('go', 'payload', { number: 7 }) ],
  assert: function(t, e) { e.outputs('out', ['payload']) },
})

// [qname-anon-station] Anonymous inline stations get qnames s1, s2 in source
// order. GREEN since qnames landed (2026-07-12).
det_test('scheduler: anonymous stations get qnames s1, s2 in source order [qname-anon-station]', {
  seed: `outer
    @go from-js
    @out det-out
    @go -> {__ | math add value 1} -> {__ | math add value 2} -> @out`,
  schedule: [ arrive('go', 0) ],
  assert: function(t, e) { e.dockTargets(['s1', 's2']) },
})

// [qname-structure] A station's qname is its space path + name.
det_test('scheduler: a station qname is its space path plus name [qname-structure]', {
  seed: `outer
    @go from-js
    @out det-out
    calc {__ | math add value 1}
    @go -> calc -> @out`,
  schedule: [ arrive('go', 0) ],
  assert: function(t, e) { e.dockTargets(['calc']) },
})

// ── Round-trip port occupancy (design/roundtrip-signalflip-draft.md) ──────
// A round-trip port pair holds one piece of local state: occupancy. A ship
// arriving at the response side while the port is FREE is a ghost — dropped
// with a soft error, never continuing onward [upport-ghost-after-first].
// Dock-count assertions need the settle-driven harness: a space_test value
// assertion cannot express this under the ordinal ruling (which value
// continues while OCCUPIED is a deterministic schedule artifact).

// Up-port direction: the request round trip completes (step 1, port frees),
// then an unrelated entry triggers the contracted station (step 2); its
// output rides the same processor->@up wire but must not reach receiver.
det_test('occupancy: unrequested ship at a free up-port ghosts [upport-ghost-after-first]', {
  seed: `
    multi
      processor
        {__}
      ghostly
        {:ghost}
      @up <-> processor
      @in -> ghostly -> processor
    outer
      @init from-js
      @trigger from-js
      @out det-out
      receiver
        {__}
      @init -> multi@up -> receiver -> @out
      @trigger -> multi@in`,
  schedule: [ arrive('init', 'test'), arrive('trigger', 'x') ],
  assert: function(t, e) {
    e.outputs('out', ['test'])                      // the ghost never reaches @out
    e.dockValues(['test', 'test', 'x', 'ghost'])    // receiver docks exactly once
  },
})

// Down-port direction: the contracted handler is also reachable directly;
// triggered with no request outstanding, its output rides the response leg
// to the down port's parent side and must ghost there, not enter inner.
det_test('occupancy: unrequested ship at a free down-port ghosts [upport-ghost-after-first]', {
  seed: `
    inner
      @in -> @down:need -> @out
    outer
      @init from-js
      @poke from-js
      @out det-out
      handler
        {__ | string uppercase}
      inner@down:need <-> handler
      @poke -> handler
      @init -> inner@in
      inner@out -> @out`,
  schedule: [ arrive('init', 'go'), arrive('poke', 'sneak') ],
  assert: function(t, e) {
    e.outputs('out', ['GO'])                        // SNEAK ghosts at the free port
  },
})

// ── Known failures (RED guides) ──────────────────────────────────────────
// (empty — the poke scalar guides went green with the pathfinder refactor)

run()

// ── Deferred guides (land with their machinery) ───────────────────────────
// Written here as intent, not as tests: in v1 each would fail for a harness
// reason (can't express the scenario) rather than because the engine lacks
// the behavior, so shipping them now would be misleading. Each becomes a
// real det_test / det_replay when its dependency lands.
//
// Scheduler (need the priority loop + true frontier interleaving):
//   [sched-advance]           advance blocks a higher-numbered ship docking first
//   [sched-wire-fifo]         single wire docks in emission order under concurrency
//   [sched-entry-frontier]    self-feed never starves fresh external arrivals
//   [sched-reentry-uniform]   ships behind a held-space wait re-number uniformly
//
// Virtual time (need vtime + timeouts-as-events, not wall-clock setTimeout):
//   [sched-timeout-event]     a timeout placed before/after a response decides
//                             the race; the loser ghosts [timeout-ghost-drop]
//   [request-cycle-timeout]   a cyclic request chain resolves to empty by timeout
//
// Identifiers (need the internal-dock trace: qname + number + sender per dock;
// procids were dropped from the spec — observable ids are qnames + content
// hashes only, error ships name qnames):
//   [id-deterministic]        error ships + sender ids byte-identical across runs
//   [qname-structure]         qnames derive from the source (subspace path + name)
//   [qname-anon-station]      anon stations named s1, s2 in source order
//
// Sender-at-entry (need the attachment rule):
//   [sender-attach-entry]     senderless ship takes the entry port's qname
//   [sender-attach-registry]  a registered attenuated dialect sploots forbidden cmds
//
// Black holes / socket-load (need the features; parse/bork guides belong in
// space_test, world-I/O + transition determinism here):
//   [blackhole-in-exit]       ship at @in emitted outward, fire-and-forget
//   [blackhole-out-enter]     world value injected as a ship at @out
//   [socket-drain] / [socket-smash] / [sched-transition-keys]
