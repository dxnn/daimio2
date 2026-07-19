# Daimio2

Daimio is a language for making programmable web applications where users can extend
applications in non-trivial ways. It provides a safe, sandboxed execution environment
with a total (crash-free) execution model.

## Tools

```bash
node tests/run_all.mjs                       # run all 9 test suites
node bin/repl.mjs                            # interactive REPL  (alias: depl)
node bin/repl.mjs -e "{...}"                 # evaluate expression  (alias: daml)
node bin/repl.mjs -f file.dm                 # run a .dm file
node bin/fuzzer.mjs                          # fuzz 1000 expressions, random seed
node bin/fuzzer.mjs 5000 myseed 200 100      # count seed concurrency timeout_ms
bin/highlight-conn.mjs <layout> <render> <id> # visualize a connection path
```

## Local server

HTML files are always available at `http://localhost:8080/new/daimio2/` — no need to
launch a separate server. E.g. `http://localhost:8080/new/daimio2/site/demos/spaceeditor.html`.

## Test-driven development

Always write a failing test first, before changing code, unless you can prove that a
failing test already exists for the behavior being changed. Red test first, then green.

Tests should be labelled with the spec assertion, property, or invariant they test for,
whenever possible (usually an assertion ID). See the "Test-spec traceability" section
below for the labelling format.

All test suites must pass before any change is considered complete.


## Language overview

DAML (Daimio Markup Language) is a templating language. Literal text passes through
unchanged; commands in curly braces are evaluated and interpolated.

```
{3 | math add value 2}                          — 5
{(1 2 3) | list map block "{__ | math add value 1}"}  — [2, 3, 4]
{$user.name | string uppercase}                  — path + command
{:hello | >@output}                              — send to port
{>$count || >@notify ||}                         — side effects, no output
```

