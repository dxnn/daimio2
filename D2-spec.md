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
the data, the assets, the backend, and the process of using it —
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

TODO: dig into this more, make it sing. bring back the original words.

**1. Control your process.** You shouldn't need to use an
application's UI to use an application. You should be able to
send a program that expresses your intent. Then you can make any
interface you want. You can automate any sequence. You can adapt
the process to your needs, not the other way around. Daimio makes
this work through uniform evaluation (§1): a program received as
data executes under exactly the same rules as built-in code,
constrained by the sender's dialect.

**2. Full multiplayer, everywhere.** Why can't your friends and
family and robot assistants just pile in and work alongside you?
Daimio is multiplayer by default. Multiple actors share a space,
each with their own dialect — a restricted set of commands that
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
message arrives — letter, WebSocket, carrier pigeon — the receiver
can verify it's you and act accordingly. Daimio supports this
through channel-independent senders (§4): identity rides on the
ship, not on the transport.

Our digital experiences today make our lives more impoverished
than they need to be. Everything is rigid and locked down. Daimio
is part of changing that.

## 1. Properties of the Model

### Totality [P-total]
Every command returns a value. Every port access either succeeds or
sploots (emits a soft error and continues — see §10). No
pipeline ever crashes or diverges (assuming commands are total, which
is a requirement on command definitions). The empty value coerces to
`""`, `0`, or `[]` as needed, so it always flows cleanly through subsequent
commands. See §10 "Splooting" for the definition.


### Copy semantics [P-copy]
Values flowing through pipelines are functionally pure from the
programmer's perspective. A command receives its own copy of any
collection; mutations inside a command don't propagate back to the
caller's pipeline. Implementations may optimize with mutation when
no future references exist (linear types style), but the observable
behavior is always as-if copied.

### Dialect confinement [P-dialect]
Every process runs under an effective dialect: the intersection of
the sender's dialect (if the ship carries a sender) and the outer
space's base dialect. The effective dialect is computed once at dock
time and inherited by all sub-processes, block evaluations, and port
routing. There is no mechanism for privilege escalation during
execution — a received program, a block passed as data, or a space
loaded into a socket all run under the effective dialect. Commands
outside the effective dialect sploot. This is the core security
property: the space owner controls the base dialect, the App
controls sender dialects, and the intersection guarantees neither
party can escalate beyond the other (§0.2).

### Serial execution [P-serial]
Each space processes one ship at a time (see §5). The active
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
satisfied — no other process can modify space state during your execution.
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
around as values — evaluating a block cannot corrupt the caller's
state.

### Space isolation [P-spaceisolate]
Spaces are fully isolated containers. A subspace cannot read or
write its parent's space variables directly — all cross-boundary
communication goes through ports. This applies at every level of
nesting: inner spaces can only interact with outer spaces through
explicit port wiring. The parent controls what the child can do
(via wiring rules and dialect), and the child cannot reach beyond
what the parent exposes. This is what makes composition safe
(§0.3): wiring spaces together cannot break their internal
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
From inside a space, every command looks the same — pure and
effectful use the same syntax and return values into the pipeline.
From outside, the effectful commands are visible as ports: the
space's "effect surface" is the set of ports created by its
effectful commands. Pure commands are invisible from outside.
The command is the inside view; the port is the outside view.
These are the same thing seen from two sides of the space boundary.

This duality is what makes spaces testable and composable. A space
that uses `{time now}` and `{db query}` has ports for time and db
requests. Wire those ports to production handlers, mock handlers,
or forward them to the parent's boundary — the space cannot tell
the difference from the inside.

### Single-response effects [P-singleresponse]
Every effectful command produces exactly one response. A down-port
round trip is a single request/response pair — no streaming, no
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
host's permissions. This composes recursively to arbitrary depth
(§0.3).

### Content-addressed deduplication [P-contentaddr]
Blocks and spaces are content-addressed: identical code compiles
to the same identity. Copy and paste is a civilized operation —
the engine deduplicates automatically. No need for premature
abstraction. Just paste the code where you need it and the engine
recognizes the shared structure. When you modify a copy, the
editor can track the relationship: is this a specialization for
one case, or a change to propagate to all instances? The
content-address graph is a version history of structural sharing,
where changes can flow through the graph like merging branches.

### Liveness [P-liveness]
No process waits forever. Every down-port request has a finite
timeout (explicit, inherited, or the 10s system default). When the
timeout fires, the process resumes with a default value. Unwired
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
same rules — same dialect, same serial execution, same fresh reads,
same effect routing. A program received as data is evaluated the
same way as a block passed to `list map` — both create a
sub-process. This is what makes programmable applications work
(§0.1): a program sent by a sender executes under exactly the same
rules as built-in code, constrained by the effective dialect.

### Deterministic pipe filling [P-pipefill]
The implicit pipe value fills the first unfilled parameter of the
next command, determined by the command's parameter definition order.
This is fully deterministic from the command signature alone — the
programmer can predict what gets filled without knowing implementation
details. Named parameters override this by explicitly binding a value
to a parameter name, removing it from the implicit filling order.

### Effect partition [P-effectpartition]
Every command definition is either pure (has a `fun`) or effectful
(has an `effect` with a port type and default handler). Never both,
never neither. A pure command is a total function from parameters to
a value — it can be executed with no environment at all. An effectful
command can do nothing except send a request to its port and return
whatever comes back. This partition is what makes a DAML program
decomposable into an effect skeleton (the sequence of port requests)
and pure filling (the computation between them). If a command could
be mostly pure but also touch a port, you could no longer substitute
handlers freely because you wouldn't know what the "pure" parts
were secretly doing.

The partition is checkable at command registration time: every
command definition must have exactly one of `fun` or `effect`.

### Handler parametricity [P-handlersub]
Given the same sequence of responses from effect handlers, a DAML
program produces the same effect requests regardless of which
handlers produced those responses. The pure parts of a pipeline
cannot observe handler identity — they see only the values the
handler returns. A program is parametric in its effects.

This is the property that makes testing by handler substitution
valid: replace production handlers with mock handlers, provide the
same response script, and you get the same request sequence and
the same output. The test doesn't need a "test mode" — it needs
a different handler. See command/port duality and effect locality.

