# Daimio2

Daimio is a language for making programmable web applications where users can extend
applications in non-trivial ways. It provides a safe, sandboxed execution environment
with a total (crash-free) execution model.

## Quick start

```bash
node tests/d2_spec_test.mjs     # 197 spec alignment tests
node tests/daimio_test.mjs       # 843 legacy tests (0 known failures)
node tests/node_code.mjs         # 68 internal tests
node tests/security_test.mjs    # 97 security tests (dialect, pollution, regex, actors)
node tests/space_test.mjs       # 91 space/topology tests (9 known failures)
node tests/example_test.mjs     # 104 command example tests
node tests/perf_test.mjs        # 21 performance regression benchmarks
```

All seven test suites must pass before any change is considered complete.

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
  d2_spec_test.mjs     — spec alignment tests (158 tests)
  daimio_test.mjs      — legacy test suite from daimio.dm (~843 tests)
  node_code.mjs        — internal JS-level tests (68 tests)
  example_test.mjs     — command example tests (102 tests, auto-discovered)
  daimio.dm            — test definitions (text format)
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

Effectful commands declare an `effect` property instead of (or alongside) `fun`.

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

## Test status

- **d2_spec_test**: 197/197 pass
- **daimio_test**: 843/843 pass (0 known failures)
- **node_code**: 68/68 pass
- **security_test**: 97/97 pass
- **space_test**: 82/91 pass (9 known failures for unimplemented spec behaviors)
- **example_test**: 104/104 pass
- **perf_test**: 21/21 benchmarks pass

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

### Poke alias footgun

The `poke` alias is `list poke value`, which fills the `value` param from the pipe.
This means `{$d | poke (:a :x) value 99}` puts `(:a :x)` into the wrong param (it
gets treated as a push, not a path). Must use `list poke path (:a :x) value 99` for
key-path pokes. Similarly, inside a block `{$d | list poke path (:a :x) value __}`
sets value to the pipe value (`$d`), not the block input — use `value __in` instead.

## REPL

The REPL is at `repl.mjs` in the project root (moved from `tests/repl.mjs`):
```bash
node repl.mjs              # interactive mode  (alias: depl)
node repl.mjs -e "{...}"   # evaluate expression, print result, exit  (alias: daml)
node repl.mjs -f file.dm   # run a .dm file as DAML, print result, exit
```
- Use `node repl.mjs -e "<expression>"` to quickly test DAML expressions
- Use `node repl.mjs -f <file>` to run a .dm file
- Type Daimio expressions at the `>` prompt, hit Enter on a blank line to execute
- Supports multiline paste (buffered until blank line)
- Named blocks use pipe on `{begin}`, not `{end}`:
  `{begin foo | >$foo ||}{body}{end foo}`
