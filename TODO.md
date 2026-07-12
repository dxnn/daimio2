# Daimio2 Implementation TODO

Work needed to bring the engine in line with D2-spec.md. Roughly priority-ordered.
Add items freely.

## Priority

1. ~~**Implement `{var read}` / `{var write}`**~~ **DONE 2026-07-08** — pure local
   dynamic-name pair in `var.js`, no effect block; mirrors `$foo`/`>$foo` exactly
   (`get_state` / `set_state` + passthrough). `[var-read]` `[var-write]` green.

2. **All effectful commands must be port-routed — no default `fun`.**
   - (a) **DONE 2026-07-08**: `fun`/`defaultValue` dropped from `time now` and
     `var read-out`/`write-out` (the interim `D.now` bridge went with it, per Q4).
   - (b) **DONE 2026-07-08**: `import_models` enforces exactly one of `fun`/`effect`
     (registration bork + method rejected). `[P-effectpartition]` in node_code.
   - (c) remains — the effectful dispatch path so `effect`/`portType` actually
     route a request through a port. This is item B below. Until it lands,
     `run_fun` sploots every effectful command to empty with a soft error
     (`[effectful-unwired-sploot]` green in d2_spec, space_test, det_time).

3. **Socket transition tests.** **DONE 2026-07-08** (as far as honestly possible):
   overlap test removed (dropped semantics, dead `loadSubspace` API); the
   state-lost property lives as `[socket-svars-reset]` in det_socket_test with
   replace / wiring-demand / reloadable guides (all RED on the subspace-routing
   block). **Drain/smash guides deferred by design** — they need a BUSY old
   content (down-port wait), i.e. round-trip routing (B) + virtual time; written
   as deferred notes in det_socket_test so they can't pass for the wrong reason.
   Tags `[socket-drain]` `[socket-smash]` land with those.

4. **Endpoint syntax standardized on `name@port` (spec §3) — DONE 2026-07-08.**
   Parser accepts `@` (normalized to the internal dot key); all tests, the
   spacetests.dm corpus, fixtures, and ASCII-parse emission migrated; one legacy
   dot-form test kept as coverage. Loose end: the legacy corpus still has a
   station named port literally called `out` ("Same but different"), which the
   spec reserves in @-position — rename it when the reserved-dir bork lands.

## Major engine work (detailed)

These are the two big unlocks; almost every RED guide in the determinism suite
is waiting on one of them. Each lists what to build, where, and which tests go
green when it lands.

### 0. Subspace parsing — DONE 2026-07-08 (nested blocks + name@port)