Follows from: effect partition (pure parts can't touch ports),
effect exteriority (I10), and the uniform command syntax (effectful
commands look the same as pure commands from inside the pipeline).

### Program portability [P-portable]
A DAML program — a block or pipeline serialized as source text —
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
always ≤ the outer space's base dialect. A sender's dialect is
always ≤ the outer space's base dialect. No mechanism — block
evaluation, program-as-data, socket loading, port routing — can
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

**I4. Sender confinement.** For any process P with sender S in
outer space X: `P.effective_dialect = S.dialect ∩ X.dialect`.
The process can never do more than the sender allows AND the
outer space allows. This is computed once at dock time and
inherited by all sub-processes. A command outside the effective
dialect sploots.

**I5. Serial exclusion.** At most one process is active in a
space at any time. A waiting process holds the space — no other
ship can dock until the active process completes. The queue is
FIFO. (This invariant may be relaxed per-space in a future
concurrent model.)

**I6. Space variable atomicity.** Within a single process
execution (including all sub-processes), space variable access
is consistent — no other process can read or write space state
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
for its subspaces. A subspace cannot wire its own ports — it can
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
This is deterministic from the command signature alone — no runtime
state affects which parameter receives the implicit value.


## 2. Design Decisions Record

Rationale for decisions that aren't obvious from the spec itself.


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

### Why space syntax as the serialization format?
The alternative is a separate binary format or manifest. Space syntax
was chosen because it already supports station definitions (with DAML
blocks inside), subspace definitions, and space variable declarations
with values. No new format needed — a serialized space is just
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
inheritance was chosen because pipeline vars are write-once
(immutable bindings), making it safe — the block gets a frozen
snapshot, and vars bound inside the block don't propagate back.
This eliminates boilerplate in the common case of accessing outer
variables from inner blocks.

### Why programmable applications?
The alternative is traditional APIs: the application exposes
endpoints, and clients call them. But an API is the application
author's model of what you want to do. A program is YOUR model of
what you want to do. Sending a program lets you compose operations,
express conditional logic, and avoid round-trips — all without the
application author anticipating your exact use case. The dialect
makes this safe: the program runs under the sender's restricted
permissions, so it can only do what the sender is allowed to do.
The application doesn't need to trust the program; it trusts the
dialect.

### Why dialects instead of ACLs?
The alternative is per-command or per-resource access control lists.
Dialects were chosen because they compose naturally with spaces:
a dialect is a property of the execution context, not of individual
resources. When you nest spaces, dialects restrict downward — a
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
message carries its own authentication — it doesn't matter whether
it arrives via WebSocket, HTTP, letter, or carrier pigeon. This
aligns with the actor model: the message identifies the sender,
the space looks up the sender's dialect, and the program executes
under those permissions. Separating identity from channel makes
the system robust to transport changes and enables use cases like
offline program shipping.


# Part II: Spaces — The Outer Topology

## 3. Space Syntax

Space syntax is the textual format for defining a space's topology.
It is distinct from DAML (the block language, §9) — space syntax
describes structure (stations, ports, wiring, subspaces), while
DAML describes behavior (pipelines, commands, values). Station
definitions contain DAML inside them, but the surrounding topology
is space syntax.

### Grammar

Space syntax is **indentation-based**. A top-level name at column 0
declares a space. [spacesyn-toplevel] Indented lines below it define the space's contents.

```
space_def  ::= name NL (indent line NL)*     — NL = newline

line       ::= port_decl
             | station_decl
             | route_decl
             | state_decl
             | dialect_decl

port_decl  ::= '@' name flavour param*     — @counter dom-set-text [spacesyn-port]
station_decl ::= name NL indent daml       — station name, then DAML block [spacesyn-station]
route_decl ::= endpoint ('->' endpoint)+    — chain of connections [spacesyn-route]
state_decl ::= '$' name json_value?         — $count 0, $items [] [spacesyn-state]
dialect_decl ::= '{' json_object '}'        — inline JSON restrictions

endpoint   ::= '@' name                    — space-level port
             | name                        — station (auto-expands to .in/.out)
             | name '.' name               — station.port or subspace.port
             | '{' daml '}'                — anonymous inline station
```

Every station automatically gets three implicit ports: `_in`,
`_out`, and `_error`. [spacesyn-implicit-ports] When a station name appears in a route
without a `.port` suffix, it expands to `.in` (as a destination)
or `.out` (as a source). [spacesyn-route-expand]

Anonymous inline stations can appear in routes as `{DAML}`: [spacesyn-anon-station]
```
@init -> {__ | add 1} -> {__ | times 2} -> @out
```
These create unnamed stations with the given DAML block.

### Examples

A simple counter app:
```
counter
  @button  dom-on-submit
  @display dom-set-text
  $count 0
  @button -> {1 | add $count | >$count} -> @display
```

A space with subspaces:
```
inner
  @in
  @out
  @in -> {__ | times 2} -> @out

outer
  @init from-js 20
  @out  assert  42
  @init -> inner.in
  inner.out -> @out
```

A station with named out-ports:
```
splitter
  {__ | >@left | >@right ||}

main
  @init from-js
  @out  assert
  @init -> splitter
  splitter.left -> {__ | add 1} -> @out
```

Named ports on stations are created by **routes**, not by DAML. [spacesyn-named-port-route]
The route `splitter.left -> {__ | add 1} -> @out` creates the
`left` port on station `splitter`. The DAML `>@left` sends to
that port — but only because the route declared it. Without the
route, the port doesn't exist and `>@left` sploots at runtime.
This ensures the space definition controls which ports each
station can access.

### Static declarations

A space definition is a static declaration — it describes topology,
not behavior. Behavior lives in the station blocks (§9) and in the
wiring rules that determine how effects are routed (§6).

### Spaceseeds

A **spaceseed** is the compiled result of parsing a space definition.
It describes the static topology: stations, ports, routes, subspaces,
and initial state. A spaceseed is inert — it does not process ships
or hold live state. To run, it must be instantiated into a space
(see Spaces below).

It is a content-addressed data structure: the seed's identifier is
derived from its content, so identical definitions produce the same
seed. [seed-content-addr]

```
spaceseed = {
  id         : hash            — content-based identifier
  stations   : [BlockId]       — compiled DAML blocks (1-indexed)
  ports      : [PortDescriptor] — port declarations + implicit station ports
  routes     : [[int, int]]    — pairs of port indices (1-indexed)
  subspaces  : [SpaceseedId]   — nested spaceseeds (1-indexed)
  state      : key → Val       — initial space variable values
  dialect    : object?         — dialect restrictions (optional)
}
```

Each station contributes three implicit ports (`_in`, `_out`,
`_error`) to the ports array. Named out-ports from `>@portname`
in station DAML are added as extra ports. Routes are pairs of
port indices connecting the topology.

Subspaces are **references by ID**, not inline. All spaceseeds
live in a flat global table (`D.SPACESEEDS`), keyed by content
hash. A spaceseed's `subspaces` field is an array of IDs pointing
into this table. The same sub-seed can be shared by multiple
parent seeds. When instantiated into a live space, each ID is
recursively instantiated into a live subspace (see Spaces below).

A spaceseed's identity is the hash of its (JSON) serialized form.

```
spaceseed.id = hash(JSON.stringify(spaceseed))
```

Identical space definitions produce the same spaceseed ID. Seeds
are stored in a global table (`D.SPACESEEDS`) keyed by ID. Since
station blocks are themselves content-addressed (see §10 "Block
identity"), the spaceseed's hash transitively covers the full
content of the space — topology, blocks, and nested subspaces.

The runtime instantiates a spaceseed into a live space (see Spaces
below). Multiple spaces can share the same spaceseed — each gets
its own σ and queue, but the topology definition is shared. [seed-share-instance]


## 4. Space Domains

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
happens, and the expanded form must be valid under the same dialect. [dialect-alias-expand]

### Commands
```
A command definition is either:
  Pure(c, params, fun)                        — a pure command
  Effectful(c, params, portType)              — an effectful command
```

Pure commands are total functions from params to Val.

Effectful commands have no fun — they have a port type. When
invoked, the request is sent through a port of that type. If the
port is wired, the process waits for the response. If the port is
not wired, the command sploots. [effectful-unwired-sploot] No effects without wiring.

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
    transitions, sharing space state with the parent process.
  - **Free monad**: effectful commands cause the process to wait,
    producing port requests. Each request is an abstract operation
    with a single-shot continuation. The outer space + wiring
    interprets these operations by routing requests to handlers.

Under the current serial scheduling model (§5), each process has
exclusive access to space state for its entire lifetime. This is
what makes the composed model clean: the state transitions are
deterministic, because no other process can modify space state
between your segments. Without serial execution, it could change
nondeterministically
between async boundaries, and the state monad composition would
break down (see `D2-concurrent-scheduling.md`).

One caveat: the effect surface is not statically fixed. Block
evaluation can invoke arbitrary effectful commands determined at
runtime. This means the free monad is over an open effect
signature — the set of possible effects isn't known until the
block runs. Daimio handles this through demand-created ports and
wiring rules with OTHER fallbacks (§6).

Requires: the effective dialect (sender's dialect ∩ outer space's
dialect) must include whatever commands the program invokes, and
port wiring must exist (or be demand-creatable) for any effects
used.

### Ships
```
ship = (value, sender?)
  where value    : Val              — the payload
        sender   : Sender?          — who sent this ship (optional)
```

A ship is a value being ferried between ports, optionally carrying
a sender. When a ship arrives at a station's in-port, a process is
created to handle it (see §10 Processes). When a process completes,
it sends its result as a ship through the station's out-port. A
single process may send multiple ships to different ports during its
execution (via `>@portname`), and soft errors send ships to the
error port.

All ships produced by a process inherit that process's sender. This
includes ships sent through `>@portname`, the implicit `_out` ship,
error ships, and down-port requests. The sender propagates through
every port exit, ensuring that the App always knows who originated
each ship.

### Senders
```
sender = (id, dialect)
  where id      : string           — who sent this ship
        dialect : Dialect           — what they're allowed to do
```

A sender identifies who originated a ship and what dialect they
operate under. The sender's dialect is always a subset of the
outer space's base dialect (`sender.dialect ⊆ space.dialect`).

When a ship with a sender docks at a station, the process runs
under the **effective dialect**: the intersection of the sender's
dialect and the space's dialect.

```
effective_dialect = sender.dialect ∩ space.dialect
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
a computation. Daimio does not authenticate senders — the App is
responsible for validating identity before passing a sender into
the outer space. From Daimio's perspective, the sender is trusted
metadata.

### Sendability and the gradient of dependency

Three kinds of values can be serialized and sent over ports,
including over the network. They differ in what they need from
the receiving environment:

- **Data** — just a Val. No behavior, no effects, no requirements.
  Enters a space as a ship payload through any in-port.
- **Program** — a pipeline as DAML source text. Needs dialect +
  state + ports from the host (see Programs above). The program
  is "parasitic" — it borrows everything.
- **Space** — a serialized space definition (space syntax). Needs
  port wiring + dialect from the parent (see Spaces below). The
  space is "self-reliant" — it brings its own programs and state.

### Stations
```
station = (name, block)
  where name     : string
        block    : Block           — the compiled DAML for this station
```

A station has exactly three built-in ports, created automatically:
  - **_in**:    receives ships (fire-and-forget inward)
  - **_out**:   sends the process's result (fire-and-forget outward)
  - **_error**: receives soft errors from this station's execution

**Named ports and `>@portname`.** A station's DAML can send ships
to named ports using `>@portname`. But the port must be explicitly
declared in the space definition's routes. The route
`station.portname -> destination` creates the named port on the
station. Without a route declaring it, the port does not exist,
and `>@portname` sploots at runtime. [station-port-requires-route]

This is a security boundary: the space definition controls which
ports each station can send to. Code running inside a station
(including unquoted programs from untrusted senders) cannot send
to arbitrary ports — only to ports that the space definition
explicitly wired. The wiring is the gate.

Down ports are NOT station-level constructs. They arise from
effectful commands: when a process invokes an effectful command,
the runtime creates/uses a down port on the space (see §6).

The station itself is simple — it's a block with in, out, and
error ports, plus any named ports declared by routes. All the
interesting port topology (down, up, wiring to subspaces,
socket-in) lives at the space level.

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
space = (spaceseed, σ, queue, subspaces, parent?, dialect, portHandlers?)
  where spaceseed     : Spaceseed       — the compiled topology
        σ             : SVar → Val      — live space variable store
        queue         : [Ship]          — pending ships (FIFO)
        subspaces     : [Space]         — live subspace instances
        parent        : Space?          — enclosing space (null for outer space)
        dialect       : Dialect         — inherited from parent, or set explicitly
        portHandlers  : port → handler? — only on outer spaces
```

A space is a **live instance** of a spaceseed. It has its own
state (σ), its own ship queue, its own live subspaces, its own
dialect, and its own independent serialization — one ship at a
time per space (see §5).

When a spaceseed is instantiated into a space, each subspace
seed ID in the spaceseed is recursively instantiated into a live
subspace. Each subspace gets its own σ [subspace-own-state] and its own queue [subspace-own-queue],
independent of the parent and of its siblings. Sibling subspaces
can process ships concurrently with each other and with the
parent (when the parent is waiting on an async effect). [subspace-sibling-concurrent]

Externally, a space is a **reactive automaton** (Mealy machine):
it accepts ships at in-ports, produces ships at out-ports, and
maintains internal state between interactions. The parent cannot
observe or modify the internal state — only the port interface
is visible. This external view is coalgebraic:
`S → (Input → Output × S)`.

However, the transition function is not a pure function — it may
invoke effectful commands, which produce down-port requests that
cause the process to wait until a response arrives. Internally,
each station's block is a program (free monad over effects + state
monad, as described in Programs above). When a ship docks at a
station, a process is created to execute the station's block.
The full picture is: a reactive automaton whose transitions are
effectful programs, executed one at a time per space (§5).

**From inside, a space cannot tell whether it is an outer space
or a subspace.** [space-inside-opaque] The port interface is the same in both cases.
Effectful commands produce port requests that propagate outward.
Whether those requests reach a real-world handler or another
space's wiring is invisible from inside. This is the foundation
of testability: any space can be tested by nesting it inside a
parent that provides mock handlers, and the space cannot tell the
difference.

A subspace depends on the parent for:
  - **Port wiring**: the parent's wiring rules determine how
    the space's down-port requests are handled (§6)
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

A space is "self-reliant" — it brings its own programs and state.
But it is not self-sufficient: without wiring, its effects go
nowhere.

Spaces can also be serialized as space syntax and loaded into
sockets at runtime. Socketed spaces have additional properties
around loading, transitions, and state ephemerality — see §8.

### Outer spaces

An **outer space** is any space that is not a subspace of another
space. It's on the outside — there's no parent to wire its ports,
so port handlers must be provided directly.

The outer application creates an outer space by:
  1. Choosing a spaceseed (the compiled topology)
  2. Instantiating it into a live space (recursively creating
     subspaces, initializing σ and queues)
  3. Assigning a base dialect (what commands are available)
  4. Wiring the outermost ports to effect handlers (DOM, network,
     database, filesystem, etc.)

This wiring is what makes effects real. Inside the space, an
effectful command like `{time now}` produces a port request that
propagates outward. At the outermost boundary, the port handler
executes the actual effect and returns the response. Without this
wiring, the request would sploot.

**Multiple outer spaces.** An application can create as many outer
spaces as it needs. Each is a completely independent universe — no
shared scheduler, no shared state, no cross-instance communication. [outer-independent]
Different outer spaces may use the same spaceseed with different
dialects and different port wiring, or entirely different
spaceseeds. The application is responsible for routing data between
them (via whatever external systems it chooses).

**Senders.** Multiple senders can send ships into the same outer
space. Each sender carries their own dialect — a restricted subset
of the space's base dialect. When a ship with a sender docks at a
station, the process runs under the effective dialect:
`sender.dialect ∩ space.dialect`. This intersection is computed
once at dock time and inherited by all sub-processes.

Daimio does not authenticate senders. The App validates identity
externally (HMAC, capability tokens, session auth, etc.) and
passes trusted sender information into the outer space. From
Daimio's perspective, the sender is metadata — the App is the
authority on who sent what.


### Port handlers

Port handlers are the boundary between Daimio and the outside
world. They are the only place where real effects occur (I10).
A handler is a function provided by the App when creating an
outer space. The interface depends on the port direction:

**Down-port handler** (request/response):
```
handler(request, callback)
  where request  : {value, handler, method, params, sender?}
        callback : (response : Val) → void
```

The handler receives the request (including the sender, if
present) and MUST call the callback exactly once with a response
value. [handler-down-callback] The calling process is waiting — it resumes when the
callback fires. If the handler never calls the callback, the
timeout (§7.3) will eventually resume the process with the
default value.

**Out-port handler** (fire-and-forget outward):
```
handler(ship)
  where ship : {value, sender?}
```

The handler receives the ship and returns nothing. The process
has already moved on — out-port routing is deferred and
fire-and-forget. The handler may trigger external side effects
(update the DOM, send a network message, write to a log) but
Daimio does not wait for or observe the result.

**In-port handler** (fire-and-forget inward):
```
handler.enter(ship)
  — called by the App to push a ship into the space
```

In-port handlers are inverted: the App calls `port.enter(ship)`
when an external event occurs (user click, network message,
timer). The ship enters the space's queue through the normal
docking mechanism. The App is responsible for constructing the
ship (value + optional sender).

**Substitutability.** Any handler can be replaced with a
different implementation — mock, stub, logger, proxy to a remote
service — without the space knowing. [handler-substitute] This is the mechanism behind
testability (§0) and the command/port duality (§1): the space
sees only the port interface, never the handler.


## 5. Space Execution (Scheduling)

### Serial execution per space

Each space processes **one ship at a time**. [serial-one-at-a-time] When a ship arrives at
a space (via any in-port on any station), it either docks immediately
(creating a process) or is placed in a FIFO queue. [queue-fifo] No two processes
ever execute concurrently within the same space.

This applies regardless of which station the ship targets. A space
with stations A and B will never process a ship at A and a ship at
B at the same time. The serialization is per-space, not per-station
or per-port. [serial-per-space] Sibling subspaces are independent — each is its own
space with its own queue, and they can process ships concurrently.

### The queue

Each space maintains a queue of pending ships. A ship is enqueued
when it arrives at a space that already has an active process.

```
ARRIVE(space, ship, station):
  if space.active:
    space.queue ← space.queue ++ [(ship, station)]     — FIFO append
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
    DEFER(DOCK(space, ship, station))                  — deferred execution [queue-deferred-dock]
```

Both the dequeue and the completing process's output routing are
**deferred**. The dequeue fires first: queued ships have priority
over ships produced by the completing process's output routing. [queue-priority-routing]
If station A's `_out` routes a ship back to A's `_in` while other
ships are queued, those queued ships dock first.

### Process lifecycle

When a ship docks at a station, a process is created to run the
station's block. If the ship carries a sender, the effective dialect
is computed: `sender.dialect ∩ space.dialect`. The process goes
through these phases:

  1. **Dock**: ship arrives at station's in-port, process is created
     with the ship's sender (if any) and effective dialect
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
error port (if wired). All ships produced by the process carry
the process's sender. All port routing is deferred — the ships
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
by output routing arrive after ships already in the queue — queued
ships have priority over newly routed ships.

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
        space' = space with ports ∪ {p}, p wired by wiring  [demandport-wire]
```

Ports are created on demand [demandport-create] because:
  1. Block evaluation can invoke arbitrary effectful commands at
     runtime — the effect surface isn't known until the block runs
  2. Serialized spaces loaded into sockets may have unknown effect surfaces

### Wiring rules

Wiring rules are declared in the parent space and pattern-match against
port properties: [wiring-pattern-match]

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

Property values can be negated with `!` to mean "anything except this." [wiring-negate]
Multiple properties in a single Match are conjunctive (all must hold). [wiring-conjunctive]

Concrete syntax example:
```
S.@[handler:math]                 → match all math commands
S.@[handler:!user type:read]      → match reads that are NOT user commands
S.@[handler:math method:fizzbuzz] → you can only fizzbuzz nothing else
```

Rules are evaluated in order. The first matching rule determines the
target. [wiring-first-match] OTHER matches anything not matched by a previous rule. [wiring-other-fallback]

The space's `defaultTimeout` (from the space definition) applies to
all wiring rules unless individually overridden. [wiring-default-timeout]

The target of a wiring rule is one of:
  - A handler function (the actual effect implementation)
  - An up-port on a sibling subspace (the sibling provides the service)
  - A down-port on the parent space's own boundary (forwarding the
    effect outward — the parent's environment must handle it)
  - Null (/dev/null — the effect is silently swallowed, returns empty) [wiring-target-null]

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

If A is itself inside a space Z, and Z's wire to A has a timeout of 10s, then the effective timeout for any round trip through A is min(A's wire timeout, Z's wire timeout). Even though A gives the db handler 30s, Z will only wait 10s for the overall round trip. If Z times out first, A's in-flight db request becomes a ghost.

### Example: cross-boundary state access

A subspace cannot read or write its parent's space variables
directly (I8). To access the parent's state, it uses effectful
commands that send requests through down-ports:

```
{var read-out name :foo}           — read parent's $foo via down-port
{var write-out name :foo value 5}  — write parent's $foo via down-port
```

These are effectful commands with port type `var-read` / `var-write`.
When invoked, they create down-port requests. The parent must wire
these ports to handlers that perform the actual reads/writes on the
parent's σ.

Example wiring in the parent:
```
  S.@[handler:var method:read-out]   → varReadHandler
  S.@[handler:var method:write-out]  → varWriteHandler
```

Where `varReadHandler` receives the request, reads the named
variable from the parent's σ, and returns the value. If the
parent doesn't wire these ports, the commands sploot — the
subspace simply can't access the parent's state.

This is deliberately verbose: crossing a space boundary to access
state is a significant action that should be visible in the
topology. Note that `$foo` and `>$foo` in DAML always access the
LOCAL space's σ — they are pure segment types, not effectful
commands. Only `var read-out` and `var write-out` cross
boundaries, and only through ports [socket-crossboundary-var].


## 7. Async Boundaries

An effectful command creates an **async boundary**. [async-boundary] The process's
execution splits into two phases: before the effect (sync) and after
the response (sync). The process waits for the response; under the
current serial model (§5), the space remains busy during the wait.

### Down ports return exactly one value

A down-port round trip always produces exactly one response. [singleresponse-one] This is a
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
  c ∈ effective_dialect.commands    (command is in the effective dialect)
  c is Effectful(c, params, portType, _)
  p = resolveOrCreatePort(space, portType)    — see §6 for port resolution
  ─────────────────────────────────────────────────
  (process, σ) —[EffCmd(c, args)]→ WAIT(p, process, continuation)
```

The process waits. Its pipeline variables [async-preserve-vars] and sender are preserved. [async-preserve-sender]
The request (payload + args + sender) is sent out through port p.
The sender exits with the request, so the outside (App, parent
space, or handler) knows who originated it. The continuation is the
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
unchanged from the time of waiting — no other process can modify space state
while this process holds the space. The "fresh reads" property is
trivially satisfied (see §1).

### 7.3 Timeouts

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

At 20s, D-C times out. D's process resumes with the default value.
The request is still in flight from C's perspective. If the response
arrives at 25s, C receives it but D has already moved on. C fires
a soft error and drops the response.

The key property: **an outer wire's timeout is authoritative.** No
inner wire can extend the wait time beyond what the outer wire allows.
An inner wire CAN shorten the wait by having a tighter timeout.

#### Timeout and ghost response behavior

When a timeout fires, the waiting process resumes with the effectful
command's default value, and a soft error is emitted. [timeout-resume-empty] The request is
marked completed.

If a response later arrives for an already-completed request (an
**ghost response**), it is dropped and a soft error fires in the
space where the response surfaced — not where the request originated. [timeout-ghost-drop]

#### Unwired ports

If a down port is not wired to any target (no matching wiring rule,
and no OTHER fallback), the command sploots immediately — no async
boundary, no timeout:

```
  p has no wiring
  ─────────────────────────────────────────────────
  (process, σ) —[EffCmd(c, args)]→ (process{v := empty}, σ)
  emit soft error: {type: "unwired_port", port: p}
```

This is synchronous — the process does not wait. The pipeline
continues immediately with the empty value. No effects without
wiring.


## 8. Sockets and Space Serialization

### Serialized space format

A serialized space is **space syntax** (§3) — the textual format
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
— once loaded, a socketed space is just a subspace.

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
     stored in the global table).
  3. **Instantiate** the spaceseed into a live subspace (with its
     own σ, queue, and recursively instantiated sub-subspaces).
     Ports are left unresolved — they are demand-created on first
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
     subspace — only its existing queue drains. [socket-overlap-drain]
  3. **Old subspace is collected** when its queue is empty and
     no process is active. Its state (σ) is discarded. [socket-overlap-state-lost]

