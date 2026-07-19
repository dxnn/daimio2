# Daimio2 Test TODO

Tests to upgrade and write for the spec changes made this session:
websock rename + unquote gate, black holes, socket-load rewrite,
sender/qualified-names + I16, block-evaluating commands, recursion-depth
bound, deterministic scheduler (virtual time). Layout/`space_ascii` is a
separate stream — not covered here.

Suites: `d2_spec_test.mjs` (DAML spec assertions), `space_test.mjs`
(space-level), `security_test.mjs`, `node_code.mjs`, `example_test.mjs`
(auto-discovered from command `examples`).

Legend — **[now]** writable against the current engine · **[impl]**
blocked on unimplemented machinery (ports/async, spaces, black holes,
socket-load, sender attachment); write as RED guides, as the project
already does for the space_test spec-gaps.

---

## Upgrade existing tests

- **`d2_spec_test.mjs:1341` "Star PutGet [law-putget]"** — asserts
  `poke "*" 0 | peek "*"` → `[0,0,0]`. The behavior is right, but the
  `[law-putget]` label is now backwards: the spec says PutGet *fails*
  for Star/Par (peek wraps the traversal, so `[0,0,0] ≠ 0`). Relabel it
  as a Star-PutGet-**failure** demonstration and pair it with the affine
  cases that do hold. [now]
- **`d2_spec_test.mjs:2538` `[P-effectpartition]` scan** — currently
  buckets commands into pure/effectful/both/neither with a hardcoded
  `known_both = [time.now, var.read-out, var.write-out]`. Upgrade to the
  **ternary**: split "has fun" into pure (no block param) vs
  block-evaluating (≥1 block-typed param) `[blockeval-category]`; and the
  `known_both` allowance should empty out once the effect+fun commands
  are fixed (TODO impl item 2). [now]
- **`d2_spec_test.mjs:361-375` var read-out/write-out** — the local
  read-back `{var write-out … | var read-out …}` → 42 passes only because
  today's `fun` reads local state. Under port-routing (effectful, no fun)
  this becomes cross-boundary and unwired → empty. Migrate the local
  read-back to the new `{var read}`/`{var write}` `[var-read][var-write]`;
  keep `var read-out`/`write-out` for the wired cross-boundary case. [impl]
