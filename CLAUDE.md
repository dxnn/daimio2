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

## Test status (as of 2026-07-12, end of session)

- d2_spec_test: 434/434 pass (0 known)
- daimio_test: 842/843 pass (1 known: the [peek-par] fold guide — par
  semantics decision pending, see extra/coverage/DECISIONS.md)
- node_code: 87/87 pass
- security_test: 172/172 pass (closed-space tests removed)
- space_test: 161 pass, 10 known (sigil/blackhole/socket compile borks
  awaiting the sigil parser; err-match-by-name; serialize; false sentinel)
- det suites: det_time 3/3, det_world 3/3, det_sender 6/7 (sender-attach-entry
  needs the entry-attachment rule), det_test 15/15,
  det_blackhole / det_socket per their known sets
- space_ascii_test: 421/421 pass (59/59 fixtures round-trip; fixture sources
  and parse emission now use name@port endpoints)
- example_test: 110/110 pass (delete/values examples added)
- perf_test: 21/21 pass
- editor_test: 84/84 pass

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
- **daimio_test (1)**: the [peek-par] fold guide — the merged spec's par
  formula (fold: sub-paths extend with the remaining path) conflicts with
  the corpus's designed series/parallel STAGING semantics (the "Series
  and parallel" tutorial chapter). Staging kept in the engine; decision
  pending (extra/coverage/DECISIONS.md).
- **space_test (10)**: sigil / black-hole / socket compile borks awaiting
  the sigil parser (TODO item C), err-match-by-name, serialize, 1x
  k_variable.js `false` sentinel for unbound svar

## Provisional spec decisions (revisit later)
- **Block in a space variable → serialized as a dead string.** A block held
  in an svar serializes to its source text and is always dead on reload, even
  if it was live when the space was serialized. Reviving requires `process
  unquote`. Marked `[serialize-block-dead]` in D2-spec.md §8. Revisit if/when
  live-block persistence is wanted (interacts with the unquote privilege gate).

## Pending spec drafts (design/)

Four draft patches await review/merge — decision trail in design/gen1.md +
gen2.md, working file gen3.md:
- blockeval-spec-draft.md — ternary effect partition + covering rule
- depth-spec-draft.md — recursion depth bound (composes with blockeval)
- sender-spec-draft.md — sender-at-entry + QNames/deterministic ids
- scheduler-spec-draft.md — vtime deterministic scheduler (REQUIRES sender
  patch first; proof sketch in sched-determinism-sketch.md)

After merges: test-suite phase (~52 new assertion IDs) + black hole
renderer/parser/fixture work (site/js, tests/).

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