No ships are lost. [socket-overlap-no-loss] The old subspace's queued work completes
before the subspace is removed. But state does not survive the
transition — if you need persistent state across socket swaps,
it lives outside the space (via ports to external storage). The
socket is a hot-swappable execution slot, not a state container.

### Cross-boundary space variable access

Cross-boundary state access uses effectful commands through
down-ports. See §6 "Example: cross-boundary state access" for the
full worked example. The mechanism is always a down-port round
trip, preserving space isolation (I8).


# Part III: Blocks — The Inner Language

## 9. Block Syntax

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

string_literal ::= '"' (char | command | namedblock)* '"'   [parse-string-interpolation]
number_literal ::= '-'? digit+ ('.' digit+)?    — also exponential (3e10), hex (0x777), etc.
                                                   any string JS coerces to a number [parse-number-lit]
name_literal   ::= ':' name             — e.g. :foo produces the string "foo" [parse-name-lit]
list_literal   ::= '(' value* ')'       — e.g. (1 2 3), (:a :b :c) [parse-list-lit]

block      ::= '"{' pipeline '}"'       — a quoted pipeline as a value [parse-block-quoted]
             | '"' daml '"'             — a quoted DAML template as a value (those quotes are hard to parse)

pvar_write ::= '>' name                 — e.g. >result, >x -- NB NO path for pvar writes!
pvar_read  ::= '_' name path?           — e.g. _foo, _x.bar.#1
svar_write ::= '>$' name path?          — e.g. >$count, >$user.name
svar_read  ::= '$' name path?           — e.g. $count, $user.name

