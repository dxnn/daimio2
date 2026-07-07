# Deterministic Test Harness — Plan

A dedicated home for every **determinism-sensitive** test: the deterministic
scheduler, identifier/sender determinism, replay, socket transitions,
black-hole world I/O, and the state-isolation-sensitive poke tests currently
flaking `d2_spec_test`.

It is written **against the replay API the new version will provide** — a
space driven by an explicit *input schedule* under virtual time, producing a
canonical *trace*. Where the engine does not yet provide a hook, the harness
names the gap and the tests stand as fail-fast RED guides (self-managed
known/novel, `run_all` count 0), so the suite stays green until the engine
catches up. Same discipline the project already uses for spec-gap tests.

> **v1 status — BUILT.** `tests/det_harness.mjs` + `tests/det_test.mjs`, on
> the three additive engine hooks (`D.Space#is_idle`, `D.make_execution_space`,
> `D.settle`). Green today: per-test svar isolation, replay of the
> deterministic core (stateful counter + fan-in, byte-identical across runs),
> and fan-in dock order (an artifact of setImmediate-FIFO until the scheduler
> formalizes it). The two `[WRONG:poke-key-scalar-affine]` svar-coercion cases
> moved here from `d2_spec_test` and now fail deterministically. Deferred
> guides (scheduler interleaving, virtual time, qname ids, sender-at-entry,
> black-hole/socket-load I/O) are enumerated at the foot of `det_test.mjs`,
> each held back because in v1 it would fail for a harness reason rather than
> the right one. They land with their machinery.

---

## The model: Schedule → Drive → Trace → Assert

The only sources of nondeterminism in a Daimio run are *external*: when
external ships arrive, when/whether the world answers a request, when a
timeout fires, when the world injects into a black hole, when a socket-load
lands. Pin all of those in a **schedule** and the run is a pure function of
`(space, schedule)`. Replay = run the same pair twice, get byte-identical
traces.

1. **Schedule** — an ordered list of typed external events (below), authored
   as plain data.
2. **Drive** — `D.run_scheduled(seed, schedule, cb)` runs the space under the
   deterministic scheduler and virtual time: injects arrivals at their
   frontier numbers, services outward requests from scripted responses, fires
   timeout events, applies socket-loads, runs to quiescence, then `cb(trace)`.
3. **Trace** — a canonical, ordered event stream the scheduler emits (dockings,
   outputs, error ships), each rendered to a stable string.
4. **Assert** — compare the trace: exact, ordering (subsequence), replay-equal,
   outputs, error ships.

---

## Schedule event types

- `arrive(port, value, {number?})` — an external ship enters `@port`. Takes a
  frontier number (explicit or auto-assigned in list order).
- `respond({port, nth|match, value, delay})` — a scripted world response to a
  **request** that the space emits on a down/command port. Keyed to the
  *request* (the Nth request seen on that port, or a predicate), **not** to
  absolute time, because the request fires at a data-dependent moment. `delay`
  is the virtual-time gap before the response — this is exactly what races
  against the wire's timeout.
- `timeout({port|wire, at})` — force a timeout event at a virtual time. Lets a
  test pin which of {response, timeout} wins and which becomes a ghost.
- `world_in(port, value, {number?})` — a spontaneous world injection at a
  black hole's `@out` (no triggering request).
- `socket_load(port, astroglot, {mode})` — valid/invalid Astroglot arrives at a
  socket-load port; `mode ∈ {drain, smash}`.

Two clocks, deliberately: `arrive`/`world_in`/`timeout` are placed on the
**virtual timeline**; `respond` is placed **relative to its request**. A
black-hole emission (`@in` outward) is fire-and-forget — it appears in the
*trace* as an output, never expects a `respond`.

---

## Trace format

Ordered list; each entry a stable record, rendered canonically for `===`:

- `dock`   — `{ vt, pid, target, ship, sender, value }`
  `pid = qname#vtime`; `target` = docking qname (station/port); `ship` = ship
  number; `sender` = sender id; `value` = a stable digest of the ship value.
- `output` — a ship arriving at a collect/out port `{ vt, port, ship, value }`.
- `error`  — an error ship `{ vt, port, sender, value }`.

Everything in a trace entry is a *replayable* identifier or a value digest —
no wall-clock, no host handle. That is the property `[id-internal-handles]`
demands and the thing that makes `expect_replay` meaningful.

---

## Author-facing API

```js
det_test(label, {
  seed: `outer
    @init from-js
    ...`,
  schedule: [
    arrive('init', 'x'),
    respond({ port: 'clock', nth: 1, value: '12:00', delay: 2 }),
  ],
  assert: (trace) => {
    expect_order(trace, [ dockOf('a'), dockOf('b') ])   // a before b
  },
})

det_replay_test(label, { seed, schedule })   // run twice, assert identical
```

