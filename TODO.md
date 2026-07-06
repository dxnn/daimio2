# Daimio2 Implementation TODO

Work needed to bring the engine in line with D2-spec.md. Roughly priority-ordered.
Add items freely.

## Priority

1. **Implement `{var read}` / `{var write}`** — pure, local, dynamic-name svar access.
   - `{var read name :foo}` reads the current space's `$foo` by a *computed* name
     (the counterpart to the literal-name `$foo` syntax); `{var write name :foo value V}`
     writes it (counterpart to `>$foo`). `{var read name _n}` reads whatever `_n` names.
   - The behavior already exists in `daimio/commands/builtin/var.js`: `read-out`/`write-out`
     call `process.space.get_state`/`set_state`. Extract a clean `read`/`write` pair with
     **no `effect` block** (these are local, not port-routed).
   - Spec: §6 "Example: cross-boundary state access", tags `[var-read]` `[var-write]`.

2. **All effectful commands must be port-routed — no default `fun`.**
   - Spec already requires this (no spec change): a command has *exactly one* of `fun` or
     `effect` (§1 P-effectpartition); "Effectful commands have no fun" (§4); unwired
     effectful → sploot, not a fallback (§7 `[effectful-unwired-sploot]`, "No effects
     without wiring").
   - Current violation: `var read-out`/`var write-out` carry BOTH `effect` and `fun`, and
     `m_command.js` ignores `effect` entirely (`execute` → `run_fun` always calls `fun`), so
     they run as pure *local* reads/writes instead of cross-boundary port round-trips.
   - Work: (a) drop `fun`/`defaultValue` from effectful command defs; (b) enforce the
     registration-time check (exactly one of `fun`/`effect`); (c) implement the effectful
     dispatch path so `effect`/`portType` actually route a request through a port.

3. **Socket transition tests.** Update `space_test.mjs:1217-1276` (`socket overlap: old
   space state lost`) to the new model — its `[socket-overlap-state-lost]` tag, comment, and
   label reference the dropped overlap semantics; the assertion (state lost on transition)
   still holds. Then add dedicated tests for **drain** (in-flight completes, new arrivals
   buffer then deliver) and **smash** (old svars + non-exited ships destroyed; a waiting
   down-port response returns to a ghost). Tags `[socket-drain]` `[socket-smash]`.

## Backlog / dependencies (expand as needed)

- **Port / async machinery** — prerequisite for 2(c): cmd-port demand-creation, down-port
  round-trips, WAIT/resume, wiring-rule matching, per-wire timeouts. Currently unimplemented
  (CLAUDE.md: "space_test (24): 23x unimplemented spec behaviors").
- **Cross-boundary `var read-out`/`var write-out`** — once ports route, these must reach the
  **parent's** state, not the caller's (today's `fun` reads the caller's own space).
- **Socket-load** — implement the replace-content model + drain/smash transitions (spec §8):
  incoming Astroglot replaces a subspace's internal content (top-level label discarded, parent
  name + wiring kept); drain (default) buffers new arrivals then swaps; smash destroys old svars
  + non-exited ships (returning down-port responses → ghosts); a socket-load port on the root
  borks.
- **Deterministic scheduler** — dock order and cross-space interleaving. The spec's determinism
  boundary is deferred until this exists (spec #11); ask before speccing.