port_send  ::= '>@' name                — send to a named space-level port

path       ::= ('.' selector)*          — paths can also be expressed as lists
selector   ::= name                     — Key: a literal key: .foo, .12
             | '#' integer              — Pos: a positional (1-based) index: .#1, .#-1
             | '*'                      — Star: all children
             | command                  — evaluated: .{math add value 1 to 2}
```

Dot-path selectors are either **literal** (`name`, `#N`, `*`) or
**evaluated** (`{...}`). An evaluated selector is a command whose
result becomes the selector value. This is how Par works in
dot-paths: `$foo.{(:a :b)}` evaluates the list `(:a :b)`, which
becomes a Par selector [path-eval-selector]. There is no bare `()`
in dot-path syntax — Par requires evaluation, so it uses curlies
[path-par-curlies].

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

This keeps the parser simple — structural brace matching is the
only rule, with no context-dependent escape processing.

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


## 10. Block Domains

### Values
```
v ∈ Val       — numbers, strings, lists (the single universal collection)
```

Values are the single data type. A collection is a universal data
structure that supports ordered access (by position), keyed access
(by string key), and nesting (values can contain other values to
arbitrary depth).

### Collections: keyed and unkeyed

A collection is either keyed or unkeyed.

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
  {* (:a 1 :b 2) | list values}    — keyed → unkeyed: drops keys    [collection-values]
  {(1 2) | list rekey}              — unkeyed → keyed: index keys   [collection-rekey]
  ```

Most other operations (peek, map, delete, iteration) work uniformly
on both keyed and unkeyed collections.

### The empty value

The empty value is the identity element. It coerces based on context:
`""` when used as a string [empty-coerce-string], `0` when used as a
number [empty-coerce-number], `[]` when used as a list
[empty-coerce-list]. This is why totality works without error values — a missing
path, an unbound variable, or a timed-out effect all produce the empty
value, which becomes whatever zero the consuming command expects.

### Splooting

To **sploot** is to emit a soft error and continue. The pipeline
is never halted [sploot-pipeline-continues]. The error is routed
to the space's error port (if wired) [sploot-error-port]; the pipeline continues with a value determined by
the operation type.

Splooting is the mechanism behind totality: every operation that
"fails" actually succeeds — it just succeeds with a soft error
notification on the side. What value the pipeline continues with
depends on the operation:

  - **Value-producing operations** (commands, variable reads)
    continue with the empty value [sploot-value-cmd]. The operation
    didn't produce a result, so empty is the right default.
  - **Pass-through operations** (port sends, variable writes,
    failed pokes) continue with the unchanged pipeline value
    [sploot-passthru-portsend]. The side effect failed, but the
    value flows through as if the operation wasn't there.

A sploot can occur at **compile time** or **runtime**:

  - **Compile-time**: the error is detected during block
    compilation (e.g. unknown command name). The soft error is
    emitted once. The segment can be compiled away entirely —
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

Key and Pos are **affine** — they focus on at most one location.

Star is a **traversal** — it focuses on all existing children.

Par is a **multiplexer** — it maps an operation across multiple paths.
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
peek([10,20,30], ["#2"])      →  20    (Pos, 1-indexed)
peek([10,20,30], [2])         →  30    (number key, 0-indexed)
peek([10,20,30], ["2"])       →  30    (string coerced to nat, 0-indexed)
peek([10,20,30], ["a"])       →  ""    (soft error: can't coerce)
peek({a:1, "2":99}, [2])      →  99    (number key on object, as string "2")
peek({a:1, b:2, c:3}, ["#2"]) →  2     (Pos on keyed list, by insertion order)
```

