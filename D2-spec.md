# Daimio2: Formal Execution Model


## 0. Concrete Syntax

DAML (Daimio Ain't Markup Language, aka Drat Another Markup Language, aka Dragon Ate My Lambdas) is a templating language. A DAML source string is a mix of literal text and command invocations delimited by curly braces. Literal text passes through unchanged; commands are evaluated and their results are interpolated into the output. And then we eat lunch.

### Grammar

```
daml       ::= (text | command | namedblock)*

text       ::= any characters not containing paired curlies -- or an unpaired front curly

command    ::= '{' pipeline '}'

namedblock ::= '{begin' name '}' daml '{end' name '}'

pipeline   ::= segment (pipe segment)*

pipe       ::= '|'                      — normal:  implicit value (chi) flows
             | '||'                     — barrier: implicit value is blocked

segment    ::= command_call
             | literal
             | list_literal
             | block
             | pvar_read
             | pvar_write
             | svar_read
             | svar_write
             | port_send

command_call ::= handler method (param_name value)*

handler    ::= name                     — e.g. math, string, list
method     ::= name                     — e.g. add, split, transmogrify

param_name ::= name                     — e.g. value, to, block

value      ::= string_literal
             | number_literal
             | pvar_read
             | svar_read
             | command
             | block
             | name_literal

string_literal ::= '"' (char | command | namedblock)* '"'
number_literal ::= '-'? digit+ ('.' digit+)?    - actually any JS numeric string... so like 0x3e3 is cool :shrug: 
name_literal   ::= ':' name             — e.g. :foo produces the string "foo"
list_literal   ::= '(' value* ')'       — e.g. (1 2 3), (:a :b :c)

block      ::= '"{' pipeline '}"'       — a quoted pipeline as a value
             | '"' daml '"'             — a quoted DAML template as a value (those quotes are hard to parse)

pvar_write ::= '>' name                 — e.g. >result, >x -- NB NO path for pvar writes!
pvar_read  ::= '_' name path?           — e.g. _foo, _x.bar.#1
svar_write ::= '>$' name path?          — e.g. >$count, >$user.name
svar_read  ::= '$' name path?           — e.g. $count, $user.name

port_send  ::= '>@' name                — send to a named space-level port

path       ::= ('.' selector)*
selector   ::= name                     — Key: a key: .foo, 12
             | '#' integer              — Pos: a positional (1-based) index: .#1, .#-1
             | '*'                      — star: all children
             | '(' path+ ')'            — par: multiple paths gathered -- NOTE! inside a dot-path this only works in curlies
```

### The implicit pipe value

The `|` operator does more than sequence segments — it **automatically
fills the first unfilled parameter** of the next command with the
previous segment's output. This is the core pipe mechanic:

```
{2 | math add value 5 | math add value 3}
```

Here, `2` flows into `math add` as its implicit first parameter (the
value being added to), producing 7. Then 7 flows into the next
`math add` the same way, producing 10. The programmer never names
the flowing value — it's injected automatically.

This implicit value is also available explicitly as `__`. And `__in`
refers to the input to the current pipeline/block (fixed for the
whole execution, unlike `__` which updates each segment). 
Note that `__` is the ONLY pipeline var that updates inside a pipeline. All other `_` vars are static (they actually get compiled down to wiring, if you can believe that.)

```
— given pipeline input of 10:
{math add value 5 | math add value __in}
— math add value 5: implicit input is 10, result is 15
— math add value __in: implicit input is 15, but __in is still 10, result is 25
```

### Variables and scope

```
__         — the implicit pipe value (previous segment's output)
__in       — the input to the current pipeline/block (fixed)
_foo       — pipeline variable (read); set with >foo
$foo       — space variable (read); set with >$foo
```

**Scope hierarchy:**
  - `__` — previous pipe segment (resets each segment)
  - `_foo` — pipeline variable (set with `>foo`; inherited by inner
    blocks, but bindings inside a block don't propagate back out)
  - `$foo` — space variable (persists across pipelines within a space)

### The `||` barrier

`||` (double pipe) blocks the implicit pipe value from flowing to the
next segment. After `||`, the next command receives the empty value as
its implicit input. Pipeline variables (`_foo`) still cross the barrier
— only the implicit value is blocked.

This is how you run independent computations in sequence within one
pipeline, using pipeline vars to stash results:

```
{some_query | >a || other_query | >b || command foo _a bar _b}
```

Without `||`, `other_query` would receive `some_query`'s result as
its implicit input, which is probably wrong:

```
{some_query | >a | other_query | ...}
                    ↑ oops, other_query gets some_query's result piped in
```

A trailing `||` causes the pipeline to return the empty value instead
of its last segment's result. Useful in templating contexts where
side-effectful operations shouldn't produce visible output:

```
{$count | >@notify ||}                           — side effects, no output
```

### Named blocks

DAML originated as a templating language. A named block interleaves
literal text with commands to produce an output string:

```
{begin greeting}
  Hello, {$user.name}! You have {$count} messages.
  {$msgs | list each block "{_value | string uppercase}" with $items}
{end greeting}
```

Names are nice to read. They're also good for scoping and reuse. The block's content is DAML: literal text is preserved, commands are evaluated then smushed into the text sandwich. Note that this is the same evaluation model as any other DAML string — there is no special mechanism for named blocks.

### Concrete examples

```
{3 | math add value 2}                           — pure command: 5
{(1 2 3) | list map block "{__ | math add value 1}"}  — [2, 3, 4]
{$user.name | string uppercase}                  — path + command
{>x | user fetch id :bob | _x}                   — save, effect, restore
{:hello | >@spaceout}                            — send to space port
{begin roe}{$name}: {$score}{end roe}            — named template block
{$count | >@notify ||}                           — side effects, no output
```


## 1. Domains

### Values
```
v ∈ Val       — numbers, strings, lists (the single universal collection)
```

Values are the single data type. A collection is a universal data
structure that supports ordered access (by position), keyed access
(by string key), and nesting (values can contain other values to
arbitrary depth).

A collection's entries may be keyed, unkeyed, or a mix. `(1 2 3)` is
unkeyed (positional only). `{* (:a 1 :b 2)}` is keyed. This
distinction matters for poke: Name can create new entries on keyed
collections but not on unkeyed ones (see Path expressions).

**The empty value** is the zero/identity element. It coerces based on
context: `""` when used as a string, `0` when used as a number, `[]`
when used as a list. This is why totality works without error values —
a missing path, an unbound variable, or a timed-out effect all produce
the empty value, which becomes whatever zero the consuming command
expects.

**Value semantics:** values flowing through pipelines have copy semantics
at command boundaries. A command receives its own copy of any collection
it intends to mutate. The original value in the pipeline is not affected.
From the programmer's perspective, pipeline flow is functionally pure.
Implementations may use mutation internally for efficiency (linear types
style optimization when no future references exist).

### Path expressions and accessors

A path is a sequence of selectors applied to a Val to access nested
structure. Paths appear in variable access (`$user.name`, `_x.#1.items`)
and in the four path operations: peek, poke, map, delete.

#### Selectors

```
Selector = Name(string)     — keyed access: .foo
         | Pos(integer)     — positional access: .#1, .#-1 (1-based, negative from end)
         | Star             — all children: .*
         | Par(path list)   — multiple paths in parallel
```

Name and Pos are **affine** — they focus on at most one location.

Star is a **traversal** — it focuses on all existing children.

Par is a **multiplexer** — it maps an operation across multiple paths.
Each sub-path carries its own semantics.

**Pos is 1-indexed.** `#1` is first element, `#-1` is last. Pos works
on both keyed and unkeyed collections (keyed collections are accessed
by insertion order).

**Key access is 0-indexed.** Name with a numeric string on an unkeyed
list uses 0-based indexing (see Key coercion below).

#### Key coercion

Keys in paths may be strings or numbers. Coercion depends on the
target collection:

```
String key on unkeyed list:  coerce to nat using (x|0) === +x
                              if success: 0-indexed array access
                              if failure: soft error

Number key on keyed list:    treat as string (JS: obj[2] is obj["2"])

Number key on unkeyed list:  0-indexed array access

String key on keyed list:    normal key lookup
```

Examples:
```
peek([10,20,30], ["#2"])      →  20    (Pos, 1-indexed)
peek([10,20,30], [2])          →  30    (number key, 0-indexed)
peek([10,20,30], ["2"])        →  30    (string coerced to nat, 0-indexed)
peek([10,20,30], ["a"])        →  soft error (can't coerce)
peek({a:1, "2":99}, [2])      →  99    (number key on object, as string "2")
peek({a:1, b:2, c:3}, ["#2"]) →  2     (Pos on keyed list, by insertion order)
```

#### The four path operations

All four share the same path language.

| Operation | Creates structure? | Changes shape? | Optics analog |
|---|---|---|---|
| **peek** | No | No | get / view |
| **poke** | Yes (Name only) | No | set / put |
| **map** | No | No | over |
| **delete** | No | Yes | — |

#### Peek (read)

```
peek(v, []) = v

peek(Collection, Name(s) :: rest) = peek(v[s], rest)     — or Empty
peek(Collection, Pos(n)  :: rest) = peek(v at n, rest)    — or Empty
peek(Collection, Star :: rest)    = [peek(child, rest) for child in children(v)]
peek(Collection, Par(ps) :: rest) = [peek(v, p ++ rest) for p in ps]

peek(scalar, _ :: _) = Empty              — no navigation into scalars
peek(Empty, _ :: _)  = Empty
```

**No scalar wrapping.** Applying any non-empty path to a scalar
always yields Empty.

**Return type is path-dependent:** if any selector in the path is
Star or Par, the result is always a list (even if empty: `[]`).
If all selectors are affine (Name or Pos), the result is a single
value or Empty. The caller can predict the return shape from the
path alone, regardless of data.

#### Poke (write)

Poke writes a constant value at a path. **Only Name creates new
structure.** Everything else modifies in place, soft errors, or
is a no-op.

```
poke(v, [], new) = new                    — replace entirely
```

**Name** — creates on keyed collections, Empty, and scalars:

```
poke(KeyedCollection, Name(s) :: rest, new) =
  if key s exists: update val with poke(val, rest, new)
  else:            add entry (key=s, val=poke(Empty, rest, new))

poke(UnkeyedCollection, Name(s) :: rest, new) =
  apply key coercion; if s coerces to nat, update that element
  otherwise: soft error, return unchanged (no promotion)

poke(Empty, Name(s) :: rest, new) =
  create KeyedCollection with (key=s, val=poke(Empty, rest, new))

poke(scalar, Name(s) :: rest, new) =
  if affine path (no Star): poke(Empty, Name(s) :: rest, new)
                              — scalar is replaced
  if traversal (through Star): unchanged — scalar is skipped
```

**Pos** — modifies existing positions only:

```
poke(Collection, Pos(n) :: rest, new) =
  if position n exists: update val with poke(val, rest, new)
  else:                 unchanged         — out of bounds, no-op

poke(Empty, Pos(n) :: rest, new) = Empty
poke(scalar, Pos(n) :: rest, new) = unchanged
```

**Star** — modifies all existing children, never creates:

```
poke(Collection, Star :: rest, new) =
  for each child: poke(child, rest, new)
  — scalar children are skipped (see scalar rule above)

poke(Empty, Star :: rest, new) = Empty
poke(scalar, Star :: rest, new) = unchanged
```

**Par** — delegates to each sub-path, sequentially left-to-right:

```
poke(v, Par(ps) :: rest, new) =
  for each path p in ps (left to right):
    v = poke(v, p ++ rest, new)
  return v
```

**Scalar mid-path rule (affine vs traversal):** when poke encounters
a scalar mid-path, behavior depends on whether the overall path is
affine (no Star) or a traversal (passes through Star):

  - **Affine:** Name replaces the scalar and continues.
    `poke({x: 42}, [:x, :a], 99)` → `{x: {a: 99}}`
  - **Traversal:** scalar children are skipped.
    `poke([1, 2, 3], ["*", :a], 99)` → `[1, 2, 3]`

#### Map (transform at focus)

Map applies a block to each value at a path focus. **Map never
creates structure** (it doesn't add keys or extend collections).
However, map **will overwrite scalars with structure** if the block
returns a complex value. If the path doesn't reach any focus, the
structure is returned unchanged.

```
map(v, [], block) = block(v)

map(Collection, Name(s) :: rest, block) =
  if key s exists: update val with map(val, rest, block)
  else:            unchanged

map(Collection, Pos(n) :: rest, block) =
  if position n exists: update val with map(val, rest, block)
  else:                 unchanged

map(Collection, Star :: rest, block) =
  for each child: map(child, rest, block)

map(scalar, _ :: _, block) = unchanged
map(Empty, _ :: _, block) = Empty
```

**Par-map is sequential** (same as Par-poke).

**When path is omitted, default is `("*")`** — this matches current
`list map` behavior (map over all children).

**Block receives:**
  - `__` — the value at the focus
  - `_key` — the key of the focus in its parent
  - `_index` — the index of the focus in its parent
  - `_path` — the full path from root to focus, as a list (new)

`_path` uses **keys, not positions**, so it is **0-indexed** for
array elements. Even when the selector was Pos (e.g. `"#2"`),
`_path` records the resolved 0-indexed key.

#### Delete (remove at focus)

Delete removes the entry at a path focus. **Delete changes
collection shape** (positions shift, entries disappear). If the
path doesn't reach any focus, the structure is returned unchanged.

```
delete(v, []) = Empty

delete(KeyedCollection, Name(s) :: []) =
  remove entry with key s (no-op if missing)

delete(UnkeyedCollection, Name(s) :: []) =
  apply key coercion; if s coerces to nat, splice (shift)
  otherwise: soft error, return unchanged

delete(Collection, Pos(n) :: []) =
  if position n exists: splice (shift remaining elements)
  else:                 unchanged

delete(Collection, Star :: []) =
  remove all children (preserve keyed/unkeyed type)

delete(Collection, selector :: rest) =
  navigate to child(ren) via selector, recurse with rest
```

**Par-delete uses collect-then-remove semantics.** It identifies
all targets from the original structure, then removes them all at
once (in reverse index order for positional deletes to preserve
correctness as indices shift).

This differs from Par-poke and Par-map, which are sequential. The
justification: poke and map preserve collection shape, so sequential
application over non-overlapping paths is equivalent to parallel.
Delete changes shape — sequential positional deletes shift indices
between steps, causing later sub-paths to target wrong positions.
We accept the asymmetry because it is justified by the operations'
different relationship to shape.

#### Conversion commands

Switching between keyed and unkeyed is explicit:

```
{* (:a 1 :b 2) | list values}   →  [1, 2]          (keyed → unkeyed)
{(1 2) | list rekey}             →  {"0":1, "1":2}   (unkeyed → keyed)
```

#### Path command signatures

```
list peek   — params: data, path
list poke   — params: data, path, value
list map    — params: data, path (default "*"), block
list delete — params: data, path
list append — params: data, value
list values — params: data                    (keyed → unkeyed)
list rekey  — params: data                    (unkeyed → keyed)
```

`list map` with path omitted defaults to `("*")` (current behavior:
map over all children). `list append` replaces the old empty-path
poke behavior; empty path in poke means "replace entirely."

#### Laws

```
PutGet:    peek(poke(v, p, x), p) = x
PutPut:    poke(poke(v, p, x), p, y) = poke(v, p, y)
GetPut:    poke(v, p, peek(v, p)) = v
DeleteGet: peek(delete(v, p), p) = Empty
DeleteDel: delete(delete(v, p), p) = delete(v, p)
MapId:     map(v, p, "{__}") = v
PokeAsMap: poke(v, p, x) = map(v, p, "{x}")
```

PutPut holds universally. DeleteDel (idempotent) holds universally.
MapId (identity block preserves structure) holds universally.

GetPut holds except when Name creates a new entry.

PutGet holds when poke actually writes. Fails on no-ops (out-of-bounds
Pos, Name soft error on unkeyed) and on traversal scalar skips.

DeleteGet holds when delete actually removed something.

PokeAsMap holds when both would write. Diverges when focus doesn't
exist: poke creates (via Name), map skips. Also diverges on traversal
scalar mid-path: poke skips scalars through Star, but map through
Star would also skip (both unchanged), so they actually agree there.

After positional delete, positions shift: `peek(delete([a,b,c], [#2]),
[#2])` = `c`. Consistent with splice semantics.

### Identifiers
```
x ∈ PVar      — pipeline variable names (_foo, _bar)
s ∈ SVar      — space variable names ($foo, $bar)
c ∈ Cmd       — command names (math.add, time.now)
p ∈ PortId    — port identifiers, generated at runtime
```

### Dialect
```
δ ∈ Dialect = (commands, aliases)
  where commands : P(Cmd)               — permitted commands
        aliases  : AliasName → Pipeline  — compile-time expansions
```

A dialect determines what commands can be invoked and what shorthand
is available within an outer space. Dialects are partially ordered:
δ_Bob ⊆ δ_Alice means Bob's command set is a subset of Alice's AND
Bob's alias set is a subset of Alice's.

**Aliases** are compile-time substitutions. An alias name expands to a
fixed pipeline fragment before execution. They are part of the dialect
because restricting a dialect may remove aliases as well as commands.
Aliases are purely syntactic — they expand before any execution
happens, and the expanded form must be valid under the same dialect.

### Commands
```
A command definition is either:
  Pure(c, params, fun)         — a pure command with a handler function
  Effectful(c, params, portType, defaultHandler)  — an effectful command
```

Pure commands are total functions from params to Val.
Effectful commands have no fun; they have a port type and a default handler.
The port type names the kind of port that will be created on demand.
The default handler is an implementation that the environment may override.

### Ships
```
ship = (v, env)
  where v   : Val         — the ship's current payload (pipeline value)
        env : PVar → Val  — the ship's pipeline variable bindings
```

A ship is the unit of execution flowing through a space. It carries its
payload and its local state (pipeline vars). Pipeline vars are immutable
within a segment but can be bound via >x.

**Env scope:** pipeline variables are write-once and scoped to one
pipeline/block execution. When a block is invoked by a command (like
`list map`), it inherits a copy of the parent pipeline's env — all
the parent's pipeline vars are readable inside the block. But vars
bound inside the block (via `>x`) do not propagate back to the parent.
The inheritance is one-way: parent → child, never child → parent.

When a ship exits a station's _out port, its env is cleared. The ship
arrives at the next station with only its payload (v).

Pipeline vars DO survive across async boundaries *within* the same
pipeline. If a ship suspends at a down port and resumes, its env is
intact. But they don't escape the pipeline that created them.

Ships do NOT carry dialects. The dialect is a property of the
outer space the ship is flowing through (see Spaces below).

### Outer Spaces
```
The outer application instantiates Daimio once per actor. Each
Daimio instance IS an outer space: a live copy of a space definition's
topology, with its own space variables, running under one dialect.

outerSpace = (space, δ, σ)
  where space           : space        — the space definition
        δ               : Dialect      — this instance's dialect
        σ               : SVar → Val   — this instance's space variables
```

A Daimio instance has no knowledge of other Daimio instances. There
is no cross-instance communication, no shared scheduler, no shared
state. From Daimio's perspective, there is exactly one outer space —
the one it's running. If the outer application wants 30 actors using
the same space definition, it creates 30 separate Daimio instances.
Each is a completely independent universe.

The outer application is responsible for:
  - Creating Daimio instances (one per actor)
  - Assigning each instance's dialect
  - Routing incoming data to the correct instance
  - Monitoring resource usage per instance
  - Providing effect handlers (wiring the outermost ports)

Inter-actor communication happens entirely outside of Daimio, mediated
by the outer application through whatever external systems it chooses
(databases, CRDTs, message queues, etc.).

### Pipeline Segments
```
seg ::= PureCmd(c, args)           — invoke a pure command
      | EffCmd(c, args)            — invoke an effectful command (async boundary)
      | ReadSVar(s, path)          — read a space variable (with optional path)
      | WriteSVar(s, path)         — write pipeline value to space variable
      | ReadPVar(x, path)          — read a pipeline variable (with optional path)
      | WritePVar(x)               — bind pipeline value to pipeline variable
      | Literal(v)                 — a literal value
      | Block(daml)                — a quoted DAML string as a value

pipeline ::= seg₁ pipe seg₂ pipe ...  — sequential composition
pipe     ::= '|' or '||'             — normal pipe or barrier pipe
```

**Eval is not a special operation.** Whenever a Block (a DAML string)
is evaluated — whether by `list map`, `list fold`, `if then`, or any
other command that takes a block parameter — that block's pipeline
executes in the current space under the current dialect. This is just
normal pipeline execution. There is no separate "eval" mechanism;
evaluating a block IS running a pipeline.

This means `{(1 2 3) | list map block "{__ | add 1}"}` involves block
evaluation: the block `"{__ | add 1}"` is a DAML string that gets
evaluated once per list element. Each evaluation is a pipeline execution, subject to
the same rules as any other pipeline (segment atomicity, fresh space
var reads, effectful commands creating async boundaries, etc.).

A program received as data (e.g. a ship carrying a DAML string) is
evaluated the same way — it's a Block that gets run as a pipeline.
No special case needed.

### Stations
```
station = (name, pipeline)
  where name     : string
        pipeline : pipeline        — the DAML code in this station
```

A station has exactly three built-in ports:
  - **_in**:    receives ships (fire-and-forget inward)
  - **_out**:   sends the pipeline's result (fire-and-forget outward)
  - **_error**: receives soft errors from this station's execution

A station's pipeline can also send ships to the enclosing **space's**
out-ports using `>@portname`. This is how a station pushes data to
named space-level ports (not station ports).

Down ports are NOT station-level constructs. They arise in two ways:
  1. **From effectful commands:** when a pipeline invokes an effectful
     command, the runtime creates/uses a down port on the space.
  2. **From explicit space-level wiring:** the space definition can
     connect two stations (one's _out to another's _in) through a
     down/up port pair, creating a call-response link between them.

This means the station itself is simple — it's a pipeline with in,
out, and error. All the interesting port topology (down, up, wiring
to subspaces, socket-in) lives at the space level.

### Ports
```
port = (id, direction, flavour, wiring)

direction ::= In | Out | Down | Up

  In   — fire-and-forget inward (ships enter the space)
  Out  — fire-and-forget outward (ships leave the space)
  Down — round-trip outward (request/response, the space needs something)
  Up   — round-trip inward (the space provides a service)

flavour   — the port's type (e.g. "time-now", "socket-in")

wiring    — how this port connects to the outside; determined by the
            parent space's wiring declarations (see §5)
```

### Spaces
```
space = (stations, subspaces, ports, wiringRules, defaultTimeout?)

  stations      : name → station
  subspaces     : name → space
  ports         : set of port
  wiringRules   : list of WiringRule     — pattern-based routing (see §5)
  defaultTimeout: Duration?              — default timeout for wires (see §3.3)
```

A space is a **definition** — a template for execution. It specifies
topology (stations and their wiring), subspaces, port structure, and
wiring rules. It does NOT hold a dialect or space variable values.
Those belong to the outer space (see Outer Spaces above).

When the outer application wants an actor to use a space, it creates
an outer space from the space definition, assigns a dialect, and
initializes the space variable store.


## 2. Execution: Synchronous Segments

A **synchronous segment** is a maximal sequence of pipeline steps that
contains no effectful command invocations (no async boundaries). It is
the atomic unit of execution.

### Transition relation for synchronous steps

We write:

```
(ship, σ) —[seg]→ (ship', σ')
```

to mean: executing segment seg with ship state `ship` and space variable
store `σ` (from the current outer space) produces new ship state
`ship'` and new store `σ'`.

**Pure command:**
```
  c ∈ δ.commands      (command is in the outer space's dialect)
  c is Pure(c, params, fun)
  args' = fillImplicit(args, ship.v)     — ship.v fills first unfilled param
  v' = fun(args')
  ─────────────────────────────────────────────────
  (ship, σ) —[PureCmd(c, args)]→ (ship{v := v'}, σ)
```

The implicit pipe value (ship.v) fills the first parameter of the
command that wasn't explicitly provided. This is the `|` mechanic:
`{2 | math add value 5}` means math.add receives 2 as its implicit
first param and 5 as value.

If c ∉ δ.commands, the command is not executed. A soft error is emitted
(see §4), and the pipeline value is unchanged.

**Read space variable:**
```
  v' = peek(σ(s), path)    (read current value at path — always fresh)
  ─────────────────────────────────────────────────
  (ship, σ) —[ReadSVar(s, path)]→ (ship{v := v'}, σ)
```

If s is unbound in σ, or path doesn't match, the result is the empty
value (consistent with totality — no errors, just defaults).

**Write space variable:**
```
  σ' = σ[s ↦ poke(σ(s), path, ship.v)]
  ─────────────────────────────────────────────────
  (ship, σ) —[WriteSVar(s, path)]→ (ship, σ')
```

If path is empty, this sets s directly. See §1 Path expressions for
full poke semantics: Name creates on keyed/Empty/scalar (affine only),
Pos only modifies existing, Star only modifies existing children,
Name on unkeyed lists coerces or soft errors.

**Read pipeline variable:**
```
  v' = peek(ship.env(x), path)
  ─────────────────────────────────────────────────
  (ship, σ) —[ReadPVar(x, path)]→ (ship{v := v'}, σ)
```

If x is unbound or path doesn't match, the result is empty (totality).

**Write pipeline variable:**
```
  env' = ship.env[x ↦ ship.v]
  ─────────────────────────────────────────────────
  (ship, σ) —[WritePVar(x)]→ (ship{env := env'}, σ)
```

Pipeline variable bindings are write-once within a synchronous segment
(SSA). Rebinding is a compile-time error for _vars within a segment.

**Pipe composition:**
```
  (ship, σ) —[seg₁]→ (ship₁, σ₁)
  (ship₁, σ₁) —[seg₂]→ (ship₂, σ₂)
  ─────────────────────────────────────────────────
  (ship, σ) —[seg₁ | seg₂]→ (ship₂, σ₂)
```

**Barrier pipe composition (||):**
```
  (ship, σ) —[seg₁]→ (ship₁, σ₁)
  ship₁' = ship₁{v := empty}           — next command gets empty as implicit param
  (ship₁', σ₁) —[seg₂]→ (ship₂, σ₂)    — but env (pipeline vars) is preserved
  ─────────────────────────────────────────────────
  (ship, σ) —[seg₁ || seg₂]→ (ship₂, σ₂)
```

A trailing `||` with no following segment returns empty:
```
  (ship, σ) —[seg₁]→ (ship₁, σ₁)
  ─────────────────────────────────────────────────
  (ship, σ) —[seg₁ ||]→ (ship₁{v := empty}, σ₁)
```

**Literal:**
```
  (ship, σ) —[Literal(v)]→ (ship{v := v}, σ)
```

### Block invocation by commands

A Block(daml) segment produces a suspended pipeline as a value — a
DAML string that can be passed to commands. Certain pure commands
accept block parameters and invoke them iteratively:

```
{(1 2 3) | list map block "{_value | math add value 1}"}
{$items | list reduce block "{_total | math add value _value}" with 0}
{* (:c 3 :b 2 :a 4) | >l | list keys | sort | map block "{_l.{_value}}"}
```

When a command invokes a block:

  1. The block **inherits the parent pipeline's env**. All pipeline
     variables bound before the block was invoked are available inside
     the block. This is safe because pipeline vars are write-once
     (immutable bindings) — the block gets lexical closure over
     frozen values.
  2. The command **injects scope variables** on top of the inherited
     env. Standard injected names:
       `_value`       — the current item being processed
       `_key`         — the current item's key (for keyed collections)
       `_index`       — the current item's index
       `_total`       — accumulator value (for reduce/fold)
       `_path`        — full path from root to focus, as a list
                        (for path-aware map; uses 0-indexed keys)
     Injected vars shadow parent vars of the same name.
  3. Within the block, `__in` is the block's input (typically `_value`).
     `__` is the previous pipe segment's output — at the start of the
     block, `__` equals `__in`.
  4. The block executes as a pipeline in the current outer space,
     under the current dialect, with access to space variables.
  5. The block's result is collected by the command.
  6. Pipeline vars bound inside the block (via `>x`) do NOT propagate
     back to the parent pipeline. The block's env is its own scope.

Commands that invoke blocks are still Pure if the block itself
contains only pure commands. If a block contains effectful commands,
each invocation may create async boundaries. The command's iteration
suspends at each boundary and resumes when the response arrives,
maintaining ordering.

### Atomicity guarantee

All synchronous steps within a segment execute without interleaving.
No other ship may read or write σ during a synchronous segment's
execution. This is enforced by the scheduler (§8).


## 3. Execution: Asynchronous Boundaries

An effectful command creates an **async boundary**. The ship's execution
splits into two phases: before the effect (sync) and after the response
(sync). Between these phases, other ships may execute.

### Down ports return exactly one value

A down-port round trip always produces exactly one response. This is a
design decision with several consequences:

  1. It aligns with the free monad interpretation: each effect operation
     suspends, receives one value, and continues. Single-shot continuations.
  2. It keeps the pipeline model simple: the programmer knows that after
     an effectful command, they get one value and continue. No need to
     reason about iteration or stream termination.
  3. If the Outside wants to send multiple values (a stream), it uses
     an in-port, not a down-port response. The down-port can serve as
     the trigger ("start streaming") and the in-port carries the data.

This means multi-shot continuations (nondeterminism, backtracking) are
NOT expressible via down ports. These are exotic for Daimio's use cases
(app actions, network APIs, and other CRUD are all naturally call-response).

### Effectful command execution

```
  c ∈ δ.commands       (command is in the outer space's dialect)
  c is Effectful(c, params, portType, _)
  p = resolveOrCreatePort(space, portType)    — see §5 for port resolution
  ─────────────────────────────────────────────────
  (ship, σ) —[EffCmd(c, args)]→ SUSPEND(p, ship, continuation)
```

The ship is suspended. Its pipeline variables are preserved. The
request (payload + args) is sent out through port p. The continuation
is the remainder of the pipeline after this segment.

Multiple ships may be concurrently suspended on the same port. The
runtime must correlate each incoming response to the correct suspended
ship (e.g. via request tagging). This is implementation bookkeeping,
not a semantic concern.

### Resumption

When a response arrives and the suspended ship is still waiting:

```
  resp ∈ Val
  ship' = suspended.ship{v := resp}
  ─────────────────────────────────────────────────
  RESUME(suspended, resp) → (ship', σ_current)
```

Critically: σ_current is the space variable store **at the time of
resumption**, not at the time of suspension. Space variable reads after
an async boundary see fresh values. This is the "fresh reads" rule.

### 3.3 Timeouts

Every down-port wire has a **timeout**: the maximum duration the runtime
will wait for a response before resuming the suspended ship with a
default value.

#### Timeout values

```
Wire = {
  pattern   : WiringPattern,
  target    : WiringTarget,
  timeout?  : Duration          — explicit timeout, or inherited
}
```

A wire's **nominal timeout** is determined by:
  1. Its own explicit timeout value, if set.
  2. Otherwise, inherited from the nearest enclosing wire in the
     chain that has an explicit value.
  3. If no wire in the chain has an explicit value, the system
     default of 10 seconds.

Inheritance means: if spaces are nested A > B > C > D, and the
B-A wire has timeout 30s, and C-B has no explicit timeout, then
C-B inherits 30s from B-A. If D-C is explicitly set to 20s, it
stays at 20s.

#### Effective timeout

The **effective timeout** for any down-port round trip is the
minimum of all nominal timeouts along the chain from the requesting
ship to the handler. This arises naturally from the mechanics:

If D sends a request through C through B to an external handler:
  - D-C nominal timeout: 20s
  - C-B nominal timeout: 30s (inherited from B-A)

At 20s, D-C times out. D's ship resumes with the default value.
The request is still in flight from C's perspective. If the response
arrives at 25s, C receives it but D has already moved on. C fires
a soft error and drops the response.

The key property: **an outer wire's timeout is authoritative.** No
inner wire can extend the wait time beyond what the outer wire allows.
An inner wire CAN shorten the wait by having a tighter timeout.

#### Timeout and orphaned response behavior

When a timeout fires, the suspended ship resumes with the effectful
command's default value, and a soft error is emitted. The request is
marked completed.

If a response later arrives for an already-completed request (an
**orphaned response**), it is dropped and a soft error fires in the
space where the response surfaced — not where the request originated.

#### Unwired ports

If a down port is not wired to any target (no matching wiring rule,
and no OTHER fallback), the runtime detects this immediately at
request time — no need to wait for a timeout:

```
  p has no wiring
  defaultVal = the effectful command's default value
  ─────────────────────────────────────────────────
  (ship, σ) —[EffCmd(c, args)]→ (ship{v := defaultVal}, σ)
  emit soft error: {type: "unwired_port", port: p}
```

This is synchronous — no async boundary is created, no ship is
suspended, no timeout. The pipeline continues immediately.


## 4. Errors

Daimio is total. Commands do not throw exceptions. However, certain
conditions produce **soft errors**:

```
error conditions:
  - command not in dialect (c ∉ δ.commands)
  - effectful command with unwired port (returns default, no async)
  - timeout on down-port response (returns default after elapsed time)
  - orphaned response (response arrives for already-completed request)
  - unbound space variable read (returns empty, may also emit error)
  - type mismatch in command params (command returns default value)
  - key coercion failure (non-numeric string key on unkeyed list)
  - Name poke on unkeyed list (no promotion, returns unchanged)
```

A soft error:
  1. Emits an error event as a ship to the space's error port (if wired)
  2. Does NOT halt the pipeline
  3. The pipeline continues with the empty value (which coerces to
     "", 0, or [] depending on context).

This is analogous to IEEE 754 NaN propagation: errors flow through the
pipeline as values, rather than interrupting control flow.


## 5. Ports, Wiring, and Demand-Creation

### Port resolution

When an effectful command executes, the runtime resolves its port:

```
resolveOrCreatePort(space, portType):
  if space has an existing port of type portType:
    return that port
  else:
    create a new port p of type portType, direction Down
    apply wiringRules(space) to p    — pattern match to determine handler
    add p to space.ports
    return p
```

Ports are created on demand because:
  1. Block evaluation can invoke arbitrary effectful commands at
     runtime — the effect surface isn't known until the block runs
  2. Serialized spaces loaded into sockets may have unknown effect surfaces

### Wiring rules

Wiring rules are declared in the parent space and pattern-match against
port properties:

```
WiringRule = (pattern, target, timeout?)

pattern ::= Match(properties)      — match ports with these properties
           | OTHER                  — default fallback (everything unmatched)

properties = {
  handler? : string | !string,  — e.g. user, logic, or !math (NOT math)
  method?  : string | !string,  — e.g. add, twitterpate, or !remove
  type?    : Read | Write,      — polarity of the effect
}

timeout? : Duration        — explicit timeout for this wire
                             (if absent, inherited from nearest outer
                             wire with a value, or system default 10s)
```

Property values can be negated with `!` to mean "anything except this."
Multiple properties in a single Match are conjunctive (all must hold).

Concrete syntax example:
```
S.@[handler:math]                 → match all math commands 
S.@[handler:!user type:read]      → match reads that are NOT user commands
S.@[handler:math method:fizzbuzz] → you can only fizzbuzz nothing else
```

Rules are evaluated in order. The first matching rule determines the
target. OTHER matches anything not matched by a previous rule.

The space's `defaultTimeout` (from the space definition) applies to
all wiring rules unless individually overridden.

The target of a wiring rule is one of:
  - A handler function (the actual effect implementation)
  - An up-port on a sibling subspace (the sibling provides the service)
  - A down-port on the parent space's own boundary (forwarding the
    effect outward — the parent's environment must handle it)
  - Null (/dev/null — the effect is silently swallowed, returns empty)

### Example wiring

```
Parent space A contains subspace S with a socket-in port.
A.defaultTimeout = 15s

A's wiring rules for S:
  S.@[handler:db]                → dbHandler             timeout: 30s
  S.@[handler:time]              → up-port on sibling T  (inherits 15s)
  S.@[handler:user type:write]   → dev-null              (no timeout needed)
  S.@[handler:!user type:!write] → down-port on A        (inherits 15s)
  OTHER                          → down-port on A        (inherits 15s)
```

This means: db effects are handled locally with a generous 30s timeout. (The 'db' here is for 'dragon biscuits'. Alice would never give database access to Bob, she's not daft. I mean you know what he's like.) Time effects are served by subspace T with A's default 15s, user writes are suppressed (returns empty immediately, no async), and everything else is forwarded to A's parent environment with the default timeout.

If A is itself inside a space Z, and Z's wire to A has a timeout of 10s, then the effective timeout for any round trip through A is min(A's wire timeout, Z's wire timeout). Even though A gives the db handler 30s, Z will only wait 10s for the overall round trip. If Z times out first, A's in-flight db request becomes orphaned.


## 6. Sockets and Space Serialization

### Serialized space format

A serialized space is **source DAML**. The DAML syntax already supports:
  - Station definitions with their pipelines
  - Subspace definitions (including socketed subspaces)
  - Space variable declarations with values

```
serializedSpace = DAML source text
```

The DAML source is the canonical serialization format. It includes
current space variable values (the main thing that changes between
the initial definition and a running snapshot). Socketed subspaces
are serialized as regular subspace definitions — once loaded, a
socketed space is just a subspace.

A serialized space does NOT include:
  - Dialect (the Daimio instance's dialect applies)
  - Port wiring (wiring comes from the socket's parent)

### Socket-in port

A socket is any space that has a port of flavour "socket-in".

```
socketSpace = space with at least one port where flavour = "socket-in"
```

When a serialized space arrives as a ship at a socket-in port:

```
LOAD(socketSpace, serializedSpace):
  1. Parse the DAML source into a space definition
  2. Construct a new live space from the definition
     - Build stations and internal wiring
     - Initialize space variables from values in the DAML
     - Leave ports unresolved (they will be demand-created)
  3. Install the new space as a subspace of socketSpace
  4. Apply socketSpace's wiringRules to any ports the new
     subspace creates on demand
  5. The new subspace is now live and can accept ships
```

### Socket transitions: overlap

If a previous subspace occupied this socket, the transition uses
**overlap** semantics:

```
TRANSITION(old, new):
  1. Install new subspace immediately
  2. New ships entering the socket go to the new subspace
  3. Old subspace continues processing its in-flight ships
  4. When the old subspace has no more in-flight ships and no
     pending requests, it is garbage collected
  5. Any state that needs to survive the transition must be
     stored Outside (via ports to external storage), not in
     space variables — the old subspace's variables are lost
```

This is consistent with the outer space model: if you need
persistent state across socket transitions, it lives Outside. The
socket is a hot-swappable execution slot, not a state container.

### Cross-boundary space variable access

A subspace that needs to read or write a parent's space variable
does so through an explicit effectful command and a down port:

```
{var read name :foo}     — sends a request up through a down port
{var write name :foo}    — sends a write request up through a down port
```

The parent space must wire these ports to a handler — typically a
station that reads or writes the parent's own space variables and
returns the result. This is deliberately verbose: crossing a space
boundary to access state is a significant action that should be
visible in the topology.

Syntactic sugar may be added later, but the underlying mechanism
is always a down-port round trip. This preserves the property that
spaces are fully isolated — all cross-boundary communication goes
through ports.


## 7. Block Evaluation and Programs-as-Data

There is no special "eval" mechanism. Evaluating a DAML string is
just running a pipeline. It happens constantly during normal execution:

  - `{(1 2 3) | list map block "{__ | add 1}"}` — the block is
    evaluated once per element
  - `{if $cond | then block "{do_something}" else block "{other}"}` —
    one of the blocks is evaluated
  - A ship arrives carrying a DAML string as its payload, and a
    station's pipeline runs that string as a block

In all cases, the block's pipeline executes in the current outer space,
under the outer space's dialect, with access to the outer space's
space variables. Blocks inherit the parent pipeline's env (see §2,
Block invocation). A program received as data and run as a block
inherits the env of whatever pipeline evaluates it — if there are no
pipeline vars in scope, the received program simply sees an empty env.
The execution model — segment atomicity, fresh space var reads,
effectful commands creating async boundaries — applies uniformly.

This is why dialect-per-outer-space works cleanly: there's no
question of what dialect a received program runs under. Everything
in this outer space runs under this outer space's dialect, period.
There is no mechanism for escalating or changing the dialect
mid-execution.


## 8. Scheduling and Interleaving

### The scheduler

A Daimio instance has a single scheduler. The scheduler maintains a
queue of **ready segments**: synchronous segments waiting to execute.
A segment becomes ready when:
  - A ship arrives at a station's in-port (new segment)
  - A response arrives at a down-port for a suspended ship (resumption)
  - A timeout fires for a suspended ship (timeout resumption)

### Scheduling rule

```
At each tick, the scheduler:
  1. Selects one ready segment from the queue
  2. Executes it atomically (all synchronous steps, no interleaving)
  3. If the segment ends with an effectful command:
     - Sends the request out the appropriate port
     - Places the ship in suspended state
  4. If the segment completes normally:
     - Routes the ship's output value to the next station via wiring
     - This may enqueue new ready segments (at connected stations)
```

### Interleaving properties

Because segments are atomic and the scheduler processes one per tick:

Two ships in the same Daimio instance may interleave at segment
boundaries, but never within a segment.

Other Daimio instances are completely separate processes. Daimio has
no knowledge of them and no interaction with them.

**The "don't read-then-write $var across async" warning:** if a
ship reads $foo, goes async, and writes $foo after resumption,
another ship may have modified $foo in between. This is the one
concurrency hazard in the model. It arises only from ship
interleaving across async boundaries.

This hazard is analogous to a TOCTOU (time-of-check-to-time-of-use)
race. Potential mitigations (not in the base model, possibly layered):
  - Per-ship snapshots of σ (MVCC-style, adds complexity)
  - Compare-and-swap on space variables (adds a new primitive)
  - Advisory locking (adds blocking, which we want to avoid)
  - Documentation and convention (the Daimio2 way, for now)


## 9. The Three Sendable Things

The model supports three kinds of values that can be serialized and
sent over ports, including over the network:

### Data
```
Just a Val. No behavior, no effects, no requirements.
Enters a space as a ship payload through any in-port.
The simplest case.
```

### Program
```
A pipeline, serialized as DAML source text.
Enters an outer space as a ship payload. A station's pipeline
evaluates it as a block — this is ordinary block evaluation,
not a special mechanism.
It is a free monad over the effect signature:
  - Pure commands are interpreted directly
  - Effectful commands become port requests
  - The outer space + wiring is the interpreter
Requires: the outer space's dialect must include whatever
          commands the program invokes, and port wiring must
          exist (or be demand-creatable) for any effects used.
The program is "parasitic" — it borrows everything from the host.
```

### Space
```
A serialized space, represented as DAML source text.
Enters through a socket-in port on a socket space.
It is a coalgebra — behavior with internal context:
  - Carries its own topology, programs, and state
  - Depends on the socket only for port wiring to the outside
  - Self-contained internally, dependent externally
Requires: a socket with wiring rules that cover its effect surface
          (with OTHER as a fallback for unknown effects).
The space is "self-reliant" — it brings its own context.
When loaded into a socket, it becomes a subspace of the
receiving space within the current Daimio instance.
```

The gradient of dependency:
```
  Data:    needs nothing
  Program: needs dialect + state + ports (borrows everything)
  Space:   needs port wiring + dialect assignment (brings everything else)
```


## 10. Properties of the Model

### Totality
Every command returns a value. Every port access either succeeds or
produces a soft error with the empty value. No pipeline ever crashes
or diverges (assuming commands are total, which is a requirement on
command definitions). The empty value coerces to "", 0, or [] as
needed, so it always flows cleanly through subsequent commands.

### Actor isolation
A Daimio instance is a single outer space. It has no knowledge of
other instances. "Actor isolation" is not a property Daimio enforces —
it's a consequence of the outer application creating separate Daimio
instances. Inter-actor communication is entirely the outer application's
concern, mediated by external systems (databases, CRDTs, etc.).

### Effect locality
Effects only occur at the outside of the outermost space. Every
effectful command invocation within a space produces a port request.
Port requests propagate outward (via down-port forwarding through
parent spaces) until they reach the outermost space, where real effects
occur. Any intermediate space can intercept and handle the request
(via up-port wiring to a subspace or a local handler), which is how
testing, mocking, and simulation work.

### Segment atomicity
Within a synchronous segment, space variable access is consistent (no
interleaving). Across async boundaries, freshness is guaranteed but
consistency is not (another ship may have written between suspension
and resumption).

### Port demand-creation
The effect surface of a Daimio instance is not fully fixed at
construction time. Ports are created when first needed and wired
according to the parent space's rules. This supports block evaluation
and socket loading without requiring static knowledge of all possible
effects.

### Composition
Spaces compose by nesting. A subspace's effect surface becomes
obligations on the parent. The parent either handles them, forwards
them to its own boundary, or swallows them. This composes recursively
to arbitrary depth.

### Liveness
No ship is suspended forever. Every down-port request has a finite
timeout (explicit, inherited, or the 10s system default). When the
timeout fires, the ship resumes with a default value. Unwired ports
return the default immediately with no async boundary at all. This
guarantees that every ship eventually completes its pipeline, modulo
the totality of the pipeline's pure computation.

### Timeout compositionality
The effective timeout for a request chain is the minimum of all
timeouts along the chain. Outer spaces' timeouts are authoritative:
no inner wire can extend the wait time beyond what an outer wire
allows. Inner wires can only shorten it. This means the socket owner
always controls the maximum wait time for anything loaded into their
socket.


## 11. Design Decisions Record

Decisions made during the formalization process, with rationale.

### D1: Dialect is per Daimio instance
A Daimio instance runs under one dialect. All execution within the
instance is constrained to that dialect. Ships do not carry dialects —
they carry payload and pipeline variables only.

### D2: Actor isolation via separate Daimio instances
Each actor gets their own Daimio instance. Daimio has no concept of
other instances — from its perspective, there is one outer space,
period. The outer application creates and manages instances. Inter-actor
communication is entirely outside Daimio's scope.

### D3: Space variable reads are always fresh
Every reference to $foo reads the current value at that moment in
execution. Values are not cached across async boundaries. Pipeline
vars (_foo) are the mechanism for preserving values across async
boundaries. Mental model: "pipeline vars are yours, space vars are
the room's."

### D4: Down ports return exactly one value
A down-port round trip always produces exactly one response. This
aligns with free monad semantics (single-shot continuations), keeps
the pipeline model simple, and avoids the need for stream termination
logic in pipelines. Streams use in-ports instead.

### D5: Request correlation
Multiple concurrent requests can flow through the same down port.
The runtime must correlate responses to their originating requests
so that each suspended ship resumes with the correct value. Late
or orphaned responses are dropped with a soft error. The correlation
mechanism (e.g. request tagging) is an implementation detail.

### D6: Cascading timeouts with outer-wins semantics
Every down-port wire has a timeout (explicit, inherited from nearest
outer wire, or system default 10s). The effective timeout for any
request chain is the minimum along the chain. Outer timeouts are
authoritative — inner wires cannot extend the wait time. This
guarantees liveness and gives socket owners control over latency
bounds for anything loaded into their socket.

### D7: Soft errors for all failure modes
Timeouts, orphaned responses, unwired ports, dialect violations,
and type mismatches all produce soft errors: an event to the error
port, a default value in the pipeline, and continued execution.
No pipeline ever crashes. Consistent with Daimio's totality
principle.

### D8: Socket transitions use overlap
When a new space is loaded into an occupied socket, the new space
starts accepting ships immediately while the old space drains its
in-flight work. State that must survive transitions lives Outside.
This is consistent with the outer space model and avoids blocking
on potentially long-running in-flight operations.

### D9: Cross-boundary state access is explicit
A subspace reads a parent's space variable via an effectful command
like {var read name :foo}, which goes through a down port. The
parent must wire that port to a handler. This is deliberately
verbose — crossing a space boundary is a significant action.
Sugar may be added later.

### D10: Serialization format is DAML source
A serialized space is DAML source text. The existing syntax already
supports station definitions, subspace definitions (including
socketed ones), and space variable declarations with values. No
separate binary format or manifest is needed.

### D11: Energy/resource limits are per Daimio instance
Resource measurement (CPU, memory) is per Daimio instance.
Enforcement is delegated to the outer application. Suspended
ships do not consume CPU while waiting (though they consume
memory). The outer app may monitor total resource usage per
instance.

### D12: No special eval mechanism
Evaluating a DAML string is just running a pipeline. Block evaluation
in map/fold/if, and running a program received as data, are the same
operation. Everything in an outer space runs under that outer space's
dialect. There is no privilege escalation during execution.

### D13: Dialects include aliases
A dialect is not just a command set — it also includes compile-time
aliases (name → pipeline expansions). Restricting a dialect may
remove aliases as well as commands. Aliases are purely syntactic
and expand before execution.

### D14: Values have copy semantics
Values flowing through pipelines are functionally pure from the
programmer's perspective. Commands receive copies; mutations don't
propagate back. Implementations may optimize with mutation when no
future references exist (linear types style).

### D15: Paths follow optics semantics with four operations
Four path operations: peek (get), poke (set), map (over), delete.
All share the same selector language. Name is the only selector
that creates in poke — on keyed collections, Empty, and scalars
(affine only; traversal through Star skips scalars). Pos never
creates. Star never creates. Delete changes shape (splice
semantics); Par-delete uses collect-then-remove to handle index
shifting, unlike Par-poke/Par-map which are sequential. Pos is
1-indexed; key access is 0-indexed. Key coercion: string keys on
unkeyed lists coerce to nat or soft error.

### D16: The empty value coerces by context
The empty value is not a distinct type — it becomes "", 0, or []
depending on what the consuming command expects. This is what makes
totality practical: a failed path access, unbound variable, or
timed-out effect produces a value that flows through subsequent
commands without special handling.

### D17: `||` barrier blocks implicit parameter filling
The double pipe clears the implicit pipe value so the next command's
first parameter isn't auto-filled. Pipeline variables (`_foo`) still
cross the barrier. A trailing `||` causes the pipeline to return empty.
This enables running independent computations in sequence within one
pipeline, stashing results in pipeline vars, and suppressing output
in templating contexts.

### D18: Blocks inherit parent pipeline vars
Inner blocks get lexical closure over the parent pipeline's env.
This is safe because pipeline vars are write-once (immutable
bindings). Vars bound inside the block don't propagate back.
This eliminates the need for explicit `with` params in the common
case of accessing outer variables from inner blocks.