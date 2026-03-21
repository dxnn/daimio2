# Daimio2

Daimio is a language for making programmable web applications where users can extend
applications in non-trivial ways. It provides a safe, sandboxed execution environment
with a total (crash-free) execution model.

## Quick start

```bash
node tests/d2_spec_test.mjs     # 351 spec alignment tests
node tests/daimio_test.mjs       # 843 legacy tests (0 known failures)
node tests/node_code.mjs         # 83 internal tests
node tests/security_test.mjs    # 179 security tests (dialect, pollution, regex, senders)
node tests/space_test.mjs       # 108 space/topology tests (29 known failures)
node tests/example_test.mjs     # 104 command example tests
node tests/perf_test.mjs        # 21 performance regression benchmarks
```

All seven test suites must pass before any change is considered complete.

## Test-driven development

Always write a failing test first, before changing code, unless you can prove that a
failing test already exists for the behavior being changed. Red test first, then green.

Tests should be labelled with the spec assertion, property, or invariant they test for,
whenever possible (usually an assertion ID). See the "Test-spec traceability" section
below for the labelling format.

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
- `{begin name}...{end name}` — named block (template)

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
- Soft errors route to space error port; pipeline continues with empty value.
- Every down-port request has a timeout (default 10s). Liveness guaranteed.

### Scope inheritance (blocks)

Three-layer lookup when a block reads a pipeline variable:
1. Named keys from `process.state` (e.g., `_value`, `_key` injected by commands)
2. `process.pipeline_vars` (vars set by `>foo` in the pipeline)
3. Caller's scope (inherited from parent pipeline)

Vars bound inside a block do NOT propagate back to the parent.

## Project structure

```
daimio/
  1_daimio.js          — core: D object, helpers, Space, Process, Port, Dialect
  daimio.js            — entry point, imports everything, creates top-level dialect
  2_segtypes/          — segment types (lexer priority order: a-n)
    a_terminator.js    — terminators
    b_number.js        — number literals
    c_string.js        — string literals
    d_block.js         — block segments (per-segment original_string for quote)
    e_blockjoin.js     — block joins
    f_pipeline.js      — pipeline segments
    g_list.js          — list literals
    h_fancy.js         — fancy handlers (__, __in, etc.)
    i_variableset.js   — pipeline var writes (keeps vars in pipeline + pipeline_vars)
    j_portsend.js      — port sends (>@name)
    k_variable.js      — space var reads/writes
    l_pipevar.js       — pipeline var reads
    m_command.js        — command invocation (effectful routing, timeout, orphan detection)
    n_alias.js         — alias expansion
  commands/builtin/    — built-in command handlers
    list.js            — list manipulation (map, reduce, each, filter, sort, etc.)
    logic.js           — boolean logic, conditionals
    math.js            — arithmetic
    process.js         — process control (run, etc.)
    string.js          — string manipulation
    time.js            — time commands (effectful)
    var.js             — cross-boundary state access (effectful read/write)
  datatypes/           — type coercion (block, string, number, list, etc.)
  pathfinders/         — path resolution (list keys, positions, star, zkey)
  optimizations/       — compile-time optimizations
  pflavs/              — port flavours (DOM, socket, SSE, XHR, from-js, to-js)
  aliases/             — built-in alias definitions
  lib/                 — third-party: murmurhash, seedrandom, setimmediate
tests/
  d2_spec_test.mjs     — spec alignment tests (332 tests)
  daimio_test.mjs      — legacy test suite from daimio.dm (~843 tests)
  node_code.mjs        — internal JS-level tests (68 tests)
  example_test.mjs     — command example tests (104 tests, auto-discovered)
  daimio.dm            — test definitions (text format)
  daimio.html          — browser REPL + test runner
bin/
  repl.mjs             — Node REPL (interactive, -e, -f modes)
  fuzzer.mjs           — DAML fuzzer (seeded PRNG, parallel, auto-minimizer)
css/
  daimio.css           — standalone styles for daimio.html (no Bootstrap)
  todo.css             — TodoMVC demo styles
D2-spec.md             — formal execution model specification
extra/
  D2-spec-commentary.md — spec discussion/commentary
demos/                 — demo applications (automata, todomvc, mandelbrot, etc.)
```

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

## Spec reference

The formal execution model is in `D2-spec.md`. Structure:

Part I — Orientation:
- §0: Prelude (motivation, six core ideas)
- §1: Properties + Invariants (totality, isolation, duality, liveness, I1-I15)
- §2: Design decisions

Part II — Spaces (outer topology):
- §3: Space syntax (spaceseed grammar sketch)
- §4: Space domains (dialects, commands, programs, ships, senders, stations, ports, spaces, outer space)
- §5: Space execution (scheduling, queue, process lifecycle, deferred routing)
- §6: Ports and wiring (demand-creation, pattern matching, OTHER fallback)
- §7: Async boundaries (effectful commands, timeouts)
- §8: Sockets and serialization