#### The four path operations

All four share the same path language.

| Operation | Adds entries? | Removes entries? | Optics analog |
|---|---|---|---|
| **peek** | No | No | get / view |
| **poke** | Yes (Key only) | No | set / put |
| **map** | No | No | over |
| **delete** | No | Yes | — |

"Adds entries" means a key or position that didn't exist before now
exists in the collection. Only poke can do this (via Key on keyed
collections or Empty). Map can change the *value* at an existing
entry — including replacing a scalar with a collection — but it
never adds or removes entries from the parent collection.

#### Peek (read)

```
peek(v, []) = v                                                     [peek-empty-path]

peek(Collection, Key(s) :: rest)  =  peek(v[s], rest)               [peek-key-hit]
                                     — or Empty                     [peek-key-miss]
peek(Collection, Pos(n)  :: rest) =  peek(v at n, rest)             [peek-pos-hit]
                                     — or Empty                     [peek-pos-miss]
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
may be a list — the wrapping is about whether peek adds an
*additional* list layer around the result.

#### Poke (write)

Poke writes a constant value at a path. **Only Key creates new
structure.** Everything else modifies in place or sploots.

```
poke(v, [], new) = new                    — replace entirely           [poke-empty-path]
```

Empty-path poke replaces the value wholesale. This preserves the
lens laws (PutGet, PutPut, GetPut all hold at empty path).  
Append semantics are available separately via `list union`.

**Key** — creates on keyed collections, Empty, and scalars:

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

**Pos** — modifies existing positions only:

```
poke(Collection, Pos(n) :: rest, new) =
  if position n exists: update val                              [poke-pos-update]
  else:                 unchanged — out of bounds               [poke-pos-oob]

poke(Empty, Pos(n) :: rest, new) = Empty                        [poke-pos-empty]
poke(scalar, Pos(n) :: rest, new) = unchanged                   [poke-pos-scalar]
```

**Star** — modifies all existing children, never creates:

```
poke(Collection, Star :: rest, new) =                           [poke-star]
  for each child: poke(child, rest, new)
  — scalar children are skipped (see scalar rule above)

poke(Empty, Star :: rest, new) = Empty                          [poke-star-empty]
poke(scalar, Star :: rest, new) = unchanged                     [poke-star-scalar]
```

**Par** — delegates to each sub-path, sequentially left-to-right:

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
    `poke({x: 42}, [:x, :a], 99)` → `{x: {a: 99}}`
  - **Traversal (reached via Star):** scalar children are skipped.
    `poke([1, 2, 3], ["*", :a], 99)` → `[1, 2, 3]`

The determination is local [poke-midpath-local]: did this particular
recursive call arrive here through a Star expansion? Not "does the overall path
contain Star somewhere." This matters for Par, where different
sub-paths may have different affinity — each sub-path is expanded
independently, so each makes its own affine/traversal determination.

#### Map (transform at focus)

Map applies a block to each value at a path focus. **Map never
adds entries** [map-no-add] — it doesn't add keys or extend
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

**When path is omitted, default is `("*")`** [map-default-star] — this matches current
`list map` behavior (map over all children).

**Block receives:** [map-block-scope]
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
application is safe — later sub-paths still address the same
positions. Delete removes entries, shifting indices. Sequential
positional deletes would corrupt later sub-paths.

**Overlapping Par paths.** For Par-poke and Par-map, overlapping
sub-paths are applied sequentially: the second sub-path sees the
result of the first. For Par-delete, overlapping sub-paths are
resolved from the original structure — if both sub-paths target
the same entry, it is removed once [delete-par-overlap].

#### Path operations as commands

The four path operations are invoked as `list` commands:

```
list peek   — params: data, path
list poke   — params: data, path, value
list map    — params: data, path (default "*"), block
list delete — params: data, path
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

