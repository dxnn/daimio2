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
- **Seedlike `<->` parser hardening** (reviewer-reported) — `seedlikes_from_string`
  (1_daimio.js:3234) assumes `port <-> station`: it mints a port from *any* LHS token (with a
  garbage direction) and always appends `.in`/`.out` to the RHS as if it were a station. So
  station-first `A <-> @down:svc` silently mints a bogus port `A` + malformed routes (no error),
  and port-on-RHS contracts (`S@down <-> T@up`, per §6) also misparse. A **subspace-qualified
  LHS** (`worker.down:svc <-> proc`, per §6) hits the same path: it mints a bogus port named
  `worker.down:svc` with direction `worker.down` — confirmed 2026-07-07 while adding subspace
  down ports to the layout engine (had to wire fixtures with FAF `->` instead). Fix: reject a
  `<->` whose LHS isn't a valid Enter-N-Exit port, and handle RHS ports — enforce the §3 contract
  signal-type bork instead of failing silently. Fail loud, not silent.
- **Inline block on `<->` RHS is silently dropped** (found 2026-07-07) — the `<->` branch of
  `seedlikes_from_string` (1_daimio.js:3234) pushes routes referencing `{…}.in`/`.out` but,
  unlike the FAF `->` branch (line ~3259), never registers the anonymous `{…}` as a station. So
  `@up:svc <-> {__ | add 1}` produces routes to a station that doesn't exist; `resolve_endpoint`
  returns null, the connection is skipped, and the contract vanishes with no error (the port
  renders as an unwired standalone). Fix: mint a `station-<n>` for a `{…}` RHS (and LHS) in the
  `<->` branch, mirroring the FAF branch. Fail loud or, better, just handle it.

## Space layout: vertical-to-vertical port contracts

- **A contract between two round-trip ports mis-routes to a side + orphans a glyph**
  (found 2026-07-07, `site/js/space_layout.js`). When a connection joins a wall vertical
  port and a subspace down port — e.g. `@down <-> inner.down`, which should desugar to
  `down -> inner.down` / `inner.down -> down` once the `<->` parser bug above is fixed —
  the layout renders it wrong: outer's `@down` attaches to **inner's left/right `o` (in/out)
  sides** and inner's `down` `^v` glyph is stamped but left **orphaned** (no wire, yet its
  band slots still add row height). Two causes in the connection classifier:
  1. The vertical-port diversion (`vport_by_pid[fid] || vport_by_pid[tid]`) is checked
     *before* the subspace-down check, so the connection is handled as `@down`'s leg and the
     far end attaches at the subspace's side (`vp_in_x`), never at its bottom-edge `^v`.
  2. `sub_down_info` *also* fires on the same connection and places the `^v` glyph + band
     slots, but `route_subdown_chain` never runs for it (it went to `vport_conns`), so the
     glyph is orphaned. (Confirmed: invariants pass — they check paths, not glyphs — but the
     corrected-route render fails round-trip, parsing back as `@down -> inner.in` /
     `inner.out -> @down`.)
  Fix needs a genuine **vertical-to-vertical route**: both endpoints attach at their own
  `^v` (outer's floor pair and inner's bottom-edge pair), neither on a side wall — a routing
  case that doesn't exist yet. Also make the two detectors mutually exclusive (or cooperate)
  so no orphaned glyph is placed. Loose end: `sub_down_info`'s `/^down/` test also matches a
  malformed `down.in`/`down.out` port (the parser bug above), which is how the original
  report produced *two* `^v` pairs on inner — moot once the parser is fixed, but worth
  tightening to an exact `down`/`down:*` match.