Key syntax elements:
- `{...}` — command invocation
- `|` — pipe (flows implicit value to next segment's first unfilled param)
- `||` — barrier pipe (blocks implicit value, pipeline vars still cross)
- `__` — explicit reference to implicit pipe value
- `__in` — input to current pipeline/block (fixed for whole execution)
- `_foo` / `>foo` — read/write pipeline variable (scoped to pipeline)
- `$foo` / `>$foo` — read/write space variable (persists across pipelines)
- `>@name` — send to named space port
- `"{...}"` — block (quoted pipeline as a value)
- `(:a :b :c)` — list literal
- `:foo` — name literal (produces string "foo")
- `{begin name}...{end name}` — named block (pipe goes on `{begin}`, not `{end}`:
  `{begin foo | >$foo ||}{body}{end foo}`)

## Architecture

### Core concepts

- **Values**: numbers, strings, lists (universal collection with ordered + keyed access).
  The empty value coerces by context: `""`, `0`, or `[]`.
- **Ships**: values in transit between ports. Just data.
- **Blocks**: compiled DAML templates (segments + wiring). Stations have blocks; blocks can be passed as values.
- **Processes**: the unit of execution. Created when a ship docks at a station; sub-processes created for block evaluation (synchronous, depth-first).
- **Spaces**: topology containers with stations, subspaces, ports, and wiring rules. One ship at a time per space.
- **Ports**: typed connection points (In, Out, Down/request, Up/response).
- **Dialect**: determines available commands and aliases per Daimio instance.

### Execution model

- Pure commands are synchronous and total (always return a value).
- Effectful commands create async boundaries via down ports (request/response).
- `NaN` return from a command signals async (took callback route).
- Serial execution per space — one ship at a time, process holds space exclusively.
- Space variable reads are always fresh (trivially, under serial execution).
- Pipeline vars survive async boundaries within the same process.
- Soft errors: `D.Etc.active_space` set in `Process.run`, `on_error` routes via `port.enter()`.
  `D.on_error` is a silent no-op when no `@err` port. Stations have only `_in`/`_out` (no `_error`).
- Every down-port request has a timeout (default 10s). Liveness guaranteed.
- Runtime code eval: only `process unquote` + `process run` (exec port removed).

### Ports

- `space.ports` holds INSIDE ports; OUTSIDE is at `port.pair`.
- Down ports use `sync` (not `exit`): `port_standard_sync` → `pair.outside_exit(ship, callback)`.
- Command portType naming: `cmd:handler:method` (e.g., `cmd:time:now`, `cmd:var:read-out`).
- Round-trip occupancy (spaced up/down pairs, state on the inside half):
  requests occupy from the requester's side and queue at the port while
  occupied; the first ship at the other side while occupied IS the response
  (ordinal, provenance-blind — delivered onward or to a recorded respond
  callback for wiring-rule targets); while free it ghosts with a soft error.
  World-paired halves exempt. Timeout = port emits empty + frees (virtual-time
  backlog). Design: design/roundtrip-signalflip-draft.md.

### Sender / dialect

- `D.Sender(id, {dialect})` → `process.effective_dialect = intersect(sender, space)`.
- Sender propagates through: block eval, port pairs ({sender} carrier), outside_exit, error, queue.
- Subspaces inherit parent dialect (I2); only outer space uses `seed.dialect_instance`.
- Optimizers (`OPT_simple_math`, `OPT_simple_peek`) must check dialect before executing.

### Other internals

- Per-space PRNG: `D.Space(seed_id, parent, prng_seed)` → `space.rng` via seedrandom; subspaces share parent's rng.

### Scope inheritance (blocks)

Three-layer lookup when a block reads a pipeline variable:
1. Named keys from `process.state` (e.g., `_value`, `_key` injected by commands)
2. `process.pipeline_vars` (vars set by `>foo` in the pipeline)
3. Caller's scope (inherited from parent pipeline)

Vars bound inside a block do NOT propagate back to the parent.

## Naming conventions

```
D.import_commands   — snake_case for functions and constants
D.SegmentTypes      — CamelCase for built-in objects
D.SPACESEEDS        — ALLCAPS for runtime containers
```

## Key patterns

### Command definition

Commands are defined via `D.import_models()` with handler, method, params, and fun:

```js
D.import_models({
  handler: {
    methods: {
      method: {
        desc: 'What this method does',
        help: ['Detailed usage notes'],
        examples: [
          ['{handler method param 5}', 'expected output'],
        ],
        params: [{ key: 'value', type: 'number', required: true }],
        fun: function(value) { return result }
      }
    }
  }
})
```

Effectful commands declare an `effect` property instead of `fun`.

Examples are `[input, expected]` tuples tested by `example_test.mjs`. The test harness
auto-discovers all examples from `D.Commands` — no registration needed.

### Port inside/outside pairing

- `space.ports` holds INSIDE ports
- OUTSIDE is at `port.pair`
- Down ports use `sync` (not `exit`) for request/response with callback
- `port_standard_sync` delegates to `pair.outside_exit(ship, callback)`

### D.is_nice and falsy values

`D.is_nice(value)` returns `value || value == false` — this means `""` is "nice"
(because `"" == false` is true in JS). Be careful with empty string checks.

### Pay attention to aliases

The `poke` alias is `list poke value`, which fills the `value` param from the pipe.
This means `{$d | poke (:a :x) value 99}` puts `(:a :x)` into the value param, not the path param. (The 99 is skipped as a duplicate param.)
Instead do `{$d | poke 99 path (:a :x)}`.
Many aliases fill a parameter spot this same way, but not all, so pay attention.

See `extra/notes.md` for spec reference, test-spec traceability, current work status,
demo status, and optimization opportunities.

## Project structure

```
daimio/           — core engine (1_daimio.js, daimio.js, segtypes, commands, etc.)
site/             — browser-facing files
  css/            — stylesheets
  js/             — space_layout.js, space_ascii.js, space_svg.js, editor.js
  demos/          — demo apps
  editor/         — CodeMirror mode/hint, spaceeditor
  tests/          — browser test pages
  images/         — logo
tests/            — Node test suites + space_ascii fixtures (41 fixture dirs)
bin/              — CLI tools (repl, fuzzer, space-ascii, highlight-conn)
extra/            — notes, reports, commentary (not in git)
expired/          — old commands/demos for reference
```

## Space-ASCII layout engine

`site/js/space_layout.js` — full Sugiyama pipeline:
1. Extract topology from seedlike
2. Topo sort with cycle detection (DFS, back-edge identification)
3. Virtual port layers (left ports at layer 0, right ports at last layer)
4. Back-edge reversal (swap from/to, route as forward, flip path at end)
5. Dummy node insertion for forward multi-layer edges (reversed edges route
   via below-station h-channels and get no dummies)
6. Barycentric crossing minimization (with dummies and ports)
7. Chain straightening: dummy rows clamp into the band between the chain's
   endpoint rows (dummies may share a slot with same-source/same-dest
   dummies); emptied rows are compacted away
8. Hop-level fan grouping (final hop joins the dest's to-fan, other hops the
   source's from-fan — whichever group is larger wins; split by direction;
   reversed/self-loop drop legs count toward the source's down-fan)
9. Channel ordinals per gap, then ordinal-based approach-conflict detection
   (dep/arr x-ranges overlap iff dep channel ordinal >= arr ordinal)
10. Gap sizing (channels + arrival ladder columns) + channel x allocation
11. Band slot allocator: approach tracks, reversed-edge h-channels (merged
    by source per band — every cell of a shared channel carries only that
    source's flow, and each rise off it renders as a corner or turn arrow),
    and self-loop channels share per-band y slots, two rows apart
12. Reversed-edge and self-loop drop legs register as pseudo-hops under the
    source's down-fan key (shared trunk columns)
13. Contract returns to a left port rise one column off the wall and
    T-junction into the port's wire; right-port sources (down-port
    responses) mirror it, branching off the port's mouth and routing like
    a back-edge. When gap 0 carries channels alongside a port-return lane,
    a unit is reserved so the tracks clear the lane.
14. Post-processing: row/column collapsing

The layout is canonical: connections and cycle-breaking sort by component
NAME (source text for anonymous stations), and anonymous stations are named
s0, s1, ... by rank among anonymous sources (skipping names taken by
declared stations) — so declaration and route order never affect the
picture, and a parsed render reproduces it exactly.

Vertical (round-trip) ports render on the top/bottom borders, not the side
walls: up-flavour → top border, down-flavour → bottom, drawn as `x` when
unwired or `^v` when wired (^ = north-flowing wire's cell, v = south-flowing).
This keeps down-port responses off the right wall, where they used to collide
with out-ports. A wall pair is anchored over the gap left of its dest's layer;
legs that can't reach it directly drop at the source's down-fan trunk and
travel a top-band (up ports) or the floor band (down ports). A station's
down-port round trip attaches at a `^v` pair on its bottom edge and drops
straight to the floor pair when the corridor is clear. A subspace's `down:*`
port renders as `^v` on the box's bottom edge and routes through the band
below the subspace's row (request rises into ^, response drops from v); an
`up:*` port mirrors it on the top edge, routing through a band ABOVE the
row — which grows the row upward (the box shifts down within its row by
`above_h = 2·slots−2` to make room). `extract` maps up→top, down→bottom;
custom-named ports still infer left/right from connection usage.

Junction convention: O is a pure crossing. A wire turning at a cell where
wires pass through in both axes renders as the turn's arrow (v ^ > <) —
the wire merges into the crossing wire, one direction only.

Seven invariant checks (all fixtures passing):
- No wire through station body interior (a down-port leg may touch a box's
  own bottom border at its `^v` attach and run downward into the band; an
  up-port leg touches the top border and runs upward — neither enters the
  interior)
- No opposing-direction wires (unless shared endpoint, or at a port's
  mouth between two wires that both attach to that port — requests leave
  and returns T-junction in over the same 1-2 cells)
- No shared-wire false connectivity (unless shared endpoint)
- One empty space between parallel wires (no adjacent same-axis runs;
  exempt: the two opposite-flowing legs of a `^v` pair — a wall vertical
  port or a subspace down port — are adjacent by design)
- Wall clearance: no vline flush against a side wall, no hline flush under
  the top border (bottom border exempt — the underscore floor reads as space)
- Attach clearance: arriving wires turn >= 3 cells before a station's in.x
  (the paren eats one cell), >= 2 for subspaces; departures run >= 2 cells
  past out.x before turning; ports exempt
- Turn uniqueness: at most one turn direction per cell (cross-and-merge is
  one-directional), unless the turning wires share an endpoint — a fan's
  internal cells are interchangeable, so every reading is a true flow

Renderers: `space_ascii.js` (ASCII), `space_svg.js` (SVG). Both use same layout output.
Parser: `space_ascii_parse.js` (ASCII → source.dm). Uses wire tracing + render-guided refinement.

## ASCII parser (Astroglot round-trip)

`site/js/space_ascii_parse.js` — parses render.txt back to source.dm format.
Round-trip: `render.txt → parse_ascii() → source.dm → seedlikes_from_string → extract → layout → render`.

All fixtures round-trip exactly. The wire tracer is flow-aware at two
levels, both guaranteed faithful by the layout invariants:
- junction chars encode flow (v/^/>/<), so traversal never runs against
  a drawn junction; at through-cells the merge is one-directional
- plain - and | runs get their direction inferred from run evidence
  (arrows on the run, attachments and corner chars at its ends), so a
  trace can't ride a wire backwards after a legal merge turn (the two
  cells beside a left port stay unmarked for the contract T-junction)

Contract returns are recognized by their T-junction (a ^ on the port wire
fed from below). At a left port's mouth T (a ^ exactly two cells right of
the wall o) a rising return exits only toward the port — riding onward
along the port's outgoing wire would read the return as feeding the
port's fan. Vertical ports are read straight off the glyph: `x`/`^v` on
the top/bottom borders (up/down space ports), `^v` on a station's bottom
edge or a subspace box's top/bottom edge (up/down round trips). Each `^v` is two
opposite-flowing wires, and the tracer never hops between the paired
cells (they would read as one wire). Vertical-port legs emit as plain FAF
routes (`@down -> S`, `S -> @down`), which render identically to `<->`.
All stations are emitted as declarations — anonymous ones under
their rendered rank-name — since an inline {…} reference would mint a new
station per occurrence. Each block is refined independently against its
own render, with the other blocks' sources kept in scope (a subspace
reference only registers when the referenced space is defined). Refine
tries cycle rotations first (the traced start of a cycle is arbitrary but
decides the back-edge), then joins routes sharing an inline anonymous
endpoint, then best-improvement removal/addition, then swaps — this also
resolves the inherently ambiguous shapes (a v feeding a right port's
mouth is visually identical to a self-loop drop; refine discards the
reading whose render diverges). Custom port labels and flavours are not
rendered, so a parsed source uses canonical @in/@in:a/@out names —
renders are identical because labels never reach the picture.