### Blocks
```
block = (segments, flow)
  where segments : [Segment]         — the compiled pipeline steps
        flow     : key → [key]       — the segment flow graph
```

A block is a compiled DAML template. It holds an array of segments
and a **segment flow graph** that describes data dependencies
between them. A station has one block. Blocks can also be passed
as values to commands (`list map`, `process run`, `if then`, etc.)
and evaluated later.

The segment flow graph is distinct from space-level wiring (§6).
Space wiring connects ports across the topology. The flow graph
connects segments within a single block — it is the compiled form
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
inputs are looked up from the flow graph — the keys in the graph
point to previously stored outputs. The first segment of a
pipeline has no incoming flow edges (nothing feeds into it
implicitly).

### Block identity

Before hashing, the compiler normalizes segment keys to sequential
indices (`wash_keys`) [compile-normalize]. This ensures that two
blocks compiled from the same DAML produce identical normalized
structures regardless of the compilation context. The block is then JSON-serialized and
hashed. The hash is the block's identity:

```
block.id = hash(JSON.stringify(normalized_block))
```

Identical DAML always produces the same block ID [blockid-same].
Blocks are stored in a global table (`D.BLOCKS`) keyed by ID — if
a block with the same hash already exists, the existing one is
reused [blockid-dedup].
This means every station, every block parameter, and every named block
that contains the same DAML shares the same compiled block. The
deduplication is automatic and invisible to the programmer.

### Processes
```
process = (space, block, state, pipeline_vars, current, asynced,
           sender?, effective_dialect)
  where space             : Space          — the enclosing space
        block             : Block          — the block being executed
        state             : key → Val      — segment outputs and scope vars
        pipeline_vars     : PVar → Val     — pipeline variable bindings
        current           : int            — current segment index
        asynced           : bool           — waiting for async response?
        sender            : Sender?        — who sent the originating ship
        effective_dialect : Dialect         — sender.dialect ∩ space.dialect
```

A process is the unit of execution. It is created when a ship docks
at a station, and destroyed when the block completes. A process
executes its block's segments sequentially, maintaining pipeline
variable bindings and tracking its position.

The effective dialect is computed at process creation: if the ship
carries a sender, `effective_dialect = sender.dialect ∩
space.dialect`. If no sender, `effective_dialect =
space.dialect`. All command invocations within the process
(and its sub-processes) are checked against this effective dialect.

**Pipeline variable scope:** pipeline variables are write-once and
scoped to a single process. When a block is evaluated by a command
(like `list map`), a **sub-process** is created that inherits a
copy of the parent's pipeline vars — all the parent's vars are
readable inside the block. But vars bound inside the block (via
`>x`) do not propagate back to the parent. The inheritance is
one-way: parent → child, never child → parent.

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

### The implicit pipe value

The `|` operator sequences segments. It also automatically **fills
a parameter** of the next command. The first unfilled parameter
takes the previous segment's output. [pipe-flow] This is the core pipe mechanic:

```
{3 | math add to 5}
```

Here the value `3` flows in to the `value` parameter of `math add`,
producing `8`. The flowing value is never named, it's injected
automatically into the first unnamed parameter.

```
{2 | list range}
{2 | list range length 3}
{2 | list range length 3 start 4}
```

Note that **parameter ordering** is important.
The command `list range` is defined with parameters `length`, `start`,
and `step`, in that order. In the first example, the `length`
parameter is filled by `2`, yielding `(1 2)`. In the second the
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
second example. The `||` construction blocks the implicit value
from flowing through, while still allowing the previous segment's
value to be referenced explicitly. Here `step` receives `2` but
`start` is unfilled, yielding `(1 3 5)`. This is useful when you
want to set a specific parameter explicitly without filling any
others implicitly.

```
{( 1 2 3 ) | map block "{__ | add 1 | add __in | add __}"}
```

Pipelines can also take an initial input value, for instance when
used as part of a block applied to data, as in this example. This
does not implicitly fill a parameter in the first segment of the
pipeline, but is accessible by `__`. It is also accessible as
`__in` within any segment in that pipeline -- a fixed value, unlike
`__`, which updates after each segment. [pipe-dunderin] Note that `__` is the only
pipeline variable that updates inside a pipeline. All other `_`
vars are single-assignment (they actually get compiled down to
wiring). This example takes the input value, adds 1, adds the
input value again, and then adds that value to itself, yielding
`(6 10 14)`.

### Variables and scope

```
__         — the implicit pipe value (injected by runtime)
__in       — the input to the current pipeline/block (injected by runtime)
_foo       — pipeline variable (set with >foo)
$foo       — space variable (set with >$foo)
```

**Scope hierarchy:**
- `__`   — previous segment value: resets each segment
- `_foo` — pipeline variable: local to the pipeline; inherited by
  child blocks, but pvars set inside a block don't propagate back out
- `$foo` — space variable: available within all pipelines in the
  same space [scope-svar-access]

### The `||` barrier

`||` (double pipe) blocks the implicit pipe value from flowing to the
next segment. After `||`, the next command receives the empty value as
its implicit input. Pipeline variables (`_foo`) still cross the barrier
— only the implicit value is blocked. [pipe-barrier-vars]

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
of its last segment's result. [pipe-trailing-empty] Useful in templating contexts where
side-effectful operations shouldn't produce visible output:

```
{$count | >@notify ||}                           — side effects, no output
```

### Block syntax

A block is a quoted DAML string — a program as a value. There are
two syntactic forms, but they produce the same thing:

```
"{__ | add 1}"                       — quoted block (inline)
{begin foo}Hello, {name}!{end foo}   — named block (multi-line friendly)
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
compiled and will NOT execute — they're just data
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

Aliases are compile-time substitutions (see §4 Dialect). An alias
name is replaced with a fixed pipeline fragment during the munging
phase [alias-expand-basic]. For example, `add` expands to
`math add value`, so `{add 5}` becomes `{math add value 5}`.

**Pipe-eating aliases.** Some alias expansions contain `__` (the
implicit pipe reference). For example, `then` expands to
`logic if value __ then`. When an alias contains `__`, the
implicit pipe value is consumed by the alias expansion — it is
NOT also passed implicitly to the expanded command's first
unfilled parameter [alias-pipe-eat]. This prevents double-filling.

**Parameter threading.** Named parameters after the alias name
are threaded into the expansion. `{add 5 to 3}` expands `add`
to `math add value`, then `5` fills the dangling positional slot
and `to 3` maps to the `to` parameter of `math add`
[alias-param-thread].

**Dialect gating.** Aliases are part of the dialect. If an alias
is removed from a restricted dialect, it is unavailable — using
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
(process, σ) —[seg]→ (process', σ')
```

to mean: executing segment seg with process state `process` and
space variable store `σ` produces new process state `process'` and
new store `σ'`. Here `process.v` is the current pipeline value and
`process.env` is the pipeline variable bindings.

**Pure command:**
```
  c ∈ effective_dialect.commands   (command is in the effective dialect)
  c is Pure(c, params, fun)
  args' = fillImplicit(args, process.v)     — process.v fills first unfilled param
  v' = fun(args')
  ─────────────────────────────────────────────────
  (process, σ) —[PureCmd(c, args)]→ (process{v := v'}, σ)     [total-cmd-value]
```

**Parameter filling** (`fillImplicit`) works in two passes:

  1. **Explicit params** are matched by name. `{math add value 5 to 3}`
     binds `value=5` and `to=3` regardless of definition order.
  2. **The implicit pipe value** (process.v) fills the first parameter
     (by definition order) that was not explicitly provided. This
     happens at most once — only the first unfilled param receives it. [pipe-fill-one]
     `{2 | math add value 5}` means math.add receives 2 as its
     implicit first param and 5 as value.