Part III — Blocks (inner language):
- §9: Block syntax (DAML grammar, parsing algorithm)
- §10: Block domains (values, collections, paths, splooting, blocks, processes)
- §11: Block execution (transition relations, pipes, scope, sub-processes)
- §12: Errors (soft errors, splooting)
- §13: Security analysis (privilege escalation, TOCTOU, DoS, spoofing)
- §14: Future work (concurrent scheduling, editor, auth, TODA, apps)

## Current work: D2-spec.md revision (2025-03-19)

An academic review loop (9 rounds, Reviewer + PostDoc agents) produced a revised spec
draft at `extra/drafts/draft-round9.md`. All 9 intermediate drafts are in `extra/drafts/`.

**Issues found and fixed in the draft:**
1. P-blockscope: false "write-once" safety justification -> corrected to copy + synchronous execution
2. Dialect-cmd-sploot: section 11 said pass-through, section 12 said empty -> unified to empty
3. Named port creation: section 3 contradiction (routes vs DAML scanning) -> route-based rule
4. Barrier pipe `||`: transition relation contradicted worked example -> introduced absent vs empty
5. DeleteDel/DeleteGet: idempotence claim false for Pos selectors -> qualified with counterexample
6. "Space's error port": referenced but never defined -> corrected to station's `_error` port
7. WriteSVar/WritePVar/PortSend: undefined when `process.v = absent` -> added `val()` coercion
8. Effectful command arity: inconsistent 3-tuple vs 4-tuple -> unified to 4-tuple with defaultHandler

**Next step:** Review `extra/drafts/draft-round9.md` against the original D2-spec.md,
decide which changes to adopt, and replace D2-spec.md with the final version.

## Current work: Spec-aligned implementation (2026-03-20)

Session focused on tactical spec alignment and test infrastructure:

**Completed:**
1. Per-space PRNG seeding — `D.Space` accepts optional `prng_seed`, creates per-space `rng`
   via seedrandom. Subspaces share parent's rng. [random-pure] [random-seeded] [random-internal]
2. `{math random}` wired to `D.Etc.active_space.rng` (deterministic per-space)
3. Removed station `_error` default port (spec says stations have only `_in` and `_out`)
4. `D.on_error` silenced — no console.log fallback when no `@err` port
5. `{var read}` → `{var read-out}`, `{var write}` → `{var write-out}` (spec names)
6. Test suite speedup: security_test 3.5s→0.08s, space_test 5.1s→0.6s (total ~11s→~3s)
7. 27 new port/wiring spec tests in space_test.mjs (RED tests guiding future work)
8. `[spacesyn-subspace-before-ref]` — forward references now rejected in parser
9. `[cmd-name-encode]` — portType renamed to `cmd:handler:method` convention
10. Fixed test seedlike indentation bugs for subspace tests

**29 known-failing space tests** — all require unimplemented features:
- `<->` round-trip wiring syntax
- Command port demand-creation and wiring rules
- Up-port mechanics (ghost responses, chained up-ports)
- Wiring rule targets (station, sibling up-port, parent boundary forwarding)
- Error routing by name (`@out:err`) vs by flavour

## Test status

- **d2_spec_test**: 351/351 pass
- **daimio_test**: 843/843 pass (0 known failures)
- **node_code**: 83/83 pass
- **security_test**: 179/179 pass
- **space_test**: 108/137 pass (29 known failures for unimplemented spec behaviors)
- **example_test**: 104/104 pass
- **perf_test**: 21/21 benchmarks pass
- **fuzz_test**: seed-dependent; stack overflows from self-referential blocks are the main finding

## Test-spec traceability (Phase 20)

Every spec-supported test is annotated with assertion IDs from D2-spec.md. The format
is `[assertion-id]` in test labels or section comments. ~400 annotations across 5 files.

**Assertion ID format**: Properties are `[P-total]`, invariants are `[I1]`–`[I15]`,
fine-grained assertions are `[poke-key-update]`, `[parse-brace-structural]`, etc.
Tests wrong per spec are marked `[WRONG:assertion-id]`.

**6 wrong tests** (all in d2_spec_test.mjs): Key poke on unkeyed promotes to keyed
instead of splooting (spec says `[poke-key-unkeyed-fail]`), and svar-path poke coerces
scalars before poking instead of using the scalar rule. Root cause: two implementation
bugs in poke. See the test-spec sweep report in memory.

## Fuzzer

The fuzzer at `bin/fuzzer.mjs` generates random DAML and runs it, looking for crashes,
hangs, prototype pollution, and async errors. Generators cover: commands with type-confused
params, meta-evaluation (process run/quote/unquote chains), complex pathfinder paths,
coercion stress chains, port sends, named blocks (nested/multiple), and random garbage.

```bash
node bin/fuzzer.mjs                          # 1000 expressions, random seed
node bin/fuzzer.mjs 50000 myseed             # 50k, reproducible seed
node bin/fuzzer.mjs 5000 myseed 200 100      # count seed concurrency timeout_ms
node bin/fuzzer.mjs 5000 myseed -v            # verbose (full expressions to stderr)
node bin/fuzzer.mjs 5000 myseed --skip 3000   # skip first 3000 (for OOM bisection)
```

Crashes are auto-minimized to shortest reproducing expression (preserves `||` barrier pipes).
Self-referential named blocks (`{begin foo | >$foo}{$foo}{end foo}`) are detected statically
and skipped — the engine needs a recursion depth limit to handle these (TODO).

