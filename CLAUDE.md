# Daimio2

Daimio is a language for making programmable web applications where users can extend
applications in non-trivial ways. It provides a safe, sandboxed execution environment
with a total (crash-free) execution model.

## Quick start

```bash
node tests/d2_spec_test.mjs     # 149 spec alignment tests
node tests/daimio_test.mjs       # ~843 legacy tests (4 known failures)
node tests/node_code.mjs         # 68 internal tests
```

All three test suites must pass before any change is considered complete.

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
- **Pipelines**: segments connected by pipes. The atomic unit of computation.
- **Ships**: the unit of execution flowing through a space, carrying payload + pipeline vars.
- **Spaces**: topology containers with stations, subspaces, ports, and wiring rules.
- **Ports**: typed connection points (In, Out, Down/request, Up/response).
- **Dialect**: determines available commands and aliases per Daimio instance.
- **Blocks**: quoted DAML that can be passed as values and evaluated later.

### Execution model

- Pure commands are synchronous and total (always return a value).
- Effectful commands create async boundaries via down ports (request/response).
- `NaN` return from a command signals async (took callback route).
- Segments execute atomically — no interleaving within a synchronous segment.
- Space variable reads are always fresh (re-read after async boundaries).
- Pipeline vars survive async boundaries within the same pipeline.
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
  d2_spec_test.mjs     — spec alignment tests (149 tests)
  daimio_test.mjs      — legacy test suite from daimio.dm (~843 tests)
  node_code.mjs        — internal JS-level tests (69 tests)
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
        params: [{ key: 'value', type: 'number', required: true }],
        fun: function(value) { return result }
      }
    }
  }
})
```

Effectful commands declare an `effect` property instead of (or alongside) `fun`.

### Port inside/outside pairing

- `space.ports` holds INSIDE ports
- OUTSIDE is at `port.pair`
- Down ports use `sync` (not `exit`) for request/response with callback
- `port_standard_sync` delegates to `pair.outside_exit(ship, callback)`

### D.is_nice and falsy values

`D.is_nice(value)` returns `value || value == false` — this means `""` is "nice"
(because `"" == false` is true in JS). Be careful with empty string checks.

## Spec reference

The formal execution model is in `D2-spec.md`. Key sections:
- §0: Concrete syntax (grammar)
- §1: Domains (values, paths, ships, spaces, ports)
- §2: Synchronous execution
- §3: Async boundaries (effectful commands, timeouts)
- §4: Errors (soft errors, totality)
- §5: Ports and wiring (demand-creation, pattern matching, OTHER fallback)
- §6: Sockets and serialization
- §7: Block evaluation (programs-as-data)
- §8: Scheduling and interleaving
- §9: Three sendable things (data, program, space)
- §10: Properties (totality, isolation, atomicity, liveness)

## Test status

- **d2_spec_test**: 149/149 pass
- **daimio_test**: 839/843 (4 known failures in `known_failures` set)
- **node_code**: 68/68 pass

Known failures are mostly edge cases in nested poke paths with par combinations.

One test is marked KNOWN PROBLEMATIC: `poke([1,2,3], ["*", :a], 99)` — star expands
to scalar children, then keyfinder can't create/set on primitives because D.poke doesn't
track parent references. Fixing requires refactoring D.poke to carry `{parent, key}`
context for each todo item.

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
