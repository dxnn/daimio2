# Daimio2 Test TODO

Tests to upgrade and write for the spec changes made this session:
websock rename + unquote gate, black holes, socket-load rewrite,
sender/qualified-names + I16, block-evaluating commands, recursion-depth
bound. Layout/`space_ascii` is a separate stream — not covered here.

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
  `[qname-anon-station]`; qnames derive from topology `[qname-structure]`.
- Determinism: same space + same inputs twice → error ships and exiting
  sender ids are byte-identical `[id-deterministic][procid-sequence]`;
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

---

## Parser / Astroglot

- **Malformed `<->` must error, not silently misparse** (reviewer-reported) —
  `seedlikes_from_string` mints a bogus port from any LHS token and treats the
  RHS as a station, so a backwards `A <-> @down:svc` "passes" on orphan shapes.
  Test: station-on-LHS (and other non-`port <-> station` shapes) errors/borks
  per the §3 contract signal-type rule; a valid `@up:svc <-> A` still round-trips;
  a port-on-RHS contract (`S@down <-> T@up`) parses to the right two routes. [now]

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

## Notes
- Label every test with its assertion ID (test-spec traceability; see
  `extra/notes.md`). Most `[impl]` items are RED guides — failing tests
  that document intended behavior ahead of the port/space machinery.
- Depends on `TODO.md`: `{var read}/{var write}` needs impl item 1;
  everything under effectful port-routing / cross-boundary needs the
  port-async machinery (impl item 2 + backlog).