Assertions: `expect_trace` (exact), `expect_order` (subsequence),
`expect_replay` (deep-equal across two runs — the core
`[sched-deterministic][id-deterministic]`), `expect_outputs(trace, port, [...])`,
`expect_error(trace, {...})`.

---

## Isolation

Each `det_test` runs in a **fresh runtime** so no svar/id state bleeds between
tests. This is what lets the flaky poke tests move here.

- **Ideal:** an instance factory (`D.create()`) with its own
  `SPACESEEDS/BLOCKS/Etc/state` — the `project_runtime_isolation` thread.
- **Interim (until the factory lands):** snapshot and reset the singleton's
  global mutable state around each test — clear the `SPACESEEDS`/`BLOCKS`
  entries the test created and reset `D.Etc.process_counter`/`token_counter`
  to a fixed baseline — so ids start clean and are replay-stable. Marked as a
  stopgap.

---

## Engine hooks — PRESENT vs LACKING

**PRESENT — exploit now:**

- Singleton `D` (`daimio/daimio.js:101`). Space construction:
  `D.make_some_space(seedlike)` → seed_id; `new D.Space(seed_id)`; external
  injection `D.send_value_to_js_port(space, port, value, flavour)`.
- Custom port flavours via `D.import_port_flavour` (dir +
  `outside_exit(ship, callback)`). The `collect`/`assert` flavours in
  `space_test.mjs` prove the pattern — **the mock world and the trace sink are
  just flavours plus a hook.**
- Request/response already flows through `outside_exit(ship, callback)`
  (`D.port_standard_sync`, `1_daimio.js:828–837`). A mock-world flavour scripts
  a response by invoking `callback(response_ship)` — so `respond` events are
  buildable on today's port machinery.
- Sender/dialect plumbing: `D.Sender(id, {dialect})` (`1_daimio.js:2265`);
  `process.effective_dialect` (`2827`, `2885`).

**LACKING — the harness assumes these; each is a build item:**

1. **Deterministic scheduler.** No priority loop; dispatch is a FIFO queue
   advanced by `D.setImmediate` (`1_daimio.js:801,832,2753`;
   `pflavs/internal.js:41`). No ship `number`, no frontier numbering, no
   `dock = max(counter, ship#) + 1`, no `(number, wire-decl-order, FIFO)` key.
   → all ordering semantics (`[sched-*]`).
2. **Virtual time.** Timeouts are wall-clock `setTimeout`
   (`commands/builtin/process.js:31`) plus the down-port timeout;
   `process.starttime = Date.now()` (`1_daimio.js:2830`). No vtime; timeouts
   are not schedule events. → timeout-vs-response races can't be pinned or
   replayed (`[sched-timeout-event][timeout-ghost-drop]`).
3. **Deterministic identifiers.** Process id is `pid = process_counter++`
   (`1_daimio.js:2825`) + wall-clock starttime, not `qname#vtime`. No
   topology-derived qnames at runtime (rank-naming exists only in the layout
   engine). → `[id-deterministic][procid-sequence][qname-*]`.
4. **Replay entry point + trace sink.** No `D.run_scheduled(seed, schedule, cb)`
   and no `D.on_trace_event`. The scheduler is the natural emit point; both
   absent. → can't drive by a schedule or capture a canonical trace.
5. **Sender attachment at entry.** `Sender`/`effective_dialect` exist, but the
   "senderless ship takes the entry port's qname as sender" rule is not
   implemented. → `[sender-attach-entry][sender-attach-registry]`.
6. **Black holes & socket-load.** No `((label))` parse, no world-face flavours,
   no drain/smash. → those guides.
7. **Runtime isolation.** Global mutable state on the singleton —
   `D.SPACESEEDS`, `D.BLOCKS`, `D.Etc.process_counter/token_counter`
   (`1_daimio.js:36,38,66,67`) — is shared across every run in a process; no
   fresh-instance factory. This is the direct cause of the poke-test flakiness
   and the `project_runtime_isolation` thread.

Dependencies on the design drafts (owned by the user, not touched here):
scheduler numbering (`scheduler-spec-draft`), sender-at-entry + qnames
(`sender-spec-draft`), black holes / socket-load. The schedule's numbering
unit must line up with the scheduler draft's final `number` semantics.

---

## Tests that live here

Scheduler (`[sched-*]`):
- Convergence order `[sched-tie-wire][sched-advance]`
- Advance blocks reordering `[sched-advance]`
- Single wire is FIFO `[sched-wire-fifo][routing-deferred-order]`
- Self-send fairness `[sched-entry-frontier][sched-dock-max]`
- Held-space re-numbering `[sched-reentry-uniform][sched-dock-max]`
- Timeout as schedule event `[sched-timeout-event][timeout-ghost-drop]`
- Replay identical `[sched-deterministic][id-deterministic]`
- Socket-transition determinism `[sched-transition-keys]`
- Station-free cycle borks `[sched-cycle-station]`

