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
  arrive, respond, timeout, world_in, socket_load,
  known_failures, run,
} from './det_harness.mjs'

// ── Isolation (green) ────────────────────────────────────────────────────
// Each test gets its own execution space, so svars never leak between tests.
// (The second test would read "5" if state leaked from the first.)
det_daml('isolation: write and read $x within one space', '{5 | >$x || $x}', '5')
det_daml('isolation: a fresh space sees no $x from a prior test', '{$x}', '')

// ── Moved from d2_spec_test: svar-coercion poke (RED, now isolated) ───────
// list poke coerces the scalar base to [scalar] before D.poke sees it, so
// the affine scalar-replace rule doesn't apply. [WRONG:...] flags the
// disputed expectation. These flaked d2_spec_test via shared svar state;
// here they fail deterministically.
det_daml('poke: scalar base via list poke (list coercion wraps scalar) [WRONG:poke-key-scalar-affine]',
         '{:hello | list poke path :a value 99}', '{"a":99}')
det_daml('poke: string base via >$x.path (list coercion wraps scalar) [WRONG:poke-key-scalar-affine]',
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

// ── Known failures (RED guides) ──────────────────────────────────────────
;[
  'poke: scalar base via list poke (list coercion wraps scalar) [WRONG:poke-key-scalar-affine]',
  'poke: string base via >$x.path (list coercion wraps scalar) [WRONG:poke-key-scalar-affine]',
].forEach(function(l) { known_failures.add(l) })

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
// Identifiers (need the internal-dock trace: qname#vtime + sender per dock):
//   [id-deterministic]        error ships + sender ids byte-identical across runs
//   [procid-sequence]         process ids follow the deterministic sequence
//   [qname-anon-station]      anon stations rank-name s1, s2 in source order
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
