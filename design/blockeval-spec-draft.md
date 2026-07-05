# Block-Evaluating Commands — draft edits for D2-spec.md

Drafted 2026-07-05 from design/gen2.md (reviewer finding on
P-effectpartition / transition-rule coverage; decision: A+E).
Seven edits, ordered by spec position. Line numbers refer to the
current D2-spec.md. New assertion IDs use the `blockeval-` prefix
(6 total).

The one-sentence version: the partition becomes ternary — pure,
block-evaluating, effectful — and a command with block-typed params
is exactly as effectful as the blocks it receives.

---

## Edit 1 — Rewrite [P-effectpartition] (§1, lines 243–266)

Replace the section body (including the aside) with:

> ### Effect partition [P-effectpartition]
> Every command definition is exactly one of three things: **pure**
> (a `fun`, no block-typed params), **block-evaluating** (a `fun`
> and at least one block-typed param, counting `either` params with
> a block arm), or **effectful** (an `effect` with a port type).
> The classification is mechanical from the definition alone and is
> checked at registration time [blockeval-category].
>
> A pure command is a total function from parameters to a value --
> it can be executed with no environment at all. An effectful
> command can do nothing except send a request to its port and
> return whatever comes back. A block-evaluating command computes
> like a pure command but may apply its block parameters, each
> application creating a sub-process (P-uniformeval, §5). It makes
> no port requests of its own [blockeval-no-port]: **a
> block-evaluating command is exactly as effectful as the blocks it
> receives** [blockeval-parametric]. Given pure blocks -- or
> non-block values, which are never evaluated (§11, "Block-typed
> contexts") -- it completes synchronously, indistinguishable from
> a pure command [blockeval-sync-when-pure]. Given a block
> containing effectful commands, the sub-process's port requests
> are the only async boundaries the command has (§7).
>
> This partition is what makes a DAML program decomposable into an
> effect skeleton (the sequence of port requests) and pure filling
> (the computation between them). Block evaluation preserves the
> decomposition recursively: a sub-process contributes its own
> effect skeleton, spliced into the parent's at the point of
> application. If a command could be mostly pure but also touch a
> port, you could no longer substitute handlers freely because you
> wouldn't know what the "pure" parts were secretly doing.
>
> > **Algebraic aside.** In the free monad tree, `Pure` nodes are
> > computation and `Op` nodes are effect requests. A
> > block-evaluating command is a node containing sub-trees -- the
> > blocks it applies. Evaluation demands are served by the runtime
> > itself: they never cross a space boundary and never appear on
> > the effect surface. When a sub-tree contains `Op` nodes, they
> > splice into the parent's effect sequence at the application
> > point; when it contains none, the node collapses to `Pure`.
> > The partition is still forced by the tree shape -- computation
> > in continuations, requests at `Op` nodes -- applied recursively.

---

## Edit 2 — P-handlersub derivation (§1, lines 281–283)

Replace the final "Follows from:" paragraph:

> Follows from: effect partition (pure and block-evaluating parts
> cannot touch ports themselves -- a block-evaluating command is
> exactly as effectful as the blocks it receives, and those blocks'
> requests are already part of the skeleton), effect exteriority
> (I10), and the uniform command syntax (effectful commands look
> the same as pure commands from inside the pipeline).

---

## Edit 3 — Command definitions (§4, lines 818–827)

Replace the definition/result block:

```
A command definition is one of:
  Pure(name, params, fun)            -- fun, no block-typed params
  BlockEval(name, params, fun)       -- fun, ≥1 block-typed param [blockeval-category]
  Effectful(name, params, portType)  -- port type, no fun
  -- name is a Cmd (has .handler, .method fields)

A command execution produces one of two results:
  Value(Val)         -- the command completed, here is the result
  Async(wait, cont)  -- the command suspended; resume via cont
                     -- wait: a port (effectful command), or a
                     -- suspended sub-process (block-evaluating
                     -- command whose block hit an effect)
```

Add after the "Pure commands are total functions..." paragraph
(line 829):

> Block-evaluating commands (`list map`, `list filter`, `process
> run`, `logic if`, etc.) are total functions over values and block
> applications. They are exactly as effectful as the blocks they
> receive [blockeval-parametric]: with pure blocks they produce
> `Value` synchronously; a block that reaches an effectful command
> suspends its sub-process, and the command suspends with it.

---

## Edit 4 — Covering transition rule (§7, after "Resumption",
line 2046)

