# Daimio2: Formal Execution Model


# Part I: Orientation

## 0. Prelude

DAML (Daimio Ain't Markup Language, aka Drat Another Markup Language,
aka Dragon Ate My Lambdas) is a templating language. A DAML source
string is a mix of literal text and command invocations delimited by
curly braces. Literal text passes through unchanged; commands are
evaluated and their results are interpolated into the output. And
then we eat lunch.

### Why Daimio exists

Applications as we know them are the wrong abstraction.

An application binds together the user interface, the features,
the data, the assets, the backend, and the process of using it --
all into a single monolithically controlled unit. The app maker
decides what you can do, how you do it, what your data looks like,
and when it changes. You can't add features. You can't remove
features. You can't control your data. You can't change the
interface. And you can't change the *process* -- the sequence of steps,
the workflow, the way the tool shapes your work. A filing cabinet
and index cards don't work this way. There, you control your
process. But not with digital things.

Daimio is part of a radical re-envisioning of our digital lives.
It's one layer in a stack that includes
first-class digital assets (TODA files for portable, self-sovereign
ownership), self-authenticating messages (identity follows the
message, not the channel), and fluid, heterogeneous topologies
(no central server required). Daimio provides the execution model
for this world: a safe, sandboxed environment where multiple
people and programs can interact with shared capabilities, each
constrained to exactly what they're allowed to do.

Six core ideas animate the design:

**1. Control your process.** You shouldn't need to use an
application's UI to use an application. You should be able to
send a program that expresses your intent. Then you can make any
interface you want. You can automate any sequence. You can adapt
the process to your needs, not the other way around. Daimio makes
this work through uniform evaluation (P-uniformeval): a program received as
data executes under exactly the same rules as built-in code,
constrained by the sender's dialect.

**2. Full multiplayer, everywhere.** Why can't your friends and
family and robot assistants just pile in and work alongside you?
Daimio is multiplayer by default. Multiple actors share a space,
each with their own dialect -- a restricted set of commands that
determines what they can do. The space owner controls permissions.
An invited actor can do exactly what the owner allows, nothing
more, nothing less. No third-party servers. No intermediation.
Just people and programs working together.

**3. No more locked-up monoliths.** Applications shouldn't bundle
everything into one thing that one entity controls. The right
factoring separates UI, features, data, assets, backend, and
topology so each can be independently controlled. Daimio's
spaces decompose along these lines: the topology (how things
connect) is separate from the behavior (what the blocks do), which
is separate from the state (space variables), which is separate
from the effects (port wiring). Each aspect can be swapped,
rewired, or replaced without touching the others.

**4. Your stuff is yours.** Combined with first-class digital
assets, your accounts, relationships, and data don't need to stay
locked up on someone else's server. You carry what you need.
Self-authenticating messages mean it doesn't matter how your
message arrives -- letter, WebSocket, carrier pigeon -- the receiver
can verify it's you and act accordingly. Daimio supports this
through channel-independent senders (see Senders in section 4): identity rides on the
ship, not on the transport.

Our digital experiences today make our lives more impoverished
than they need to be. Everything is rigid and locked down. Daimio
is part of changing that.

## 1. Properties of the Model

### Totality [P-total]
Every command returns a value. Every port access either succeeds or
sploots (emits a soft error and continues -- see section 10, "Splooting"). No
pipeline ever crashes or diverges (assuming commands are total, which
is a requirement on command definitions). The empty value coerces to
`""`, `0`, or `[]` as needed, so it always flows cleanly through subsequent
commands.


### Copy semantics [P-copy]
Values flowing through pipelines are functionally pure from the
programmer's perspective. A command receives its own copy of any
collection; mutations inside a command don't propagate back to the
caller's pipeline. Implementations may optimize with mutation when
no future references exist (linear types style), but the observable
behavior is always as-if copied.

### Dialect confinement [P-dialect]
Every process runs under an **effective dialect** (defined in §4
Senders), computed once at dock time and inherited by all
sub-processes, block evaluations, and port routing. Commands
outside the effective dialect sploot. No mechanism exists for
privilege escalation during execution -- received programs, blocks
as data, and socketed spaces all run under the effective dialect.

### Serial execution [P-serial]
Each space processes one ship at a time (see section 5). The active
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

### Fresh reads [P-fresh]
Under the current serial model, fresh reads are trivially
satisfied -- no other process can modify space state during your execution.
Space variable reads see exactly what the active process (or its
sub-processes) last wrote. Pipeline variables remain the mechanism
for stashing values within a pipeline, but the motivation is
convenience, not protection from concurrent modification.

### Block scope isolation [P-blockscope]
Pipeline variables flow into sub-processes (lexical inheritance
from the parent process) but never flow out. A sub-process gets a
copy of the parent's env; variables bound inside the sub-process
(via `>x`) do not propagate back. This is safe because pipeline
vars are write-once (immutable bindings), so the inherited values
are frozen. The one-way information flow makes blocks safe to pass
around as values -- evaluating a block cannot corrupt the caller's
state.

### Space isolation [P-spaceisolate]
Spaces are fully isolated containers. A subspace cannot read or
write its parent's space variables directly -- all cross-boundary
communication goes through ports. This applies at every level of
nesting: inner spaces can only interact with outer spaces through
explicit port wiring. The parent controls what the child can do
(via wiring rules and dialect), and the child cannot reach beyond
what the parent exposes. This is what makes composition safe
(see P-compose): wiring spaces together cannot break their internal
invariants. At the outermost level, separate Daimio instances have
no knowledge of each other; inter-instance communication is
entirely the outer application's concern.

### Effect locality [P-effectlocal]
Effects only occur at the outside of the outermost space. Every
effectful command invocation within a space produces a port request.
Port requests propagate outward (via down-port forwarding through
parent spaces) until they reach the outermost space, where real
effects occur. Any intermediate space can intercept and handle the
request (via up-port wiring to a subspace or a local handler).
This is the mechanism behind testability: any space can be
tested by composing it into a parent that provides mock handlers,
and the space cannot tell the difference from the inside.

### Command/port duality [P-duality]
From inside a space, every command looks the same -- pure and
effectful use the same syntax and return values into the pipeline.
From outside, the effectful commands are visible as ports: the
space's "effect surface" is the set of ports created by its
effectful commands. Pure commands are invisible from outside.
The command is the inside view; the port is the outside view.
These are the same thing seen from two sides of the space boundary.

This duality is what makes spaces testable and composable. A space
that uses `{time now}` and `{db query}` has ports for time and db
requests. Wire those ports to production handlers, mock handlers,
or forward them to the parent's boundary -- the space cannot tell
the difference from the inside.

### Single-response effects [P-singleresponse]
Every effectful command produces exactly one response. A down-port
round trip is a single request/response pair -- no streaming, no
multi-shot continuations. This keeps pipelines linear: after an
effectful command, the programmer gets one value and continues.
If the outside wants to send multiple values, it uses an in-port
(fire-and-forget), not a down-port response.

### Port demand-creation [P-demandport]
The effect surface of a Daimio instance is not fully fixed at
construction time. Ports are created when first needed and wired
according to the parent space's rules. This supports block evaluation
and socket loading without requiring static knowledge of all possible
effects.

### Composition [P-compose]
Spaces compose by nesting. A subspace's effect surface becomes
obligations on the parent. The parent either handles them, forwards
them to its own boundary, or swallows them. Dialects restrict
downward: an invited actor or loaded subspace can never exceed the
host's permissions. This composes recursively to arbitrary depth.

### Content-addressed deduplication [P-contentaddr]
The compiler produces a **structural normal form** for blocks and
spaceseeds, then hashes the result. Structurally equivalent code
compiles to the same identity — the engine deduplicates
automatically. See section 10 "Block identity and normal form" and
section 3 "Spaceseeds" for the normalization details.

### Liveness [P-liveness]
No process waits forever. Every down-port request has a finite
timeout (explicit, inherited, or the 10s system default). When the
timeout fires, the process resumes with the empty value. Unwired
ports sploot immediately with no async boundary at all. This
guarantees that every process eventually completes its block,
modulo the totality of the block's pure computation.

### Timeout compositionality [P-timeoutcompose]
The effective timeout for a request chain is the minimum of all
timeouts along the chain. Outer spaces' timeouts are authoritative:
no inner wire can extend the wait time beyond what an outer wire
allows. Inner wires can only shorten it. This means the socket owner
always controls the maximum wait time for anything loaded into their
socket.

### Uniform evaluation [P-uniformeval]
There is no special "eval" mechanism. Blocks, received programs,
named blocks, and station blocks all execute as processes under the
same rules -- same dialect, same serial execution, same fresh reads,
same effect routing. A program received as data is evaluated the
same way as a block passed to `list map` -- both create a
sub-process. This is what makes programmable applications work:
a program sent by a sender executes under exactly the same
rules as built-in code, constrained by the effective dialect.

### Deterministic pipe filling [P-pipefill]
The implicit pipe value fills the first unfilled parameter of the
next command, determined by the command's parameter definition order.
This is fully deterministic from the command signature alone -- the
programmer can predict what gets filled without knowing implementation
details. Named parameters override this by explicitly binding a value
to a parameter name, removing it from the implicit filling order.

### Effect partition [P-effectpartition]
Every command definition is either pure (has a `fun`) or effectful
(has an `effect` with a port type). Never both,
never neither. A pure command is a total function from parameters to
a value -- it can be executed with no environment at all. An effectful
command can do nothing except send a request to its port and return
whatever comes back. This partition is what makes a DAML program
decomposable into an effect skeleton (the sequence of port requests)
and pure filling (the computation between them). If a command could
be mostly pure but also touch a port, you could no longer substitute
handlers freely because you wouldn't know what the "pure" parts
were secretly doing.

The partition is checkable at command registration time: every
command definition must have exactly one of `fun` or `effect`.

> **Algebraic aside.** In the free monad tree, `Pure` nodes are
> computation (transforming values). `Op` nodes are effect
> requests (asking the outside for something). A command that
> does both would be a node that computes AND requests — but
> the tree structure separates these: computation happens in
> the continuations between `Op` nodes, never inside them. The
> effect partition is forced by the tree shape.

### Handler parametricity [P-handlersub]
Given the same sequence of responses from effect handlers, a DAML
program produces the same effect requests regardless of which
handlers produced those responses. The pure parts of a pipeline
cannot observe handler identity -- they see only the values the
handler returns. A program is parametric in its effects.

This is the property that makes testing by handler substitution
valid: replace production handlers with mock handlers, provide the
same response script, and you get the same request sequence and
the same output. The test doesn't need a "test mode" -- it needs
a different handler. See P-duality and P-effectlocal.