`seedlikes_from_string` now parses an indented named block whose body contains
space structure (`@`/`$` decls or wires) into a child spaceseed registered in
the parent's `subspaces`, recursively (deeper nesting works). A block whose
deeper lines are only DAML stays a multiline station. `[spacesyn-subspace-nested]`
(provisional tag — the SPEC still says two-level Astroglot with sibling-defined
subspaces; the grammar section needs a patch to bless nesting, pending user
review). `name@port` endpoints work (priority item 4). Remaining gaps that keep
the subspace guides RED: `[port-implicit-create]` (ports used in wiring but not
declared are NOT minted yet — several guides' inner blocks declare no ports),
`((label))` black-hole parsing, and routing (B). The `<->` RHS/LHS port forms
are still broken (parser-hardening item below).

### A. Priority-loop scheduler with ship numbers (spec §5)
### CORE DONE 2026-07-08 — refinements remain

Landed: ships carry a scheduler `number` as carrier metadata (with `sender`,
never payload — `[sched-ship-vtime]` stayed green) through
`enter`/`exit`/queue/process; dock assigns `max(space.counter, ship#) + 1`,
raises the counter and the runtime root's frontier (`[sched-dock-max]`);
unnumbered external entries take the root frontier; sub-processes share the
requester's number (flat). All deferred ship deliveries go through
`D.schedule_delivery` — a binary heap keyed `(number, global seq)`; each
`D.setImmediate` tick (still counted by the det harness's settle) pops the
LOWEST pending item (`[sched-dock-lowest]`, per-wire FIFO via seq). The dock
hook exposes `number`; `send_value_to_js_port` accepts one and the harness
passes `arrive()`'s through. Perf within limits (ship_routing ratio 0.88 vs
limit 18).

Remaining refinements:
- **Numbering-at-actual-dock under waits.** A ship arriving at a WAITING
  space gets its number at `dock()` entry today, though its process starts
  later from `space.queue` — revisit with `[sched-reentry-uniform]`.
- **Entry stamping at the boundary.** Frontier numbering happens in `dock()`
  (entry-time ≈ dock-time for now); exact entry-point stamping lands with
  `[sched-entry-frontier]`'s true interleaving guide.
- **Wire declaration order as the mid key component** (`[sched-tie-wire]`) —
  seq gives FIFO but not declaration-order ties; add when its guide lands.
- **`port_standard_sync` deliveries** (cmd requests to world ports) are
  number-neutral plain deferrals; key them when `[sched-reentry-uniform]`
  lands.
- The deferred guides `[sched-advance]` `[sched-wire-fifo]`
  `[sched-entry-frontier]` `[sched-reentry-uniform]` need harness machinery
  (true frontier interleaving) per det_test's deferred-notes section.
- Qname half of the dock hook: item E.

### B. Round-trip routing — effectful `cmd:` ports (spec §6/§7)
### DONE 2026-07-12 (signal flip via port occupancy) — timeouts remain

Landed: `run_fun` → `run_effect` in `m_command.js`. Wiring rules compile to
index-resolved entries in the seed (`make_spaceseeds`; duplicate patterns bork
`[wiring-no-duplicate]`; `spaceseed_add`'s canonical sort remaps rule indices).
At invocation: glob match against the invoking station's own space
(most-specific wins `[wiring-most-specific]`); a miss surfaces the request at
the space's boundary and matches the parent's rules with the subspace as
holder; `holder@cmd:glob <-> @cmd` surfaces it one level further
(`[cmd-forward]`); a miss or root-forward sploots
(`[effectful-unwired-sploot]`). Request = keyed `{handler, method, …args}`
(`[effcmd-request-val]`). Station targets: same-space runs as a direct
sub-process (requester holds the space); ancestor-space targets go through the
ancestor's serial `execute` (queue if busy). Port targets ride `port sync` to
the world (`[demandport-wire]`, det-world). One response resumes; extras ghost
(`[P-singleresponse]` `[cmd-transient]`). Pipeline vars + sender survive the
wait. GREEN: det_time demandport-wire; det_world roundtrip-response +
P-singleresponse; det_sender sender-propagate-downport; space_test
wiring-target-station/-forward, cmd-forward, cmd-transient,
singleresponse-one, wiring-default-timeout, effectful-unwired-sploot-subspace.

Signal flip landed 2026-07-12 (design/roundtrip-signalflip-draft.md v2 —
ports hold state, wires carry ships, no ship-carried contracts):
- Two mundane bugs were most of the gap: the FAF parser dropped the hop
  after a mid-chain port, and the `down` flavour's dead `exit` stub
  swallowed every pair crossing. Fixed; double-FAF down chains and
  `S@down <-> T@up` contracts ride end to end on plain wires.
- **Port occupancy**: a spaced round-trip pair keeps FREE/OCCUPIED on its
  inside half. Requests occupy from the requester's side and queue at the
  port while occupied [port-one-at-a-time]; first ship at the other side
  while occupied IS the response (ordinal, provenance-blind); while free
  it ghosts with a soft error [upport-ghost-after-first] (det_test
  dock-count guides). World-paired halves exempt.
- Rule targets on paired space ports enter with the transient cmd port's
  respond callback as the occupancy return address
  (`[wiring-target-upport]`, sibling-serves — GREEN). Rules also register
  referenced sibling seedlikes like wires do.
- GREEN now: signal-flip-up/-down, down-port-declared, roundtrip-response,
  upport-inside-station, async-preserve-sender, chained/FAF up-port set
  (four of those had been red only from mis-indented test strings).

Remaining:
- **Timeouts.** No default 10s / rule-timeout enforcement yet — a target
  that never responds leaves the port occupied and any waiter waiting
  (liveness hole). Virtual-time backlog; decided semantics: the timeout
  acts on the PORT (emits the empty response onward, frees); stale-ship
  residual window accepted as anonymous flow (no number-floor hardening).
- **`[demandport-create]` bork** (declaring a `cmd:` port) — still RED, small
  parser check, batched with the black-hole compile borks.

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
  `cmd:time:now` (part of B); the Outside then provides the time via a scheduled
  `cmd:time:now` response. **Also remove the `D.now` bridge** — it was added only
  as an interim so `{time now}` is deterministic under test, and is flagged as
  undesirable: remove it as soon as `{time now}` routes correctly. Turns green:
  `det_time` `[demandport-wire]`; and the unwired `{time now}` sploot guides in
  d2/space go green (`[effectful-unwired-sploot]`).
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
  param exists today (`D.Space(seed_id, parent, prng_seed)` has no depth slot);
  **proposed API:** extend to `D.Space(seed_id, parent, prng_seed, depth_bound)`
  (or a per-instance options object) so a test can set a low bound (e.g. 3) and
  assert the sploot fires at exactly that depth. Turns green: the deferred depth
  guides (`[depth-bound-instance]`, `[depth-nesting-only]`).
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