Known issue: `D.BLOCKS` caches every compiled block forever. Over long fuzzer runs this
causes linear memory growth and eventual OOM. Not a fuzzer bug — it's the engine's global
block cache with no eviction.

### Engine bugs found by fuzzer

- **NaN-as-async signal**: `number` type coercion returned `NaN` for non-numeric strings
  (e.g. `+"baz"`), which the runtime misinterpreted as "went async." Fixed in `datatypes/number.js`.
- **Trig on infinity**: `Math.sin(Infinity)` = `NaN`, same async misinterpretation.
  Fixed with `|| 0` guard on sin/cos output.
- **Math solver NaN**: `0 * -Infinity` = `NaN` in multiply/add/subtract/divide.
  Fixed with `|| 0` on all `fun()` return sites in `naryanArray`, `singleArray`, `doubleArray`.
- **Math round overflow**: `Math.pow(10, 999999)` = `Infinity`, then `round(5 * Infinity) / Infinity` = `NaN`.
  Fixed with `|| 0` on the rounding path.
- **execute_then_stringify space leak**: `D.run`'s `prior_starter` called `execute_then_stringify`
  without a process context, so `datatypes/block.js` fell back to `D.ExecutionSpace` instead of
  the space that `D.run` was called with. Fixed by passing `{space, station_id: false}` as
  minimal context in `1_daimio.js`.

## Demo status

Most demos have been updated to work with the current codebase:

**Completed:**
- Removed all `with` param usage from DAML (replaced with scope inheritance / pipeline vars)
- Fixed strict-mode errors in all `<script type="module">` blocks (`var`/`window.` declarations)
- CodeMirror updated to CM5 from CDN (cdnjs 5.65.18) — custom daimio mode + hint stay local
- Working: button_local, button_two, button_timer, turtle_solo, seqs/*, coderetreat, todomvc
- tests/daimio.html: REPL converted to module script, var scoping fixed, Bootstrap removed
  (replaced with css/daimio.css + vanilla JS for navbar dropdowns)

**Needs investigation:**
- sans-collatz.html: same pattern, plus missing `collate` station type
- mandelbrot demos: `mandelbrot iterate` command only defined in canvas_ships_faster.html, not the other two
- turtle_net, turtle_net_temp: load daimio from remote `http://daimio.org/`, need socket.io (exec port replaced with unquote+run)
- server demos: need socket.io backend

**Pattern reference for `with` removal:**
- `run with _var` → blocks reference `_var` directly (scope inheritance)
- `map with {* (:name val)}` → set pipeline var before map: `val | >name || ... | map block "..."`
- Named blocks can't set pipeline vars before `{begin}` → use `{_key | >$row || ""}` with space var

## Optimization opportunities

### setImmediate overhead in port routing

Port routing (`port_standard_exit`, `port_standard_sync`, `Space.execute` via `run_queue`)
uses `D.setImmediate` to defer each step to the next tick. This keeps browser UIs responsive
during heavy computation but costs ~11µs per call in Node.js. In the space_ship_routing
benchmark, 1100 hops generate 3301 setImmediate calls — the scheduling overhead accounts
for nearly the entire 36ms runtime. The actual command dispatch and block evaluation is
negligible by comparison.

A synchronous mode (skip setImmediate when no UI is present, or when the space opts in)
could give 10-50× speedup for pure computation workloads like the mandelbrot solver.

Relevant code:
- `daimio/1_daimio.js` line 804: `D.setImmediate` in `port_standard_exit`
- `daimio/1_daimio.js` line 838: `D.setImmediate` in `port_standard_sync`
- `daimio/1_daimio.js` line 2611: `D.setImmediate` in `run_queue`

### Pay attention to aliases

The `poke` alias is `list poke value`, which fills the `value` param from the pipe.
This means `{$d | poke (:a :x) value 99}` puts `(:a :x)` into the value param, not the path param. (The 99 is skipped as a duplicate param.) 
Instead do `{$d | poke 99 path (:a :x)}`. 
Many aliases fill a parameter spot this same way, but not all, so pay attention.

## REPL

The REPL is at `bin/repl.mjs`:
```bash
node bin/repl.mjs              # interactive mode  (alias: depl)
node bin/repl.mjs -e "{...}"   # evaluate expression, print result, exit  (alias: daml)
node bin/repl.mjs -f file.dm   # run a .dm file as DAML, print result, exit
```
- Use `node bin/repl.mjs -e "<expression>"` to quickly test DAML expressions
- Use `node bin/repl.mjs -f <file>` to run a .dm file
- Type Daimio expressions at the `>` prompt, hit Enter on a blank line to execute
- Supports multiline paste (buffered until blank line)
- Soft errors display in red; `-e` and `-f` modes print errors to stderr
- Tab completion: handlers/aliases after `{`, methods after handler, params after method
- History persists across sessions in `~/.daimio_history` (up-arrow to recall)
- Named blocks use pipe on `{begin}`, not `{end}`:
  `{begin foo | >$foo ||}{body}{end foo}`
