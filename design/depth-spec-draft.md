# Recursion Depth Bound — draft edits for D2-spec.md

Drafted 2026-07-05 from design/gen2.md (reviewer finding on
P-total/recursion; decision: option (a) + instance-level bound,
system default 100). Seven edits, ordered by spec position. Line
numbers refer to the current (post-black-hole-merge) D2-spec.md.
New assertion IDs use the `depth-` prefix, plus one general error
rule (6 total).

Composes with design/blockeval-spec-draft.md: once that patch lands,
the enforcement point is the `apply` demand [blockeval-demand]. This
draft is standalone-safe — it anchors to sub-process creation (§5),
which exists today.

The one-sentence version: implementations bound block-evaluation
depth (default 100, set per outer space like the timeout); exceeding
it sploots the innermost evaluation — which turns P-total's
termination claim from a false assumption into a theorem.

---

## Edit 1 — P-total (§1, lines 85–91)

Add after "...The empty value coerces to `""`, `0`, or `[]` as
needed, so it always flows cleanly through subsequent commands.":

> Block-evaluation depth is bounded; exceeding the bound sploots
> the innermost evaluation (§11, "Recursion depth"
> [depth-exceeded-sploot]). With the bound in place, termination is
> a theorem rather than an assumption: total commands, bounded
> depth, bounded breadth (values are finite), and finite pipelines
> mean every process terminates.

---

## Edit 2 — I1 (§1, lines 317–320)

Replace "No pipeline diverges or crashes.":

> No pipeline diverges or crashes: block-evaluation depth is
> bounded, and exceeding the bound sploots (§11, "Recursion
> depth").

---

## Edit 3 — Outer space creation (§4, line 1270)

Add a sixth item to the creation list:

>   6. Providing a block-evaluation depth bound (or accepting the
>      system default of 100) [depth-bound-instance]

---

## Edit 4 — New subsection: Recursion depth (§11, insert before
"### Finalization", line ~3827)

> ### Recursion depth
>
> Sub-process creation is the only unbounded-depth construct in
> the model: a named block can invoke itself, and a block can
> unquote and run itself. Implementations MUST bound
> block-evaluation depth [depth-bound]. The bound is set per outer
> space at creation time, with a system default of 100
> [depth-bound-instance] — the spatial counterpart of the down-port
> timeout (P-liveness, §7.2): a normative default, an
> instance-level knob, and normative behavior at the limit.
>
> Depth counts sub-process nesting only [depth-nesting-only].
> Applying a block to a thousand items at depth k runs every
> application at depth k+1 — breadth costs nothing. Depth is a
> property of nesting, not time: it persists across async
> boundaries. Deferred port routing starts fresh processes through
> the queue, so routed ships begin again at depth zero
> [depth-reset-routing] (§5, "Port routing and deferred entry").
>
> Creating a sub-process beyond the bound sploots the innermost
> evaluation [depth-exceeded-sploot]: a value-producing sploot —
> soft error to `@out:err`, the evaluation yields empty, and the
> enclosing pipeline continues (§12). The unwind is ordinary: each
> enclosing level completes normally with the empty flowing
> through. Given the bound, the behavior is fully deterministic.
> Because every evaluation vector — block params, named blocks,
> `process run`, end-of-pipeline evaluation, finalization — creates
> a sub-process (P-uniformeval), this single check covers them all.

---

## Edit 5 — [finalize-block] annotation (§11, line 3834)

Replace the annotation
`-- terminates: nesting depth bounded by finite source`
(which is false — a named block can invoke itself) with:

```
                      -- terminates: depth bounded ("Recursion
                      -- depth" [depth-exceeded-sploot])
```

---

## Edit 6 — §12 Errors (lines 3881–3901)

Add to the value-producing sploots list:

```
  - block-evaluation depth bound exceeded                   [depth-exceeded-sploot]
```

Add after the "When splooting:" list (line 3901):

> Sploots also serve as the floor for host-level failures:
> implementations MUST catch whatever host runtime errors they can
> and convert them to value-producing sploots rather than crashes
> [host-error-sploot]. This generalizes the port-flavour rule
> [flavour-error-soft] to all execution contexts. A conforming
> command never throws (totality is a requirement on definitions);
> if one does anyway, or the host fails in a recoverable way, the
> failure surfaces as a sploot, not a crash.

---

## Edit 7 — §13 DoS paragraph (lines 4033–4046)

Replace the "Defense (partial)" paragraph:

> **Defense (partial):** Recursion is bounded: block-evaluation
> depth is capped per outer space (§11, "Recursion depth"), so deep
> recursion sploots deterministically instead of exhausting the
> host stack [depth-exceeded-sploot]. Liveness (I9) guarantees
> effectful operations resolve via timeout. But pure computation
> still has no built-in limit — a tight loop of pure commands, a
> map over a massive list, or ship ping-pong between stations
> (deferred routing resets depth [depth-reset-routing]) can consume
> unbounded CPU.

(The "Mitigation" paragraph — resource limits deferred to §14 —
stands unchanged.)

---

## New assertion IDs (6)

depth-bound, depth-bound-instance, depth-nesting-only,
depth-reset-routing, depth-exceeded-sploot, host-error-sploot

## Portable RED test (writable before implementation)

Unbounded recursion MUST sploot rather than crash, at any bound:
a self-invoking named block yields empty + soft error and the
process completes [depth-exceeded-sploot]. With the instance-level
bound set low (e.g. 3), the exact sploot depth is assertable.
