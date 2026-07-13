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

### C. Space label sigils + lexical scope + socket port-likes — DONE 2026-07-12 (eve)

Landed (commit 0202f2a): sigil labels, structural borks, two-layer
lexical scope with local shadowing (unique '::' keys; the collision
merge is gone), black-hole compile borks + opposing default flavours,
socket port-likes + D.socket_load (replace works end to end — the four
det_socket guides are green; drain==smash until busy-content tracking).
The last-property-never-flushes parser bug died en route. Remaining in
this area: honest [socket-drain]/[socket-smash] distinction (needs
busy content = down-port waits mid-load), and the ASCII layout/parse
emission still renders old forms (fixtures non-normative per dann;
emission migration is its own pass). Original build plan follows:
- Label sigils: `*name` black hole at top level or nested (blackhole
  flag on the seedlike → make_spaceseeds); `+name` / `!name` nested
  only; `+`/`!` at column 0 bork; a BARE nested block whose body has
  space structure borks [spacesyn-sigil-required] (replaces today's
  silent structural inference).
- Two-layer lexical scope: per-space name resolution (own sigil-defined
  children, else earlier top-level), shadowing local to the defining
  space, collision = shadow never merge [spacesyn-scope-two-layer]
  [spacesyn-shadow-local]. Kills the current file-scope leak + merge.
- Sockets: `!name` mints the two implicit port-likes
  (name@socket-load / name@socket-load-smash) [socket-portlike-*];
  socket-load flavour no longer exists; runtime loads sploot
  [socket-load-sploot]; parse the endpoint form (reserved names in
  @-position). Reframe det_socket guides from content-declared ports
  to frame port-likes.
- Migration in the same commits: nested-form tests gain `+`; blackhole
  guides already use `*` (red); ASCII layout/parse + fixtures follow
  LATER (non-normative per dann; emission format decision pending).
- RED guides waiting: the two [spacesyn-sigil-required] parse guides,
  [blackhole-*] set, [socket-portlike-implicit], [socket-load-not-root],
  [blackhole-ref-bare] (all in space_test).

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
### CORE DONE 2026-07-08 — refinements DONE 2026-07-13

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

Refinements — LANDED 2026-07-13 (16f7da5, 866f30c, b1d892d):
- **Numbering-at-actual-dock under waits** — dock numbering (and the dock
  hook) moved from arrival to process start; queued-behind-wait ships
  re-number past the wait; the space queue pops lowest-number first
  [space-queue]. Ship entry numbers still stamp at arrival (entry-time
  frontier [sched-entry-frontier]).
- **Re-entry renumbering** [sched-reentry-uniform] — a port-crossing
  response (or timeout empty) renumbers its held process
  max(counter, resp#)+1; world/App/timeout responses enter at the
  frontier. Station-target rule responses stay flat.
- **Wire declaration order** [sched-tie-wire] — heap key is now
  (number, wire ordinal, seq); no-wire deliveries sort last. This exposed
  and fixed block sub-processes dropping their root's number
  (datatypes/block.js — the [sched-ship-vtime] hole).
- Guides landed: [sched-advance] [sched-wire-fifo] [sched-entry-frontier]
  [sched-reentry-uniform] [sched-tie-wire] [request-cycle-timeout] + two
  replay guards. Note: `port_standard_sync` world deferrals stay outside
  the heap — the request LEAVES the runtime; its response re-enters at the
  frontier, which is the part that orders. Open: [id-deterministic]
  (error ships don't name qnames yet, §12 follow-up).

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

- **Effectful commands: full spec + coverage sweep (dann, 2026-07-12 eve).**
  The stdlib has exactly three effectful commands today — `time now`
  (cmd:time:now), `var read-out` (cmd:var:read-out), `var write-out`
  (cmd:var:write-out) — and the fuzzer surfaces their unwired-sploot
  errors constantly, so their semantics must be FULLY SPEC'D, each:
  request value shape ([effcmd-request-val] covers the general keyed
  form; per-command field lists are not written), response semantics
  and coercion (what does cmd:var:read-out return for an unbound
  parent var?), timeout interaction, sender/dialect gating, and the
  §10-style canonical examples (they cannot have `examples:` today —
  example_test runs in an unwired space and they'd sploot; the
  example harness needs a wired fixture space, or the spec needs
  prose examples). Cross-boundary `var read-out`/`write-out`
  reaching the PARENT's state (not the caller's) is spec'd (§6
  worked example) but untested end-to-end
  ([socket-crossboundary-var] below). Any future effectful command
  (network, storage, process sleep) follows the same template.
  Fuzzer note: the unwired sploots are expected [effectful-unwired-
  sploot] and the fuzzer allowlist now recognizes them (plus ghost/
  timeout/socket-sploot messages) — 0 crashes at 3300 exprs.

- **Virtual time — CORE DONE 2026-07-12 (eve).** D.register_timeout /
  D.advance_clock; cmd requests get rule-or-default deadlines
  ([timeout-resume-empty], [timeout-ghost-drop] green); occupied
  round-trip ports emit empty + free at their deadline (era-guarded);
  production uses unref'd wall timers, the det harness drives a
  mutable virtual clock (timeout events; respond_now; settle treats a
  timeout-pending wait as quiescent). [timeout-inherit] +
  [timeout-min-chain] LANDED 2026-07-13 (bc9e4d7): a cmd request's
  deadline is the min of the explicit timeouts along its walked rule
  chain; contract chains had min-chain naturally (per-hop occupancy
  deadlines + empty propagation — guarded by a det_time test).
  Remaining: [request-cycle-timeout] guide (needs queue-behind-wait
  numbering).
- **`process sleep` — RESOLVED 2026-07-13 (dann: reclassify effectful).**
  Sleep declares effect cmd:process:sleep; the new `clock` port flavour
  is the canonical world handler (answers `then` at now+`for` via
  D.register_timeout — wall timers in production, det harness drives the
  virtual clock). Spec §6 [effcmd-process-sleep] + §4 flavour list;
  demos/spaceeditor wire pacer@cmd:process:sleep <-> @clock; fuzzer
  un-excludes sleep/wait. Commits eab2bf9, de671a5, 694e577.
- **Sender attachment at entry + registry — DONE 2026-07-12 (eve).**
  Senderless world entries take the entry port's qname (D.port_qname)
  with the space base dialect; D.register_sender(qname, sender) wins;
  never overrides. det_sender 8/8.
- **E. Runtime qualified names — DONE 2026-07-12** (seeds carry
  source-order station/subspace names; dock hook exposes qnames; anons
  s1, s2 in source order; PRNG derives per-space from them). Error-ship
  strings don't name qnames yet (§12 follow-up).
- **Space serialization (§8) — DONE 2026-07-12 late.** Sources were
  already retained as OriginalString block decorators (the earlier
  "needs seed-format source retention" premise was wrong); serialize
  emits definition + current svars, declared dialect kept, subspaces
  recursively sigiled, round-trip verified. Follow-up: rules/routes
  emission is index-reconstructed — fidelity beyond the round-trip
  test unaudited.
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