## Open design decisions (as of 2026-07-19 — boundary-contracts session)

Design pass with dann, docs only (no engine code yet):
- **Space-reflection contract SETTLED (v1 direction, 2026-07-19)**: dann
  redirected — the render stack's input is the JSON REFLECTION of canonical
  Astroglot (no new decisions; §3/§8 own semantics). Names are identity, NO
  generated ids/names; anons are nameless, live inline in route chains,
  render unlabeled; dirs use Astroglot vocabulary (in/out/up/down — wall
  mapping is lib-internal); flavour kept; "Topology" name retired (dann to
  name; default "space"). W1–W5 superseded. Rewritten:
  design/topology-contract.md. TWO SPEC EDITS QUEUED (approved): §3
  station/subspace name-collision bork (today: silent shadowing, subspace
  wins, station orphaned — probe tmp/probe_name_collision.mjs); §8
  serialize inlines anons into wire chains (current s1-generation is buggy:
  no taken-name skip → name capture; anonymity destroyed on reparse) with
  anon-source-order preservation for qname stability. Round-trip suite
  equivalence = canonical-Astroglot compare, NOT byte parity. Impl (extract/
  layout/parse rework + anon-label fixture regen — regen needs dann's
  explicit go) queued behind the spec edits.
- **Hole-formation notification** (dann: solve NOW; metadata RULED IN
  2026-07-19): the App must learn a black hole is forming with enough info
  to bind it (Tauri shell currently re-parses Astroglot itself). Hook fired
  synchronously at D.Space construction of any blackhole seed (covers
  socket swaps — nested holes in loaded content are legal; only the loaded
  ROOT is barred), manifest {qname, name, ports:[{name,dir,flavour,
  settings}], meta}, symmetric teardown notification on smash/drain.
  Declared hole metadata (body-level JSON, currently dead space) is IN:
  qname-only binding is too fragile — wrapping a space in another space
  changes every qname, and wrapping is a common operation; metadata gives
  a wrap-stable binding key. This is gen1 space-types' "second use case"
  trigger, scoped to holes only. Flow: spec-keeper review → spec → red
  tests → implement. Review DONE (no contradictions; 4 scoping clauses —
  opacity observer-qualifier, notification trace position + source-order,
  hook-throw soft, hook-injection frontier). RULED: seed.meta field (hole
  body JSON = metadata, never dialect). Manifest (formation notification)
  awaiting dann's go after clarification.

