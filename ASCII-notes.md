# Daimio2 ASCII Renderer notes


## Space layout: vertical-to-vertical port contracts

**DEFERRED (dann, 2026-07-13): the ASCII renderer is not mission-critical.**
Diagnosis complete (below); implementation parked. Nothing downstream depends
on it — the parser rejects nothing valid here, so this is purely a layout gap.

- **Root cause (confirmed 2026-07-13).** The connection classifier
  (`space_layout.js:587`) sweeps ANY connection touching a wall vertical port
  into `vport_conns` — BEFORE the `sub_down_info`/`sub_up_info` check at 592 —
  and the vport router downstream assumes the OTHER endpoint is a positioned
  node (a station, or a subspace's side wall). Two topologies violate that:
  - **Both ends vertical** (`@up:req <-> @down:fwd`, one space): the far end is
    also a vport with no node x/y, so the router emits a path point past the
    grid; `render_space` (`space_ascii.js:68`, `grid[y]` undefined) then throws.
    This is a whole CRASH CLASS, not one case — grid sizing must account for the
    route so no path point exceeds it.
  - **Wall vport + subspace-down** (`@down <-> inner.down`): the `vport_by_pid`
    check wins over the `sub_down` check, so the far end attaches at the
    subspace's SIDE `o` and the subspace's bottom-edge `^v` is stamped but never
    wired (orphaned glyph, still eating row height).
- **Proposed approach (for whoever picks this up).** (1) Split the classifier:
  detect a vertical-to-vertical connection (both endpoints wall up/down OR
  subspace up/down edges) and route it separately; make the vport and
  sub_down/sub_up detectors mutually exclusive so no glyph is stamped without a
  matching route. (2) New route builder: both endpoints attach at their own `^v`
  (wall ceiling/floor pair or subspace box edge), joined via a reserved vertical
  channel + the existing top/floor bands — neither end on a side wall.
  (3) Feed the reservation into height/width sizing (closes the crash class).
  (4) Keep the 7 invariants green + all fixtures round-tripping; add `@up<->@down`
  and `@down<->inner.down` fixtures once they render cleanly. Hard part: band
  allocation + invariant/round-trip interactions.
- **Down-port coverage today:** the down-port-contract fixture uses a
  subspace-down contract (down `^v` on a box edge, handled by a parent station),
  which renders + round-trips — so the down glyph IS exercised; only the
  vertical-to-vertical *contract* render is missing.
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