Identifiers / sender:
- Deterministic error ships + sender ids `[id-deterministic][procid-sequence]`
- No observable id is a host handle `[id-internal-handles]`
- Anon station rank-naming `[qname-anon-station]`; qnames from topology
  `[qname-structure]`
- Sender attachment at entry / registry attenuation `[sender-attach-*]`

Black holes / socket-load (world I/O via the mock-world flavour + schedule):
- Outward emit fire-and-forget `[blackhole-in-exit][blackhole-no-guarantee]`;
  inward inject `[blackhole-out-enter]`; opacity `[blackhole-substitutable]`
- Socket-load replace `[socket-load-replace]`; drain `[socket-drain]`; smash
  `[socket-smash]`

Moved from `d2_spec_test` (need isolation, not scheduling):
- `poke: scalar base via list poke …` and `poke: string base via >$x.path …`
  (both `[WRONG:poke-key-scalar-affine]`). They stay RED but become
  deterministic and stop flaking `d2_spec_test`.

---

## Interim posture

The harness probes for `D.run_scheduled` (+ trace sink). If absent, every
`det_test` fails fast with a uniform `engine replay API absent: <hook>` and is
listed **known** (self-managed known/novel; `run_all` count 0). This keeps
`run_all` green while the tests stand as executable RED guides.

Recommendation: **uniform-RED** until the scheduler lands — do **not** build a
best-effort adapter over today's FIFO/`setImmediate` dispatch. Today's engine
is *accidentally* mostly-ordered (single-thread `setImmediate` is FIFO), so a
best-effort adapter would show false green and mask the real work.

---

## File layout & run_all

- `tests/det_harness.mjs` — model, driver adapter, trace, assertions,
  isolation, schedule constructors.
- `tests/det_test.mjs` — the tests above.
- `tests/DET_HARNESS.md` — this plan.
- `run_all.mjs` — add `['det_test.mjs', 'determinism (scheduler/ids/replay)', 0]`.

---

## v1 bootstrap — minimum engine changes

Verified against the engine: v1 needs **no behavioral engine change**. Every
mechanism the driver rides on already exists —

- fresh isolated space: `new D.Space(D.spaceseed_add({…}))`; svars live in
  `space.state` (per-instance) — verified a fresh space resolves commands and
  does not leak svars to another fresh space.
- inject: `D.send_value_to_js_port(space, port, value)`.
- script responses: a mock-world port flavour's `outside_exit(ship, callback)`
  calls `callback(response)` — the down-port sync path already forwards the
  callback (`D.port_standard_sync` → `pair.outside_exit(ship, callback)`,
  `1_daimio.js:828–840`).
- trace: ordered arrivals at `collect`/error port flavours (no internal hook
  needed for v1; the `qname#vtime` per-dock trace is deferred with the ids).
- quiescence: `space.processes.length === 0 && space.queue.length === 0`
  (async-waiting processes stay in `processes`). `starttime = Date.now()`
  (`1_daimio.js:2830`) is assigned but **never read**, so wall-clock never
  reaches a trace.

Three tiny **additive** hooks (new functions; touch no existing path → cannot
regress the 9 suites), added only to keep the harness off engine internals:

1. `D.Space.prototype.is_idle()` → `!this.processes.length && !this.queue.length`.
   Quiescence predicate; the real scheduler redefines it later.
2. `D.make_execution_space()` — factory for a bare isolated execution space
   (wraps the `daimio.js:92` seed literal).
3. `D.settle(space, cb)` — recursive-`setImmediate`-until-idle drain, confirmed
   idle across two consecutive ticks (guards the momentary-idle window between
   `run_queue`'s `queue.shift()` and its deferred `real_execute`), with a tick
   budget that turns a non-settling self-feed into a RED "budget exceeded".

Deferred (all subjects of RED tests, not prerequisites): scheduler priority
loop, virtual time + timeouts-as-events, `qname#vtime` ids, sender-at-entry,
black holes, socket-load. Tests needing them fail fast as RED; the harness runs
everything else against the real engine (not a faked adapter).

## Open decisions

1. **World-response keying** — request-relative (`respond` keyed to the Nth
   request + `delay`) *(recommended)* vs absolute virtual time.
2. **Schedule numbering unit** — frontier ordinals aligned to the scheduler
   draft's `number` *(recommended)* vs abstract vtime floats. Depends on the
   draft's final numbering.
3. **Trace granularity** — full docks (`vt, pid, target, ship, sender, value`)
   *(recommended: strongest replay guarantee)* vs outputs + errors + ids only
   (looser coupling to internals).
4. **Isolation now** — lightweight snapshot/reset now, swap to the instance
   factory later *(recommended)* vs wait for the factory.
5. **Interim posture** — uniform-RED *(recommended)* vs best-effort adapter.