> **Block-evaluating command execution:**
> ```
>   c in effective_dialect.commands
>   c is BlockEval(name, params, fun)
>   args' = fillImplicit(args, process.v)     -- same filling as PureCmd
>   v' = fun(args') with apply
>   ---
>   (process, state) --[BlockCmd(c, args)]--> (process{v := v'}, state)
> ```
>
> `apply(block, input)` is the evaluation demand [blockeval-demand]:
> each call creates a sub-process executing `block` with
> `__in = input`, under the same rules as any process -- same
> effective dialect, same space, same sender (P-uniformeval; §5,
> "Sub-processes"). Non-block values at block-typed params are
> returned as-is, demanding nothing (§11) [blockeval-sync-when-pure].
>
> No new wait machinery is needed. Sub-processes are nested
> execution, not concurrent execution [subprocess-sync-dfs]: if a
> sub-process reaches an effectful command, it is the sub-process
> that WAITs on the port under the ordinary rule above, and the
> parent command is blocked by depth-first nesting alone. When the
> response arrives, RESUME continues the sub-process; on its
> completion `apply` returns its value and `fun` proceeds. If no
> sub-process suspends, the whole step is synchronous -- the same
> shape as PureCmd. Pipeline variables and sender are preserved
> across any such wait, as at every async boundary
> [async-preserve-vars] [async-preserve-sender].

---

## Edit 5 — §11 filling note (lines 3325–3327)

Replace the sentence "PureCmd and EffCmd use
`fillImplicit(args, process.v)`...":

> PureCmd, BlockCmd, and EffCmd use `fillImplicit(args,
> process.v)`, which handles `absent` directly (by skipping
> implicit filling).

Add after the Pure command rule (line 3337):

> Block-evaluating commands share this filling and coercion; their
> execution rule lives in §7, since they can suspend when a block
> reaches an effectful command.

---

## Edit 6 — Segment grammar (§11, line 3659)

Add a segment kind:

```
seg ::= PureCmd(c, args)           -- invoke a pure command
      | BlockCmd(c, args)          -- invoke a block-evaluating command
                                   --   (sub-process per block application;
                                   --   async boundary only if a block
                                   --   suspends) [blockeval-segment]
      | EffCmd(c, args)            -- invoke an effectful command (async boundary)
      ...
```

---

## Edit 7 — Dialect-check note (line 3941)

Replace "PureCmd (§11) and EffCmd (§7) both check
`c ∈ effective_dialect.commands`":

> PureCmd (§11), BlockCmd (§7), and EffCmd (§7) all check
> `c ∈ effective_dialect.commands`. Sub-processes created by
> BlockCmd run under the same effective dialect (P-uniformeval),
> so a block cannot reach commands its parent could not.

---

## Cross-references left intact (verified consistent)

- §5 "Sub-processes" (line 1463) already describes the category
  informally ("Commands that accept block parameters ... evaluate
  the block by creating a sub-process") — optionally prefix with
  "Block-evaluating commands (P-effectpartition)" for the
  vocabulary link.
- §11 "Block-typed contexts" (line 3378) and [block-param-block] /
  [block-param-nonblock] already specify per-invocation sub-process
  creation and the non-block pass-through; unchanged.
- P-total is unaffected: block-evaluating commands still always
  return a value (sub-process totality + liveness bound inner
  effects).
- P-uniformeval is the anchor and is unchanged.

## New assertion IDs (6)

blockeval-category, blockeval-no-port, blockeval-parametric,
blockeval-sync-when-pure, blockeval-demand, blockeval-segment