Follows from: effect partition (pure parts can't touch ports),
effect exteriority (I10), and the uniform command syntax (effectful
commands look the same as pure commands from inside the pipeline).

### Program portability [P-portable]
A DAML program -- a block or pipeline serialized as source text --
can be run in any space that provides the required dialect and port
wiring, producing the same behavior given the same handler responses
and the same initial space state. The program text is a faithful
serialization of the computation: no closures, no ambient references,
no hidden state within a pipeline. Two independently constructed
spaces running the same DAML with identical handlers and identical
initial state produce identical results.

One subtlety: space variables read but not set within the program
are part of the space's initial state, not the program. Portability
holds for the program itself; the caller must provide the expected
state environment. This is why shipping a program to a different
space works: the recipient provides its own handlers and state, and
the program executes identically as long as the effect responses
and state match.

Follows from: no closures in DAML, deterministic evaluation, and
uniform evaluation.


### Invariants

These are constraints the system MUST maintain. Violating any of
these is a bug.

**I1. Totality.** Every command invocation produces a value. Every
path access produces a value. Every port request eventually resolves
(via response, timeout, or unwired default). No pipeline diverges
or crashes. The empty value is always a valid result.

**I2. Dialect monotonicity.** A process's effective dialect is
always a subset of the outer space's base dialect. A sender's dialect is
always a subset of the outer space's base dialect. No mechanism -- block
evaluation, program-as-data, socket loading, port routing -- can
produce a process with a dialect that exceeds the outer space's
base dialect. Subspaces do not have their own dialects; they
inherit from the outer space. Restrictions only accumulate; they
never relax.

**I3. Sender preservation.** If a ship carries a sender, every
process in the execution tree rooted at that ship inherits the
sender and its effective dialect. This includes sub-processes
from block evaluation, ships sent through `>@portname`, ships
exiting through `_out`, down-port requests, and error ships.
The sender exits all ports, including the outermost boundary
to the App.

**I4. Sender confinement.** A process can never do more than
both the sender and the space allow. The effective dialect (§4
Senders) enforces this. Computed once at dock time, inherited by
all sub-processes.

**I5. Serial exclusion.** At most one process is active in a
space at any time. A waiting process holds the space -- no other
ship can dock until the active process completes. The queue is
FIFO. (This invariant may be relaxed per-space in a future
concurrent model.)

**I6. Space variable atomicity.** Within a single process
execution (including all sub-processes), space variable access
is consistent -- no other process can read or write space state
during the active process's lifetime.

**I7. Pipeline variable isolation.** Pipeline variables bound in
a sub-process do not propagate to the parent. Pipeline variables
from the parent are readable (inherited copy) but the inheritance
is one-way. No sub-process can modify the parent's pipeline state.

**I8. Space boundary opacity.** A subspace cannot read or write
its parent's space variables directly. All cross-boundary
communication goes through ports. A parent cannot read a
subspace's space variables directly. The port interface is the
only channel.

**I9. Liveness.** Every down-port request resolves within finite
time. Unwired ports resolve immediately. Wired ports resolve
within the effective timeout (minimum of all timeouts along the
chain). No process waits forever.

**I10. Effect exteriority.** Effectful commands produce port
requests, not direct effects. The actual effect occurs only at
the outermost port boundary, where the App's handler executes it.
No space can cause a real-world effect without a port request
traversing to the outside.

**I11. Wiring authority.** The parent space controls all wiring
for its subspaces. A subspace cannot wire its own ports -- it can
only declare them. The parent decides what each port connects to
(handler, sibling up-port, forwarded down-port, or null).

**I12. Timeout authority.** The effective timeout for a request
chain is the minimum of all nominal timeouts along the chain. No
inner wire can extend the wait time beyond what an outer wire
allows. The outermost space always controls the maximum wait.

**I13. Queue priority.** When a process completes, queued ships
dock before ships produced by the completing process's output
routing. Ships already waiting have priority over newly routed
ships.

**I14. Copy semantics.** A command receives its own copy of any
collection it intends to mutate. Values flowing through pipelines
are never modified by downstream commands. From the programmer's
perspective, pipeline flow is functionally pure.

**I15. Deterministic pipe filling.** The implicit pipe value fills
the first unfilled parameter by the command's definition order.
This is deterministic from the command signature alone -- no runtime
state affects which parameter receives the implicit value.


## 2. Design Decisions Record

Rationale for decisions that aren't obvious from the spec itself.


### Why single-response effects?
The alternative is multi-shot continuations (streaming responses via
down ports). Single-response was chosen because it aligns with the
free monad interpretation (single-shot continuations), keeps the
pipeline model linear, and avoids stream termination logic. If the
outside wants to send multiple values, it uses an in-port
(fire-and-forget) -- the down-port response can serve as the trigger
("start streaming") while the in-port carries the data.

### Why overlap for socket transitions?
When a new space is loaded into an occupied socket, the alternative
is to drain the old space before activating the new one (blocking).
Overlap was chosen to avoid blocking on potentially long-running
in-flight operations. The cost is that state doesn't survive
transitions -- but this is consistent with the space isolation
model. Persistent state lives Outside (via ports to external
storage), not in space variables.

### Why is cross-boundary state access verbose?
Crossing a space boundary to access state is a significant action
that should be visible in the topology, not hidden behind sugar.
The explicit `{var read-out name :foo}` through a down port makes it
clear where isolation boundaries are being crossed. Syntactic sugar
may be added later, but the underlying mechanism will always be a
port round trip.

### Why space syntax as the serialization format?
The alternative is a separate binary format or manifest. Space syntax
was chosen because it already supports station definitions (with DAML
blocks inside), subspace definitions, and space variable declarations
with values. No new format needed -- a serialized space is just
source text that can be read, edited, and debugged with normal tools.

### Why resource limits per instance?
Resource measurement (CPU, memory) is per Daimio instance, with
enforcement delegated to the outer application. Waiting processes
do not consume CPU while waiting (though they consume memory).
This keeps resource tracking out of the language model and lets
the outer application use whatever monitoring and enforcement
strategy fits its needs.

### Why do blocks inherit parent pipeline vars?
The alternative is requiring explicit parameter passing (e.g. a
`with` param on every command that takes a block). Lexical
inheritance is safe (P-blockscope) and eliminates boilerplate in
the common case of accessing outer pipeline vars from inner blocks.

### Why programmable applications?
The alternative is traditional APIs: the application exposes
endpoints, and clients call them. But an API is the application
author's model of what you want to do. A program is YOUR model of
what you want to do. Sending a program lets you compose operations,
express conditional logic, and avoid round-trips -- all without the
application author anticipating your exact use case. The dialect
makes this safe: the program runs under the sender's restricted
permissions, so it can only do what the sender is allowed to do.
The application doesn't need to trust the program; it trusts the
dialect.

### Why dialects instead of ACLs?
The alternative is per-command or per-resource access control lists.
Dialects were chosen because they compose naturally with spaces:
a dialect is a property of the execution context, not of individual
resources. When you nest spaces, dialects restrict downward -- a
child space's dialect is always a subset of its parent's. This
means permission delegation is structural, not administrative. The
space owner gives an actor a dialect; the actor can invoke commands
and those commands can delegate to subspaces, but nothing in the
chain can escalate beyond the original grant.

### Why are effectful commands modelled as ports?
The alternative is having effectful commands execute directly in
the runtime (like a syscall). Modelling them as ports means the
effect surface of a space is explicit and external: you can see
exactly what effects a space needs by examining its ports. This
enables testability (wire ports to mocks), portability (wire ports
to different backends), and composition (a parent space can
intercept, forward, or suppress any child's effects). The command
is the ergonomic inside interface; the port is the composable
outside interface. Same thing, two views.

### Why channel-independent messages?
The alternative is binding authentication to the transport (session
cookies, connection-based auth). Channel independence means a
message carries its own authentication -- it doesn't matter whether
it arrives via WebSocket, HTTP, letter, or carrier pigeon. This
aligns with the actor model: the message identifies the sender,
the space looks up the sender's dialect, and the program executes
under those permissions. Separating identity from channel makes
the system robust to transport changes and enables use cases like
offline program shipping.


# Part II: Spaces -- The Outer Topology

## 3. Space Syntax

Space syntax is the textual format for defining a space's topology.
It is distinct from DAML (the block language, section 9) -- space syntax
describes structure (stations, ports, wiring, subspaces), while
DAML describes behavior (pipelines, commands, values). Station
definitions contain DAML inside them, but the surrounding topology
is space syntax.

### Grammar

Space syntax is **indentation-based**. A top-level name at column 0
declares a space. [spacesyn-toplevel] Indented lines below it define the space's contents.

```
space_def  ::= name NL (indent line NL)*     -- NL = newline

line       ::= port_decl
             | station_decl
             | route_decl
             | state_decl
             | dialect_decl

port_decl  ::= '@' dir ':' name (flavour param*)?  -- @in:click dom-on-click btn1 [spacesyn-port]
                                                   -- flavour defaults to generic for direction
                                                   -- cmd: ports cannot be declared here
dir        ::= 'in' | 'out' | 'up' | 'down'
station_decl ::= name NL indent daml       -- station name, then DAML block [spacesyn-station]
wire_decl  ::= faf | contract | cmd_wire
faf        ::= endpoint ('->' endpoint)+            -- FAF: fire-and-forget [spacesyn-route]
contract   ::= endpoint '<->' endpoint              -- contract: one out, one back
cmd_wire   ::= subspace '@cmd:' pattern '<->' endpoint   -- command port contract
             | subspace '@cmd:' pattern '<->' '@cmd'     -- command port forwarding
state_decl ::= '$' name json_value?         -- $count 0, $items [] [spacesyn-state]
dialect_decl ::= '{' json_object '}'        -- inline JSON restrictions

endpoint   ::= '@' dir (':' name)?         -- space-level port (@in, @in:click, @out:display)
             | name                        -- station (implicit _in/_out)
             | name '@' name               -- station named port (splitter@left)
             | name '@' dir (':' name)?    -- subspace port (sub@up, sub@up:adder)
             | '{' daml '}'                -- anonymous inline station
```

Every station automatically gets two implicit ports: `_in` and
`_out`. [spacesyn-implicit-ports] When a station name appears in a route
without an `@port` suffix, it expands to `_in` (as a destination)
or `_out` (as a source). [spacesyn-route-expand]

**Implicit port creation.** If a port is referenced in wiring
but not explicitly declared, it is created with the default
flavour for its direction [port-implicit-create]. This applies
to all four declarable directions (`in`, `out`, `up`, `down`)
and to both bare (`@in`) and named (`@in:foo`) forms. `cmd:`
ports are never created this way — they are demand-created by
commands only.

```
inner
  processor
    {__ | string uppercase}
  @in -> processor -> @out          -- @in and @out created implicitly
```

This is equivalent to explicitly declaring them:
```
inner
  @in
  @out
  processor
    {__ | string uppercase}
  @in -> processor -> @out
```

Bare ports (`@in`) and named ports (`@in:foo`) are distinct —
they can coexist on the same space without ambiguity
[port-bare-named-coexist]. Explicit declarations are only
needed for non-default flavours (e.g.,
`@in:click dom-on-click button1`) [port-default-flavour].
Subspace ports are NOT created implicitly by the parent — they
must be declared (or implicitly created by wiring) inside the
subspace's own definition [port-no-parent-implicit].

Anonymous inline stations can appear in routes as `{DAML}`: [spacesyn-anon-station]
```
@in -> {__ | add 1} -> {__ | times 2} -> @out
```
These create unnamed stations with the given DAML block.

### Examples

A simple counter app:
```
counter
  @in:button  dom-on-submit
  @out:display dom-set-text
  $count 0
  @in:button -> {1 | add $count | >$count} -> @out:display
```

Subspaces must be defined before they are referenced. In the
example below, `inner` is defined first, then `outer` references
it in its routes [spacesyn-subspace-before-ref].

A space with subspaces (inner's ports created implicitly by wiring):
```
inner
  @in -> {__ | times 2} -> @out

outer
  @in:init from-js 20
  @out:result  assert  42
  @in:init -> inner@in
  inner@out -> @out:result
```

A station with named out-ports:
```
splitter
  {__ | >@left | >@right}

main
  @in:init from-js
  @out:result  assert
  @in:init -> splitter
  splitter@left -> {__ | add 1} -> @out:result
```

Named ports on stations are created by **routes**, not by DAML. [spacesyn-named-port-route]
The route `splitter@left -> {__ | add 1} -> @out:result` creates
the `left` port on station `splitter`. The DAML `>@left` sends
to that port -- but only because the route declared it. Without
the route, the port doesn't exist and `>@left` sploots at
runtime. This ensures the space definition controls which ports
each station can access.

### Static declarations

A space definition is a static declaration -- it describes topology,
not behavior. Behavior lives in the station blocks (section 9) and in the
wiring rules that determine how effects are routed (section 6).

### Space definition errors

A malformed space definition is a **hard error** [spacedef-hard-error]
— the space fails to compile and no spaceseed is created. This is different
from DAML pipeline errors, which just sploot. The space
definition is static topology; there is no pipeline to continue
with empty.

Hard errors include:
  - Multiple wires to a round-trip port's in-side or out-side
    (up/down ports are point-to-point)
  - An OUT-N-IN port in a FAF `->` chain
  - A contract `<->` with wrong signal types (e.g., INPUT on LHS)
  - A contract `<->` with more than two endpoints
  - A `cmd:` port in a port declaration
  - Referencing a subspace before it is defined
  - Referencing a subspace or station that doesn't exist
  - A port declaration with an unknown flavour
  - A route referencing a station that doesn't exist

These are all detectable at parse/compile time. The compiler
rejects the definition and reports the error. No spaceseed is
produced.

### Spaceseeds

A **spaceseed** is the compiled result of parsing a space definition.
It describes the static topology: stations, ports, routes, subspaces,
and initial state. A spaceseed is inert -- it does not process ships
or hold live state. To run, it must be instantiated into a space
(see Spaces below).

It is a content-addressed data structure: the seed's identifier is
derived from its content, so identical definitions produce the same
seed. [seed-content-addr]

```
spaceseed = {
  id         : hash            -- content-based identifier
  stations   : [BlockId]       -- compiled DAML blocks (1-indexed)
  ports      : [PortDescriptor] -- port declarations + implicit station ports
  routes     : [[int, int]]    -- pairs of port indices (1-indexed)
  subspaces  : [SpaceseedId]   -- nested spaceseeds (1-indexed)
  state      : key -> Val      -- initial space variable values
  dialect    : object?         -- dialect restrictions (optional)
}
```

Each station contributes two implicit ports (`_in`, `_out`) to
the ports array. Named out-ports declared by routes
are added as extra ports: `station@left -> @out:result` creates a `left`
port on the station, for instance. Routes are pairs of
port indices connecting the topology.

Subspaces are **referenced by ID**, not inline. A spaceseed's
`subspaces` field is an array of IDs pointing into a flat global
table (`D.SPACESEEDS`). The same seed can be shared by
multiple parent spaces.

A spaceseed's identity is the hash of its serialized form:

```
spaceseed.id = hash(JSON.stringify(spaceseed))
```

Station blocks are referenced by their normalized block IDs
(see section 10 "Block identity and normal form"), and subspaces
are referenced by their seed IDs. So the hash transitively
covers the full structural normal form — topology, blocks, and
nested subspaces. Identical space definitions produce the same
spaceseed ID. [seed-content-addr]

Note: unlike blocks, spaceseeds are not currently normalized
beyond block and subspace content-addressing. Reordering
stations or routes in the space definition would produce a
different seed ID even if the topology is equivalent.

Multiple spaces can share the same spaceseed -- each is
instantiated into a live space (see Spaces below) with its own
state and queue, but the topology definition is shared.
[seed-share-instance]


## 4. Space Domains

### Identifiers
```
x in PVar      -- pipeline variable names (_foo, _bar)
s in SVar      -- space variable names ($foo, $bar)
c in Cmd       -- command names (math.add, time.now)
p in PortId    -- port identifiers, generated at runtime
```

### Dialect
```
d in Dialect = (commands, aliases)
  where commands : P(Cmd)               -- permitted commands
        aliases  : AliasName -> Pipeline  -- compile-time expansions
```

A dialect determines what commands can be invoked and what shorthand
is available within an outer space. Dialects are partially ordered:
d_Bob is a subset of d_Alice means Bob's command set is a subset of
Alice's AND Bob's alias set is a subset of Alice's.

**Aliases** are compile-time substitutions. An alias name expands to a
fixed pipeline fragment before execution. They are part of the dialect
because restricting a dialect may remove aliases as well as commands.
Aliases are purely syntactic -- they expand before any execution
happens, and the expanded form must be valid under the same dialect. [dialect-alias-expand]

### Commands
```
A command definition is either:
  Pure(c, params, fun)                             -- a pure command
  Effectful(c, params, portType)                   -- an effectful command
```

Pure commands are total functions from params to Val. `math random`
is pure [random-pure] -- it reads from the instance's PRNG, which
is deterministic given the seed (see Spaces, PRNG).

Effectful commands have no fun -- they have a port type. When
an effectful command is registered, it also registers a port
flavour with the `cmd:` prefix (e.g., `time now` registers
`cmd:time-now`). This namespace prevents collisions with
built-in environment flavours like `dom-on-click`.

`cmd:` ports can ONLY be created by the effectful command
itself — they cannot be declared in routes or created manually
in the space definition. This means the dialect check on the
command is the sole gate: if the command isn't in the dialect,
it sploots, and the port is never created. The `cmd:` flavour
may exist globally (other senders or subspaces may use the same
command), but it's inert until a command activates it.

When invoked, the request is sent through a port of that type.
If the port is wired, the process waits for the response. If
the port is not wired, the command sploots.
[effectful-unwired-sploot] No effects without wiring.

### Programs

A program is a pipeline, serialized as DAML source text. It enters
an outer space as a ship payload and may be evaluated as a block
via `process run`, creating a sub-process (P-uniformeval).

Formally, a program is a **free monad over the effect signature,
composed with a state monad** for space variables:

  - **State monad**: pure commands and space variable access are
    synchronous state transitions: `(process, state) -> (process', state')`.
    This includes block evaluation -- commands like `list map` and
    `process run` create sub-processes that execute as nested state
    transitions, sharing space state with the parent process.
  - **Free monad**: effectful commands cause the process to wait,
    producing port requests. Each request is an abstract operation
    with a single-shot continuation. The outer space + wiring
    interprets these operations by routing requests to handlers.

> **Algebraic aside.** A free monad is a tree:
> `Free F a = Pure a | Op(request, k)`. `Pure` means "done,
> here's the value." `Op` means "I need something from outside,
> and `k` is what to do with the answer." A handler folds over
> the tree: at each `Op`, it handles the request and feeds the
> result to `k`. The fold is a catamorphism from the initial
> (free) algebra to the handler algebra — and the initial
> algebra property guarantees a unique such fold for any handler.
> This is why handler substitution works: the program (tree) is
> independent of the handler (algebra).

Under the current serial scheduling model (section 5), each process has
exclusive access to space state for its entire lifetime. This is
what makes the composed model clean: the state transitions are
deterministic, because no other process can modify space state
between your segments. Without serial execution, state could change
nondeterministically between async boundaries, and the state monad
composition would break down.

One caveat: the effect surface is not statically fixed. Block
evaluation can invoke arbitrary effectful commands determined at
runtime. This means the free monad is over an open effect
signature -- the set of possible effects isn't known until the
block runs. Daimio handles this through demand-created ports and
wiring rules with OTHER fallbacks (section 6).

Requires: the effective dialect must include whatever commands the
program invokes, and port wiring must exist (or be
demand-creatable) for any effects used.

### Ships
```
ship = (value, sender?)
  where value    : Val              -- the payload
        sender   : Sender?          -- who sent this ship (optional)
```

A ship is a value being ferried between ports, optionally carrying
a sender. When a ship arrives at a station's in-port, a process is
created to handle it (see section 10, Processes). When a process completes,
it sends its result as a ship through the station's out-port. A
single process may send multiple ships to different ports during its
execution (via `>@portname`), and soft errors send ships to the
space's `@out:err` port (if declared).

All ships produced by a process inherit that process's sender. This
includes ships sent through `>@portname`, the implicit `_out` ship,
error ships, and down-port requests. The sender propagates through
every port exit, ensuring that the App always knows who originated
each ship.

### Senders
```
sender = (id, dialect)
  where id      : string           -- who sent this ship
        dialect : Dialect           -- what they're allowed to do
```

A sender identifies who originated a ship and what dialect they
operate under. The sender's dialect is always a subset of the
outer space's base dialect (`sender.dialect` is a subset of `space.dialect`).

When a ship with a sender docks at a station, the process runs
under the **effective dialect**: the intersection of the sender's
dialect and the space's dialect.

```
effective_dialect = sender.dialect intersection space.dialect
```

Since all subspaces inherit the same dialect, the intersection is
the same regardless of where in the hierarchy the ship docks. It
is computed once at dock time and can be memoized.

A ship without a sender runs under the space's dialect directly
(the default case for internal routing, system events, etc.). [sender-effective-default]

**Sender propagation.** The sender is immutable and propagates
through the entire execution tree:
  - Sub-processes from block evaluation inherit the sender [sender-propagate-subprocess]
  - Ships sent through `>@portname` carry the sender [sender-propagate-portsend]
  - Ships exiting through `_out` carry the sender [sender-propagate-out]
  - Down-port requests carry the sender [sender-propagate-downport]
  - Error ships carry the sender [sender-propagate-error]
  - Ships exiting the outermost space carry the sender (so the
    App can route responses back and apply its own policies) [sender-propagate-exit]

The sender is how the App tracks which external entity triggered
a computation. Daimio does not authenticate senders -- the App is
responsible for validating identity before passing a sender into
the outer space. From Daimio's perspective, the sender is trusted
metadata.

### Sendability and the gradient of dependency

Three kinds of values can be serialized and sent over ports,
including over the network. They differ in what they need from
the receiving environment:

- **Data** -- just a Val. No behavior, no effects, no requirements.
  Enters a space as a ship payload through any in-port.
- **Program** -- a pipeline as DAML source text. Needs dialect +
  state + ports from the host (see Programs above). The program
  is "parasitic" -- it borrows everything.
- **Space** -- a serialized space definition (space syntax). Needs
  port wiring + dialect from the parent (see Spaces below). The
  space is "self-reliant" -- it brings its own programs and state.

### Stations
```
station = (name, block)
  where name     : string
        block    : Block           -- the compiled DAML for this station
```

A station has exactly two built-in ports, created automatically:
  - **_in**:    receives ships (fire-and-forget inward)
  - **_out**:   sends the process's result (fire-and-forget outward)

Both are wireable via routes. If unwired, ships are silently
dropped.

Soft errors do NOT go through station ports. They route to the
**space's** error port (`@out:err`), if one is declared in the space
definition. See §12 for the full error model.

**Named ports and `>@portname`.** A station's DAML can send ships
to named ports using `>@portname`. But the port must be explicitly
declared in the space definition's routes. The route
`station@portname -> destination` creates the named port on the
station. Without a route declaring it, the port does not exist,
and `>@portname` sploots at runtime. [station-port-requires-route]

This is a security boundary: the space definition controls which
ports each station can send to. Code running inside a station
(including unquoted programs from untrusted senders) cannot send
to arbitrary ports -- only to ports that the space definition
explicitly wired. The wiring is the gate.

The station itself is simple -- it's a block with `_in`, `_out`,
plus any named ports declared by routes. All the interesting port
topology (down, up, command ports, wiring to subspaces) lives at
the space level (see section 6).

### Ports

Every port has a **direction** and a **name**. The direction is
encoded as a prefix on the name:

```
port = (name, flavour)

direction ::= in | out | up | down | cmd

Port names:     in:click, out:display, up:adder, down:sync, cmd:time:now
```

Ports come in two symmetric pairs, plus one special case:

**One-way ports** (`in`, `out`) — a ship goes one direction.
`in` and `out` are the same mechanism viewed from opposite sides
of a boundary.

**Round-trip ports** (`up`, `down`) — a request goes one way, a
response comes back. `up` and `down` are the same mechanism
viewed from opposite sides of a boundary.

**Command ports** (`cmd`) — transient round-trip ports,
demand-created by effectful commands. Behave like `down` from
the outside. Cannot appear in space definitions. See section 6.

#### Signal types and perspective

A port's **signal type** depends on which side of the boundary
you're on. Every port flips when you cross:

```
Direction   Inside (@)     Outside (S@)
─────────   ──────────     ────────────
in          INPUT          OUTPUT          [signal-flip-in]
out         OUTPUT         INPUT           [signal-flip-out]
up          OUT-N-IN       IN-N-OUT        [signal-flip-up]
down        IN-N-OUT       OUT-N-IN        [signal-flip-down]
cmd         (n/a)          OUT-N-IN
```

Four signal types:
  - **INPUT**: one-way source of ships (LHS of FAF `->`)
  - **OUTPUT**: one-way destination for ships (RHS of FAF `->`)
  - **OUT-N-IN**: the contracting side — sends one ship,
    expects exactly one back. Can only appear as LHS of
    contract `<->`. [roundtrip-outnin-lhs]
  - **IN-N-OUT**: has two modes [chain-innout-mid]:
    - In contract `<->`: fulfills an OUT-N-IN contract (RHS)
    - In FAF `->`: double-FAF processor, nobody waits (MID)
    Stations behave the same way — they can fulfill a
    contract or act as double-FAF processors in chains.

The flipping is consistent: `@in:foo` is INPUT (a ship enters this space)
but `S@in:foo` is OUTPUT (a ship exits into S).
`@down:foo` is IN-N-OUT (a ship exits into `@down:foo`, and a matching ship will enter this space from `@down:foo` later) but
`S@down:foo` is OUT-N-IN (a ship enters this space from `S@down:foo`, and a matching ship will exit into `S@down:foo` later).

#### Declaring ports

```
@in:init                           -- generic in flavour (default)
@in:click dom-on-click button1     -- dom-click flavour, bound to element
@out:display dom-set-text counter  -- dom flavour, bound to element
@out:result                        -- generic out flavour
@out:err                           -- error port (matched by name)
@up:adder                          -- generic up flavour
@down:sync                         -- generic down flavour
```

If no flavour is specified, the port uses the generic flavour for
its direction (`in`, `out`, `up`, `down`). The `@` prefix marks
space-level ports (distinct from station ports like
`station@portname`).

**Error routing:** soft errors route to the port named `out:err`
(if declared). The runtime matches by name, not by flavour.
[err-match-by-name]

```
flavour   -- the port's behaviour (e.g. "dom-on-click", "in")
```

### Spaces
```
space = (spaceseed, state, queue, subspaces, parent?, dialect)
  where spaceseed     : Spaceseed       -- the compiled topology
        state         : SVar -> Val     -- live space variable store
        queue         : [Ship]          -- pending ships (FIFO)
        subspaces     : [Space]         -- live subspace instances
        parent        : Space?          -- enclosing space (null for outer space)
        dialect       : Dialect         -- inherited from parent, or set explicitly
```

A space is a **live instance** of a spaceseed. It has its own
state, its own ship queue, its own live subspaces, its own
dialect, and its own serialization guarantee -- one ship at a
time per space (see section 5).

When a spaceseed is instantiated into a space, each subspace
seed ID in the spaceseed is recursively instantiated into a live
subspace. Each subspace gets its own state store [subspace-own-state] and its own queue [subspace-own-queue],
independent of the parent and of its siblings. Sibling subspaces
can process ships concurrently with each other and with the
parent (when the parent is waiting on an async effect). [subspace-sibling-concurrent]

Externally, a space is a **reactive automaton** (Mealy machine):
it accepts ships at in-ports, produces ships at out-ports, and
maintains internal state between interactions. The parent cannot
observe or modify the internal state -- only the port interface
is visible. This external view is coalgebraic:
`S -> (Input -> Output x S)`.

However, the transition function is not a pure function -- it may
invoke effectful commands, which produce down-port requests that
cause the process to wait until a response arrives. Internally,
each station's block is a program (free monad over effects + state
monad, as described in Programs above). When a ship docks at a
station, a process is created to execute the station's block.
The full picture is: a reactive automaton whose transitions are
effectful programs, executed one at a time per space (section 5).

**From inside, a space cannot tell whether it is an outer space
or a subspace.** [space-inside-opaque] The port interface is the same in both cases.
Effectful commands produce port requests that propagate outward.
Whether those requests reach a real-world handler or another
space's wiring is invisible from inside. This is the foundation
of testability: any space can be tested by nesting it inside a
parent that provides mock handlers, and the space cannot tell the
difference.

> **Algebraic aside.** Spaces compose because interpretation
> composes. When space B is inside space A, A provides an algebra
> for B's effects (via wiring). But A's algebra may itself produce
> effects (forwarding to A's own down-ports), creating `Op` nodes
> in A's free monad tree. A's parent then provides the algebra for
> those. Each space boundary is one layer of interpretation: the
> child produces a tree, the parent folds it — and the fold may
> produce a new tree for the grandparent to fold.

A subspace depends on the parent for:
  - **Port wiring**: the parent's wiring rules determine how
    the space's down-port requests are handled (section 6)
  - **Dialect**: inherited from the parent (see below)

**Dialect propagation.** Every space has a dialect. Subspaces
inherit their parent's dialect. [dialect-inherit-parent] The dialect is set explicitly
only on the outer space; all subspaces get it by inheritance.
This means there is one dialect for the entire hierarchy.
Subspace restrictions come from wiring, not from dialect: if you
don't want a subspace to access `db`, don't wire its `db` port.
The dialect says "these commands exist." The wiring says "these
effects are connected." Both must be true for an effectful
command to work. A command in the dialect but with an unwired
port sploots.

**PRNG.** The Daimio instance has a single pseudo-random number
generator, shared by all spaces in the hierarchy. The seed is set
at instance creation time: the App provides a seed, or Daimio
injects a default. `math random` is a pure command -- it reads
and advances the PRNG state deterministically. Same seed produces
the same sequence across runs [random-seeded]. The PRNG state is
internal -- not accessible via `$` variables [random-internal].

A space is "self-reliant" -- it brings its own programs and state.
But it is not self-sufficient: without wiring, its effects go
nowhere.

Spaces can also be serialized as space syntax and loaded into
sockets at runtime. Socketed spaces have additional properties
around loading, transitions, and state ephemerality -- see section 8.

### Outer spaces

An **outer space** is any space that is not a subspace of another
space. It's on the outside -- there's no parent to wire its ports,
so its port flavours connect directly to the real world.

The outer application creates an outer space by:
  1. Choosing a spaceseed (the compiled topology)
  2. Instantiating it into a live space (recursively creating
     subspaces, initializing state stores and queues)
  3. Assigning a base dialect (what commands are available)
  4. Providing a PRNG seed (or accepting the default)

The outermost ports get their behavior from their **port
flavours** (see "Port flavours" above). An in-port with
flavour `dom-on-click` binds to a DOM element; an out-port
with flavour `dom-set-text` updates the DOM. The space
definition declares which flavours it needs, and the
flavours provide the bridge to the real world. Inside the
space, effectful commands produce port requests that
propagate outward. At the outermost boundary, the port
flavour's `outside_exit` or `sync` method executes the
actual effect. If a port's flavour is not loaded, the port
can't be created and the command sploots.

**Multiple outer spaces.** An application can create as many outer
spaces as it needs. Each is a completely independent universe -- no
shared scheduler, no shared state, no cross-instance communication. [outer-independent]
Different outer spaces may use the same spaceseed with different
dialects and different port wiring, or entirely different
spaceseeds. The application is responsible for routing data between
them (via whatever external systems it chooses).

**Senders.** Multiple senders can send ships into the same outer
space, each with their own dialect (see §4 Senders). The effective
dialect governs all processes triggered by that sender's ships.

Daimio does not authenticate senders. The App validates identity
externally (HMAC, capability tokens, session auth, etc.) and
passes trusted sender information into the outer space. From
Daimio's perspective, the sender is metadata -- the App is the
authority on who sent what.


### Port flavours

Port flavours define how ports interact with the outside world.
They are registered globally via `D.import_port_flavour(name,
definition)` and referenced by name in space definitions. A port
flavour provides:

  - **dir**: the port direction (`in`, `out`, `down`, `up`)
  - **settings**: parameters for port construction (e.g., a DOM
    selector, a socket channel name)
  - **Lifecycle methods** that the runtime calls:
    - `outside_add()` — setup when the port is created on the
      outside (e.g., bind a DOM event listener, connect a socket)
    - `outside_exit(ship)` — handle a ship exiting to the real
      world (e.g., set DOM text, call a JS function)
    - `enter(ship)` — handle a ship entering from the outside
      (e.g., push a click event into the space)
    - `sync(ship, callback)` — handle a down-port round-trip
      (request/response)

When a port is created (`new D.Port(template, space)`), it
inherits from its flavour via prototype chain
(`Object.create(pflav)`). The flavour's methods become the port's
methods. Default implementations are provided for common patterns
(`port_standard_exit`, `port_standard_enter`,
`port_standard_sync`).

**Built-in flavours:**

  - `in`, `out`, `up`, `down` — internal flavours for the
    standard port directions. These use the default
    implementations and have no outside behavior.
  - `from-js` — in-port: the App calls `port.enter(value)` to
    push ships in from JavaScript.
  - `to-js` — out-port: calls a registered JS function when a
    ship exits.
  - `dom-on-click`, `dom-on-change`, `dom-on-keypress`, etc. —
    in-ports: bind DOM event listeners, push events as ships.
  - `dom-set-text`, `dom-set-value`, `dom-set-raw-html` —
    out-ports: update DOM elements when ships exit.
  - `socket-in`, `socket-out` — in/out-ports for socket.io
    communication.
  - `socket-add-user`, `socket-remove-user` — out-ports for
    socket user management.

**The flavour IS the handler.** There is no separate "handler
map" passed in at space creation time. A space definition
declares which flavours its ports use, and the flavour provides
the behavior. This makes space definitions self-describing — a
space says what it needs (DOM access, socket communication, etc.)
by declaring port flavours.

**Substitutability.** To override a port's behavior (for testing,
mocking, or reconfiguration), load the space as a subspace and
wire its ports via the parent's wiring rules. [handler-substitute]
The subspace's ports connect to whatever the parent wires — mock
handlers, proxies, or sibling subspaces. The subspace doesn't
know the difference (P-duality).

The App also controls which flavours are available. If the App
doesn't load `dom-set-text`, no port of that flavour can be
created. This is a coarse-grained security control at the
environment level.

**No hot-rewiring.** Wiring rules are set at space creation time
from the spaceseed. There is no mechanism to modify wiring on a
live space. To change behavior at runtime, use a socket transition
(§8) to replace the subspace, or have the App route ships to a
different outer space entirely.

> **Algebraic aside.** The fold of a free monad uses a single
> algebra for the entire tree. Changing the algebra mid-fold
> means the tree is partially interpreted by one handler and
> partially by another — the compositionality and
> substitutability guarantees no longer hold. You can only
> change algebras between folds (between ships).




## 5. Space Execution (Scheduling)

### Serial execution per space

Each space processes **one ship at a time**. [serial-one-at-a-time] When a ship arrives at
a space (via any in-port on any station), it either docks immediately
(creating a process) or is placed in a FIFO queue. [queue-fifo] No two processes
ever execute concurrently within the same space.

This applies regardless of which station the ship targets. A space
with stations A and B will never process a ship at A and a ship at
B at the same time. The serialization is per-space, not per-station
or per-port. [serial-per-space] Sibling subspaces are independent -- each is its own
space with its own queue, and they can process ships concurrently.

### The queue

Each space maintains a queue of pending ships. A ship is enqueued
when it arrives at a space that already has an active process.

```
ARRIVE(space, ship, station):
  if space.active:
    space.queue <- space.queue ++ [(ship, station)]     -- FIFO append
    return                                             -- ship waits
  else:
    space.active <- true
    DOCK(space, ship, station)                         -- create process, run block
```

When the active process completes (either synchronously or after
all async round-trips), the space dequeues the next ship:

```
COMPLETE(space):
  space.active <- false
  if space.queue is non-empty:
    (ship, station) <- space.queue.shift()              -- FIFO dequeue
    space.active <- true
    DEFER(DOCK(space, ship, station))                  -- deferred execution [queue-deferred-dock]
```

Both the dequeue and the completing process's output routing are
**deferred**. The dequeue fires first: queued ships have priority
over ships produced by the completing process's output routing. [queue-priority-routing]
If station A's `_out` routes a ship back to A's `_in` while other
ships are queued, those queued ships dock first.

### Process lifecycle

When a ship docks at a station, a process is created to run the
station's block with the effective dialect (see §4 Senders). The
process goes through these phases:

  1. **Dock**: ship arrives at station's in-port, process is created
     with the ship's sender (if any), effective dialect, and
     `__in` initialized to the ship's value [dunderin-dock]
  2. **Execute**: process runs the block's segments sequentially
  3. **Wait** (if effectful command): process waits for a response
     via a down-port -- the space remains busy
  4. **Resume** (when response arrives): process continues from
     where it was waiting
  5. **Complete**: block finishes, final value exits as a ship
     through the station's `_out` port, process is destroyed,
     space becomes available for the next queued ship

A process may also send ships to named ports during execution
(via `>@portname`), and soft errors send ships to the space's
`@out:err` port (if declared). All ships produced by the process carry
the process's sender. All port routing is deferred -- the ships
arrive at their destinations after the current process completes.

A waiting process **holds the space**. [serial-wait-holds] While a process waits for
an async response, no other ships can dock. The process has
exclusive access to the space's state for its entire lifetime,
from dock through completion.

### Sub-processes

Commands that accept block parameters (`list map`, `process run`,
`if then`, etc.) evaluate the block by creating a **sub-process**.
A sub-process:

  - Runs in the same space, with access to the same space state
  - Bypasses the queue (it is part of the active process's work) [subprocess-bypass-queue]
  - Executes synchronously and depth-first: the parent process
    waits for the sub-process to complete before continuing [subprocess-sync-dfs]
  - Can nest to arbitrary depth (sub-sub-processes, etc.)

Sub-processes are nested execution, not concurrent execution.

### Port routing and deferred entry

When a process sends to a space-level port (`>@portname`), the
port's output routing is **deferred**: the receiving station's
in-port entry is scheduled asynchronously, not executed inline. [routing-portsend-deferred]
The sending process continues immediately.

This means `>@portname` does not block the sender's process.
The routed ship arrives at the target station after the current
process completes, entering through the normal queue mechanism. [routing-after-complete]

This also applies to the implicit `_out` routing. [routing-out-deferred] Ships produced
by output routing arrive after ships already in the queue -- queued
ships have priority over newly routed ships.

### Other Daimio instances

Other Daimio instances are completely separate. A Daimio instance
has no knowledge of other instances and no interaction with them.
Inter-instance communication is entirely the outer application's
concern.

### Future: concurrent scheduling

The serial model could be relaxed to allow multiple processes to
execute concurrently within a space, interleaving at segment boundaries.
This is not currently specified. See section 14 for a summary of the
concurrent scheduling design direction, and `D2-concurrent-scheduling.md`
for the full aspirational model.


## 6. Ports, Wiring, and Demand-Creation

### Port wiring

Wiring uses two arrow types (see §3 grammar):

**`->`** (FAF — fire-and-forget): ships flow left to right
[wire-faf-no-wait]. Nobody waits. Stations and IN-N-OUT ports
can appear in the middle as double-FAF processors — a ship
enters on one side, gets processed, and a ship exits on the
other [wire-faf-double].

```
@in:click -> processor -> @out:display
@in:data -> stationA -> @down:sync -> stationB -> @out:result
```

**`<->`** (contract): one ship out, exactly one back
[roundtrip-response]. The OUT-N-IN side has a waiting process
that suspends until the response arrives [wire-contract-waits].
Exactly two endpoints. Only OUT-N-IN ports can appear on the
left; only IN-N-OUT ports (or stations) can appear on the right.

> **Algebraic aside.** `<->` binds a free monad (the OUT-N-IN
> side, which produces `Op` nodes) to an algebra (the IN-N-OUT
> side, which interprets them). Exactly two endpoints because a
> catamorphism maps one tree to one interpreter — you can't fold
> a tree into two algebras simultaneously.

```
S@down:sync   <-> T@up:handler     -- subspace down <-> sibling up
S@cmd:time:*  <-> T@up:time        -- command port <-> sibling up
@up:service   <-> stationA         -- parent's up <-> station [upport-inside-station]
S@down:sync   <-> @down:parent-fwd -- forward to parent's parent
S@cmd:*:*     <-> @cmd             -- command port forwarding [cmd-forward]
```

> **Algebraic aside.** Forwarding via `@cmd` embeds the child's
> effect into the parent's free monad: the child's `Op` node is
> re-wrapped as an `Op` node in the parent's tree, with the
> continuations chaining. The request passes through unchanged
> because the parent isn't interpreting the effect — it's
> deferring interpretation to the next level up.

**Valid positions by signal type:**

```
Signal type   In -> (FAF)              In <-> (contract)
───────────   ──────────               ─────────────────
INPUT         LHS (source)             (not valid)
OUTPUT        RHS (destination)        (not valid)
OUT-N-IN      (not valid)              LHS only
IN-N-OUT      MID or RHS              RHS only
station       LHS, MID, or RHS        RHS only
station@foo   LHS only (output)       (not valid)
```

### One-way ports (`in`, `out`)

`in` and `out` are symmetric — the same mechanism from opposite
sides of a boundary. An `in` port is INPUT from inside, OUTPUT
from outside. An `out` port is the reverse.

```
@in:click dom-on-click button1    -- DOM clicks enter space
@out:display dom-set-text counter -- ships update the DOM
@out:err                          -- soft errors (see §12)
```

One-way ports **multiplex** [port-multiplex]: an `in` port can
receive from multiple sources; an `out` port fans out to all
wired destinations (every ship is sent to every wire). This
applies to station ports (`_in`, `_out`, `station@foo`) as well.

One-way ports appear in FAF `->` chains only. They cannot
participate in contracts `<->`.

### Round-trip ports (`up`, `down`)

`up` and `down` are symmetric — the same mechanism from opposite
sides of a boundary. A `down` port is IN-N-OUT from inside,
OUT-N-IN from outside. An `up` port is the reverse. The
direction name describes the port from inside: `down` points
outward (requests go to the parent), `up` points inward
(requests come from the parent).

Round-trip ports have an in-side and an out-side fused together.
Unlike one-way ports, round-trip ports are **point-to-point**
[port-point-to-point]: exactly one wire in, exactly one wire
out. Multiple wires to either side of an up or down port is an
error (see "Space definition errors"). This constraint
is what makes the one-in-one-out guarantee possible — if the
out-side fanned out to multiple destinations, the contract
("exactly one back") would be meaningless.

Stations can also fulfill contracts (via `<->`) because each
process is one-in-one-out with respect to `_in` and `_out`: one
ship docks, one result exits [station-contract-out]. The `_out`
value is the contract response. Ships sent via `>@portname`
during execution are
separate FAF sends — they do not participate in the contract.

**The OUT-N-IN contract.** OUT-N-IN ports can only appear in
`<->` (contract) bindings — never in `->` (FAF) chains
[roundtrip-outnin-lhs]. The contract is: "I send one ship out,
you send exactly one back." Three outcomes:

  - **Response**: contract fulfilled. One out, one back.
  - **Timeout**: contract enforced. No response in time, the
    system produces the empty value (sploot).
  - **Ghost ship**: contract violated. Extra inbound ships are
    dropped with a soft error to `@out:err`.
    [upport-ghost-after-first]

**From outside (parent wiring):** OUT-N-IN ports (`S@down:`,
`S@cmd:`) use `<->` to connect to IN-N-OUT ports (`S@up:`,
`@down:`, station):

```
S@down:sync <-> T@up:handler       -- subspace needs -> sibling serves
S@down:sync <-> @down:fwd          -- forward outward to parent's parent
```

**From inside:** IN-N-OUT ports (`@down:`, `S@up:`) can appear
in `->` chains as transparent processors. OUT-N-IN ports (`@up:`)
use `<->`:

```
@up:service <-> stationA           -- up-port round-trip to station
@in:data -> @down:foo -> @out:bar  -- down-port as processor in chain
```

### Command ports (`cmd`)

**Transient** — created fresh for each effectful command
invocation and destroyed when the response (or timeout) arrives
[cmd-transient]. `cmd:` ports use `cmd:handler:method` naming
(e.g., `cmd:time:now`) [cmd-name-encode] and CANNOT appear in
space definitions — they can only be created by the command
itself. [demandport-create]

When a process invokes an effectful command:

  1. The runtime matches the command's port type against the
     **parent's** wiring rules [demandport-wire]
  2. No match (and no OTHER fallback) → the command sploots
     immediately. No port is created.
  3. Match → a transient port is created, the request is sent
     through it, and the process waits.
  4. Response arrives → delivered to the process, port destroyed.
  5. Timeout → process sploots, port destroyed.

Command ports are never cached or reused. Each invocation creates
a fresh port and re-evaluates the parent's wiring rules. This
means if the parent's rules change (e.g., via a socket
transition), the next command automatically gets the new wiring.

The **parent's** wiring rules are the gate. The subspace never
declares its effect surface — it just tries to use commands,
and the parent decides which ones are wired.

Command ports behave like down ports (round-trip, single-shot,
process waits for response) but differ in how they're created
(demand-created vs declared) and wired (pattern-matched vs
explicit route).

Demand-creation is necessary because:
  1. Block evaluation can invoke arbitrary effectful commands at
     runtime — the effect surface isn't known until the block runs
  2. Serialized spaces loaded into sockets may have unknown effect
     surfaces

**Outer space limitation.** An outer space has no parent, so
there are no wiring rules to gate its command ports — all
effectful commands in the dialect are available via their port
flavours. Dialect restrictions still apply, but port-level
restrictions do not. If you need to restrict which effects
user-provided code can access, you MUST run that code in a
**subspace** where the parent's wiring rules control the effect
surface.

### Wiring rules

Wiring rules govern command ports. They are declared in the
parent space and pattern-match against the command port name
(`cmd:handler:method`). [wiring-pattern-match]

```
WiringRule = (pattern, target, timeout?)

pattern  ::= glob               -- e.g. cmd:time:*, cmd:*:*, cmd:var:read-out
timeout? : Duration             -- explicit timeout for this wire
                                   (if absent, inherited from nearest outer
                                   wire with a value, or system default 10s)
```

Patterns use `*` as a wildcard. Matching is simple string
matching on the port name:

```
S@cmd:time:*    <-> T@up:time       -- all time commands to sibling T
S@cmd:time:now  <-> T@up:time       -- just time now
S@cmd:var:*                         -- not wired (sploots)
S@cmd:*:*       <-> @down:fwd       -- forward everything else outward
```

Rules are evaluated in order. The first matching rule determines
the target. [wiring-first-match] A trailing `S@cmd:*:*` catches
anything not matched by a previous rule (equivalent to OTHER).
[wiring-other-fallback]

The space's `defaultTimeout` (from the space definition) applies
to all wiring rules unless individually overridden.
[wiring-default-timeout]

The target of a wiring rule is one of:
  - A **station** in the same space (the station handles the
    request or receives the ship) [wiring-target-station]
  - An **up-port on a sibling subspace** (the sibling provides
    the service -- see Up-port mechanics below)
    [wiring-target-upport]
  - A **down-port on the parent's own boundary** (forwarding the
    need outward -- the parent's environment must handle it)
    [wiring-target-forward]
  - **Not wired** (no matching rule, no OTHER fallback -- the
    request sploots) [wiring-target-null]

### Down-port mechanics

A down-port is a **round-trip channel pointing outward**. Like
all round-trip ports, its signal type flips at the boundary.

**From inside** (`@down:foo` is IN-N-OUT): in a `->` chain,
the down-port acts as a double-FAF processor — a ship enters
the in-side, exits the space, and when a response arrives, it
continues forward as a new ship. No process waits; this is
routing, not suspension.

```
@in -> stationA -> @down:sync -> stationB -> @out
```

When paired via `<->`, the down-port is a true round-trip
handler (same as a station in `<->`):

```
@up <-> @down:sync     -- up-port requests resolved by down-port
```

**From outside** (`S@down:foo` is OUT-N-IN): requests come out
of the subspace and need a destination. The parent wires it
with `<->`:

```
S@down:sync   <-> T@up:handler     -- sibling serves
S@down:sync   <-> @down:parent-fwd -- forward to parent's parent
```

**Command ports** are always seen from outside (the parent
wires them):

```
S@cmd:time:*  <-> T@up:time        -- sibling serves
S@cmd:*:*     <-> @down:fwd        -- forward outward
```

**Round-trip guarantees** (apply when wired with `<->` — the
OUT-N-IN side has a waiting process):

  - The process waits. The space remains busy (serial exclusion).
    Pipeline vars and sender are preserved across the wait.
  - Exactly one response [singleresponse-one]. The port is
    occupied while the process waits and freed when the response
    (or timeout) arrives.
  - If no response arrives within the timeout, the process
    sploots (see section 7.2).

> **Algebraic aside.** The continuation `k` in `Op(request, k)`
> takes exactly one value: `k : Val → Free F a`. The free monad's
> fold calls `k` once per `Op` node. Calling it zero times leaves
> the tree stuck; calling it more than once would require a
> different monad (nondeterminism). Single-response is the only
> option for the free monad.

### Up-port mechanics

An up-port is the mirror of a down-port: a **round-trip channel
pointing inward**. Like all round-trip ports, its signal type
flips at the boundary.

**From outside** (`S@up:handler` is IN-N-OUT): the up-port
receives requests and produces responses. It appears as the RHS
of `<->` or as MID in a `->` chain:

```
S@down:sync   <-> T@up:handler    -- sibling down <-> this up
S@cmd:time:*  <-> T@up:time       -- command port <-> this up
stationA -> T@up:handler -> stationB   -- in a -> chain as processor
```

**From inside** (`@up` is OUT-N-IN): the up-port is the space's
interface for providing a service. It uses `<->` to bind to
the station that handles requests:

```
@up <-> processor                 -- bare up-port
@up:service <-> processor         -- named up-port
```

**Round-trip lifecycle** [upport-roundtrip]:

  1. A request arrives at the up-port from outside (via `<->`
     or `->` chain).
  2. The request enters the space as a ship. It docks at the
     station wired via `<->` inside (the space's own scheduling
     applies — if busy, the ship queues).
  3. The station processes the request. The station's `_out`
     becomes the response.

**First-response semantics.** From inside, the up-port is
OUT-N-IN — the ghost ship rules apply (see "Ghost ships"
above). The first response counts; extras are ghosts.
[upport-first-response] Even under serial execution, a request
may trigger multiple stations (via deferred routing) that each
produce ships reaching the out-side. Only the first counts.

If the space never produces a response (processing sploots or
routes elsewhere), the requester's timeout handles it (section
7.2).

### Example wiring

**Command port wiring** (pattern matching):
```
Parent space A contains subspaces S and T.
A.defaultTimeout = 15s

A's wiring rules for S:
  S@cmd:time:*  <-> T@up:time              -- sibling serves time
  S@cmd:var:*                              -- not wired (sploots)
  S@cmd:*:*     <-> @down:fwd              -- forward everything else
```

Time commands from S are served by sibling T. Var commands are
blocked. Everything else is forwarded outward through A's own
`@down:fwd` port.

**Declared up-port** (station coordination via `->` chain):
```
inner_def
  processor
    {__ | string uppercase}
  @up <-> processor

outer
  stationA
    {__ | string join value "-go"}
  stationB
    {__ | string reverse}
  subspace inner_def
  stationA -> inner@up -> stationB
```

stationA's output enters `inner` via its up-port. The subspace
processes it (uppercases). The first response goes to stationB.
The up-port guarantees one-in-one-out: stationB gets exactly
one ship per stationA output.

**Declared down-port** (subspace requesting external service):

Inside `inner`:
```
inner
  processor
    {__ | >@out:need}
  @in -> processor -> @out
  @up <-> processor
```

In the parent, wiring inner's down port:
```
  inner@down:fetch <-> T@up:handler
```

The parent wires `inner@down:fetch` to sibling T's up-port via
`<->`.

If A is itself inside a space Z, and Z's wire to A has a timeout
of 10s, then the effective timeout for any round trip through A is
min(A's wire timeout, Z's wire timeout). Even though A gives T
15s, Z will only wait 10s for the overall round trip. If Z times
out first, A's in-flight request becomes a ghost.

### Example: cross-boundary state access

A subspace cannot read or write its parent's space variables
directly (I8). To access the parent's state, it uses effectful
commands that send requests through down-ports:

```
{var read-out name :foo}           -- read parent's $foo via down-port
{var write-out name :foo value 5}  -- write parent's $foo via down-port
```

These are effectful commands that create transient command ports
(`cmd:var:read-out`, `cmd:var:write-out`). The parent must wire
these ports to handlers that perform the actual reads/writes on
the parent's state store.

Example wiring in the parent:
```
  S@cmd:var:read-out   <-> varReadHandler
  S@cmd:var:write-out  <-> varWriteHandler
```

Where `varReadHandler` receives the request, reads the named
variable from the parent's state store, and returns the value. If the
parent doesn't wire these ports, the commands sploot -- the
subspace simply can't access the parent's state.

This is deliberately verbose: crossing a space boundary to access
state is a significant action that should be visible in the
topology. Note that `$foo` and `>$foo` in DAML always access the
LOCAL space's state store -- they are pure segment types, not effectful
commands. Only `var read-out` and `var write-out` cross
boundaries, and only through ports [socket-crossboundary-var].


## 7. Async Boundaries

An effectful command creates an **async boundary** [async-boundary]
-- the process waits for a response. See section 6 "Down-port
mechanics" for the full round-trip lifecycle.

### Formal transition rules

**Effectful command execution:**
```
  c in effective_dialect.commands
  c is Effectful(c, params, portType)
  p = resolveOrCreatePort(space, portType)    -- see section 6
  ---
  (process, state) --[EffCmd(c, args)]--> WAIT(p, process, continuation)
```

Pipeline variables [async-preserve-vars] and sender [async-preserve-sender]
are preserved across the wait.

**Resumption:**
```
  resp in Val
  process' = waiting.process{v := resp}
  ---
  RESUME(waiting, resp) -> (process', state_current)
```

Under the current serial model, state_current is guaranteed to be
unchanged from the time of waiting -- no other process can modify space state
while this process holds the space. The "fresh reads" property is
trivially satisfied (see section 1).

### 7.2 Timeouts

Every down-port wire has a **timeout**: the maximum duration the runtime
will wait for a response before splooting.

#### Timeout values

```
Wire = {
  pattern   : WiringPattern,
  target    : WiringTarget,
  timeout?  : Duration          -- explicit timeout, or inherited
}
```

A wire's **nominal timeout** is determined by:
  1. Its own explicit timeout value, if set.
  2. Otherwise, inherited from the nearest enclosing wire in the
     chain that has an explicit value. [timeout-inherit]
  3. If no wire in the chain has an explicit value, the system
     default of 10 seconds.

Inheritance means: if spaces are nested A > B > C > D, and the
B-A wire has timeout 30s, and C-B has no explicit timeout, then
C-B inherits 30s from B-A. If D-C is explicitly set to 20s, it
stays at 20s.

#### Effective timeout

The **effective timeout** for any down-port round trip is the
minimum of all nominal timeouts along the chain from the requesting
process to the handler. [timeout-min-chain] This arises naturally from the mechanics:

If D sends a request through C through B to an external handler:
  - D-C nominal timeout: 20s
  - C-B nominal timeout: 30s (inherited from B-A)

At 20s, D-C times out. D's process sploots.
The request is still in flight from C's perspective. If the response
arrives at 25s, C receives it but D has already moved on. C fires
a soft error and drops the response.

The key property: **an outer wire's timeout is authoritative.** No
inner wire can extend the wait time beyond what the outer wire allows.
An inner wire CAN shorten the wait by having a tighter timeout.

#### Timeout and ghost response behavior

When a timeout fires, the waiting process sploots. [timeout-resume-empty]
The request is marked completed.

> **Algebraic aside.** The fold must feed a value to the
> continuation `k` for the tree to proceed. When the algebra
> (handler) fails to produce one, the empty value serves as the
> zero — the canonical "nothing happened" that lets the tree
> continue. Totality requires that every `Op` node resolves.

If a response later arrives for an already-completed request, it
is a ghost ship (see §6 "Ghost ships") and is dropped with a
soft error to `@out:err`. [timeout-ghost-drop]

#### Unwired ports

If a down port is not wired to any target (no matching wiring rule,
and no OTHER fallback), the command sploots -- no async boundary, no
timeout:

```
  p has no wiring
  c is Effectful(c, params, portType)
  ---
  (process, state) --[EffCmd(c, args)]--> (process{v := empty}, state)
  emit soft error: {type: "unwired_port", port: p}
```

This is synchronous -- the process does not wait.


## 8. Sockets and Space Serialization

### Serialized space format

A serialized space is **space syntax** (section 3) -- the textual format
for defining topology, with DAML inside station blocks. Space
syntax supports:
  - Station definitions with their DAML blocks
  - Subspace definitions (including socketed subspaces)
  - Space variable declarations with current values

```
serializedSpace = space syntax source text
```

Space syntax is the canonical serialization format. A serialized
space includes current space variable values (the main thing that
changes between the initial definition and a running snapshot).
Socketed subspaces are serialized as regular subspace definitions
-- once loaded, a socketed space is just a subspace.

A serialized space does NOT include:
  - Dialect (the Daimio instance's dialect applies)
  - Port wiring (wiring comes from the socket's parent)

### Socket-in port

A socket is any space that has a port of flavour "socket-in".

```
socketSpace = space with at least one port where flavour = "socket-in"
```

When a serialized space arrives as a ship at a socket-in port: [socket-load]

  1. **Parse** the source text (space syntax) into a space
     definition.
  2. **Compile** the definition into a spaceseed (content-addressed,
     memoized in the global table).
  3. **Instantiate** the spaceseed into a live subspace (with its
     own state store, queue, and recursively instantiated sub-subspaces).
     Ports are left unresolved -- they are demand-created on first
     use.
  4. **Add** the new subspace to the socket space. The parent's
     wiring rules apply to the new subspace's ports on demand. [socket-wiring-demand]
  5. If a previous subspace occupied this socket, **overlap**
     semantics apply (see below).

### Socket transitions: overlap

If a previous subspace occupied this socket, the transition uses
**overlap** semantics. Both subspaces are live simultaneously
until the old one finishes its work:

  1. **New subspace goes live immediately.** All newly arriving
     ships route to the new subspace. [socket-overlap-new-live]
  2. **Old subspace keeps running.** It finishes its active
     process, then processes every ship remaining in its queue,
     one at a time, in FIFO order. No new ships enter the old
     subspace -- only its existing queue drains. [socket-overlap-drain]
  3. **Old subspace is collected** when its queue is empty and
     no process is active. Its state is discarded. [socket-overlap-state-lost]

No ships are lost. [socket-overlap-no-loss] The old subspace's queued work completes
before the subspace is removed. But state does not survive the
transition -- if you need persistent state across socket swaps,
it lives outside the space (via ports to external storage). The
socket is a hot-swappable execution slot, not a state container.

### Cross-boundary space variable access

Cross-boundary state access uses effectful commands through
down-ports. See section 6 "Example: cross-boundary state access" for the
full worked example. The mechanism is always a down-port round
trip, preserving space isolation (I8).


# Part III: Blocks -- The Inner Language

## 9. Block Syntax

### Grammar

```
daml       ::= (text | command | namedblock)*

text       ::= any characters not consumed by a command or namedblock
                (including unmatched '}')

command    ::= '{' pipeline '}'

namedblock ::= '{begin' name (pipe pipeline)? '}' daml '{end' name '}'

-- Parsing algorithm --

Parsing is left-to-right.

Scan: when the parser encounters '{', it scans forward counting
'{' (+1) and '}' (-1) to find the balanced closing '}'. Matching
is purely structural: quotes and other content are not considered
[parse-brace-structural]. If no balanced '}' is found, the '{' is
literal text and scanning continues from the next character
[parse-unmatched-open].

Classify: when a balanced span '{...}' is found:

  1. If the span begins with '{begin NAME' (where NAME is one or
     more word characters), scan forward from end of span for the literal string
     '{end NAME}'. If found, the entire stretch from '{begin'
     through '{end NAME}' is a namedblock [parse-begin-end-match].

  2. Otherwise the span is a command [parse-command]. (This
     includes '{begin NAME...}' when no matching '{end NAME}' is
     found [parse-begin-no-end].)

pipeline   ::= segment (pipe segment)*

pipe       ::= '|'                      -- normal:  implicit value (chi) flows
             | '||'                     -- barrier: implicit value is blocked

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

handler    ::= name                     -- e.g. math, string, list
method     ::= name                     -- e.g. add, split, transmogrify

param_name ::= name                     -- e.g. value, to, block

value      ::= string_literal
             | number_literal
             | pvar_read
             | svar_read
             | command
             | block
             | name_literal

string_literal ::= '"' (char | command | namedblock)* '"'   [parse-string-interpolation]
number_literal ::= '-'? digit+ ('.' digit+)?    -- also exponential (3e10), hex (0x777), etc.
                                                   any string JS coerces to a number [parse-number-lit]
name_literal   ::= ':' name             -- e.g. :foo produces the string "foo" [parse-name-lit]
list_literal   ::= '(' value* ')'       -- e.g. (1 2 3), (:a :b :c) [parse-list-lit]

block      ::= '"{' pipeline '}"'       -- a quoted pipeline as a value [parse-block-quoted]
             | '"' daml '"'             -- a quoted DAML template as a value (those quotes are hard to parse)

pvar_write ::= '>' name                 -- e.g. >result, >x -- NB NO path for pvar writes!
pvar_read  ::= '_' name path?           -- e.g. _foo, _x.bar.#1
svar_write ::= '>$' name path?          -- e.g. >$count, >$user.name
svar_read  ::= '$' name path?           -- e.g. $count, $user.name

port_send  ::= '>@' name                -- send to a named space-level port

path       ::= ('.' selector)*          -- paths can also be expressed as lists
selector   ::= name                     -- Key: a literal key: .foo, .12
             | '#' integer              -- Pos: a positional (1-based) index: .#1, .#-1
             | '*'                      -- Star: all children
             | command                  -- evaluated: .{math add value 1 to 2}
```

Dot-path selectors are either **literal** (`name`, `#N`, `*`) or
**evaluated** (`{...}`). An evaluated selector is a command whose
result becomes the selector value. This is how Par works in
dot-paths: `$foo.{(:a :b)}` evaluates the list `(:a :b)`, which
becomes a Par selector [path-eval-selector]. There is no bare `()`
in dot-path syntax -- Par requires evaluation, so it uses curlies
[path-par-curlies].

### Comments

Inside a pipeline, `/` and `//` introduce comments:

  - **`/text`** — comments out one segment. The pipeline
    continues past it. `{401 /comment | add 1}` → `402`.
    [comment-single]
  - **`//text`** — comments out all remaining segments in
    the pipeline. `{401 //comment | add 1}` → `401`.
    [comment-rest]

Comments are a compile-time feature — commented segments are
removed during compilation and do not appear in the normalized
block.

### No escape sequences

DAML has no escape mechanism for curly braces. There is no `\{`
or `{{` syntax. This is deliberate:

  - An unmatched `{` (no balanced `}`) is literal text
    [parse-no-escape].
  - A lone `}` is always literal text [parse-unmatched-close].
  - To produce a balanced `{...}` as literal output (without
    evaluation), use `{string from code 123}` to emit `{` and
    `{string from code 125}` to emit `}` [parse-code-curlies],
    or use `process quote` to return a string containing DAML
    without evaluating it.

This keeps the parser simple -- structural brace matching is the
only rule, with no context-dependent escape processing.

### Concrete examples

```
{3 | math add value 2}                           -- pure command: 5
{(1 2 3) | list map block "{__ | math add value 1}"}  -- [2, 3, 4]
{$user.name | string uppercase}                  -- path + command
{>x | user fetch id :bob | _x}                   -- save, effect, restore
{:hello | >@spaceout}                            -- send to space port
{begin roe}{$name}: {$score}{end roe}            -- named template block
{$count | >@notify ||}                           -- send ship, no output
```


## 10. Block Domains

### Values
```
v in Val       -- numbers, strings, lists (the single universal collection)
```

Values are the single data type. A collection is a universal data
structure that supports ordered access (by position), keyed access
(by string key), and nesting (values can contain other values to
arbitrary depth).

### Collections: keyed and unkeyed

A collection is either keyed or unkeyed.

```
(1 2 3)            -- unkeyed (positional only)
{* (:a 1 :b 2)}   -- keyed (string keys; `*` is an alias for `list pair`)
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
  {* (:a 1 :b 2) | list values}    -- keyed to unkeyed: drops keys    [collection-values]
  {(1 2) | list rekey}              -- unkeyed to keyed: index keys   [collection-rekey]
  ```

Most other operations (peek, map, delete, iteration) work uniformly
on both keyed and unkeyed collections.

### The empty value

The empty value is the identity element. It coerces based on context:
`""` when used as a string [empty-coerce-string], `0` when used as a
number [empty-coerce-number], `[]` when used as a list
[empty-coerce-list]. This is why totality works without error values -- a missing
path, an unbound variable, or a timed-out effect all produce the empty
value, which becomes whatever zero the consuming command expects.

### Truthiness

A value is **falsy** if it is the empty value in any of its forms:
`0`, `""`, or `[]` (empty list) [truthy-falsy]. Everything else is
**truthy**: non-zero numbers, non-empty strings, non-empty lists
[truthy-truthy].

This follows from the empty value being the universal "nothing."
Truthiness is "are you something or nothing?" Commands like
`logic if`, `then`/`else`, `and`/`or`/`not`, `filter`, and
`first` all branch on truthiness.

Examples:
```
0         -> falsy                    (number zero)
1         -> truthy                   (non-zero)
""        -> falsy                    (empty string)
"0"       -> truthy                   (non-empty string)
"[]"      -> truthy                   (non-empty string)
()        -> falsy                    (empty list)
(1)       -> truthy                   (non-empty list)
(()())    -> truthy                   (non-empty list of empty lists)
```

### Splooting

To **sploot** is to emit a soft error and continue. The pipeline
is never halted [sploot-pipeline-continues]. The error is routed
to the space's `@out:err` port (if declared) [sploot-error-port]; the pipeline continues with a value determined by
the operation type.

Splooting is the mechanism behind totality: every operation that
"fails" actually succeeds -- it just succeeds with a soft error
notification on the side. What value the pipeline continues with
depends on the operation:

  - **Value-producing operations** (commands, variable reads)
    continue with the empty value [sploot-value-cmd]. The operation
    didn't produce a result, so empty is the right default.
  - **Pass-through operations** (port sends, variable writes,
    failed pokes) continue with the unchanged pipeline value
    [sploot-passthru-portsend]. The operation failed, but the
    value flows through as if the operation wasn't there.

A sploot can occur at **compile time** or **runtime**:

  - **Compile-time**: the error is detected during block
    compilation (e.g. unknown command name). The soft error is
    emitted once. The segment can be compiled away entirely --
    no runtime cost per execution.
  - **Runtime**: the error is detected during execution (e.g.
    unbound space variable, unwired port). The soft error is
    emitted each time the segment executes.

### Value semantics

Values flowing through pipelines have copy semantics at command
boundaries. A command receives its own copy of any collection it
intends to mutate. The original value in the pipeline is not affected.
From the programmer's perspective, pipeline flow is functionally pure.
Implementations may use mutation internally for efficiency (e.g.
linear types style optimization when no future references exist).

### Path expressions and accessors

A path is a sequence of selectors applied to a Val to access nested
structure. Paths appear in variable access (`$user.name`, `_x.#1.items`)
and in the four path operations: peek, poke, map, delete.

#### Selectors

Key and Pos are **affine** -- they focus on at most one location.

Star is a **traversal** -- it focuses on all existing children.

Par is a **multiplexer** -- it maps an operation across multiple paths.
Each sub-path carries its own semantics.

**Pos is 1-indexed.** `#1` is first element [pos-one-indexed],
`#-1` is last [pos-negative]. Negative positions count from the
end. Pos works on both keyed and unkeyed collections (keyed
collections are accessed by insertion order). `#0` is invalid
[pos-zero-invalid]. Any position that doesn't resolve to an
existing element sploots.

**Key access is 0-indexed.** Key with a numeric string on an
unkeyed list uses 0-based indexing [key-zero-indexed] (see Key
coercion below).

#### Key coercion

Keys in paths may be strings or numbers. Coercion depends on the
target collection:

```
String key on unkeyed list:  coerce to natural number               [keycoerce-string-unkeyed]
                              if success: 0-indexed array access
                              if failure: sploot

Number key on keyed list:    treat as string                        [keycoerce-number-keyed]

Number key on unkeyed list:  0-indexed array access                 [keycoerce-number-unkeyed]

String key on keyed list:    normal key lookup                      [keycoerce-string-keyed]
```

Examples:
```
peek([10,20,30], ["#2"])      ->  20    (Pos, 1-indexed)
peek([10,20,30], [2])         ->  30    (number key, 0-indexed)
peek([10,20,30], ["2"])       ->  30    (string coerced to nat, 0-indexed)
peek([10,20,30], ["a"])       ->  ""    (soft error: can't coerce)
peek({a:1, "2":99}, [2])      ->  99    (number key on object, as string "2")
peek({a:1, b:2, c:3}, ["#2"]) ->  2     (Pos on keyed list, by insertion order)
```

#### The four path operations

All four share the same path language.

| Operation | Adds entries? | Removes entries? | Optics analog |
|---|---|---|---|
| **peek** | No | No | get / view |
| **poke** | Yes (Key only) | No | set / put |
| **map** | No | No | over |
| **delete** | No | Yes | -- |

"Adds entries" means a key or position that didn't exist before now
exists in the collection. Only poke can do this (via Key on keyed
collections or Empty). Map can change the *value* at an existing
entry -- including replacing a scalar with a collection -- but it
never adds or removes entries from the parent collection.

#### Peek (read)

```
peek(v, []) = v                                                     [peek-empty-path]

peek(Collection, Key(s) :: rest)  =  peek(v[s], rest)               [peek-key-hit]
                                     -- or Empty                     [peek-key-miss]
peek(Collection, Pos(n)  :: rest) =  peek(v at n, rest)             [peek-pos-hit]
                                     -- or Empty                     [peek-pos-miss]
peek(Collection, Star :: rest)    = [peek(child, rest) ...]         [peek-star]
peek(Collection, Par(ps) :: rest) = [peek(v, p ++ rest) ...]        [peek-par]

peek(scalar, _ :: _) = Empty                                        [peek-scalar]
peek(Empty, _ :: _)  = Empty
```

**No scalar wrapping.** Applying any non-empty path to a scalar
always yields Empty.

**Return type is path-dependent:** if any selector in the path is
Star or Par, the result is always wrapped in a list [peek-star-wraps]
(even if empty: `[]`). If all selectors are affine (Key or Pos),
the result is a single unwrapped value or Empty
[peek-affine-unwraps]. The caller can predict the wrapping from the
path alone, regardless of data. Note: the unwrapped value itself
may be a list -- the wrapping is about whether peek adds an
*additional* list layer around the result.

#### Poke (write)

Poke writes a constant value at a path. **Only Key creates new
structure.** Everything else modifies in place or sploots.

```
poke(v, [], new) = new                    -- replace entirely           [poke-empty-path]
```

Empty-path poke replaces the value wholesale. This preserves the
lens laws (PutGet, PutPut, GetPut all hold at empty path).
Append semantics are available separately via `list union`.

**Key** -- creates on keyed collections, Empty, and scalars:

```
poke(KeyedCollection, Key(s) :: rest, new) =
  if key s exists: update val                                   [poke-key-update]
  else:            add entry                                    [poke-key-create]

poke(UnkeyedCollection, Key(s) :: rest, new) =
  coerce to nat: update that element                            [poke-key-unkeyed-coerce]
  otherwise: soft error, return unchanged                       [poke-key-unkeyed-fail]

poke(Empty, Key(s) :: rest, new) =
  create KeyedCollection                                        [poke-key-empty]

poke(scalar, Key(s) :: rest, new) =
  if affine (no Star): replace scalar                           [poke-key-scalar-affine]
  if traversal (via Star): unchanged                            [poke-key-scalar-traversal]
```

**Pos** -- modifies existing positions only:

```
poke(Collection, Pos(n) :: rest, new) =
  if position n exists: update val                              [poke-pos-update]
  else:                 unchanged -- out of bounds               [poke-pos-oob]

poke(Empty, Pos(n) :: rest, new) = Empty                        [poke-pos-empty]
poke(scalar, Pos(n) :: rest, new) = unchanged                   [poke-pos-scalar]
```

**Star** -- modifies all existing children, never creates:

```
poke(Collection, Star :: rest, new) =                           [poke-star]
  for each child: poke(child, rest, new)
  -- scalar children are skipped (see scalar rule above)

poke(Empty, Star :: rest, new) = Empty                          [poke-star-empty]
poke(scalar, Star :: rest, new) = unchanged                     [poke-star-scalar]
```

**Par** -- delegates to each sub-path, sequentially left-to-right:

```
poke(v, Par(ps) :: rest, new) =                                 [poke-par-sequential]
  for each path p in ps (left to right):
    v = poke(v, p ++ rest, new)
  return v
```

**Scalar mid-path rule (affine vs traversal):** when poke encounters
a scalar mid-path, behavior depends on whether the scalar was
reached through Star expansion:

  - **Affine (no Star above):** Key replaces the scalar and continues.
    `poke({x: 42}, [:x, :a], 99)` produces `{x: {a: 99}}`
  - **Traversal (reached via Star):** scalar children are skipped.
    `poke([1, 2, 3], ["*", :a], 99)` produces `[1, 2, 3]`

The determination is local [poke-midpath-local]: did this particular
recursive call arrive here through a Star expansion? Not "does the overall path
contain Star somewhere." This matters for Par, where different
sub-paths may have different affinity -- each sub-path is expanded
independently, so each makes its own affine/traversal determination.

#### Map (transform at focus)

Map applies a block to each value at a path focus. **Map never
adds entries** [map-no-add] -- it doesn't add keys or extend
collections. It transforms existing values in place. However, the block's return
value can be any type, so map can replace a scalar with a
collection (or vice versa) at an existing entry. If the path
doesn't reach any focus, the structure is returned unchanged.


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

map(scalar, _ :: _, block) = unchanged                              [map-scalar-unchanged]
map(Empty, _ :: _, block) = Empty                                   [map-empty-unchanged]
```

**Par-map is sequential** (same as Par-poke).

**When path is omitted, default is `("*")`** [map-default-star] -- this matches current
`list map` behavior (map over all children).

**Block receives:** [map-block-scope]
- `__` -- the value at the focus
- `_key` -- the key of the focus in its parent
- `_index` -- the index of the focus in its parent
- `_path` -- the full path from root to focus, as a list

`_path` uses **keys, not positions**, so it is **0-indexed** for
array elements. Even when the selector was Pos (e.g. `"#2"`),
`_path` records the resolved 0-indexed key.

#### Delete (remove at focus)

Delete removes the entry at a path focus. **Delete changes
collection shape** (positions shift, entries disappear). If the
path doesn't reach any focus, the structure is returned unchanged.

```
delete(v, []) = Empty                                               [delete-empty-path]

delete(KeyedCollection, Key(s) :: []) =                             [delete-key-keyed]
  remove entry with key s (no-op if missing)

delete(UnkeyedCollection, Key(s) :: []) =                           [delete-key-unkeyed]
  apply key coercion; if s coerces to nat, splice (shift)
  otherwise: soft error, return unchanged

delete(Collection, Pos(n) :: []) =                                  [delete-pos]
  if position n exists: splice (shift remaining elements)
  else:                 unchanged

delete(Collection, Star :: []) =                                    [delete-star]
  remove all children (preserve keyed/unkeyed type)

delete(Collection, selector :: rest) =
  navigate to child(ren) via selector, recurse with rest
```

**Par-delete uses collect-then-remove semantics** [delete-par-collect]. All target
positions are identified from the original structure, then removed
in reverse index order within each level. Reverse order ensures
that removing an earlier position doesn't shift later positions
before they're removed.

This differs from Par-poke and Par-map, which apply sequentially
left-to-right. Poke and map don't remove entries, so sequential
application is safe -- later sub-paths still address the same
positions. Delete removes entries, shifting indices. Sequential
positional deletes would corrupt later sub-paths.

**Overlapping Par paths.** For Par-poke and Par-map, overlapping
sub-paths are applied sequentially: the second sub-path sees the
result of the first. For Par-delete, overlapping sub-paths are
resolved from the original structure -- if both sub-paths target
the same entry, it is removed once [delete-par-overlap].

#### Path operations as commands

The four path operations are invoked as `list` commands:

```
list peek   -- params: data, path
list poke   -- params: data, path, value
list map    -- params: data, path (default "*"), block
list delete -- params: data, path
```

#### Laws

```
PutGet:    peek(poke(v, p, x), p) = x                               [law-putget]
PutPut:    poke(poke(v, p, x), p, y) = poke(v, p, y)               [law-putput]
GetPut:    poke(v, p, peek(v, p)) = v                               [law-getput]
DeleteGet: peek(delete(v, p), p) = Empty                            [law-deleteget]
DeleteDel: delete(delete(v, p), p) = delete(v, p)                   [law-deletedel]
MapId:     map(v, p, "{__}") = v                                    [law-mapid]
PokeAsMap: poke(v, p, x) = map(v, p, "{x}")                        [law-pokeasmap]
```

PutPut holds universally (poke doesn't change collection shape, so
positions are stable across consecutive pokes).

MapId (identity block preserves structure) holds universally (map
doesn't change collection shape either).

GetPut holds except when Key creates a new entry.

PutGet holds when poke actually writes. Fails on no-ops (out-of-bounds
Pos, Key soft error on unkeyed) and on traversal scalar skips.

**Positional delete shifts positions.** After a positional delete,
remaining elements shift to fill the gap (splice semantics). This
means the same Pos selector addresses a different element after
deletion. Two laws break as a consequence:

DeleteGet holds for Key and Star selectors, where identity is stable
across deletion. Fails for Pos: `delete([1,2,3], [Pos(2)])` = `[1,3]`,
then `peek([1,3], [Pos(2)])` = `3`, not Empty. The deleted element is
gone, but its successor slid into its position. Also fails for Par
sub-paths containing Pos, since Par delegates to its sub-paths.

DeleteDel (idempotent) holds for Key and Star selectors, where the
target's identity doesn't shift when it's removed. Fails for Pos:
`delete(delete([1,2,3], [Pos(2)]), [Pos(2)])` = `delete([1,3], [Pos(2)])`
= `[1]`, but `delete([1,2,3], [Pos(2)])` = `[1,3]`, so `[1] != [1,3]`.
Each successive delete at the same position removes a different element.
Also fails for Par sub-paths containing Pos.

This is not a bug -- it's inherent to positional addressing with splice
semantics. Positions are transient names: they identify a slot, not an
element. After deletion the slot is gone and its number is recycled.
Key and Star address elements by identity (key or exhaustive traversal),
so deletion doesn't invalidate the selector.

PokeAsMap holds when both would write. Diverges when focus doesn't
exist: poke creates (via Key), map skips. Also diverges on traversal
scalar mid-path: poke skips scalars through Star, but map through
Star would also skip (both unchanged), so they actually agree there.

### Blocks
```
block = (segments, flow)
  where segments : [Segment]         -- the compiled pipeline steps
        flow     : key -> [key]      -- the segment flow graph
```

A block is a compiled DAML template. It holds an array of segments
and a **segment flow graph** that describes data dependencies
between them. A station has one block. Blocks can also be passed
as values to commands (`list map`, `process run`, `if then`, etc.)
and evaluated later.

The segment flow graph is distinct from space-level wiring (section 6).
Space wiring connects ports across the topology. The flow graph
connects segments within a single block -- it is the compiled form
of pipes and pipeline variable references.

### Block compilation

DAML source is compiled into a block through a process that
resolves data flow into a static segment flow graph:

  1. **Parsing** produces tokens from DAML source text.
  2. **Munging** resolves each token's data dependencies:
     - The `|` pipe operator creates an edge from the previous
       segment's output to the next segment's first unfilled
       parameter [compile-pipe-edge].
     - `||` (barrier) breaks the implicit edge [compile-barrier-break].
     - `__` is **compiled away**: references to `__` are replaced
       with direct edges to the upstream segment
       [compile-dunder-elim].
     - `>x` / `_x` (pipeline variables) are **partially compiled
       away**: `_x` references are resolved into direct edges;
       `>x` remains for scope inheritance [compile-pvar-partial].
     - `>$x` / `$x` (space variables) are **NOT compiled away**:
       they are runtime reads/writes [compile-svar-runtime].
  3. **The result** is a block with an array of remaining segments
     and a flow graph: `{segmentKey: [inputKey1, inputKey2, ...]}`.

At runtime, a process executes each segment in order. Each
segment's output is stored by key. When a segment executes, its
inputs are looked up from the flow graph -- the keys in the graph
point to previously stored outputs. The first segment of a
pipeline has no incoming flow edges (nothing feeds into it
implicitly).

### Block identity and normal form

The compiler produces a **structural normal form** before
hashing. The normalization (`wash_keys`) does:

  1. **Dead code elimination**: segments not linked to the final
     output are removed, except side-effectful segments
     (VariableSet, PortSend, `run`) which are retained.
  2. **Key renormalization**: segment keys are rebuilt as
     sequential indices (0, 1, 2...) and wiring references are
     rewritten to match. This strips parse-order keys, which
     depend on the token counter and compilation context.
  3. **Metadata stripping**: token metadata (prevkey, names,
     inputs, original key) is removed. Only segment type and
     value survive. [compile-normalize]

The normalized block is JSON-serialized and hashed:

```
block.id = hash(JSON.stringify(normalized_block))
```

Two DAML strings that compile to the same sequence of segment
types, values, and wiring produce the same block ID —
regardless of surrounding context or compilation order.
[blockid-same] Blocks are stored in `D.BLOCKS` keyed by ID;
duplicates reuse the existing block. [blockid-dedup]

Note: this is structural equivalence, not full semantic
equivalence. Different variable names (`_a` vs `_b`) or
reordered operations produce different IDs even if they compute
the same result.

### Processes
```
process = (space, block, state, pipeline_vars, current, asynced,
           sender?, effective_dialect)
  where space             : Space          -- the enclosing space
        block             : Block          -- the block being executed
        state             : key -> Val     -- segment outputs and scope vars
        pipeline_vars     : PVar -> Val    -- pipeline variable bindings
        current           : int            -- current segment index
        asynced           : bool           -- waiting for async response?
        sender            : Sender?        -- who sent the originating ship
        effective_dialect : Dialect         -- sender.dialect intersection space.dialect
```

A process is the unit of execution. It is created when a ship docks
at a station, and destroyed when the block completes. A process
executes its block's segments sequentially, maintaining pipeline
variable bindings and tracking its position.

The effective dialect is computed at process creation (see §4
Senders) and applies to all command invocations within the process
and its sub-processes.

**Pipeline variable scope:** pipeline variables are scoped to a
single process. When a block is evaluated by a command (like
`list map`), a **sub-process** is created that inherits a snapshot
copy of the parent's pipeline vars -- all the parent's vars are
readable inside the block. But vars bound inside the block (via
`>x`) do not propagate back to the parent. The inheritance is
one-way: parent to child, never child to parent.

**Sub-processes** are synchronous and depth-first. When a command
evaluates a block, the sub-process runs to completion (or waits)
before the parent process continues. Sub-processes can nest to
arbitrary depth. Each sub-process runs in the same space, has
access to the same space variables, and inherits the parent's
sender and effective dialect.

**Async boundaries:** pipeline variables survive across async
boundaries within the same process. If a process waits at an
effectful command and later resumes, its pipeline vars are intact.
But they don't escape the process that created them.


## 11. Block Execution

A process executes a block's segments sequentially. This section
defines the transition relations for each segment type, pipe
composition, and block invocation (sub-processes).

### Template interpolation

A DAML template mixes literal text and commands. When a template
has multiple segments (text and/or commands), the compiler adds a
**terminator** that concatenates all segment outputs into a single
string [template-concat]. Each segment's output is stringified:
numbers become their string representation, lists become JSON,
empty becomes `""` [template-stringify].

If a template contains a single command and no surrounding text,
there is no terminator -- the command's value passes through with
its original type [template-single-passthru]. This is why
`{math add value 1 to 2}` returns the number `3`, but
`{math add value 1 to 2} ` (with trailing space) returns the
string `"3 "`.

### The implicit pipe value

The `|` operator sequences segments. It also automatically **fills
a parameter** of the next command. The first unfilled parameter
takes the previous segment's output. [pipe-flow] This is the core pipe mechanic:

```
{3 | math add to 5}
```

Here the value `3` flows in to the `value` parameter of `math add`,
producing `8`. The flowing value is never named; it's injected
automatically into the first unnamed parameter.

```
{2 | list range}
{2 | list range length 3}
{2 | list range length 3 start 4}
```

Note that **parameter ordering** is important.
The command `list range` is defined with parameters `length`, `start`,
and `step`, in that order. In the first example, the `length`
parameter is filled by `2`, yielding `(1 2)`. In the second, the
`start` parameter is the first unfilled parameter by definition
order, so it takes the `2`, yielding `(2 3 4)`. [pipe-fill-deforder] Only after the
first two parameters are explicitly filled is the `2` finally
allowed to infest `step`, producing `(4 6 8)`.

```
{2 |  list range length 3 step __}
{2 || list range length 3 step __}
```

What if you want to fill the `step` parameter? The implicit value
is also available explicitly as `__`. [pipe-dunder] In the first example `step`
is explicitly taking the previous pipe's value -- but `start` is
also taking the implicit piped value, yielding `(2 4 6)`.

Astute readers will have noticed the subtle difference in the
second example. The `||` construction prevents the implicit pipe
value from flowing, while still allowing the previous segment's value
to be referenced explicitly via `__`. Here `step` receives `2`
(via `__`) but `start` is truly unfilled -- no implicit value
is injected -- so it receives its declared fallback of `1`,
yielding `(1 3 5)`. (If `||` merely set the pipe value to empty,
`start` would receive `0` and the result would be `(0 2 4)`.
The distinction between "absent" and "empty" matters.) This is
useful when you want to set a specific parameter explicitly
without filling any others implicitly.

```
{( 1 2 3 ) | map block "{__ | add 1 | add __in | add __}"}
```

Pipelines can also take an initial input value, for instance when
used as part of a block applied to data, as in this example. This
does not implicitly fill a parameter in the first segment of the
pipeline, but is accessible via `__`. It is also accessible as
`__in` within any segment in that pipeline -- a fixed value, unlike
`__`, which updates after each segment. [pipe-dunderin] Note that `__` is the only
pipeline variable that updates inside a pipeline. All other `_`
var references are resolved at compile time into direct flow edges
(they get compiled down to wiring). This example takes the input
value, adds 1, adds the
input value again, and then adds that value to itself, yielding
`(6 10 14)`.

### Variables and scope

```
__         -- the implicit pipe value (injected by runtime)
__in       -- the input to the current pipeline/block (injected by runtime)
_foo       -- pipeline variable (set with >foo)
$foo       -- space variable (set with >$foo)
```

**Scope hierarchy:**
- `__`   -- previous segment value: resets each segment
- `_foo` -- pipeline variable: local to the pipeline; inherited by
  child blocks, but pvars set inside a block don't propagate back out
- `$foo` -- space variable: available within all pipelines in the
  same space [scope-svar-access]

### The `||` barrier

`||` (double pipe) breaks the implicit pipe edge entirely (see
the `list range` example above for why this matters). Pipeline
variables (`_foo`) still cross the barrier -- only the implicit
pipe edge is broken. [pipe-barrier-vars]

This is how you run independent computations in sequence within one
pipeline, using pipeline vars to stash results:

```
{some_query | >a || other_query | >b || command foo _a bar _b}
```

Without `||`, `other_query` would receive `some_query`'s result as
its implicit input, which is probably wrong:

```
{some_query | >a | other_query | ...}
                    ^ oops, other_query gets some_query's result piped in
```

A trailing `||` causes the pipeline to return the empty value instead
of its last segment's result. [pipe-trailing-empty] Useful in templating contexts where
side-effectful operations shouldn't produce visible output:

```
{$count | >@notify ||}                           -- send ship, no output
```

### Block syntax

A block is a quoted DAML string -- a program as a value. There are
two syntactic forms, but they produce the same thing:

```
"{__ | add 1}"                       -- quoted block (inline)
{begin foo}Hello, {name}!{end foo}   -- named block (multi-line friendly)
```

Both are parsed into the same Block segment via the same code path. [block-forms-equivalent]
A quoted block is DAML wrapped in quotes. A named block is syntactic
sugar: the parser transforms `{begin foo | cmd}body{end foo}` into
a pipeline where the body becomes a quoted block passed as the first
value to `cmd`. [block-named-pipe] The name exists only for matching the end tag and
readability.

Named blocks do not automatically create a variable or squelch
output. [block-named-no-squelch] To save one for reuse, pipe it explicitly:

```
{begin greeting | >$greeting ||}
  Hello, {__.name}! You have {__.count} rice balls.
{end greeting}

{$user | run block $greeting}
```

### Code as data: quote, unquote, run

DAML strings have a lifecycle between "live" (compiled, executable)
and "dead" (raw text, inert).

**Live strings (blocks).** A string literal `"{$foo}"` in DAML
source is compiled at parse time into a block [block-in-source-live].
When evaluated (as a block parameter to a command, or via
`process run`), it creates a sub-process and produces a result
[run-evaluates].

**Dead strings.** Strings that arrive from the outside world
(user input, database, network) are raw text. They are NOT
compiled and will NOT execute -- they're just data
[dead-string-inert]. String transformation commands (like
`string transform`) also kill live strings: they coerce the block
to text, operate on it, and return a dead string
[string-taints].

**Quote** (`process quote`) takes a live string and returns the
raw DAML text without evaluating it [quote-kills]. The block is
coerced to its source text. Useful for inspecting DAML or passing
it through string operations.

**Unquote** (`process unquote`) takes a dead string and compiles
it into a live block [unquote-compiles]. This is the **privilege
boundary**: it's the only runtime mechanism that turns data into
executable code. If `unquote` is not in the sender's effective
dialect, strings cannot become code [unquote-privilege].

**Run** (`process run`) evaluates a block, creating a sub-process
under the current sender's effective dialect. The block inherits
the parent's pipeline vars and sender.

The typical pattern for dynamic code execution:
```
{$user_input | process unquote | process run}
```

This compiles the string, then runs it. Both steps are required.
Without `unquote`, the string stays inert. Without `run`, the
block is just a value.

### Parameter ordering

```
{math subtract value 5 from 8}
{math subtract from 8 value 5}
```

Note that **explicit parameter ordering** is unimportant. [param-order-explicit] The
command `math subtract` has the form
`math subtract value _x from _y`, but those parameters can be
specified in either order. The ordering in the command's definition
is only relevant for the implicit value carried through the pipe.

### Alias expansion

Aliases are compile-time substitutions (see section 4, Dialect). An alias
name is replaced with a fixed pipeline fragment during the munging
phase [alias-expand-basic]. For example, `add` expands to
`math add value`, so `{add 5}` becomes `{math add value 5}`.

**Pipe-eating aliases.** Some alias expansions contain `__` (the
implicit pipe reference). For example, `then` expands to
`logic if value __ then`. When an alias contains `__`, the
implicit pipe value is consumed by the alias expansion -- it is
NOT also passed implicitly to the expanded command's first
unfilled parameter [alias-pipe-eat]. This prevents double-filling.

**Parameter threading.** Named parameters after the alias name
are threaded into the expansion. `{add 5 to 3}` expands `add`
to `math add value`, then `5` fills the dangling positional slot
and `to 3` maps to the `to` parameter of `math add`
[alias-param-thread].

**Dialect gating.** Aliases are part of the dialect. If an alias
is removed from a restricted dialect, it is unavailable -- using
it sploots [alias-dialect-gate]. Note that alias expansion happens
at compile time, but the expanded command is still checked against
the effective dialect at runtime.

**Multiple invocations.** Each invocation of an alias in a
pipeline gets fresh internal keys. This ensures that multiple
uses of the same alias (e.g. `{({1 | then :yay} {0 | then :boo})}`)
don't corrupt each other's wiring [alias-multi-invoke].

### Transition relation for synchronous steps

We write:

```
(process, state) --[seg]--> (process', state')
```

to mean: executing segment seg with process state `process` and
space variable store `state` produces new process state `process'` and
new store `state'`. Here `process.v` is the current pipeline value and
`process.env` is the pipeline variable bindings.

**The pipe value `process.v` is either a Val or `absent`.** [pipe-absent]
At the start of a pipeline, `process.v = absent`. After `|`, it holds
the previous segment's output (a Val). After `||`, it is reset to
`absent`. The `absent` state has two roles:

  1. **Implicit parameter filling:** when `process.v` is absent, no
     implicit parameter filling occurs -- unfilled params receive their
     fallback or default value. This single mechanism explains both the
     first-segment behavior (no implicit fill) and the barrier behavior
     (no implicit fill).
  2. **Value consumption:** when a transition relation consumes
     `process.v` as a value (not for implicit filling), `absent` is
     treated as `empty`. This is the only coercion rule for `absent`:
     it is not a distinct observable value, just a signal to skip
     implicit filling.

We define a helper for clarity: [absent-coerce-empty]

```
val(process.v) = process.v   if process.v is a Val
val(process.v) = empty        if process.v is absent
```

WriteSVar, WritePVar, and PortSend all use `val(process.v)` because
they consume the pipe value as data, not for parameter filling. PureCmd
and EffCmd use `fillImplicit(args, process.v)`, which handles `absent`
directly (by skipping implicit filling).

**Pure command:**
```
  c in effective_dialect.commands   (command is in the effective dialect)
  c is Pure(c, params, fun)
  args' = fillImplicit(args, process.v)     -- see below for absent handling
  v' = fun(args')
  ---
  (process, state) --[PureCmd(c, args)]--> (process{v := v'}, state)     [total-cmd-value]
```

**Parameter filling** (`fillImplicit`) works in two passes:

  1. **Explicit params** are matched by name. `{math add value 5 to 3}`
     binds `value=5` and `to=3` regardless of definition order.
  2. **The implicit pipe value** fills the first parameter (by definition
     order) that was not explicitly provided -- but only when `process.v`
     is a Val (not absent). When `process.v` is absent, this step is
     skipped entirely: no parameter receives an implicit value.
     [pipe-fill-one]
     `{2 | math add value 5}` means math.add receives 2 as its
     implicit first unfilled param (`to`) and 5 as `value`. But
     `{2 || math add value 5}` means `to` is unfilled (absent pipe),
     so it gets its fallback value of 0.

**Type coercion.** Daimio's type system exists only at command
boundaries. Values flowing through pipelines are untyped. When a
value enters a command parameter, it is coerced to the param's
declared type. There is no type checking and no type errors --
coercion is total, always producing a value of the expected type
[coerce-total].
This is a deliberate choice: totality over type safety.

Each command param declares a type in its definition (e.g.
`{key: 'value', type: 'number'}`). The available types are fixed:

```
list     -- scalars wrap to single-element list; empty -> [] [coerce-list]
string   -- numbers stringify; empty -> "" [coerce-string]
number   -- strings coerce numerically; empty -> 0; NaN -> 0 [coerce-number]
integer  -- like number, then rounded [coerce-integer]
block    -- compiled block refs become evaluable; strings pass through [coerce-block]
             (strings must be explicitly compiled via `process unquote`)
anything -- passed through (with empty normalization) [coerce-anything]

either:A,B -- if the value matches type A, coerce as A; [coerce-either]
             otherwise coerce as B. Used for params that
             accept e.g. a block or a string key.
```

Passing `"hi"` to a param of type `list` produces `("hi")`, not
an error. Passing `"hello"` to type `number` produces `0`. The
empty value coerces to each type's zero: `""`, `0`, `[]`, etc.

**Unfilled optional params** receive the empty value, coerced to
their declared type (e.g. `""` for string, `0` for number, `[]`
for list). [param-unfilled-default] If the param has a `fallback` defined, the fallback is
used instead.

**Required params:** if a param is marked `required` and receives
no value (not from explicit naming, not from implicit pipe filling,
and no fallback defined), the command sploots. [param-required-sploot]

**Unknown param names** are silently ignored. [param-unknown-ignored] The command only
reads params declared in its definition. Supplied names that don't
match any declared param are compiled but never consumed -- the
command executes as if they weren't there.


**Dialect check:** if c is not in effective_dialect.commands, the command
sploots instead of executing. [dialect-cmd-sploot] This is a
value-producing sploot, not a pass-through: the blocked command produces
nothing, so the pipeline gets the empty value (just like an unwired
effectful command or a missing required param).

```
  c not in effective_dialect.commands
  ---
  (process, state) --[PureCmd(c, args)]--> (process{v := empty}, state)
  emit soft error: {type: "dialect_blocked", command: c}
```

**Read space variable:**
```
  v' = peek(state(s), path)    (read current value at path -- always fresh)
  ---
  (process, state) --[ReadSVar(s, path)]--> (process{v := v'}, state)
```

If s is unbound in state, or path doesn't match, the result sploots
(empty value + soft error to the space's `@out:err` port). [svar-read-unbound-sploot] This aids debugging --
a typo in a variable name produces an observable error -- while
the pipeline continues normally with the empty value.

**Write space variable:**
```
  state' = state[s := poke(state(s), path, val(process.v))]
  ---
  (process, state) --[WriteSVar(s, path)]--> (process, state')
```

If path is empty, this sets s directly. [svar-write-path] See section 10, Path expressions, for
full poke semantics: Key creates on keyed/Empty/scalar (affine only),
Pos only modifies existing, Star only modifies existing children,
Key on unkeyed lists coerces or soft errors.

**Read pipeline variable:**
```
  v' = peek(process.env(x), path)
  ---
  (process, state) --[ReadPVar(x, path)]--> (process{v := v'}, state)
```

If x is unbound or path doesn't match, the result is empty (totality). [pvar-unbound-empty]

**Write pipeline variable:**
```
  env' = process.env[x := val(process.v)]
  ---
  (process, state) --[WritePVar(x)]--> (process{env := env'}, state)
```

Pipeline variable bindings are write-once within a synchronous segment
(SSA). [scope-pvar-writeonce] Rebinding is a compile-time error for _vars within a segment.

**Port send:**
```
  portname exists on this station (declared by a route)
  ---
  (process, state) --[PortSend(portname)]--> (process, state)
  schedule deferred: ship(val(process.v), process.sender) -> portname

  portname does not exist on this station
  ---
  (process, state) --[PortSend(portname)]--> (process, state)
  emit soft error                       -- pass-through: pipeline value unchanged [portsend-missing-sploot]
```

The pipeline value is unchanged -- PortSend passes it through. [station-portsend-passthru]
The actual ship send is **deferred**: it is scheduled to execute
after the current process completes (see section 5 "Port routing and
deferred entry"). The deferred ship carries the process's sender.

The port must be declared by a route in the space definition. A
station cannot send to arbitrary ports -- only to ports the space
definition explicitly wired. This prevents untrusted code from
sending ships to ports it shouldn't have access to.

**No implicit fill on first segment.** At the start of a pipeline,
`process.v = absent` (see "The pipe value" above). The `|` operator
creates edges in the segment flow graph (see section 10 "Block
compilation"); the first segment has no incoming flow edge.
Since `process.v` is absent, `fillImplicit` skips implicit filling --
nothing is injected into the first segment's unfilled parameters. The
pipeline's input is accessible explicitly as `__` and `__in`,
but does not implicitly fill any parameter of the first segment. [pipe-fill-first-none]

**Pipe composition:**
```
  (process, state) --[seg1]--> (process1, state1)
  (process1, state1) --[seg2]--> (process2, state2)
  ---
  (process, state) --[seg1 | seg2]--> (process2, state2)
```

**Barrier pipe composition (||):**
```
  (process, state) --[seg1]--> (process1, state1)
  process1' = process1{v := absent}     -- no implicit filling for seg2 [compile-barrier-break]
  (process1', state1) --[seg2]--> (process2, state2)  -- env (pipeline vars) preserved
  ---
  (process, state) --[seg1 || seg2]--> (process2, state2)
```

Setting `process.v` to `absent` (not `empty`) means `fillImplicit`
skips entirely — see "The `||` barrier" above for the rationale
and examples. [pipe-barrier-absent] `__` still works across `||`
because `__` references are compiled into direct flow edges
(section 10), not runtime reads of `process.v`.

A trailing `||` with no following segment returns empty:
```
  (process, state) --[seg1]--> (process1, state1)
  ---
  (process, state) --[seg1 ||]--> (process1{v := empty}, state1)
```

(Trailing `||` returns `empty`, not `absent` — no subsequent
segment needs the distinction.) [pipe-trailing-empty]

**Literal:**
```
  (process, state) --[Literal(v)]--> (process{v := v}, state)   -- [literal-produces-value]
```

### Block invocation

Commands that accept block parameters (`list map`, `list reduce`,
`if then`, etc.) evaluate the block by creating a synchronous,
depth-first **sub-process** (P-uniformeval).

```
{(1 2 3) | list map block "{__ | math add value 1}"}
{$items | list reduce block "{_total | math add value _value}" with 0}
```

**Scope** when a command creates a sub-process for a block:

  1. The sub-process **inherits the parent's pipeline vars**. All
     pipeline variables bound before the block was invoked are
     readable inside. [scope-pvar-inherit] This is safe because pipeline vars are
     write-once — the sub-process gets a copy of frozen values.
  2. The command **injects scope variables** on top of the inherited
     vars. Standard injected names:
       `_value`       -- the current item being processed [scope-inject-value]
       `_key`         -- the current item's key (for keyed collections) [scope-inject-key]
       `_index`       -- the current item's index [scope-inject-index]
       `_total`       -- accumulator value (for reduce/fold) [scope-inject-total]
     Injected vars shadow parent vars of the same name.
  3. `__in` is initialized based on context [pipe-dunderin-first]:
     - **Station process** (dock): `__in` = the ship's value
       [dunderin-dock]
     - **`list map` / `list each`**: `__in` = the current element
       (`_value`) [dunderin-map]
     - **`list reduce`**: `__in` = the current element (`_value`)
     - **`process run` with value param**: `__in` = the value
       param [dunderin-run]
     - **`process run` without value**: `__in` = empty
     At the start of any pipeline, `__ = __in`.
  4. The sub-process executes in the same space as the parent, under
     the same effective dialect, with the same sender, and with
     access to the same space variables.
  5. Pipeline vars bound inside the sub-process (via `>x`) do NOT
     propagate back to the parent. [scope-pvar-no-propagate] The sub-process's env is its own.

Every process runs under its effective dialect (§4 Senders). A
program received as data inherits the sender and effective dialect
of whatever process evaluates it.

### Atomicity guarantee

Under serial execution (§5), the active process has exclusive
access to space state for its entire lifetime -- including across
async boundaries (I6).

#### Pipeline Segments
```
seg ::= PureCmd(c, args)           -- invoke a pure command
      | EffCmd(c, args)            -- invoke an effectful command (async boundary)
      | ReadSVar(s, path)          -- read a space variable (with optional path)
      | WriteSVar(s, path)         -- write pipeline value to space variable
      | ReadPVar(x, path)          -- read a pipeline variable (with optional path)
      | WritePVar(x)               -- bind pipeline value to pipeline variable
      | PortSend(portname)         -- send pipeline value to a space-level port
      | Literal(v)                 -- a literal value
      | Block(daml)                -- a quoted DAML string as a value

pipeline ::= seg1 pipe seg2 pipe ...  -- sequential composition
pipe     ::= '|' or '||'             -- normal pipe or barrier pipe
```


## 12. Errors

Daimio is total. Commands do not throw exceptions. When something
goes wrong, the operation **sploots**: it emits a soft error and
continues (see section 10, "Splooting").

Conditions that sploot, with their continuation value:

```
Value-producing (continue with empty):
  - command not in effective dialect                         [dialect-cmd-sploot]
  - effectful command with unwired port (no async)          [effectful-unwired-sploot]
  - timeout on down-port response                           [timeout-resume-default]
  - unbound space variable read                             [svar-read-unbound-sploot]
  - required param missing                                  [param-required-sploot]

Pass-through (continue with unchanged value):
  - port send to nonexistent port                           [portsend-missing-sploot]
  - key coercion failure in poke/delete                     [poke-key-unkeyed-fail]
  - Key poke on unkeyed list (no promotion)                 [sploot-passthru-poke]

Dropped (no pipeline to continue):
  - ghost response (arrived after completion)               [timeout-ghost-drop]
```

When splooting:
  1. A soft error is emitted as a ship to the space's `@out:err` port
     (if declared). The error ship carries the process's sender.
  2. The pipeline is NOT halted.
  3. The pipeline continues -- with empty for value-producing
     operations, or with the unchanged value for pass-through
     operations.

**Error routing.** Soft errors route to the **space's** `@out:err`
port, not to a per-station port. The `@out:err` port is a declared
port in the space definition, like any other:

```
@out:err                                    -- generic out flavour
@out:err -> {__ | >@out:log}               -- route errors to a logger
@out:err -> @out:error_fwd                 -- forward to space boundary
```

If no `@out:err` port is declared, errors are silently dropped. The
pipeline continues either way -- `@out:err` is for observability,
not control flow. [error-unwired-dropped]

Ghost ships (see §6 "Ghost ships") also send a soft error to
`@out:err` before being dropped.

This is analogous to IEEE 754 NaN propagation: errors flow
through the pipeline as values, rather than interrupting control
flow.


## 13. Security Analysis

This section traces attack vectors against the model and shows
how the invariants defend against them -- or where the defense
depends on configuration.

### Privilege escalation via block evaluation

**Attack:** Alice stores a malicious block in a space variable.
Bob's ship triggers `{$alice_block | process unquote | run}`.
Bob has admin dialect. Alice's code runs under Bob's authority.

**Defense:** The sender's effective dialect is the intersection
of sender.dialect and space.dialect (I4). Bob's process runs
Alice's code, but under Bob's effective dialect -- which is
`Bob.dialect intersection space.dialect`. If Alice's code tries commands
outside that intersection, they sploot. The risk is when Bob's
dialect is MORE permissive than Alice intended -- Alice's code gets
more power than she designed for.

**Mitigation:** `process unquote` is the privilege boundary. It
converts strings to executable code. If `unquote` is not in the
sender's dialect, arbitrary code blocks are inert strings. The
restricted dialect blocks `unquote` by default.

### Privilege escalation via socketed spaces

**Attack:** Alice loads a space into a socket. Bob sends a ship
into the outer space, which routes to Alice's socketed space.
Alice's space contains stations that do powerful things.

**Defense:** Alice's space runs under Bob's effective dialect.
The sender propagates through all port routing, including into
subspaces (I3). Alice's stations can only execute commands in
Bob's effective dialect. Additionally, Alice's socketed space
can only cause effects through ports that the parent wired (I11).
Unwired ports sploot (I10).

**Residual risk:** If the socket's wiring is permissive AND Bob's
dialect is permissive, Alice's code has broad capability. Socket
wiring should be as restrictive as the use case allows.

### TOCTOU on space variables (concurrent model only)

**Attack:** Under the aspirational concurrent model, ship A reads
`$balance`, goes async, and writes `$balance - amount` after
resumption. Ship B does the same concurrently. Both read the same
balance, both subtract, double-spend.

**Defense under current model:** Serial exclusion (I5) prevents
this entirely. One ship at a time per space. Ship B is queued
until Ship A completes.

**Defense under concurrent model:** Not fully mitigated. The
concurrent scheduling design discusses potential mitigations: MVCC
snapshots, compare-and-swap, advisory locking. None are in the
current spec. If concurrent scheduling is enabled for a space,
the space author must design for it.

### Regex denial of service

**Attack:** A sender provides a string that triggers catastrophic
backtracking in a regex command (e.g. `string grep`).

**Defense:** The restricted dialect sets a policy flag
`no_user_regex` that disables user-provided regex patterns.
Commands that accept regex can check this policy and sploot if
the sender's dialect disallows it. This is a dialect-level
defense, not a runtime defense -- a permissive dialect can still
be vulnerable.

**Residual risk:** A sender with regex permission can still craft
pathological patterns. The energy/resource limits (section 14)
would mitigate this by capping CPU time per sender.

### Denial of service via resource exhaustion

**Attack:** A sender submits a program with deep recursion,
infinite loops via space variable manipulation, or massive data
construction.

**Defense (partial):** Totality (I1) prevents crashes but not
resource exhaustion. Liveness (I9) guarantees effectful operations
resolve via timeout. But pure computation has no built-in limit --
a tight loop of pure commands can consume unbounded CPU.

**Mitigation:** Resource limits are deferred to section 14 (Future Work).
Currently, the outer application is responsible for monitoring
and killing runaway processes.

### Cross-space information leakage

**Attack:** A subspace tries to read its parent's space variables
directly, bypassing the port interface.

**Defense:** Space boundary opacity (I8). All cross-boundary
communication goes through ports. A subspace cannot read or write
its parent's state store directly. Cross-boundary state access requires
an explicit effectful command (`var read-out`, `var write-out`) through a
down port, which the parent must wire to a handler. If the parent
doesn't wire it, the request sploots.

### Sender spoofing

**Attack:** A malicious entity sends a ship with a forged sender
(claiming to be an admin).

**Defense:** Daimio does not authenticate senders -- this is
explicitly the App's responsibility. Daimio trusts whatever
sender the App provides. If the App's authentication is broken,
Daimio's dialect confinement is bypassed.

**Mitigation:** The sender authentication mechanism (section 14)
would add cryptographic verification at the outer space
boundary. Until then, the App MUST validate sender identity
before passing ships into the outer space.

### Port wiring as attack surface

**Attack:** A socketed space declares ports that match wiring
rules the parent didn't intend to expose.

**Defense:** Wiring authority (I11). The parent controls ALL
wiring for its subspaces. A subspace can only declare ports -- it
cannot wire them. The parent's wiring rules determine what each
port connects to. The OTHER fallback in wiring rules is a
catch-all that the parent explicitly configures. If a port
doesn't match any rule and there's no OTHER, it sploots.


### Dialect confinement proof (runtime eval)

Now that runtime code evaluation is consolidated to a single path
(`process unquote` then `process run`), we can enumerate every
execution path and verify dialect enforcement is complete.

**Claim:** Given effective dialect D_eff = sender.dialect intersection
space.dialect, no DAML expression executing under D_eff can invoke
a command outside D_eff.

**Proof by path enumeration:**

| Path | Where checked | Mechanism |
|------|---------------|-----------|
| Command dispatch | `m_command.js` execute | `dialect.get_method()` before every `run_fun` call |
| Optimizer fast paths | `OPT_simple_math`, `OPT_simple_peek` | `dialect.get_method()` at top of execute |
| `process run` (block eval) | `datatypes/block.js` then `real_execute` | Inherits `process.sender`; new Process recomputes D_eff |
| Implicit block eval (pipe) | same as above | Same `datatypes/block.js` path |
| Station docking | `port_standard_enter` then `Space.dock` | Sender extracted from process, forwarded through port pair |
| Subspace crossing | `Space` constructor | `this.dialect = parent.dialect` (I2 monotonicity); sender intersected at Process creation |
| Alias expansion | `n_alias.js` (parse) + `m_command.js` (runtime) | Aliases expand unconditionally at parse time; resulting Command checked at dispatch |
| `D.run` boundary | `execute_then_stringify` | Sender forwarded to block re-execution context |

**Key invariants this depends on:**

- Blocks are compiled without dialect checks; dialect is enforced
  fresh at every execution. This enables the same block to run
  under different authority levels.
- `D.is_block` requires `instanceof D.Segment` -- blocks cannot be
  forged from DAML data values.
- No DAML command creates, modifies, or exposes sender objects.
  Senders are App-level only.
- `intersect_dialects` uses AND logic: both sender and space must
  allow a command for it to execute.
- Policy flags (e.g. `no_user_regex`) merge with OR logic:
  either restriction wins.

**What this does NOT cover:**

- DoS via `D.BLOCKS` cache growth. Every `unquote` call allocates
  a compiled block that is never evicted. A loop generating novel
  strings is a slow memory leak.
- Alias information leakage. Aliases expand at parse time from the
  global `D.Aliases` table, not through dialect gating. A blocked
  command produces a diagnostic error revealing its existence.
- Sender authentication. The App is responsible for verifying
  sender identity before passing ships into the outer space
  (see section 14).


## 14. Future Work

Things we've thought about and deliberately deferred. These are
not TODOs -- they're design directions that are out of scope for
the current spec but inform where the system is heading.

### Concurrent scheduling

The current serial model (one ship at a time per space) could be
relaxed to allow segment-level interleaving within a space. This
would increase throughput when ships are waiting on effects, at
the cost of introducing TOCTOU hazards on shared space variables.
Concurrency would be a per-space opt-in.

### Content-addressed editor

Blocks and spaces are content-addressed, which means copy and
paste is automatically deduplicated. An editor built on this
property could track the structural sharing graph: when you modify
a copy, you choose whether it's a specialization or a change to
propagate to all instances. The content-address graph becomes a
version history where changes flow like merging branches. You
don't have to choose between abstraction and copying -- you get
both.

### Per-subspace dialects

Currently, the dialect is a property of the outer space and all
subspaces inherit it. Subspace restrictions come entirely from
wiring. A future extension could allow subspaces to have their
own further-restricted dialects, giving finer-grained control.
This would require dialect intersection at each space boundary
instead of once at dock time.

### Virtual round-trip pairing

Currently, an up-port from inside can only `<->` with a single
station. For complex resolution (multi-station pipelines), you
must push the complexity into a sub-subspace. A future extension
could allow composing an ad-hoc round-trip from two FAF ports:
`S@cmd:time:* <-> T@in:request+T@out:response`. This would let
any space with an in and out port serve round-trips without
declaring an up-port. Deferred because the up-port abstraction
handles most cases and the `+` syntax adds complexity.

### Per-space PRNG

Currently, the PRNG is per-instance — all spaces in the hierarchy
share one sequence. This means a subspace's random values depend
on how many `math random` calls other spaces have made. A
per-space PRNG would give each space its own sequence, seeded from
the parent's PRNG at instantiation time. Advantages: a subspace's
random sequence depends only on its own execution, not on sibling
activity. The same spaceseed loaded into different contexts
produces the same random sequence (supporting P-portable). This
matters most for socketed spaces, where the same space definition
should behave identically regardless of surrounding context.

### Sender authentication

Currently, Daimio trusts senders -- the App is responsible for
authentication. A future layer could build authentication into
the sender model: signed messages, capability tokens, or HMAC
verification at the outer space boundary. The sender's identity
would be cryptographically verified before the dialect is looked
up.

### Energy and resource limits

Two separate mechanisms:

**System-wide yield.** Every process yields after a fixed time
slice (e.g. 100ms). This is not per-sender -- it's a global
scheduler property. No process can monopolize a space. When the
yield fires, the process goes async and resumes on the next tick.
Other queued ships and deferred routing get a chance to run. From
the process's perspective, the yield is transparent.

**Per-sender energy budget.** Each sender has an energy cap (set
by the App). Every operation consumes energy -- segment execution,
sub-process creation, memory allocation. The App manages the
budget externally: how it recharges, what the cap is, how costs
are weighted. Daimio enforces the cap and reports energy consumed
on outbound ships, so the App can update its accounting.

Open questions:

  - **Process termination.** What happens when a process exhausts
    its sender's energy? If the process is killed immediately,
    it releases the space for other ships -- but serial exclusion
    means the space was blocked while the process ran, and killing
    mid-execution leaves questions about state.

  - **State consistency.** If a killed process had already written
    space variables, are those writes visible? Do they stay
    (potentially inconsistent state) or get rolled back
    (transactional, but expensive and surprising)? This also
    affects subspace state if the process triggered work in
    subspaces.

  - **Partial output.** What exits through `_out` when a process
    is killed? The value at the point of termination (probably
    empty)? Or does the pipeline fast-forward through remaining
    segments with empty values (similar to splooting everything,
    but without soft errors for each)? Fast-forwarding may produce
    strange results.

  - **Error reporting.** Does killing emit a soft error to the
    space's `@out:err` port? How does the App learn
    that a process was killed for energy exhaustion vs completing
    normally?

  - **Energy distribution across wiring.** If a process completes
    with 100 energy remaining and its output is wired to two
    different stations, how is the remaining energy split? Does
    each receiver get 100? 50 each? Does the energy budget
    transfer to the next process at all, or reset per-dock?

  - **Resumability.** Can a killed process resume later if energy
    is replenished? Or is termination permanent -- the ship is
    lost and the sender must re-send?

  - **Sub-process energy.** Do sub-processes (from block
    evaluation) share the parent's energy budget? They should,
    since sub-processes are the mechanism for recursive
    computation. Infinite recursion should drain the budget, not
    bypass it.

  - **Energy and the yield.** How do the two mechanisms interact?
    The yield is time-based (wall clock). The energy budget is
    operation-based (step count). A process could yield many times
    (long-running but cooperative) without exhausting energy, or
    exhaust energy within a single tick (tight loop).

### Composite commands

App-defined commands built from existing DAML commands. An app
could register new handler/method names that expand to DAML
programs at invocation time -- similar to aliases but with
parameters, dialect gating, and the ability to be shared across
spaces.

### Parameter-level dialect restrictions

Currently, dialects restrict at the command level -- a command is
either available or not. A future extension could restrict at the
parameter level: allow `db query` but deny `sql` values matching
certain patterns, or allow `asset send` only to whitelisted
recipients.

### Remove the exec port

The exec port is a legacy mechanism for running dynamic code with
metadata threading (the "secret" hack). The sender model makes it
obsolete: sender identity propagates automatically through all
ports, and dynamic code execution is handled by
`{process unquote | process run}` with explicit pipeline data
flow. Removing exec eliminates three core hacks (secret stashing
in port_standard_enter, station_id undefined in portsend, process
threading through port exit).

### Apps, Rooms, and higher-level architecture

Daimio provides the execution layer. Above it sits the App layer:
frontend spaces (UI), backend spaces (effects), rooms (multiplayer
broadcast), and the routing between them. An App connects multiple
actors to multiple spaces with different dialects and different
resource backends. This architecture is sketched in `extra/D_new.txt` but not yet specified.

### OCapN integration

Daimio's sender/dialect model is conceptually close to object
capabilities: a sender's dialect is an unforgeable set of
permitted operations, analogous to a capability set. The
**OCapN** (Object Capability Network) pre-standard defines
CapTP (Capability Transport Protocol) for messaging between
distributed capability-secured objects, with promise pipelining
and secure third-party handoffs.

If a Daimio-powered App uses CapTP for messaging between
machines, it can integrate Daimio's dialect restrictions
directly into its capabilities. The mapping is natural: a
CapTP capability received from a remote peer becomes a Daimio
sender whose dialect is derived from the capability's
attenuation. Daimio output carrying a sender becomes a CapTP
message with the corresponding capability. Daimio itself
doesn't change — it just sees senders with dialects, same as
always. The App is the bridge.

This would allow interoperation with Spritely Goblins, Agoric,
and any future OCapN-compatible system, positioning
Daimio-powered apps as nodes in the emerging capability-secure
distributed computing ecosystem.

### TODA integration

First-class digital assets via TODA files. Your user account,
relationships, and assets become portable, self-sovereign objects
that don't need to live on someone else's server. Combined with
self-authenticating messages, this enables channel-independent
identity and Bring Your Own Backend -- you carry your assets and
computational resources into any app.


## 15. Related Work

Several systems address overlapping parts of Daimio's problem
space: programmable applications, multi-user code sharing, and
capability-secured execution. Daimio was not designed from these
systems — it grew from its own motivations (§0) — but they
are interesting neighbors.

**LambdaMOO** (Curtis, 1990). Users write code in a shared
live environment. The system sandboxes execution with tick
limits, recursion limits, and quotas. The closest precedent for
multi-user end-user programming. Uses ACL-based security (owner
permissions on objects/verbs), not capabilities.

**Sandstorm.io** (Varda, 2014). Capability-based web
application platform using containerized "grains" with
Powerbox-mediated capability grants. Operates at the application
level (composing pre-built apps), not the language level
(writing and sharing code within apps).

**Spritely Goblins and OCapN** (Lemmer-Webber, 2019). The
most principled capability-secure distributed programming model,
based on Mark Miller's E language. Targets developers writing
Scheme, not end users writing piped commands. The
object-capability formalism ("what you hold onto is what you can
do") is a natural fit for Daimio's dialect model — see §14
"OCapN integration."

**Agoric / Hardened JavaScript** (Miller, Tribble, 2018).
Capability security at production scale in a mainstream
language. SES Compartments with attenuated endowments are
conceptually similar to dialect subsetting. Demonstrates that
the approach works in practice.

**Roblox / Luau**. Capability-constrained end-user programming
at global scale (380M monthly active users). Sandboxed
execution with isolated global tables and controlled API access.
The closest production analog to dialect + wiring restriction.

**Croquet / Multisynq** (Kay, Smith, Reed, 2003). Replicated
computation for peer-to-peer collaboration. Strict Model/View
separation and deterministic replay. The determinism constraint
makes casual user scripting harder than Daimio's model.

**The E language** (Miller, 1997). The theoretical ancestor of
most capability-secure systems in this list. E's vat model
(single-threaded event queue per process) is structurally
similar to Daimio's serial execution per space. Miller's 2006
thesis *Robust Composition* provides the formal foundations
for object-capability security.