**Type coercion.** Daimio's type system exists only at command
boundaries. Values flowing through pipelines are untyped. When a
value enters a command parameter, it is coerced to the param's
declared type. There is no type checking and no type errors —
coercion is total, always producing a value of the expected type
[coerce-total].
This is a deliberate choice: totality over type safety.

Each command param declares a type in its definition (e.g.
`{key: 'value', type: 'number'}`). The available types are fixed:

```
list     — scalars wrap to single-element list; empty → [] [coerce-list]
string   — numbers stringify; empty → "" [coerce-string]
number   — strings coerce numerically; empty → 0; NaN → 0 [coerce-number]
integer  — like number, then rounded [coerce-integer]
block    — compiled block refs become evaluable; strings pass through [coerce-block]
             (strings must be explicitly compiled via `process unquote`)
anything — passed through (with empty normalization) [coerce-anything]

either:A,B — if the value matches type A, coerce as A; [coerce-either]
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
match any declared param are compiled but never consumed — the
command executes as if they weren't there.


**Dialect check:** if c ∉ effective_dialect.commands, the command is
not executed. A soft error is emitted (see §12), and the pipeline
value is unchanged. [dialect-cmd-sploot]

**Read space variable:**
```
  v' = peek(σ(s), path)    (read current value at path — always fresh)
  ─────────────────────────────────────────────────
  (process, σ) —[ReadSVar(s, path)]→ (process{v := v'}, σ)
```

If s is unbound in σ, or path doesn't match, the result sploots
(empty value + soft error to error port). [svar-read-unbound-sploot] This aids debugging —
a typo in a variable name produces an observable error — while
the pipeline continues normally with the empty value.

**Write space variable:**
```
  σ' = σ[s ↦ poke(σ(s), path, process.v)]
  ─────────────────────────────────────────────────
  (process, σ) —[WriteSVar(s, path)]→ (process, σ')
```

If path is empty, this sets s directly. [svar-write-path] See §10 Path expressions for
full poke semantics: Key creates on keyed/Empty/scalar (affine only),
Pos only modifies existing, Star only modifies existing children,
Key on unkeyed lists coerces or soft errors.

**Read pipeline variable:**
```
  v' = peek(process.env(x), path)
  ─────────────────────────────────────────────────
  (process, σ) —[ReadPVar(x, path)]→ (process{v := v'}, σ)
```

If x is unbound or path doesn't match, the result is empty (totality). [pvar-unbound-empty]

**Write pipeline variable:**
```
  env' = process.env[x ↦ process.v]
  ─────────────────────────────────────────────────
  (process, σ) —[WritePVar(x)]→ (process{env := env'}, σ)
```

Pipeline variable bindings are write-once within a synchronous segment
(SSA). [scope-pvar-writeonce] Rebinding is a compile-time error for _vars within a segment.

**Port send:**
```
  portname exists on this station (declared by a route)
  ─────────────────────────────────────────────────
  (process, σ) —[PortSend(portname)]→ (process, σ)
  schedule deferred: ship(process.v, process.sender) → portname

  portname does not exist on this station
  ─────────────────────────────────────────────────
  (process, σ) —[PortSend(portname)]→ (process, σ)
  emit soft error                       — pass-through: pipeline value unchanged [portsend-missing-sploot]
```

The pipeline value is unchanged — PortSend passes it through. [station-portsend-passthru]
The actual ship send is **deferred**: it is scheduled to execute
after the current process completes (see §5 "Port routing and
deferred entry"). The deferred ship carries the process's sender.

The port must be declared by a route in the space definition. A
station cannot send to arbitrary ports — only to ports the space
definition explicitly wired. This prevents untrusted code from
sending ships to ports it shouldn't have access to.

**No implicit fill on first segment.** The `|` operator creates
edges in the segment flow graph (see §10 "Block compilation").
The first segment of a pipeline has no incoming flow edges —
nothing is injected into its first unfilled parameter. The
pipeline's input is accessible explicitly as `__` and `__in`,
but does not implicitly fill any parameter of the first segment. [pipe-fill-first-none]

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
  (process, σ) —[Literal(v)]→ (process{v := v}, σ)   — [literal-produces-value]
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
     readable inside. [scope-pvar-inherit] This is safe because pipeline vars are
     write-once — the sub-process gets a copy of frozen values.
  2. The command **injects scope variables** on top of the inherited
     vars. Standard injected names:
       `_value`       — the current item being processed [scope-inject-value]
       `_key`         — the current item's key (for keyed collections) [scope-inject-key]
       `_index`       — the current item's index [scope-inject-index]
       `_total`       — accumulator value (for reduce/fold) [scope-inject-total]
     Injected vars shadow parent vars of the same name.
  3. `__in` is the sub-process's input (typically `_value`). `__` is
     the previous pipe segment's output — at the start, `__ = __in`. [pipe-dunderin-first]
  4. The sub-process executes in the same space as the parent, under
     the same effective dialect, with the same sender, and with
     access to the same space variables.
  5. Pipeline vars bound inside the sub-process (via `>x`) do NOT
     propagate back to the parent. [scope-pvar-no-propagate] The sub-process's env is its own.

Every process runs under its effective dialect (sender.dialect ∩
space.dialect, computed at dock time). There is no mechanism
for escalating or changing the dialect mid-execution. A program
received as data inherits the sender and effective dialect of
whatever process evaluates it — the sender's restrictions apply
to all code, whether built-in or received as data.

### Atomicity guarantee

A space processes one ship at a time (§5). The active process has
exclusive access to space state for its entire lifetime — not just
within a synchronous segment, but across async boundaries as well.
No other process may read or write space variables while the active
process exists.

#### Pipeline Segments
```
seg ::= PureCmd(c, args)           — invoke a pure command
      | EffCmd(c, args)            — invoke an effectful command (async boundary)
      | ReadSVar(s, path)          — read a space variable (with optional path)
      | WriteSVar(s, path)         — write pipeline value to space variable
      | ReadPVar(x, path)          — read a pipeline variable (with optional path)
      | WritePVar(x)               — bind pipeline value to pipeline variable
      | PortSend(portname)         — send pipeline value to a space-level port
      | Literal(v)                 — a literal value
      | Block(daml)                — a quoted DAML string as a value

pipeline ::= seg₁ pipe seg₂ pipe ...  — sequential composition
pipe     ::= '|' or '||'             — normal pipe or barrier pipe
```


## 12. Errors

Daimio is total. Commands do not throw exceptions. When something
goes wrong, the operation **sploots**: it emits a soft error and
continues (see §10 "Splooting").

Conditions that sploot, with their continuation value:

```
Value-producing (continue with empty):
  - command not in effective dialect                         [dialect-cmd-sploot]
  - effectful command with unwired port (no async)          [effectful-unwired-sploot]
  - timeout on down-port response                           [timeout-resume-empty]
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
  1. A soft error is emitted as a ship to the space's error port
     (if wired). The error ship carries the process's sender.
  2. The pipeline is NOT halted.
  3. The pipeline continues — with empty for value-producing
     operations, or with the unchanged value for pass-through
     operations.

This is analogous to IEEE 754 NaN propagation: errors flow through the
pipeline as values, rather than interrupting control flow.


## 13. Security Analysis

This section traces attack vectors against the model and shows
how the invariants defend against them — or where the defense
depends on configuration.

### Privilege escalation via block evaluation

**Attack:** Alice stores a malicious block in a space variable.
Bob's ship triggers `{$alice_block | process unquote | run}`.
Bob has admin dialect. Alice's code runs under Bob's authority.

**Defense:** The sender's effective dialect is the intersection
of sender.dialect and space.dialect (I4). Bob's process runs
Alice's code, but under Bob's effective dialect — which is
`Bob.dialect ∩ space.dialect`. If Alice's code tries commands
outside that intersection, they sploot. The risk is when Bob's
dialect is MORE permissive than Alice intended — Alice's code gets
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
concurrent scheduling doc discusses potential mitigations: MVCC
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
defense, not a runtime defense — a permissive dialect can still
be vulnerable.

**Residual risk:** A sender with regex permission can still craft
pathological patterns. The energy/resource limits (§13 Future
Work) would mitigate this by capping CPU time per sender.

### Denial of service via resource exhaustion

**Attack:** A sender submits a program with deep recursion,
infinite loops via space variable manipulation, or massive data
construction.

**Defense (partial):** Totality (I1) prevents crashes but not
resource exhaustion. Liveness (I9) guarantees effectful operations
resolve via timeout. But pure computation has no built-in limit —
a tight loop of pure commands can consume unbounded CPU.

**Mitigation:** Resource limits are deferred to Future Work.
Currently, the outer application is responsible for monitoring
and killing runaway processes.

### Cross-space information leakage

**Attack:** A subspace tries to read its parent's space variables
directly, bypassing the port interface.

**Defense:** Space boundary opacity (I8). All cross-boundary
communication goes through ports. A subspace cannot read or write
its parent's σ directly. Cross-boundary state access requires
an explicit effectful command (`var read`, `var write`) through a
down port, which the parent must wire to a handler. If the parent
doesn't wire it, the request sploots.

### Sender spoofing

**Attack:** A malicious entity sends a ship with a forged sender
(claiming to be an admin).

**Defense:** Daimio does not authenticate senders — this is
explicitly the App's responsibility. Daimio trusts whatever
sender the App provides. If the App's authentication is broken,
Daimio's dialect confinement is bypassed.

**Mitigation:** The sender authentication mechanism (§13 Future
Work) would add cryptographic verification at the outer space
boundary. Until then, the App MUST validate sender identity
before passing ships into the outer space.

### Port wiring as attack surface

**Attack:** A socketed space declares ports that match wiring
rules the parent didn't intend to expose.

**Defense:** Wiring authority (I11). The parent controls ALL
wiring for its subspaces. A subspace can only declare ports — it
cannot wire them. The parent's wiring rules determine what each
port connects to. The OTHER fallback in wiring rules is a
catch-all that the parent explicitly configures. If a port
doesn't match any rule and there's no OTHER, it sploots.


### Dialect confinement proof (runtime eval)

Now that runtime code evaluation is consolidated to a single path
(`process unquote` → `process run`), we can enumerate every
execution path and verify dialect enforcement is complete.

**Claim:** Given effective dialect D_eff = sender.dialect ∩
space.dialect, no DAML expression executing under D_eff can invoke
a command outside D_eff.

**Proof by path enumeration:**

| Path | Where checked | Mechanism |
|------|---------------|-----------|
| Command dispatch | `m_command.js` execute | `dialect.get_method()` before every `run_fun` call |
| Optimizer fast paths | `OPT_simple_math`, `OPT_simple_peek` | `dialect.get_method()` at top of execute |
| `process run` (block eval) | `datatypes/block.js` → `real_execute` | Inherits `process.sender` → new Process recomputes D_eff |
| Implicit block eval (pipe) | same as above | Same `datatypes/block.js` path |
| Station docking | `port_standard_enter` → `Space.dock` | Sender extracted from process, forwarded through port pair |
| Subspace crossing | `Space` constructor | `this.dialect = parent.dialect` (I2 monotonicity); sender intersected at Process creation |
| Alias expansion | `n_alias.js` (parse) + `m_command.js` (runtime) | Aliases expand unconditionally at parse time; resulting Command checked at dispatch |
| `D.run` boundary | `execute_then_stringify` | Sender forwarded to block re-execution context |

**Key invariants this depends on:**

- Blocks are compiled without dialect checks; dialect is enforced
  fresh at every execution. This enables the same block to run
  under different authority levels.
- `D.is_block` requires `instanceof D.Segment` — blocks cannot be
  forged from DAML data values.
- No DAML command creates, modifies, or exposes sender objects.
  Senders are App-level only.
- `intersect_dialects` uses AND logic: both sender and space must
  allow a command for it to execute.
- Policy flags (`restrict_unsafe_ports`, `no_user_regex`) merge
  with OR logic: either restriction wins.

**What this does NOT cover:**

- DoS via `D.BLOCKS` cache growth. Every `unquote` call allocates
  a compiled block that is never evicted. A loop generating novel
  strings is a slow memory leak.
- Alias information leakage. Aliases expand at parse time from the
  global `D.Aliases` table, not through dialect gating. A blocked
  command produces a diagnostic error revealing its existence.
- Sender authentication. The App is responsible for verifying
  sender identity before passing ships into the outer space
  (see §14).


## 14. Future Work

Things we've thought about and deliberately deferred. These are
not TODOs — they're design directions that are out of scope for
the current spec but inform where the system is heading.

### Concurrent scheduling

The current serial model (one ship at a time per space) could be
relaxed to allow segment-level interleaving within a space. This
would increase throughput when ships are waiting on effects, at
the cost of introducing TOCTOU hazards on shared space variables.
Concurrency would be a per-space opt-in. See
`D2-concurrent-scheduling.md` for the full aspirational model.

### Content-addressed editor

Blocks and spaces are content-addressed, which means copy and
paste is automatically deduplicated. An editor built on this
property could track the structural sharing graph: when you modify
a copy, you choose whether it's a specialization or a change to
propagate to all instances. The content-address graph becomes a
version history where changes flow like merging branches. You
don't have to choose between abstraction and copying — you get
both.

### Per-subspace dialects

Currently, the dialect is a property of the outer space and all
subspaces inherit it. Subspace restrictions come entirely from
wiring. A future extension could allow subspaces to have their
own further-restricted dialects, giving finer-grained control.
This would require dialect intersection at each space boundary
instead of once at dock time.

### Sender authentication

Currently, Daimio trusts senders — the App is responsible for
authentication. A future layer could build authentication into
the sender model: signed messages, capability tokens, or HMAC
verification at the outer space boundary. The sender's identity
would be cryptographically verified before the dialect is looked
up.

### Energy and resource limits

Two separate mechanisms:

**System-wide yield.** Every process yields after a fixed time
slice (e.g. 100ms). This is not per-sender — it's a global
scheduler property. No process can monopolize a space. When the
yield fires, the process goes async and resumes on the next tick.
Other queued ships and deferred routing get a chance to run. From
the process's perspective, the yield is transparent.

**Per-sender energy budget.** Each sender has an energy cap (set
by the App). Every operation consumes energy — segment execution,
sub-process creation, memory allocation. The App manages the
budget externally: how it recharges, what the cap is, how costs
are weighted. Daimio enforces the cap and reports energy consumed
on outbound ships, so the App can update its accounting.

Open questions:

  - **Process termination.** What happens when a process exhausts
    its sender's energy? If the process is killed immediately,
    it releases the space for other ships — but serial exclusion
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

  - **Error reporting.** Does killing emit one soft error to the
    error port? Multiple? How does the App learn that a process
    was killed for energy exhaustion vs completing normally?

  - **Energy distribution across wiring.** If a process completes
    with 100 energy remaining and its output is wired to two
    different stations, how is the remaining energy split? Does
    each receiver get 100? 50 each? Does the energy budget
    transfer to the next process at all, or reset per-dock?

  - **Resumability.** Can a killed process resume later if energy
    is replenished? Or is termination permanent — the ship is
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
programs at invocation time — similar to aliases but with
parameters, dialect gating, and the ability to be shared across
spaces.

### Parameter-level dialect restrictions

Currently, dialects restrict at the command level — a command is
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
resource backends. This architecture is sketched in
`extra/D_new.txt` but not yet specified.

### TODA integration

First-class digital assets via TODA files. Your user account,
relationships, and assets become portable, self-sovereign objects
that don't need to live on someone else's server. Combined with
self-authenticating messages, this enables channel-independent
identity and Bring Your Own Backend — you carry your assets and
computational resources into any app.
