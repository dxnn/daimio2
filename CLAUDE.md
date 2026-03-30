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

