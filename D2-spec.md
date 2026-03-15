# Daimio2: Formal Execution Model

## 0. Prelude

DAML (Daimio Ain't Markup Language, aka Drat Another Markup Language, aka Dragon Ate My Lambdas) is a templating language. A DAML source string is a mix of literal text and command invocations delimited by curly braces. Literal text passes through unchanged; commands are evaluated and their results are interpolated into the output. And then we eat lunch.

TODO: put more text here

## 1. Concrete Syntax

### Grammar

```
daml       ::= (text | command | namedblock)*

text       ::= any characters not consumed by a command or namedblock
                (including unmatched '}')

command    ::= '{' pipeline '}'

namedblock ::= '{begin' name (pipe pipeline)? '}' daml '{end' name '}'

— Parsing algorithm —

Parsing is left-to-right.

Scan: when the parser encounters '{', it scans forward counting
'{' (+1) and '}' (-1) to find the balanced closing '}'. Matching
is purely structural: quotes and other content are not considered.
If no balanced '}' is found, the '{' is literal text and scanning
continues from the next character.

Classify: when a balanced span '{...}' is found:

  1. If the span begins with '{begin NAME' (where NAME is one or
     more word characters), scan forward from end of span for the literal string
     '{end NAME}'. If found, the entire stretch from '{begin'
     through '{end NAME}' is a namedblock.

  2. Otherwise the span is a command. (This includes '{begin
     NAME...}' when no matching '{end NAME}' is found.)

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

path       ::= ('.' selector)*          - NB paths can also be expressed as lists
selector   ::= name                     — Key: a key: .foo, 12
             | '#' integer              — Pos: a positional (1-based) index: .#1, .#-1
             | '*'                      — star: all children
             | '(' path+ ')'            — par: multiple paths gathered
```

TODO: right now, inside a dot-path Par only works in curlies.

### The implicit pipe value

TODO: move this and the remaining subsections out of Grammar, they don't really belong here

The `|` operator sequences segments. It also automatically **fills a parameter** of the next command. The first unfilled parameter takes the previous segment's output.
This is the core pipe mechanic:

```
{3 | math add to 5}
```

Here the value `3` flows in to the `value` parameter of `math add`, producing `8`. The flowing value is never named, it's injected automatically into the first unnamed parameter.

```
{2 | list range}
{2 | list range length 3}
{2 | list range length 3 start 4}
```

Note that **parameter ordering** is important.
The command `list range` is defined with parameters `length`, `start`, and `step`, in that order. In the first example, the `length` parameter is filled by `2`, yielding `(1 2)`. In the second the `start` parameter is the first unfilled parameter by definition order, so it takes the `2`, yielding `(2 3 4)`. Only after the first two parameters are explicitly filled is the `2` finally allowed to infest `step`, producing `(4 6 8)`.

```
{2 |  list range length 3 step __}
{2 || list range length 3 step __}
```

What if you want to fill the `step` parameter? The implicit value is also available explicitly as `__`. In the first example `step` is explicitly taking the previous pipe's value -- but `start` is also taking the implicit piped value, yielding `(2 4 6)`.

Astute readers will have noticed the subtle difference in the second example. The `||` construction blocks the implicit value from flowing through, while still allowing the previous segment's value to be referenced explicitly. Here `step` receives `2` but `start` is unfilled, yielding `(1 3 5)`. This is useful when you want to set a specific parameter explicitly without filling any others implicitly.


```
{( 1 2 3 ) | map block "{__ | add 1 | add __in | add __}"}
```

Pipelines can also take an initial input value, for instance when used as part of a block applied to data, as in this example.
This does not implicitly fill a parameter in the first segment of the pipeline, but is accessible by `__`.
It is also accessible as `__in` within any segment in that pipeline -- a fixed value, unlike `__`, which updates after each segment.
Note that `__` is the only pipeline variable that updates inside a pipeline.
All other `_` vars are single-assignment (they actually get compiled down to wiring).
This example takes the input value, adds 1, adds the input value again, and then adds that value to itself, yielding `(6 10 14)`.



TODO: move this to a command semantics section

```
{math subtract value 5 from 8}
{math subtract from 8 value 5}
```

Note that **parameter ordering** is unimportant.
The command `math subtract` has the form `math subtract value _x from _y`, but those parameters can be specified in either order. The ordering in the command's definition is only relevant for the implicit value carried through the pipe.



### Variables and scope

```
__         — the implicit pipe value (injected by runtime)
__in       — the input to the current pipeline/block (injected by runtime)
_foo       — pipeline variable (set with >foo)
$foo       — space variable (set with >$foo)
```

**Scope hierarchy:**
- `__`   — previous segment value: resets each segment
- `_foo` — pipeline variable: local to the pipeline; inherited by child blocks, but pvars set inside a block don't propagate back out
- `$foo` — space variable: available within all pipelines in the same space

### The `||` barrier

TODO: sort out the pipeline vs block verbage...

TODO: merge this with the previous || treatment, move out of concrete syntax section

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

### Blocks

A block is a quoted DAML string — a program as a value. There are
two syntactic forms, but they produce the same thing:

```
"{__ | add 1}"                       — quoted block (inline)
{begin foo}Hello, {name}!{end foo}   — named block (multi-line friendly)
```

Both are parsed into the same Block segment via the same code path.
A quoted block is DAML wrapped in quotes. A named block is syntactic
sugar: the parser transforms `{begin foo | cmd}body{end foo}` into
a pipeline where the body becomes a quoted block passed as the first
value to `cmd`. The name exists only for matching the end tag and
readability.

Named blocks do not automatically create a variable or squelch
output. To save one for reuse, pipe it explicitly:

```
{begin greeting | >$greeting ||}
  Hello, {__.name}! You have {__.count} rice balls.
{end greeting}

{$user | run block $greeting}
```

### Concrete examples

TODO: it's nice to have some concrete examples of the grammar -- but then put these closer to the grammar!

```
{3 | math add value 2}                           — pure command: 5
{(1 2 3) | list map block "{__ | math add value 1}"}  — [2, 3, 4]
{$user.name | string uppercase}                  — path + command
{>x | user fetch id :bob | _x}                   — save, effect, restore
{:hello | >@spaceout}                            — send to space port
{begin roe}{$name}: {$score}{end roe}            — named template block
{$count | >@notify ||}                           — side effects, no output
```



## 2. Domains

### Values
```
v ∈ Val       — numbers, strings, lists (the single universal collection)
```

Values are the single data type. A collection is a universal data
structure that supports ordered access (by position), keyed access
(by string key), and nesting (values can contain other values to
arbitrary depth).

### Collections: keyed and unkeyed

A collection's entries may be keyed, unkeyed, or a mix.

```
(1 2 3)            — unkeyed (positional only)
{* (:a 1 :b 2)}   — keyed (string keys; `*` is an alias for `list pair`)
```

Ideally, the distinction would be invisible to the end user: anything
you want to do with a collection, you should be able to do. Achieving
this idyll is non-trivial. There are sharp edges on interop and
serialization, complexity and performance concerns, and a host of
other dimensions that make up a fairly rich tradeoff space. Daimio
makes decisions that have been generously labelled "quirky", but for
all their edges they do have a genuine aesthetic at work. Keep things
simple: the user's mental model, the formal model, the code itself.
Roughly in that order. And if you can't make it simple, at least make
it interesting. If you're going to be surprised anyway, let's aim for
a whimsical surprise. That's the Daimio way.

The distinction matters in three places:

- **Poke:** Key can create new entries on keyed collections but not
  on unkeyed ones. Key poke on an unkeyed list either coerces the
  key to a numeric index or soft errors (see Key coercion in Path
  expressions).
- **Key coercion:** when a Key selector hits an unkeyed list, string
  keys are coerced to natural numbers for 0-indexed access. On keyed
  lists, number keys are treated as strings. The full rules are in
  Path expressions below.
- **Conversion:** switching between keyed and unkeyed is explicit:
  ```
  {* (:a 1 :b 2) | list values}    — keyed → unkeyed: drops keys
  {(1 2) | list rekey}              — unkeyed → keyed: index strings as keys
  ```

Most other operations (peek, map, delete, iteration) work uniformly
on both keyed and unkeyed collections.

### The empty value

The empty value is the identity element. It coerces based on context:
`""` when used as a string, `0` when used as a number, `[]` when used
as a list. This is why totality works without error values — a missing
path, an unbound variable, or a timed-out effect all produce the empty
value, which becomes whatever zero the consuming command expects.

TODO: this is the first mention of totality, seems weird. We should introduce it better.

### Value semantics

Values flowing through pipelines have copy semantics at command
boundaries. A command receives its own copy of any collection it
intends to mutate. The original value in the pipeline is not affected.
From the programmer's perspective, pipeline flow is functionally pure.
Implementations may use mutation internally for efficiency (e.g.
linear types style optimization when no future references exist).

### Sendability and the gradient of dependency

Three kinds of values can be serialized and sent over ports,
including over the network. They differ in what they need from
the receiving environment:

- **Data** — just a Val. No behavior, no effects, no requirements.
  Enters a space as a ship payload through any in-port.
- **Program** — a pipeline as DAML source text. Needs dialect +
  state + ports from the host (see Programs below). The program
  is "parasitic" — it borrows everything.
- **Space** — a serialized space as DAML source text. Needs port
  wiring + dialect from the parent (see Spaces below). The space
  is "self-reliant" — it brings its own programs and state.

### Path expressions and accessors

A path is a sequence of selectors applied to a Val to access nested
structure. Paths appear in variable access (`$user.name`, `_x.#1.items`)
and in the four path operations: peek, poke, map, delete.

#### Selectors

Key and Pos are **affine** — they focus on at most one location.

Star is a **traversal** — it focuses on all existing children.

Par is a **multiplexer** — it maps an operation across multiple paths.
Each sub-path carries its own semantics.

**Pos is 1-indexed.** `#1` is first element, `#-1` is last. Pos works
on both keyed and unkeyed collections (keyed collections are accessed
by insertion order).

**Key access is 0-indexed.** Key with a numeric string on an unkeyed
list uses 0-based indexing (see Key coercion below).

#### Key coercion

Keys in paths may be strings or numbers. Coercion depends on the
target collection:

```
String key on unkeyed list:  coerce to nat using (x|0) === +x
                              if success: 0-indexed array access
                              if failure: soft error

Number key on keyed list:    treat as string

Number key on unkeyed list:  0-indexed array access

String key on keyed list:    normal key lookup
```

Examples:
```
peek([10,20,30], ["#2"])      →  20    (Pos, 1-indexed)
peek([10,20,30], [2])         →  30    (number key, 0-indexed)
peek([10,20,30], ["2"])       →  30    (string coerced to nat, 0-indexed)
peek([10,20,30], ["a"])       →  ""    (soft error: can't coerce)
peek({a:1, "2":99}, [2])      →  99    (number key on object, as string "2")
peek({a:1, b:2, c:3}, ["#2"]) →  2     (Pos on keyed list, by insertion order)
```

#### The four path operations

All four share the same path language.

| Operation | Creates structure? | Changes shape? | Optics analog |
|---|---|---|---|
| **peek** | No | No | get / view |
| **poke** | Yes (Key only) | No | set / put |
| **map** | No | No | over |
| **delete** | No | Yes | — |

TODO: the above table says map does not create structure, and does not change shape. are those things really true? what exactly do they mean in this context?

#### Peek (read)

```
peek(v, []) = v

peek(Collection, Key(s) :: rest)  =  peek(v[s], rest)      — or Empty
peek(Collection, Pos(n)  :: rest) =  peek(v at n, rest)    — or Empty
peek(Collection, Star :: rest)    = [peek(child, rest) for child in children(v)]
peek(Collection, Par(ps) :: rest) = [peek(v, p ++ rest) for p in ps]

peek(scalar, _ :: _) = Empty              — no navigation into scalars
peek(Empty, _ :: _)  = Empty
```

**No scalar wrapping.** Applying any non-empty path to a scalar
always yields Empty.

**Return type is path-dependent:** if any selector in the path is
Star or Par, the result is always a list (even if empty: `[]`).
If all selectors are affine (Key or Pos), the result is a single
value or Empty. The caller can predict the return shape from the
path alone, regardless of data.
TODO: note that a value can be a list -- this is about the wrapping

#### Poke (write)

Poke writes a constant value at a path. **Only Key creates new
structure.** Everything else modifies in place or soft errors and
is a no-op.
TODO: aka sploots

```
poke(v, [], new) = new                    — replace entirely
```
TODO: should poke really replace it entirely? it currently appends. I'm still not sure which is right.

**Key** — creates on keyed collections, Empty, and scalars:

```
poke(KeyedCollection, Key(s) :: rest, new) =
  if key s exists: update val with poke(val, rest, new)
  else:            add entry (key=s, val=poke(Empty, rest, new))

poke(UnkeyedCollection, Key(s) :: rest, new) =
  apply key coercion; if s coerces to nat, update that element
  otherwise: soft error, return unchanged (no promotion)

poke(Empty, Key(s) :: rest, new) =
  create KeyedCollection with (key=s, val=poke(Empty, rest, new))

poke(scalar, Key(s) :: rest, new) =
  if affine path (no Star): poke(Empty, Key(s) :: rest, new)
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
TODO: does this really happen based on overall path, or just based on current segment? which of those should it be?

  - **Affine:** Key replaces the scalar and continues.
    `poke({x: 42}, [:x, :a], 99)` → `{x: {a: 99}}`
  - **Traversal:** scalar children are skipped.
    `poke([1, 2, 3], ["*", :a], 99)` → `[1, 2, 3]`

#### Map (transform at focus)

Map applies a block to each value at a path focus. **Map never
creates structure** (it doesn't add keys or extend collections).
However, map **will overwrite scalars with structure** if the block
returns a complex value. If the path doesn't reach any focus, the
structure is returned unchanged.

TODO: it seems a little wrong to say Map never creates structure. It will have happily add a deeper structure, e.g. : `{(1 2) | list map block (3 4)}`
TODO: In other places it says poke doesn't create structure, but poke definitely creates new keys


```
map(v, [], block) = block(v)

map(Collection, Key(s) :: rest, block) =
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

delete(KeyedCollection, Key(s) :: []) =
  remove entry with key s (no-op if missing)

delete(UnkeyedCollection, Key(s) :: []) =
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
once (in reverse index order, for positional deletes to preserve
correctness as indices shift).

This differs from Par-poke and Par-map, which are sequential. Both poke and map preserve collection shape, so sequential
application over non-overlapping paths is equivalent to parallel.
Delete changes shape — sequential positional deletes shift indices
between steps, causing later sub-paths to target wrong positions.
We accept the asymmetry because it is justified by the operations'
different relationship to shape.

TODO: shape the above statement a bit better.
TODO: whta about overlapping paths? what if the first par path pokes a shape in that the second par path follows? how is that handled currently?

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

TODO: add other `list` methods? why just these?
TODO: these are mostly other places do we need this table?

TODO: I think the paragraph below is repeated elsewhere:
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

GetPut holds except when Key creates a new entry.

PutGet holds when poke actually writes. Fails on no-ops (out-of-bounds
Pos, Key soft error on unkeyed) and on traversal scalar skips.

DeleteGet holds when delete actually removed something.

PokeAsMap holds when both would write. Diverges when focus doesn't
exist: poke creates (via Key), map skips. Also diverges on traversal
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

### Programs

A program is a pipeline, serialized as DAML source text. It enters
an outer space as a ship payload. A station's process may evaluate it
as a block, through the ordinary block evaluation mechanisms like
`process run`, thereby creating a sub-process.

Formally, a program is a **free monad over the effect signature,
composed with a state monad** for space variables:

  - **State monad**: pure commands and space variable access are
    synchronous state transitions: `(process, σ) → (process', σ')`.
    This includes block evaluation — commands like `list map` and
    `process run` create sub-processes that execute as nested state
    transitions, sharing σ with the parent process.
  - **Free monad**: effectful commands cause the process to wait,
    producing port requests. Each request is an abstract operation
    with a single-shot continuation. The outer space + wiring
    interprets these operations by routing requests to handlers.

Under the current serial scheduling model (§9), each process has
exclusive access to σ for its entire lifetime. This is what makes
the composed model clean: the state transitions are deterministic,
because no other process can modify σ between your segments.
Without serial execution, σ could change nondeterministically
between async boundaries, and the state monad composition would
break down (see `D2-concurrent-scheduling.md`).

One caveat: the effect surface is not statically fixed. Block
evaluation can invoke arbitrary effectful commands determined at
runtime. This means the free monad is over an open effect
signature — the set of possible effects isn't known until the
block runs. Daimio handles this through demand-created ports and
wiring rules with OTHER fallbacks (§6).

Requires: the outer space's dialect must include whatever commands
the program invokes, and port wiring must exist (or be
demand-creatable) for any effects used.

### Ships
```
ship ∈ Val                — a value in transit between ports
```

A ship is a value being ferried between ports. It is just data — it
carries no execution state, no pipeline variables, no dialect. When a
ship arrives at a station's in-port, a process is created to handle
it (see Processes below). When a process completes, it sends its
result as a ship through the station's out-port. A single process
may send multiple ships to different ports during its execution
(via `>@portname`), and soft errors send ships to the error port.

### Blocks
```
block = (segments, wiring)
  where segments : [Segment]         — the compiled pipeline steps
        wiring   : key → [key]       — data flow between segments
```

A block is a compiled DAML template. It holds an array of segments
(literal text, commands, variable reads/writes, etc.) and a wiring
map that describes data flow between them. A station has one block.
Blocks can also be passed as values to commands (`list map`,
`process run`, `if then`, etc.) and evaluated later.

### Processes
```
process = (space, block, state, pipeline_vars, current, asynced)
  where space         : Space          — the enclosing space
        block         : Block          — the block being executed
        state         : key → Val      — segment outputs and scope vars
        pipeline_vars : PVar → Val     — pipeline variable bindings
        current       : int            — current segment index
        asynced       : bool           — waiting for async response?
```

A process is the unit of execution. It is created when a ship docks
at a station, and destroyed when the block completes. A process
executes its block's segments sequentially, maintaining pipeline
variable bindings and tracking its position.

**Pipeline variable scope:** pipeline variables are write-once and
scoped to a single process. When a block is evaluated by a command
(like `list map`), a **sub-process** is created that inherits a
copy of the parent's pipeline vars — all the parent's vars are
readable inside the block. But vars bound inside the block (via
`>x`) do not propagate back to the parent. The inheritance is
one-way: parent → child, never child → parent.

**Sub-processes** are synchronous and depth-first. When a command
evaluates a block, the sub-process runs to completion (or suspends)
before the parent process continues. Sub-processes can nest to
arbitrary depth. Each sub-process runs in the same space and has
access to the same σ (space variables).

**Async boundaries:** pipeline variables survive across async
boundaries within the same process. If a process waits at an
effectful command and later resumes, its pipeline vars are intact.
But they don't escape the process that created them.

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
            parent space's wiring declarations (see §6)
```

### Spaces
```
space = (stations, subspaces, ports, wiringRules, defaultTimeout?)

  stations      : name → station
  subspaces     : name → space
  ports         : set of port
  wiringRules   : list of WiringRule     — pattern-based routing (see §6)
  defaultTimeout: Duration?              — default timeout for wires (see §4.3)
```

A space is a **definition** — a template for execution. It specifies
topology (stations and their wiring), subspaces, port structure, and
wiring rules. It does NOT hold a dialect or space variable values.
Those belong to the outer space (see Outer Spaces above).

When the outer application wants an actor to use a space, it creates
an outer space from the space definition, assigns a dialect, and
initializes the space variable store.

Externally, a space is a **reactive automaton** (Mealy machine):
it accepts ships at in-ports, produces ships at out-ports, and
maintains internal state (σ) between interactions. The parent
cannot observe or modify the internal state — only the port
interface is visible. This external view is coalgebraic:
`S → (Input → Output × S)`.

However, the transition function is not a pure function — it may
invoke effectful commands, which produce down-port requests that
cause the process to wait until a response arrives. Internally,
each station's block is a program (free monad over effects + state
monad, as described in Programs above). When a ship docks at a
station, a process is created to execute the station's block.
The full picture is: a reactive automaton whose transitions are
effectful programs, executed one at a time (§9).

A space processes **one ship at a time**. When a ship arrives at
a busy space, it is queued. Processes (including sub-processes
from block evaluation) have exclusive access to σ for their
entire lifetime. See §9 for the full scheduling model.

A space carries its own topology, stations, and state. It depends
on the parent for two things:
  - **Port wiring**: the parent's wiring rules determine how
    the space's down-port requests are handled (§6)
  - **Dialect**: the parent assigns the dialect that governs
    which commands are available inside the space

The space is "self-reliant" — it brings its own programs and
state. But it is not self-sufficient: without wiring, its effects
go nowhere, and without a dialect, its commands don't execute.

Spaces can also be serialized as DAML source text and loaded into
sockets at runtime. Socketed spaces have additional properties
around loading, transitions, and state ephemerality — see §7.


## 3. Execution: Synchronous Segments

A **synchronous segment** is a maximal sequence of pipeline steps that
contains no effectful command invocations (no async boundaries). It is
the atomic unit of execution.

### Transition relation for synchronous steps

We write:

```
(process, σ) —[seg]→ (process', σ')
```

to mean: executing segment seg with process state `process` and
space variable store `σ` produces new process state `process'` and
new store `σ'`. Here `process.v` is the current pipeline value and
`process.env` is the pipeline variable bindings.

**Pure command:**
```
  c ∈ δ.commands      (command is in the outer space's dialect)
  c is Pure(c, params, fun)
  args' = fillImplicit(args, process.v)     — process.v fills first unfilled param
  v' = fun(args')
  ─────────────────────────────────────────────────
  (process, σ) —[PureCmd(c, args)]→ (process{v := v'}, σ)
```

**Parameter filling** (`fillImplicit`) works in two passes:

  1. **Explicit params** are matched by name. `{math add value 5 to 3}`
     binds `value=5` and `to=3` regardless of definition order.
  2. **The implicit pipe value** (process.v) fills the first parameter
     (by definition order) that was not explicitly provided. This
     happens at most once — only the first unfilled param receives it.
     `{2 | math add value 5}` means math.add receives 2 as its
     implicit first param and 5 as value.

**Type coercion** is applied to each parameter value based on the
param's declared type. Each type has a coercion function:

```
list     — scalars wrap to single-element list; empty → []
string   — numbers stringify; empty → ""
number   — strings coerce numerically; empty → 0
integer  — like number, then rounded
block    — DAML string becomes an evaluable block
anything — passed through (with empty normalization)
```

This means passing `"hi"` to a param of type `list` produces
`("hi")`, not a type error. Coercion is total — it always
produces a value of the expected type.

**Required params:** if a param is marked `required` and receives
no value (not from explicit naming, not from implicit pipe filling,
and no fallback defined), the command is not executed. A soft error
is emitted and the pipeline continues with the empty value.

**Dialect check:** if c ∉ δ.commands, the command is not executed.
A soft error is emitted (see §5), and the pipeline value is unchanged.

**Read space variable:**
```
  v' = peek(σ(s), path)    (read current value at path — always fresh)
  ─────────────────────────────────────────────────
  (process, σ) —[ReadSVar(s, path)]→ (process{v := v'}, σ)
```

If s is unbound in σ, or path doesn't match, the result is the empty
value (consistent with totality — no errors, just defaults).

**Write space variable:**
```
  σ' = σ[s ↦ poke(σ(s), path, process.v)]
  ─────────────────────────────────────────────────
  (process, σ) —[WriteSVar(s, path)]→ (process, σ')
```

If path is empty, this sets s directly. See §2 Path expressions for
full poke semantics: Key creates on keyed/Empty/scalar (affine only),
Pos only modifies existing, Star only modifies existing children,
Key on unkeyed lists coerces or soft errors.

**Read pipeline variable:**
```
  v' = peek(process.env(x), path)
  ─────────────────────────────────────────────────
  (process, σ) —[ReadPVar(x, path)]→ (process{v := v'}, σ)
```

If x is unbound or path doesn't match, the result is empty (totality).

**Write pipeline variable:**
```
  env' = process.env[x ↦ process.v]
  ─────────────────────────────────────────────────
  (process, σ) —[WritePVar(x)]→ (process{env := env'}, σ)
```

Pipeline variable bindings are write-once within a synchronous segment
(SSA). Rebinding is a compile-time error for _vars within a segment.

**Pipe composition:**
```
  (process, σ) —[seg₁]→ (process₁, σ₁)
  (process₁, σ₁) —[seg₂]→ (process₂, σ₂)
  ─────────────────────────────────────────────────
  (process, σ) —[seg₁ | seg₂]→ (process₂, σ₂)
```

**Barrier pipe composition (||):**
```
  (process, σ) —[seg₁]→ (process₁, σ₁)
  process₁' = process₁{v := empty}      — next command gets empty as implicit param
  (process₁', σ₁) —[seg₂]→ (process₂, σ₂)  — but env (pipeline vars) is preserved
  ─────────────────────────────────────────────────
  (process, σ) —[seg₁ || seg₂]→ (process₂, σ₂)
```

A trailing `||` with no following segment returns empty:
```
  (process, σ) —[seg₁]→ (process₁, σ₁)
  ─────────────────────────────────────────────────
  (process, σ) —[seg₁ ||]→ (process₁{v := empty}, σ₁)
```

**Literal:**
```
  (process, σ) —[Literal(v)]→ (process{v := v}, σ)
```

### Block invocation

A Block segment produces a DAML string as a value. Commands that
accept block parameters (`list map`, `list reduce`, `if then`, etc.)
evaluate the block by creating a **sub-process**. There is no special
"eval" mechanism — evaluating a block IS creating a sub-process that
runs the block, subject to the same rules as any other process.
Sub-processes are synchronous and depth-first: the parent process
waits for the sub-process to complete before continuing.

```
{(1 2 3) | list map block "{__ | math add value 1}"}
{$items | list reduce block "{_total | math add value _value}" with 0}
```

A program received as data (a ship carrying a DAML string) is
evaluated the same way — it's a block that gets run by a sub-process.

**Scope** when a command creates a sub-process for a block:

  1. The sub-process **inherits the parent's pipeline vars**. All
     pipeline variables bound before the block was invoked are
     readable inside. This is safe because pipeline vars are
     write-once — the sub-process gets a copy of frozen values.
  2. The command **injects scope variables** on top of the inherited
     vars. Standard injected names:
       `_value`       — the current item being processed
       `_key`         — the current item's key (for keyed collections)
       `_index`       — the current item's index
       `_total`       — accumulator value (for reduce/fold)
     Injected vars shadow parent vars of the same name.
  3. `__in` is the sub-process's input (typically `_value`). `__` is
     the previous pipe segment's output — at the start, `__ = __in`.
  4. The sub-process executes in the same space as the parent, under
     the same dialect, with access to the same space variables (σ).
  5. Pipeline vars bound inside the sub-process (via `>x`) do NOT
     propagate back to the parent. The sub-process's env is its own.

Everything in an outer space runs under that outer space's dialect,
period. There is no mechanism for escalating or changing the dialect
mid-execution. A program received as data inherits the pipeline vars
of whatever process evaluates it — if there are no pipeline vars in
scope, it simply sees an empty env.

### Atomicity guarantee

A space processes one ship at a time (§9). The active process has
exclusive access to σ for its entire lifetime — not just within a
synchronous segment, but across async boundaries as well. No other
process may read or write σ while the active process exists.

#### Pipeline Segments
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


## 4. Execution: Asynchronous Boundaries

An effectful command creates an **async boundary**. The process's
execution splits into two phases: before the effect (sync) and after
the response (sync). The process waits for the response; under the
current serial model (§9), the space remains busy during the wait.

### Down ports return exactly one value

A down-port round trip always produces exactly one response. This is a
design decision with several consequences:

  1. It aligns with the free monad interpretation: each effect operation
     waits, receives one value, and continues. Single-shot continuations.
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
  p = resolveOrCreatePort(space, portType)    — see §6 for port resolution
  ─────────────────────────────────────────────────
  (process, σ) —[EffCmd(c, args)]→ WAIT(p, process, continuation)
```

The process waits. Its pipeline variables are preserved. The request
(payload + args) is sent out through port p. The continuation is the
remainder of the block after this segment.

### Resumption

When a response arrives for a waiting process:

```
  resp ∈ Val
  process' = waiting.process{v := resp}
  ─────────────────────────────────────────────────
  RESUME(waiting, resp) → (process', σ_current)
```

Under the current serial model, σ_current is guaranteed to be
unchanged from the time of waiting — no other process can modify σ
while this process holds the space. The "fresh reads" property is
trivially satisfied (see §10).

### 4.3 Timeouts

Every down-port wire has a **timeout**: the maximum duration the runtime
will wait for a response before resuming the waiting process with a
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
process to the handler. This arises naturally from the mechanics:

If D sends a request through C through B to an external handler:
  - D-C nominal timeout: 20s
  - C-B nominal timeout: 30s (inherited from B-A)

At 20s, D-C times out. D's process resumes with the default value.
The request is still in flight from C's perspective. If the response
arrives at 25s, C receives it but D has already moved on. C fires
a soft error and drops the response.

The key property: **an outer wire's timeout is authoritative.** No
inner wire can extend the wait time beyond what the outer wire allows.
An inner wire CAN shorten the wait by having a tighter timeout.

#### Timeout and orphaned response behavior

When a timeout fires, the waiting process resumes with the effectful
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
  (process, σ) —[EffCmd(c, args)]→ (process{v := defaultVal}, σ)
  emit soft error: {type: "unwired_port", port: p}
```

This is synchronous — no async boundary is created, the process does
not wait, no timeout. The pipeline continues immediately.


## 5. Errors

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
  - Key poke on unkeyed list (no promotion, returns unchanged)
```

A soft error:
  1. Emits an error event as a ship to the space's error port (if wired)
  2. Does NOT halt the pipeline
  3. The pipeline continues with the empty value (which coerces to
     "", 0, or [] depending on context).

This is analogous to IEEE 754 NaN propagation: errors flow through the
pipeline as values, rather than interrupting control flow.


## 6. Ports, Wiring, and Demand-Creation

### Port resolution

When an effectful command executes, the runtime resolves its port:

```
resolveOrCreatePort(space, portType)
  where portType ∈ space.ports = existing port of that type

resolveOrCreatePort(space, portType)
  where portType ∉ space.ports = (p, space')
  where p      = new port(portType, Down)
        wiring = matchRules(space.wiringRules, p)
        space' = space with ports ∪ {p}, p wired by wiring
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


## 7. Sockets and Space Serialization

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
LOAD(socketSpace, damlSource) = socketSpace'
  where spaceDef    = parse(damlSource)              — DAML source → space definition
        subspace    = instantiate(spaceDef)           — build stations, init space vars
        subspace'   = subspace with ports unresolved  — demand-created on first use
        socketSpace' = socketSpace with subspaces ∪ {subspace'}
                       wiringRules applied to subspace' ports on demand
```

### Socket transitions: overlap

If a previous subspace occupied this socket, the transition uses
**overlap** semantics:

```
TRANSITION(socketSpace, old, new) = socketSpace'
  where socketSpace' routes new ships to new         — new is immediately live
        old continues processing in-flight ships     — old drains naturally
        old is collected when inFlight(old) = ∅      — no ships, no pending requests
        old.σ is lost                                — state does not survive transitions
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


## 9. Scheduling

### Serial execution per space

Each space processes **one ship at a time**. When a ship arrives at
a space (via any in-port on any station), it either docks immediately
(creating a process) or is placed in a FIFO queue. No two processes
ever execute concurrently within the same space.

This applies regardless of which station the ship targets. A space
with stations A and B will never process a ship at A and a ship at
B at the same time. The serialization is per-space, not per-station
or per-port.

### The queue

Each space maintains a queue of pending ships. A ship is enqueued
when it arrives at a space that already has an active process.

```
ARRIVE(space, ship, station):
  if space.active:
    space.queue ← space.queue ++ [(ship, station)]    — FIFO append
    return                                             — ship waits
  else:
    space.active ← true
    DOCK(space, ship, station)                         — create process, run block
```

When the active process completes (either synchronously or after
all async round-trips), the space dequeues the next ship:

```
COMPLETE(space):
  space.active ← false
  if space.queue is non-empty:
    (ship, station) ← space.queue.shift()              — FIFO dequeue
    space.active ← true
    DEFER(DOCK(space, ship, station))                  — deferred execution
```

The dequeue is **deferred** (not immediate), ensuring the completing
process's output routing finishes before the next ship docks.

### Process lifecycle

When a ship docks at a station, a process is created to run the
station's block. The process goes through these phases:

  1. **Dock**: ship arrives at station's in-port, process is created
  2. **Execute**: process runs the block's segments sequentially
  3. **Wait** (if effectful command): process waits for a response
     via a down-port — the space remains busy
  4. **Resume** (when response arrives): process continues from
     where it was waiting
  5. **Complete**: block finishes, final value exits as a ship
     through the station's `_out` port, process is destroyed,
     space becomes available for the next queued ship

A process may also send ships to named ports during execution
(via `>@portname`), and soft errors send ships to the space's
error port (if wired). All port routing is deferred — the ships
arrive at their destinations after the current process completes.

A waiting process **holds the space**. While a process waits for
an async response, no other ships can dock. The process has
exclusive access to the space's state for its entire lifetime,
from dock through completion.

### Sub-processes

Commands that accept block parameters (`list map`, `process run`,
`if then`, etc.) evaluate the block by creating a **sub-process**.
A sub-process:

  - Runs in the same space, with access to the same σ
  - Bypasses the queue (it is part of the active process's work)
  - Executes synchronously and depth-first: the parent process
    waits for the sub-process to complete before continuing
  - Can nest to arbitrary depth (sub-sub-processes, etc.)

Sub-processes are nested execution, not concurrent execution.

### Port routing and deferred entry

When a process sends to a space-level port (`>@portname`), the
port's output routing is **deferred**: the receiving station's
in-port entry is scheduled asynchronously, not executed inline.
The sending process continues immediately.

This means `>@portname` does not block the sender's process.
The routed ship arrives at the target station after the current
process completes, entering through the normal queue mechanism.

This also applies to the implicit `_out` routing. If station A's
`_out` is wired to station B's `_in`, the ship docks at B only
after A's process is fully complete and cleaned up.

### Other Daimio instances

Other Daimio instances are completely separate. A Daimio instance
has no knowledge of other instances and no interaction with them.
Inter-instance communication is entirely the outer application's
concern.

### Future: concurrent scheduling

The serial model could be relaxed to allow multiple processes to
execute concurrently within a space, interleaving at segment boundaries.
This is not currently enabled. See `D2-concurrent-scheduling.md`
for the aspirational concurrent model and its implications.


## 10. Properties of the Model

### Totality
Every command returns a value. Every port access either succeeds or
produces a soft error with the empty value. No pipeline ever crashes
or diverges (assuming commands are total, which is a requirement on
command definitions). The empty value coerces to "", 0, or [] as
needed, so it always flows cleanly through subsequent commands.

TODO: producing a soft error with the empty value is used all the time, we need a new term for it. I suggest "sploot". "Every port access either succeeds or sploots." "A command that outside the dialect just sploots."
TODO: think about `[]` vs `()` for empty value
TODO: the smart quote rendering makes "" look dumb, turn that off

### Copy semantics
Values flowing through pipelines are functionally pure from the
programmer's perspective. A command receives its own copy of any
collection; mutations inside a command don't propagate back to the
caller's pipeline. Implementations may optimize with mutation when
no future references exist (linear types style), but the observable
behavior is always as-if copied.

### Dialect confinement
All execution within a Daimio instance is constrained to one dialect.
There is no mechanism for privilege escalation during execution — a
received program, a block passed as data, or a space loaded into a
socket all run under the host instance's dialect. Commands outside
the dialect are not executed (soft error, pipeline continues with
empty). This is the core security property: the instance owner
controls what code can do by choosing the dialect.

### Serial execution
Each space processes one ship at a time (see §9). The active
process has exclusive access to the space's state from dock
through completion, including across async boundaries. No other
process can read or write space variables while a process is
active, even while it is waiting for an effectful command's
response.

This means space variable access is always consistent: there are
no concurrent modifications, no stale reads, no TOCTOU hazards.
A process that reads `$foo`, waits at an async boundary, and reads
`$foo` again after resumption is guaranteed to see the same value
(unless its own execution modified it in between).

### Fresh reads
Under the current serial model, fresh reads are trivially
satisfied — no other process can modify σ during your execution.
Space variable reads see exactly what the active process (or its
sub-processes) last wrote. Pipeline variables remain the mechanism
for stashing values within a pipeline, but the motivation is
convenience, not protection from concurrent modification.

### Block scope isolation
Pipeline variables flow into sub-processes (lexical inheritance
from the parent process) but never flow out. A sub-process gets a
copy of the parent's env; variables bound inside the sub-process
(via `>x`) do not propagate back. This is safe because pipeline
vars are write-once (immutable bindings), so the inherited values
are frozen. The one-way information flow makes blocks safe to pass
around as values — evaluating a block cannot corrupt the caller's
state.

### Space isolation
Spaces are fully isolated containers. A subspace cannot read or
write its parent's space variables directly — all cross-boundary
communication goes through ports. This applies at every level of
nesting: inner spaces can only interact with outer spaces through
explicit port wiring. The parent controls what the child can do
(via wiring rules and dialect), and the child cannot reach beyond
what the parent exposes. At the outermost level, separate Daimio
instances have no knowledge of each other; inter-instance
communication is entirely the outer application's concern.

### Effect locality
Effects only occur at the outside of the outermost space. Every
effectful command invocation within a space produces a port request.
Port requests propagate outward (via down-port forwarding through
parent spaces) until they reach the outermost space, where real effects
occur. Any intermediate space can intercept and handle the request
(via up-port wiring to a subspace or a local handler), which is how
testing, mocking, and simulation work.

### Single-response effects
Every effectful command produces exactly one response. A down-port
round trip is a single request/response pair — no streaming, no
multi-shot continuations. This keeps pipelines linear: after an
effectful command, the programmer gets one value and continues.
If the outside wants to send multiple values, it uses an in-port
(fire-and-forget), not a down-port response.

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
No process waits forever. Every down-port request has a finite
timeout (explicit, inherited, or the 10s system default). When the
timeout fires, the process resumes with a default value. Unwired
ports return the default immediately with no async boundary at all.
This guarantees that every process eventually completes its block,
modulo the totality of the block's pure computation.

### Timeout compositionality
The effective timeout for a request chain is the minimum of all
timeouts along the chain. Outer spaces' timeouts are authoritative:
no inner wire can extend the wait time beyond what an outer wire
allows. Inner wires can only shorten it. This means the socket owner
always controls the maximum wait time for anything loaded into their
socket.

### Uniform evaluation
There is no special "eval" mechanism. Blocks, received programs,
named blocks, and station blocks all execute as processes under the
same rules — same dialect, same serial execution, same fresh reads,
same effect routing. A program received as data is evaluated the
same way as a block passed to `list map` — both create a
sub-process. This uniformity makes the system predictable and
auditable: there is exactly one execution model, applied everywhere.

### Deterministic pipe filling
The implicit pipe value fills the first unfilled parameter of the
next command, determined by the command's parameter definition order.
This is fully deterministic from the command signature alone — the
programmer can predict what gets filled without knowing implementation
details. Named parameters override this by explicitly binding a value
to a parameter name, removing it from the implicit filling order.


## 11. Design Decisions Record

Rationale for decisions that aren't obvious from the spec itself.

TODO: examine "request tagging" -- that seems weird
TODO: let's not call requests orphans that's just sad

### Why single-response effects?
The alternative is multi-shot continuations (streaming responses via
down ports). Single-response was chosen because it aligns with the
free monad interpretation (single-shot continuations), keeps the
pipeline model linear, and avoids stream termination logic. If the
outside wants to send multiple values, it uses an in-port
(fire-and-forget) — the down-port response can serve as the trigger
("start streaming") while the in-port carries the data.

### Why overlap for socket transitions?
When a new space is loaded into an occupied socket, the alternative
is to drain the old space before activating the new one (blocking).
Overlap was chosen to avoid blocking on potentially long-running
in-flight operations. The cost is that state doesn't survive
transitions — but this is consistent with the space isolation
model. Persistent state lives Outside (via ports to external
storage), not in space variables.

### Why is cross-boundary state access verbose?
Crossing a space boundary to access state is a significant action
that should be visible in the topology, not hidden behind sugar.
The explicit `{var read name :foo}` through a down port makes it
clear where isolation boundaries are being crossed. Syntactic sugar
may be added later, but the underlying mechanism will always be a
port round trip.

### Why DAML source as the serialization format?
The alternative is a separate binary format or manifest. DAML source
was chosen because the existing syntax already supports station
definitions, subspace definitions, and space variable declarations
with values. No new format needed — a serialized space is just
DAML that can be read, edited, and debugged with normal tools.

### Why resource limits per instance?
Resource measurement (CPU, memory) is per Daimio instance, with
enforcement delegated to the outer application. Suspended ships
do not consume CPU while waiting (though they consume memory).
This keeps resource tracking out of the language model and lets
the outer application use whatever monitoring and enforcement
strategy fits its needs.

### Why do blocks inherit parent pipeline vars?
The alternative is requiring explicit parameter passing (e.g. a
`with` param on every command that takes a block). Lexical
inheritance was chosen because pipeline vars are write-once
(immutable bindings), making it safe — the block gets a frozen
snapshot, and vars bound inside the block don't propagate back.
This eliminates boilerplate in the common case of accessing outer
variables from inner blocks.