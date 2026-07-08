# Daimio2 Implementation TODO

Work needed to bring the engine in line with D2-spec.md. Roughly priority-ordered.
Add items freely.

## Priority

1. **Implement `{var read}` / `{var write}`** — pure, local, dynamic-name svar access.
   - `{var read name :foo}` reads the current space's `$foo` by a *computed* name
     (the counterpart to the literal-name `$foo` syntax); `{var write name :foo value V}`
     writes it (counterpart to `>$foo`). `{var read name _n}` reads whatever `_n` names.
   - The behavior already exists in `daimio/commands/builtin/var.js`: `read-out`/`write-out`
     call `process.space.get_state`/`set_state`. Extract a clean `read`/`write` pair with
     **no `effect` block** (these are local, not port-routed).
   - Spec: §6 "Example: cross-boundary state access", tags `[var-read]` `[var-write]`.

2. **All effectful commands must be port-routed — no default `fun`.**
   - Spec already requires this (no spec change): a command has *exactly one* of `fun` or
     `effect` (§1 P-effectpartition); "Effectful commands have no fun" (§4); unwired
     effectful → sploot, not a fallback (§7 `[effectful-unwired-sploot]`, "No effects
     without wiring").
   - Current violation: `var read-out`/`var write-out` carry BOTH `effect` and `fun`, and
     `m_command.js` ignores `effect` entirely (`execute` → `run_fun` always calls `fun`), so
     they run as pure *local* reads/writes instead of cross-boundary port round-trips.
   - Work: (a) drop `fun`/`defaultValue` from effectful command defs; (b) enforce the
     registration-time check (exactly one of `fun`/`effect`); (c) implement the effectful
     dispatch path so `effect`/`portType` actually route a request through a port.

3. **Socket transition tests.** Update `space_test.mjs:1217-1276` (`socket overlap: old
   space state lost`) to the new model — its `[socket-overlap-state-lost]` tag, comment, and
   label reference the dropped overlap semantics; the assertion (state lost on transition)
   still holds. Then add dedicated tests for **drain** (in-flight completes, new arrivals
   buffer then deliver) and **smash** (old svars + non-exited ships destroyed; a waiting
   down-port response returns to a ghost). Tags `[socket-drain]` `[socket-smash]`.

## Major engine work (detailed)

These are the two big unlocks; almost every RED guide in the determinism suite
is waiting on one of them. Each lists what to build, where, and which tests go
green when it lands.

### 0. Subspace parsing (foundational — discovered 2026-07-08)

`make_some_space` / `seedlikes_from_string` **does not create subspaces**: an
indented block with its own content compiles to a *station*, not a subspace
(confirmed — the space_test `wiring-target-station` seed and a bare
`inner { … }` both yield `subspaces: 0, stations: N`; a `((relay))` block
likewise). So the compiled seed has no subspace structure, no subspace ports,
and no internal wiring — which is why every subspace-based space_test is RED and
why the socket-load / black-hole / cmd-forwarding / up-port behavior guides
cannot even be *set up*. This is the prerequisite beneath routing (B) and every
subspace feature. Build: parse an indented named block (and the `((label))`
form) into a child spaceseed in `subspaces`, with its own ports/stations/routes/
state, referenceable by the parent as `name.in`/`name.out`/`name@port`. Turns
green (as a precondition): the entire subspace-based backlog.

### A. Priority-loop scheduler with ship numbers (spec §5 "Deterministic scheduling")

Today: dispatch is a FIFO queue advanced by `D.setImmediate` (`1_daimio.js`
`run_queue`, `port_standard_exit`, `port_standard_sync`). Ships have no number;
a dock assigns `process.pid` (a bare counter), not a scheduler number; the queue
inserts in arrival order despite the `by key`/`by number` comments already in
`ARRIVE`/`COMPLETE`.

Build:
- **Ship numbers.** Every ship carries a `number` (virtual time) as carrier
  metadata (alongside `sender`), never payload. Add it to the ship-passing path
  (`port.enter`/`exit`, `outside_exit`, the queue item, the process).
- **Frontier numbering of external entries.** A ship entering from outside a
  runtime boundary — outermost in-port arrival, black-hole emission, App
  down-port response, timeout firing — is numbered at that boundary's frontier
  (highest number processed in its subtree). The harness already passes
  `arrive(port, value, {number})`; honor it (today it's ignored). `[sched-entry-frontier]`.
- **Dock numbering.** On dock, `process.number = max(space.counter, ship.number) + 1`
  and raise `space.counter` to it; every emission of the process (and its
  sub-processes — flat numbering, they share the root's number) carries it.
  `[sched-dock-max]`.
- **Queue ordered by key**, not arrival. Key = `(number, carrying-wire
  declaration order, wire-FIFO position)`; dock pops the min. Wires stay FIFO
  channels (per-wire order is the finest key component — always FIFO, not just
  on ties). `[space-queue]` `[sched-dock-lowest]` `[sched-tie-wire]` `[sched-wire-fifo]`.
- **Advance rule.** No ship docks at number k while a lower-numbered ship can
  still reach the space (conservative-PDES lookahead; the station-in-every-cycle
  bork guarantees progress). `[sched-advance]`. A down-port response re-docks by
  the same max rule. `[sched-reentry-uniform]`.
- **Replace the `setImmediate` deferral** sites with the priority loop that
  dequeues by key. **Perf-sensitive** — keep `perf_test` (mandelbrot ship loops)
  green; establish baselines first (see TEST_TODO Performance).
- **Expose `number` (and qname) on the dock hook** `D.Etc.on_dock` info object —
  det guides read `dockNumbers`/`dockTargets`.

Turns green (all currently RED guides): `det_test` `[sched-dock-lowest]`,
`[sched-dock-max]`; and unblocks `[sched-advance]`, `[sched-entry-frontier]`,
`[sched-reentry-uniform]`, `[sched-wire-fifo]`. Depends on: runtime qnames (E)
for the qname half.

### B. Round-trip routing — effectful `cmd:` ports (spec §6/§7)

Today: fully unimplemented. Probe (2026-07-08): a `<->`-wired cmd request
reaches neither a handler nor a world flavour (`world_reqs = []`); it sploots to
empty with a caught internal host-error. `m_command.js` ignores `effect` and
always runs `fun`. This is also priority item 2(c) above.

Build:
- **Demand-create cmd ports.** Invoking an effectful command `{handler method …}`
  creates a *transient* `cmd:handler:method` port per invocation, destroyed on
  response/timeout; never cached. Declaring a `cmd:` port already borks
  (`[demandport-create]`). `[cmd-transient]` `[cmd-name-encode]`.
- **Wiring-rule matching** against the **parent** space's rules: glob-match
  `cmd:handler:method`; most-specific wins (literal beats `*`, left-to-right,
  not declaration order); duplicate patterns bork; `cmd:*:*` catch-all; no match
  → sploot empty. `[demandport-wire]` `[wiring-most-specific]` `[wiring-no-duplicate]`
  `[wiring-other-fallback]` `[effectful-unwired-sploot]`.
- **Request/response.** Request ship value = keyed list `{handler, method, …args}`
  (`[effcmd-request-val]`); routes to the target (same-space station /
  sibling up-port / parent boundary / the world); the process WAITs holding its
  space; exactly one response resumes it (`[P-singleresponse]`); extra/late
  responses ghost (`[timeout-ghost-drop]`, `[upport-ghost-after-first]`);
  pipeline vars + sender survive the wait (`[async-preserve-vars]`,
  `[async-preserve-sender]`).
- **Forwarding** `S@cmd:*:* <-> @cmd`: parent mints a matching cmd port on
  itself, triggering the grandparent's rules. `[cmd-forward]`.
- **Wiring-rule targets**: station / sibling up-port / parent-boundary down-port
  (forward) / null (sploot). `[wiring-target-station|-upport|-forward|-null]`.
- **Remove the `fun` fallbacks** from effectful commands (`time now`,
  `var read-out`/`write-out`) so they route (ties to priority item 2).

Turns green: `det_world` `[roundtrip-response]`, `[P-singleresponse]`; `det_time`
`[demandport-wire]` (cmd:time:now); `det_sender` `[sender-propagate-downport]`;
the `space_test` wiring-target-* / cmd-* / singleresponse-one / down-port set;
and (with the scheduler) `[sched-reentry-uniform]`. Prerequisite for virtual-time
timeout guides (so a timeout's empty resume is distinguishable from an unrouted
sploot — see TEST_TODO / det_time_test).

## Backlog / dependencies

- **Virtual time (timeouts as schedule events)** — depends on A + B. Drive
  timeouts off the virtual clock, not wall-clock `setTimeout`
  (`commands/builtin/process.js` sleep; the down-port default-10s timeout). A
  timeout is an external event: a clock ship numbered at its frontier, entered
  into the input schedule (`[sched-timeout-event]`). A request whose timeout
  fires resumes EMPTY and marks the request completed; a later response ghosts
  (`[timeout-resume-empty]`, `[timeout-ghost-drop]`). Effective timeout = min
  along the chain, outer wire authoritative (`[timeout-min-chain]`, I12,
  `[timeout-inherit]`). A request cycle resolves by timeout to empty
  (`[request-cycle-timeout]`). The clock override (`D.now` + the det `now`
  option) is the foundation; the harness already accepts `timeout()`/`respond()`.
- **Sender attachment at entry + registry** — on `port.enter()` from outside, a
  senderless ship takes the entry port's **qname** as sender + the space's base
  dialect (`[sender-attach-entry]`); a `D.register_sender(qname, sender)` registry
  consulted at entry attaches a registered (attenuated) sender instead
  (`[sender-attach-registry]`); never override an existing sender (already green).
  Depends on E (qnames). Turns green: `det_sender` `[sender-attach-entry]`.
- **E. Runtime qualified names** — compute topology-derived qnames (space path /
  station name / port endpoint); anonymous inline stations named `s1, s2, …` in
  **source order** (§10, decided 2026-07-07 — NOT the layout engine's rank
  scheme). Expose qname on the dock hook and in error-ship strings. Turns green:
  `det_test` `[qname-structure]`, `[qname-anon-station]`.
- **`time now` purely effectful** — drop its `fun` fallback so it routes through
  `cmd:time:now` (part of B). Turns green: `det_time` `[demandport-wire]`.
- **Black holes** (spec §3/§8) — parse `((label))` → spaceseed `blackhole` flag;
  ports mirror the outer space (in/out only; flavour opposes direction; bare port
  = generic opposing flavour); no interior (empty stations/state/subspaces, no
  queue/processes); world-I/O crossing (in-port emits FAF to the world; out-port
  world value → ship into the parent, numbered at the frontier + sender-attached);
  borks (station/state/wire inside, up/down port, root, socket-load port, `(( ))`
  endpoint ref). Compile borks are RED-guided in `space_test`; crossing-behavior
  guides in `det_blackhole_test`. Turns green: those guides.
- **Socket-load** (spec §8) — the `socket-load` port flavour; incoming Astroglot
  replaces a subspace's internal content (top-level label discarded, parent name
  + wiring kept); wiring re-applies on demand to the new content; reloadable iff
  the loaded content re-declares a socket-load port; **drain** (default: finish
  the active process + queue in key order, buffer new arrivals with numbers
  unchanged, then swap) vs **smash** (destroy old svars + non-exited ships; a
  waiting down-port response → ghost); a socket-load port on the root borks;
  loading a black hole borks; svars never survive a transition. Turns green:
  `det_socket_test` guides + `space_test` `[socket-load-not-root]`.
- **Recursion depth-bound knob** — a creation-time bound (default 100, per outer
  space; §5/§11); enforce at the block-eval demand (`apply`) — a nesting beyond
  the bound sploots the innermost eval to empty (value-producing). No creation
  param exists today (`D.Space(seed_id, parent, prng_seed)` has no depth slot).
  Turns green: the deferred depth guides (`[depth-bound-instance]`,
  `[depth-nesting-only]`).
- **Cross-boundary `var read-out`/`var write-out`** — once B routes, these reach
  the **parent's** state, not the caller's (today's `fun` reads the caller's own
  space). `[socket-crossboundary-var]`.
- **Seedlike `<->` parser hardening** (reviewer-reported) — `seedlikes_from_string`
  (1_daimio.js:3234) assumes `port <-> station`: it mints a port from *any* LHS token (with a
  garbage direction) and always appends `.in`/`.out` to the RHS as if it were a station. So
  station-first `A <-> @down:svc` silently mints a bogus port `A` + malformed routes (no error),
  and port-on-RHS contracts (`S@down <-> T@up`, per §6) also misparse. A **subspace-qualified
  LHS** (`worker.down:svc <-> proc`, per §6) hits the same path: it mints a bogus port named
  `worker.down:svc` with direction `worker.down` — confirmed 2026-07-07 while adding subspace
  down ports to the layout engine (had to wire fixtures with FAF `->` instead). Fix: reject a
  `<->` whose LHS isn't a valid Enter-N-Exit port, and handle RHS ports — enforce the §3 contract
  signal-type bork instead of failing silently. Fail loud, not silent.
- **Inline block on `<->` RHS is silently dropped** (found 2026-07-07) — the `<->` branch of
  `seedlikes_from_string` (1_daimio.js:3234) pushes routes referencing `{…}.in`/`.out` but,
  unlike the FAF `->` branch (line ~3259), never registers the anonymous `{…}` as a station. So
  `@up:svc <-> {__ | add 1}` produces routes to a station that doesn't exist; `resolve_endpoint`
  returns null, the connection is skipped, and the contract vanishes with no error (the port
  renders as an unwired standalone). Fix: mint a `station-<n>` for a `{…}` RHS (and LHS) in the
  `<->` branch, mirroring the FAF branch. Fail loud or, better, just handle it.

## Space layout: vertical-to-vertical port contracts

- **A contract between two round-trip ports mis-routes to a side + orphans a glyph**
  (found 2026-07-07, `site/js/space_layout.js`). When a connection joins a wall vertical
  port and a subspace down port — e.g. `@down <-> inner.down`, which should desugar to
  `down -> inner.down` / `inner.down -> down` once the `<->` parser bug above is fixed —
  the layout renders it wrong: outer's `@down` attaches to **inner's left/right `o` (in/out)
  sides** and inner's `down` `^v` glyph is stamped but left **orphaned** (no wire, yet its
  band slots still add row height). Two causes in the connection classifier:
  1. The vertical-port diversion (`vport_by_pid[fid] || vport_by_pid[tid]`) is checked
     *before* the subspace-down check, so the connection is handled as `@down`'s leg and the
     far end attaches at the subspace's side (`vp_in_x`), never at its bottom-edge `^v`.
  2. `sub_down_info` *also* fires on the same connection and places the `^v` glyph + band
     slots, but `route_subdown_chain` never runs for it (it went to `vport_conns`), so the
     glyph is orphaned. (Confirmed: invariants pass — they check paths, not glyphs — but the
     corrected-route render fails round-trip, parsing back as `@down -> inner.in` /
     `inner.out -> @down`.)
  Fix needs a genuine **vertical-to-vertical route**: both endpoints attach at their own
  `^v` (outer's floor pair and inner's bottom-edge pair), neither on a side wall — a routing
  case that doesn't exist yet. Also make the two detectors mutually exclusive (or cooperate)
  so no orphaned glyph is placed. Loose end: `sub_down_info`'s `/^down/` test also matches a
  malformed `down.in`/`down.out` port (the parser bug above), which is how the original
  report produced *two* `^v` pairs on inner — moot once the parser is fixed, but worth
  tightening to an exact `down`/`down:*` match.