## Implementation queue (after the spec modifications land)

- Bork on bad JSON in dialect_decl AND hole metadata (dann: compile-time
  issues are borks; spec already says dialect bad-JSON borks — engine
  silently swallows, 1_daimio.js:3841-3 empty catch).
- Fix the line-initial-`{` parser bug: the dialect branch eats a wire whose
  first endpoint is an inline anon (`{x} -> A` vanishes from the seedlike;
  grammar allows '{daml}' endpoints, D2-spec.md ~L718). Discriminator: a
  wire contains `->` — but guard against `->` inside JSON strings.
- §3 station/subspace name-collision bork (engine check + red guide).
- §8 anon inlining in serialize (drop s-name generation; preserve anon
  source order; fixture regen for anon labels — dann's explicit go first).
- Hole seed.meta: make_spaceseeds pass-through + serialize push (two
  one-liners) + manifest hook once the notification is approved and spec'd.
- Scoping chain walk (resolve_space → completion-based lexical chain,
  RULED: everywhere, one rule) + SOCKET BARRIER (a `!` definition's body
  resolves only within its own subtree — sockets take everything with
  them; NARROWING vs today: socket bodies referencing top-level defs will
  start borking — corpus check needed). Source-ref svars flatten on
  serialize (v1). State-decl value slot borks on invalid JSON. OPEN: the
  v1 reference syntax itself (strict JSON bars bare `$src worker_v2` —
  form TBD by dann).
- **Viz extraction**: PARKED (dann 2026-07-19), next to the 1_daimio.js
  split thread — see memory project_viz_extraction.md. Its prerequisite
  (the reflection contract above) is now settled.
- **Socket source into an svar** (reloadable sockets): {space source}
  command REJECTED by dann 2026-07-19 ("forces Astroglot concerns into the
  runtime"). New direction: an ASTROGLOT state-decl form initializing an
  svar with a referenced definition's canonical source — reference retained
  in the seed, re-resolved each compile ("if the space changes later, the
  svar picks up the new definition"). Requires a scoping rethink: current
  two-layer scope (own-nested + top-level, no siblings) is composition-
  fragile ("global = top level" isn't stable under wrapping). Proposed:
  completion-based lexical chain — see spec-keeper state. SUPERSEDED text
  below kept for the trail:
  (old) option B — `{space source :name}` pure command resolving same-file
  definitions (needs seeds to retain a lexical name→seed map; today only
  referenced
  subspaces survive into the compiled seed). Option A (parse-time capture)
  has copy/drift semantics. Awaiting ruling.
- **Blackhole active-flavour binding at instantiation**: spec'd
  ([blackhole-flavour-inside] creation case 4) but engine never calls
  outside_add on the inside face — inbound is App-driven
  send_value_to_js_port only. REVISIT marked in TEST_TODO.md (dann,
  2026-07-19); interacts with the notification design.

## Test status (as of 2026-07-16 — reviewer-findings sweep)

15/15 suites green, fuzzer clean. Two threads landed. First, the §10
reconciliation + #0 implementation (14e1d77/efac5a2): coercing-equality
bless (Empty is scalar `""` ≠ `[]`); two-case `[law-deleteget]` (Empty
for Key / `[]` for Star); `#0` sploots as a malformed selector
everywhere — read value-producing (empty), write pass-through
(unchanged) — implemented in positionfinder + delete_path +
OPT_simple_peek (all three; path-selector handling is duplicated across
5 sites — see memory [[path-selector-multisite]]).

Second, a fresh academic-reviewer pass on D2-spec.md → 15 findings
(verified 14 CONFIRMED / 1 PARTIAL / 0 FALSE; full list + dispositions
in `extra/spec-review-2026-07-15.md`), all resolved across 4 commits
(ad843d4/1833f67/7c10b57/c3c67c1):
- `[poke-key-unkeyed-fail]` FIXED to actually soft-error (engine skipped
  it silently; delete already emitted).
- §12 sploot catalog completeness: retired dangling
  `[sploot-passthru-poke]`; split poke/delete unkeyed-fail; added
  `[compile-unknown-alias]` (unknown alias — compile-time, pass-through)
  and `[cmd-no-method]` (handler/method not found — runtime, empty).
- Doc fixes: truthiness (`[]` falsy in its own right); P-total ghost
  caveat; §7.1 numbering; §14 title xrefs; PokeAsMap agreement; process
  record field `state`→`scope`; §6 timeout example (A/Z/T→inner/parent/
  helper); §6 round-trip walkthrough now exits at the outermost boundary
  (`@down:time`) per I10 — a subspace up-port was I10-invalid (checker
  caught it); §3 examples drop the test-only `assert` flavour for `to-js`.
- Open (optional, dann): `[pos-zero-invalid]` double-listed in §12
  (intentional read/write split); I1 could gain P-total's ghost caveat.

## Test status (as of 2026-07-13, latest — open-item sweep)

15/15 suites green, fuzzer clean (0/3000). Counts moved: space_test
179→185, node_code 87→95, det_test 24→26. Landed this session (commits
003dcca→daa7d95):
- **[id-deterministic]** pinned — the engine's soft errors already name
  only source identifiers (cmd:handler:method, port/station names), never
  runtime handles [id-internal-handles]; det_test pins an exact error
  string + byte-identical replay.
- **Contract signal-type enforcement** (fix, cb1ce0d) — `<->` LHS must be
  Enter-N-Exit (@up / child @down|@cmd), RHS Exit-N-Reenter (@down / child
  @up) or a station [roundtrip-enex-lhs]; a declared my-own @down slipping
  in as LHS / @up as RHS now bork. Three fixtures used the invalid
  own-@down-as-LHS shape → rewritten to valid down/up contracts
  (down-port-contract now a subspace-down contract); subspace-down-* made
  coherent (@up:svc→@down:svc to match the parent's reference).
- **Cross-boundary var read-out/write-out** pinned end-to-end
  [socket-crossboundary-var]: a parent-wired handler using LOCAL {var
  read/write} resolves against the PARENT's store.
- **Recursion depth bound** (feat, 1cc5e24) — D.Space takes opts
  {depth_bound} (default D.Etc.default_depth_bound=100, inherited by
  subspaces); block.js apply tracks eval_depth per space; past the bound
  the innermost eval sploots to Empty (NESTING depth only; sequential
  evals never accumulate) [depth-bound-instance] [depth-nesting-only].
- **known_failures** in space_test emptied (all prior compile-bork guides
  had landed — a passing test in that set disables its own guard).
- Recurring theme: the TODO badly lagged the code — [demandport-create],
  both `<->` parser bugs, timeouts, [request-cycle-timeout], and the
  effectful per-command field lists were all ALREADY done, just untracked.
  TODO reconciled for everything touched.

Remaining open: vertical-to-vertical port-contract layout (DEFERRED by
dann — ASCII renderer not mission-critical; root cause + approach recorded
in TODO), the button_timer ASCII art (dann's), [id-deterministic] §12
error-ship-qname follow-up (error strings are deterministic; naming a
station qname in an error is unbuilt because no error references one), and
design-side spec-draft merges (blockeval ternary partition, depth spec
patch — engine done, prose unmerged).

## Test status (as of 2026-07-13, later — scheduler frontier sweep)

The parked queue is EMPTY. Landed after the sleep flip, in order:
node_templates.mjs → expired/; dead test blocks retired with intents
lifted (corpus 843→845; THINK/aspirational/doc blocks kept); §7
walkthrough station clock→timekeeper; run_all's daimio_test
known-count 14→0 (nonzero silently tolerated corpus regressions);
[timeout-inherit]+[timeout-min-chain] (cmd deadline = min of explicit
timeouts along the walked rule chain; contract chains had it naturally);
then the scheduler-frontier work in 4 phases (16f7da5, 866f30c,
b1d892d): re-entry renumbering [sched-reentry-uniform] + dock numbering
moved from arrival to process start (queued-behind-wait ships renumber
past the wait; space queue pops lowest [space-queue]) + delivery key
(number, wire ordinal, seq) [sched-tie-wire] — which exposed+fixed block
sub-processes dropping their root's number — + guides for
advance/wire-fifo/entry-frontier/tie-wire/[request-cycle-timeout] + two
replay guards + stale deferred notes retired. 15/15 suites, fuzzer
clean. Remaining known-open: [id-deterministic] (§12 error-ship qnames)
and the button_timer ASCII art drawing (dann's).

## Test status (as of 2026-07-13 — sleep flip)

{process sleep} reclassified effectful (dann ruled the fork): effect
cmd:process:sleep + `clock` port flavour as the canonical world handler
(answers `then` at now+`for` on the virtual clock — wall timers in
production, det harness drives it). det_time 13/13 (5 new sleep guides
incl. the migrated async-boundary var tests), fuzzer 0/3000 with
sleep/wait now fuzzable, 15/15 suites green. Spec §6
[effcmd-process-sleep] + §4 flavour list; demos + spaceeditor examples
wire `pacer@cmd:process:sleep <-> @clock`. Commits eab2bf9/de671a5/694e577.
Parked for dann: audit disposals (node_templates.mjs, commented-out
blocks), §7 walkthrough's `clock` STATION name now collides with the
clock flavour (checker flag — rename?), [timeout-inherit] chain
propagation, sched frontier guides + [request-cycle-timeout].

## Test status (as of 2026-07-12, late — post known-red sweep)

Late-session additions on top of the evening block below: fuzzer clean
(0 crashes / 3300 exprs — allowlist recognizes the new spec'd soft
errors); det_blackhole 3/3 (world-face binding: hole exits fire the
flavour inward, hole out-ports are App entry surfaces with qname
senders; port qnames prefer the NAME's dir over the flavour's);
det_socket 9/9 (drain finishes busy content + buffers arrivals, smash
severs the boundary and ghosts stragglers, hole-load sploots,
transition replay byte-identical); +2 coverage guides (socket-load
sploot on bad Astroglot, delete-key soft error). Remaining known-red:
space_test 2 (serialize — seed source retention design; false
sentinel — coercion-boundary design), sched frontier guides +
[request-cycle-timeout] + [timeout-min-chain]/[timeout-inherit]
(deferred, need harness/numbering machinery). TODO carries the
effectful-commands full-spec sweep (dann).

## Test status (as of 2026-07-12, end of evening session)

- d2_spec_test: 434/434 pass (0 known)
- daimio_test: 843/843 pass (0 known — first fully green corpus)
- node_code: 87/87 pass
- security_test: 173/173 pass
- space_test: 172 pass, 2 known (serialize — needs seed-level source
  retention, see TODO; svar-read-unbound false sentinel — load-bearing
  at numeric coercion boundaries, reverted after a probe)
- det suites: det_time 7/7 (timeouts), det_world 3/3, det_sender 8/8
  (attach-entry + registry), det_test 15/15, det_socket 4/4 (loads),
  det_blackhole 0/3 known (world-binding crossing not built; seeds
  migrated to *relay)
- space_ascii_test: 421/421 pass (two fixture sources dropped their
  flush-bug workaround lines; renders untouched)
- example_test: 110/110 pass (delete/values examples added)
- perf_test: 21/21 pass
- editor_test: 84/84 pass

### 2026-07-12 evening session: staging par, sigil engine, vtime, senders
- [peek-par] patched to STAGING per dann's ruling (design aside records
  the tradeoffs); daimio.dm fully green.
- Sigil engine (item C): +/*/! labels, structural borks, two-layer
  lexical scope (locals shadow, merge dead), black-hole compile borks,
  socket port-likes + D.socket_load replace (det_socket green).
  Last-property-never-flushes parser bug fixed (flush_action at EOF).
- Virtual-time timeouts: D.register_timeout/advance_clock; cmd deadlines
  ([timeout-resume-empty]/[timeout-ghost-drop]); occupied ports emit
  empty + free (era-guarded); harness virtual clock + respond_now.
- Sender attach-at-entry + D.register_sender registry (det_sender 8/8).
- Soft errors route by NAME to out:err [err-match-by-name] (reentrancy
  guard; legacy 'err' honored).

### 2026-07-12 session: signal flip landed; audit rulings recorded
- Round-trip routing complete (TODO item B): FAF parser mid-chain-port hop
  fix, dead down-flavour exit stub removed, port occupancy (ordinal
  responses, ghost drop, queue-at-port), cmd rule targets through paired
  space ports, rules register referenced siblings. Contract-carrier design
  rejected in review — ports hold state, wires carry ships
  (design/roundtrip-signalflip-draft.md v2).
- Coverage-audit rulings in extra/coverage/DECISIONS.md; four spec patch
  drafts (approved, unapplied) in design/audit-spec-patches-draft.md:
  dialect_decl (serialization keeps it), space label sigils
  (+nested/*hole/!socket, lexical scoping, implicit socket port-likes),
  closed-space dropped for [app-entry-outside-only], process
  dialect/aliases as effective-dialect reflection.
- Second half (dann AFK, queue pushed through): four spec patches APPLIED
  to D2-spec.md (sigils/sockets/dialect/reflection — engine work for
  sigils is TODO item C, red guides staged); closed-space flag removed
  ([app-entry-outside-only]); qnames landed (seeds carry source-order
  station/subspace names, dock hook exposes qname, anons s1/s2) + PRNG
  now derived per space (hash(parent_seed, name)); pathfinder
  scalar/Empty refactor + list delete/values landed with full test
  reconciliation. NEW OPEN DECISION: [peek-par] fold vs the corpus's
  designed par STAGING — staging kept, one red guide marks it, dann to
  rule (extra/coverage/DECISIONS.md).

### 2026-07-08 session: engine features landed
- Nested subspace parsing (indented block with structure → child spaceseed)
- name@port endpoint syntax standardized (spec §3); dot form still accepted
  as the internal key encoding (one legacy test covers it)
- {var read}/{var write} pure local dynamic-name svar access
- fun/effect partition enforced at registration (exactly one)
- Contract (<->) parsing validated; malformed contracts throw hard
  ([spacedef-hard-error] — make_some_space no longer swallows borks)
- [port-implicit-create]: undeclared @dir(:name) endpoints minted from wiring
- Effectful cmd round-trip routing: rules compile to indices; same-space +
  cross-boundary + @cmd forwarding + world-port targets; one response, ghosts
- Deterministic scheduler core: ships carry a number (carrier metadata);
  dock = max(counter, ship#)+1; deliveries drain lowest-(number,seq)-first
  through D.schedule_delivery's heap (still one D.setImmediate tick per item,
  so the det harness settle counting holds); dock hook exposes number

### Known failure root causes
- **space_test (2)**: serialize (space.serialize needs seed-level source
  retention — design pass, see TODO); 1x k_variable.js `false` sentinel
  for unbound svar (probed '' on 2026-07-12: breaks numeric coercion,
  false→0 — needs a coercion-boundary design, not a one-liner).
- **det_blackhole (3)**: hole world-binding (flavour methods bound to the
  inside face) not built — compile side done, crossing side open.

## Provisional spec decisions (revisit later)
- **Block in a space variable → serialized as a dead string.** A block held
  in an svar serializes to its source text and is always dead on reload, even
  if it was live when the space was serialized. Reviving requires `process
  unquote`. Marked `[serialize-block-dead]` in D2-spec.md §8. Revisit if/when
  live-block persistence is wanted (interacts with the unquote privilege gate).
- **Scalar equality is coercing (JS `==`), blessed provisionally (2026-07-14).**
  `eq`/`logic is`/`is in` compare scalars with JavaScript `==` (numeric-string
  coercion): `"2" == 2`, `1 == "1"`, and `0 == ""` are all true; lists compare
  structurally; a scalar is never equal to a list, so the empty value — which is
  `""` in scalar contexts — does NOT equal `[]`. D2-spec.md §10 "Collection
  equality" now describes this as-is.
  **Why not the cleaner model:** we explored making the empty value a distinct
  polymorphic zero — equal to `0`/`""`/`[]` while the typed zeros stay mutually
  distinct — which would give a genuinely typed `eq ""` test. It is NOT
  implementable without changing the empty representation: at comparison time the
  empty value arrives as raw `""`, byte-identical to a genuine empty string
  (probe: `{* (:a 1) | peek :z | eq 0}` and `{() | string join | eq 0}` both hand
  the comparator `value=""`). So "Empty == 0 but '' ≠ 0" is a contradiction —
  Empty *is* `""`. And keeping `"2" == 2` (deeply embedded) rules out dropping
  numeric coercion wholesale. **Revisit** when the empty representation is unified
  into one distinct value (the "bigger conversation"); then the polymorphic-Empty
  equality becomes possible. (Resolves the reviewer's §10 equality finding by
  documenting reality; full trail in spec-keeper session memory.)

## Git policy (overrides global)
You manage git directly in this project. The global "manual git" rule does
NOT apply here. `git push` remains denied at the permission layer; the user
handles pushing.

Workflow:
- Commit after each meaningful change passes its tests. One logical change
  per commit.
- Stage only the files relevant to the change. Use `git add <paths>`, not
  `git add .` or `git add -A`. Do not sweep up unrelated edits.
- Before committing, run `git diff --staged` and verify the diff is exactly
  what you intend. If something unintended is staged, `git restore --staged
  <path>` to unstage.
- Conventional commit messages: feat:, fix:, refactor:, docs:, test:, chore:.
  First line under 72 chars. Body if useful, omitted if not.
- Never commit on red. If a test was passing and now isn't, fix the test or
  the code before committing — do not commit broken state.
- Do not include AI attribution in commit messages.