- **`space_test.mjs:1933-2201` var read-out/write-out block** — large
  suite exercising cmd-port naming, forwarding, timeouts, sploot. Re-home
  under the effectful-port-routing model (reaches the **parent's** state,
  not the caller's) once ports route. [impl]
- **`space_test.mjs:1217-1276` "socket overlap"** — overlap is gone.
  Retag the dead `[socket-overlap-state-lost]`, reword the label, and
  split into drain + smash (state-lost holds under both). [impl]
- **`security_test.mjs:127-132` alias-gating (commented out)** — decide:
  delete, or keep only the alias-*membership* assertions retagged
  `[dialect-alias-expand]` (drop `[alias-dialect-gate]`, now future work). [now]
- **`security_test.mjs:361,577,597` `[sender-effective-default]`** —
  re-verify against the entry-attachment rule: a senderless ship is now
  "internal by construction," so these should be framed as the internal
  case, not the port-entry case. Behavior likely unchanged. [now]
- **`node_code.mjs:554` math random `[random-pure]`** — already covered;
  just confirm it still aligns with the P-effectpartition PRNG caveat
  ("pure save for reads of the seeded PRNG"). [now]

---

## New tests — writable now [now]

### Path / lens laws — `d2_spec_test`
- PutGet **fails** for Star and Par: `peek(poke(v,[Star],x),[Star])` =
  `[x,…] ≠ x` (peek wraps traversals) `[law-putget]`.
- GetPut **fails** for Star/Par (same reason) `[law-getput]`; contrast
  with the affine Key/Pos cases that hold.

### Effect partition (ternary) — `d2_spec_test`
- Registration: `fun` + no block param → pure; `fun` + ≥1 block-typed
  param (incl. `either` with a block arm) → block-evaluating; `effect`
  → effectful; `fun`+`effect` or neither → bork `[blockeval-category]`.
- `list map` with a pure block completes synchronously; result equals the
  mapped values `[blockeval-sync-when-pure]`.

### Recursion depth — `d2_spec_test` (RED until enforced)
- A self-invoking named block **sploots** (empty + soft error), process
  completes — never crashes `[depth-exceeded-sploot]`.
- With the instance bound set low (e.g. 3), the sploot fires at exactly
  that depth `[depth-bound-instance]`.
- Breadth is free: mapping N items at depth k stays at depth k+1
  `[depth-nesting-only]`.
- A command that throws surfaces as a value-producing sploot, not a crash
  `[host-error-sploot]`.

### `{var read}` / `{var write}` — `example_test` + `d2_spec_test` (after TODO impl item 1)
- `{var read name :foo}` reads the current space `$foo`; `{var write name
  :foo value 5}` writes it; `{var read name _n}` reads by computed name
  `[var-read][var-write]`. Add `examples` to the command defs for
  auto-coverage.

---

## New tests — RED guides, blocked on implementation [impl]

### Black holes — `space_test`
- `((label))` parses to a spaceseed with the black-hole flag
  `[spacesyn-blackhole][blackhole-seed-flag]`.
- Borks: a station/wire/state in a black hole `[blackhole-only-ports]`;
  an `up`/`down` port `[blackhole-inout-only]`; the root as a black hole
  `[blackhole-not-root]`; a `socket-load` port on one
  `[blackhole-no-socket-load]`; a flavour whose dir doesn't oppose
  `[blackhole-flavour-oppose]`.
- Bare `@in` defaults to the opposing generic flavour (pure sink)
  `[blackhole-default-flavour]`.
- Outward: ship at `@in` is emitted, fire-and-forget, no response
  `[blackhole-in-exit][blackhole-no-guarantee]`. Inward: world value →
  ship at `@out` into the parent queue `[blackhole-out-enter]`.
- Opacity: a black hole and a mock subspace with the same port signature
  are indistinguishable to the parent `[blackhole-substitutable]`.
- No interior: no stations/state/queue/processes `[blackhole-no-interior]`;
  flavour world-methods bind to the inside face `[blackhole-flavour-inside]`;
  in/out streams uncorrelated `[blackhole-uncorrelated]`.
- REVISIT (dann, 2026-07-19): whether hole ports self-bind ACTIVE flavours at
  instantiation. Spec's creation case 4 promises `outside_add()` runs on the
  inside face at instantiation (`[blackhole-flavour-inside]`, §4 Port
  lifecycle) but the engine never calls it — `outside_add` fires only for the
  outer space's world-side ports (1_daimio.js:2682); hole ports get noop
  `add()`. Only the exit half landed (925-927). Inbound today is App-driven
  `send_value_to_js_port` only, so a self-binding in-flavour (websock-in,
  dom-on-click) declared on a hole sits dead. Undecided: build the
  instantiation-time binding, or walk back the spec sentence and bless
  App-driven entry as the only inbound path. Interacts with the hole-formation
  notification design (App must know a hole exists before anything can bind).

### Socket-load — `space_test`
- Valid Astroglot at a socket-load port **replaces** the subspace's
  content; parent name + wiring persist; payload top-level label discarded
  `[socket-load][socket-load-replace]`. Invalid Astroglot leaves content
  untouched.
- Reloadable only if the loaded content re-declares a socket-load port
  `[socket-load-reloadable]`.
- Bork: socket-load port on the root `[socket-load-not-root]`.
- **Drain**: old finishes its queue; new arrivals buffer then deliver
  `[socket-drain]`. **Smash**: old svars + non-exited ships destroyed; a
  waiting down-port response returns to a ghost `[socket-smash]`.

### Sender / qualified names — `space_test` + `security_test`
- Entry attribution: a senderless ship through `@in:x` docks with sender
  id `@in:x` + base dialect `[sender-attach-entry]`.
- Registry attenuation: register `@in:x` with a dialect lacking `math`;
  `{3 | math add value 2}` through it sploots
  `[sender-attach-registry][dialect-cmd-sploot]`.
- No override: a ship with sender `alice` entering `relay@in:feed` keeps
  `alice` `[sender-attach-no-override]`.
- Payload inertness: a packet `{user:"admin"}` through `websock-in` gains
  no privilege `[sender-carrier-not-payload]`.
- Black-hole emergence: emerging ship carries `relay@out:news`
  `[blackhole-sender-outer]`.
- Flavour supplies sender from transport metadata, never packet contents
  `[sender-flavour-supply]`.
- Anon naming: two anonymous stations render as `s1`, `s2` in source order
  `[qname-anon-station]`; qnames derive from source order `[qname-structure]`.
- Determinism: same space + same inputs twice → error ships and exiting
  sender ids are byte-identical `[id-deterministic]`;
  no observable identifier is a runtime handle `[id-internal-handles]`.

### Block-evaluating suspension — `space_test` (needs ports/async)
- A block-evaluating command whose block reaches an effectful command
  suspends the sub-process; the parent is held by depth-first nesting and
  resumes on the response `[blockeval-parametric][blockeval-demand]`.
- Sub-processes run under the parent's effective dialect — a block can't
  reach commands the parent couldn't (§13 dialect check).

### Effectful port-routing — `space_test` (needs port machinery)
- Effectful command routes through its port; unwired → sploot (empty),
  and the soft error names the `cmd:handler:method`, not a handle
  `[effectful-unwired-sploot][id-internal-handles]`.
- I2: a sender whose dialect isn't a subset of the space still yields
  `effective = intersection ⊆ space` (extra commands inert).

### Request cycles — `space_test` (needs ports/timeouts)
- A cyclic request chain resolves by timeout to empty; a late response
  becomes a ghost `[request-cycle-timeout]`.

### Deterministic scheduler — `space_test` (needs the priority-loop scheduler)
- **Convergence order.** A and B fan in to C; C's two inputs dock in the
  order their wires are declared in the source, on every run and host
  `[sched-tie-wire][sched-advance]`.
- **Advance blocks reordering.** With A's ship pending at a lower number,
  C cannot dock B's higher-numbered ship first `[sched-advance]`.
- **Single wire is FIFO.** Ships on one wire dock in emission order; on a
  single wire the key reduces to FIFO because the source's numbers only
  increase `[sched-wire-fifo][routing-deferred-order]`.
- **Self-send fairness.** A self-feeding space (`>@again`) interleaves
  fresh external arrivals at the frontier and never starves them
  `[sched-entry-frontier][sched-dock-max]`.
- **Held-space re-numbering.** Ships queued behind a long App wait dock
  with re-raised numbers; no downstream key lands below one already
  processed `[sched-reentry-uniform][sched-dock-max]`.
- **Timeout as schedule event.** Placing a timeout before/after a response
  in the schedule deterministically decides which wins; the loser ghosts
  `[sched-timeout-event][timeout-ghost-drop]`.
- **Replay.** The same space + same input schedule, run twice, yields a
  byte-identical trace including error ships (named by qname)
  `[sched-deterministic][id-deterministic]`.
- **Socket-transition determinism.** A drain (or smash) during traffic
  produces the same interleaving on every run `[sched-transition-keys]`.
- **Bork.** A station-free wiring cycle fails to compile
  `[sched-cycle-station]` — `[now]` once cycle detection lands, `[impl]`
  until then.

---

## Parser / Astroglot

- **Malformed `<->` must error, not silently misparse** (reviewer-reported) —
  `seedlikes_from_string` mints a bogus port from any LHS token and treats the
  RHS as a station, so a backwards `A <-> @down:svc` "passes" on orphan shapes.
  Test: station-on-LHS (and other non-`port <-> station` shapes) errors/borks
  per the §3 contract signal-type rule; a valid `@up:svc <-> A` still round-trips;
  a port-on-RHS contract (`S@down <-> T@up`) parses to the right two routes. [now]
  — **DONE** (RED guide `[spacedef-hard-error][roundtrip-enex-lhs]` + green
  control in `space_test.mjs`, via a new `parse_test(label, seedlike, should_bork)`
  helper). Confirmed via probe that station-on-LHS currently parses without
  error. Other non-`port <-> station` shapes and the round-trip route-pair
  assertion remain for a follow-up.

## Performance regression

- **Establish perf regression baselines.** `perf_test.mjs` exists (21 checks) but
  we need end-to-end workload regressions that fail on throughput drops, not just
  micro-checks. Starting point: the **mandelbrot ships** demos in
  `site/demos/mandelbrot/` (`canvas_ships.html`, `_fast.html`, `_faster.html`) —
  heavy daimio workloads (iterative escape-time via self-feeding `>@again`/`>@done`
  ship loops, block eval, path access, arithmetic). The base/fast/faster ladder
  gives a natural before/after comparison. Extract the pipelines into a headless
  perf harness, record iteration/second (or total ships docked) baselines, assert
  no regression beyond a tolerance.
- **Scheduler is perf-sensitive.** If the deterministic-scheduler draft lands, it
  replaces the `setImmediate` deferral sites with a priority loop — a change that
  can shift throughput. These mandelbrot baselines should exist *before* that
  lands so the scheduler's perf impact is measurable. The self-feeding loops are
  also the exact shape the scheduler's frontier/dock-number rules govern.

## Deterministic-harness RED-guide backlog (2026-07-07 spec extraction)

Full per-invariant extraction done across the four new subsystems (scheduler,
sender/qname/id, blockeval/depth, black-hole/socket/async). What's built and
what each remaining guide is blocked on:

**BUILT (verified, committed) — 8 determinism suites + space/d2 guides:**
- `det_test.mjs` — isolation, replay (counter + fan-in), fan-in dock order
  (green artifact); internal-dock trace via the D.Etc.on_dock hook:
  `[sched-dock-lowest]`, `[sched-dock-max]`, `[qname-anon-station]`,
  `[qname-structure]` (RED), `[sched-ship-vtime]` (green); poke moves (RED).
- `det_sender_test.mjs` — I2/I3/I4 + sender attach: attach-no-override,
  propagate-out, immutability, dialect-cmd-sploot(+control), carrier-not-payload
  (green); `[sender-attach-entry]` (RED).
- `det_world_test.mjs` — emission observed (green); `[roundtrip-response]`,
  `[P-singleresponse]` (RED).
- `det_time_test.mjs` — `{time now}` under a runner-frozen clock (D.now): exact
  value + replay (green); `[demandport-wire]` cmd:time:now routing (RED).
- `det_blackhole_test.mjs` — crossing: `[blackhole-in-exit]`, `[blackhole-out-enter]`,
  `[blackhole-sender-outer]` (RED, triple-blocked).
- `det_socket_test.mjs` — `[socket-load-replace]`, `[socket-wiring-demand]`,
  `[socket-load-reloadable]` (RED, triple-blocked).
- `space_test.mjs` — 8 compile-bork guides (black-hole rules, socket-load-not-root,
  demandport-create) + contract-direction, all RED.
- `d2_spec_test.mjs` — lens laws, blockeval-sync, self-invoking/host-error sploot,
  time stampwrap (green), object-via-pipe; `[var-read]`/`[var-write]` (RED).

**FOUNDATIONAL BLOCKER (discovered 2026-07-08):** `make_some_space` does not
parse subspaces — an indented block becomes a station (`subspaces: 0`). This is
the root reason every subspace-based guide (socket-load, black-hole crossing,
cmd-forwarding, up-ports, cross-boundary var) is RED, beneath routing. See
TODO.md §0.

**Blocked on the internal-dock trace hook** (`D.on_trace_event` emitting
`{qname, number, target, sender, value}` per dock — the single most valuable
harness addition; note procids were dropped, so no `qname#vtime` id):
`[sched-dock-lowest]`, `[sched-dock-max]`, `[sched-advance]`,
`[sched-entry-frontier]`, `[sched-reentry-uniform]`, `[sched-ship-vtime]`
(+ the negative: DAML cannot read the number), `[qname-structure]`,
`[qname-anon-station]`, `[subprocess-bypass-queue]`, `[id-internal-handles]`
(scan every emitted id — must be a qname or content hash).
These are all RED-for-the-right-reason once the trace exists (engine has no
number/qname yet). Needs number-pinning too (`arrive(...,{number})` already
added, currently ignored).

**Blocked on world-I/O** (mock-world execution through down-ports):
`[blackhole-in-exit]`, `[blackhole-out-enter]`, `[blackhole-uncorrelated]`,
`[blackhole-sender-outer]`, `[blackhole-substitutable]`, `[P-singleresponse]`,
`[sender-propagate-downport]`, `[effcmd-request-val]`, `[cmd-forward]`,
`[wiring-target-*]`, `[demandport-wire]`. (`det-world` flavour + `respond`
scaffolding exist; down-port round-trips are unimplemented.)

**Blocked on virtual time** (timeout-as-schedule-event): `[sched-timeout-event]`,
`[timeout-ghost-drop]`, `[timeout-resume-empty]`, `[timeout-min-chain]`/I12,
`[request-cycle-timeout]`, `[upport-ghost-after-first]`.

**Blocked on the feature itself:** socket-load semantics (`[socket-load]`,
`[socket-load-replace]`, `[socket-wiring-demand]`, `[socket-load-reloadable]`,
`[socket-drain]`, `[socket-smash]`, `[sched-transition-keys]`); black-hole seed
flag (`[blackhole-seed-flag]` — seed inspection); depth-bound knob
(`[depth-bound-instance]`, `[depth-nesting-only]` — no creation-time bound param
exists); blockeval suspension (`[subprocess-sync-dfs]`, `[blockeval-demand]`,
`[blockeval-parametric]`, `[blockeval-no-port]`); effectful port-routing
(`[effectful-unwired-sploot]` — already tracked in space_test).

**Blocked on a small API:** `[sender-attach-registry]` needs a qname->sender
registry consulted in `port.enter()` (`D.register_sender`).

**Low-dep green guards to add** (not yet done): `[sched-cycle-station]` bork
(station-free wiring cycle → space_test parse_test); `[sched-wire-fifo]`
(needs the multi-`>@out` emission-order semantics understood — single `>@out`
works, but `emit -> @out` wired + multi-send came back empty in a probe;
investigate); `[host-error-sploot]` (verified the engine catches a throwing
command into an empty sploot — needs a throwing command injected, so belongs in
d2_spec_test which can register one); blockeval value-behaviour guards
(`[block-param-nonblock]`, `[list-blocks-finalize]`, dunderin/scope) — mostly
existing DAML, add only the newly-formalized discriminators.

## Spec-keeper flags — RESOLVED 2026-07-07 (edits applied to D2-spec.md)

1. **`{process sender}`** — blessed. §13 refined: no command creates/modifies/
   forges a sender or exposes its dialect, but a process may read its own
   sender id (read-only, unforgeable) via `{process sender}`, dialect-gated
   like any command (a restricted dialect can withhold it). `__sender.id`
   dropped from §14 in favor of `{process sender}`.
2. **Anon-station naming** — keep the spec's `s1, s2, …` **source order**;
   the layout engine's rank scheme is a separate, non-canonical concern and is
   not mentioned in the spec. `[qname-structure]` clause reworded "source
   topology alone" → "source order alone".
3. **Malformed command** — a `fun`+`effect` (or neither) definition sploots on
   invocation (empty + soft error), like any runtime failure. No new verb; §5
   effect-partition updated.
4. **Procids dropped entirely.** Observable ids are qnames + content hashes;
   error ships name qnames. `ProcessId` domain, the "Process ids" paragraph,
   and `[procid-sequence]` removed; I16/§10/§12/§5 trimmed accordingly. Ship/
   dock **numbers** remain as scheduling metadata (not an identity).
5. **Sub-process attribution** — moot: dropping procids (#4) removes the id to
   attribute; the §14 "root-id + location uniquely names a sub-process"
   open question was deleted.
6. **`[queue-fifo]` → `[space-queue]`** (the space queue is number-ordered).
   Wires restated as **always-FIFO channels** (not merely a tiebreak);
   single-wire FIFO stays `[sched-wire-fifo]`.

## Notes
- Label every test with its assertion ID (test-spec traceability; see
  `extra/notes.md`). Most `[impl]` items are RED guides — failing tests
  that document intended behavior ahead of the port/space machinery.
- **Harness determinism (d2_spec_test).** `test()` fans out every `D.run`
  during registration and space variables persist globally across runs, so
  tests that mutate the same svar are order-dependent. The two `>$x.path`
  poke cases that surfaced this **moved to `det_test.mjs`** (each gets a
  fresh isolated space via `D.make_execution_space`). The general fragility
  remains for any future stateful d2 test; if the suite grows more of them,
  serialize the `D.run` calls or reset svar state between tests. New
  determinism-sensitive tests should go in the **deterministic harness**
  (`tests/det_harness.mjs`, design in `tests/DET_HARNESS.md`) instead.
- Depends on `TODO.md`: `{var read}/{var write}` needs impl item 1;
  everything under effectful port-routing / cross-boundary needs the
  port-async machinery (impl item 2 + backlog).
