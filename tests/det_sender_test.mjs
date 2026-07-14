// Sender / dialect determinism — run: node tests/det_sender_test.mjs
// Probes I2 (dialect monotonicity), I3 (sender propagation), I4 (confinement),
// §13 (identity rides the carrier), and sender attachment at entry.
//
// Observation channel: {process sender} returns the attached sender id as a
// DAML value (echoed to @out), and arrive(...,{sender}) injects a sender.
// NOTE (spec-keeper flag): {process sender} exposing the id is in tension with
// §13 "no DAML command exposes sender objects" and §14 (__sender.id as future
// work). It exposes only the read-only id string; the tests use it as the
// cleanest observation channel, but the conformance of the command itself is
// an open question for the spec owner.

import { det_test, arrive, sender, run } from './det_harness.mjs'

var D = (await import('../daimio/daimio.js')).default

var ECHO = `outer
  @go from-js
  @out det-out
  echo {process sender}
  @go -> echo -> @out`

// ── I3 — an explicitly-attached sender propagates and is never overridden ──
det_test('sender: an attached sender is kept, not overridden at entry [sender-attach-no-override]', {
  seed: ECHO,
  schedule: [ arrive('go', 'x', { sender: sender('alice') }) ],
  assert: function(t, e) { e.outputs('out', ['alice']) },
})

det_test('sender: propagates across a station-to-station hop [sender-propagate-out]', {
  seed: `outer
    @go from-js
    @out det-out
    a {__}
    b {process sender}
    @go -> a -> b -> @out`,
  schedule: [ arrive('go', 'x', { sender: sender('alice') }) ],
  assert: function(t, e) { e.outputs('out', ['alice']) },
})

det_test('sender: is immutable across pipeline work [I3]', {
  seed: `outer
    @go from-js
    @out det-out
    echo {:junk | string uppercase || process sender}
    @go -> echo -> @out`,
  schedule: [ arrive('go', 'x', { sender: sender('alice') }) ],
  assert: function(t, e) { e.outputs('out', ['alice']) },
})

// ── I2 / I4 — a restricted sender attenuates; a forbidden command sploots ──
det_test('sender: forbidden command sploots to empty under an attenuated sender [dialect-cmd-sploot] [I4]', {
  seed: `outer
    @go from-js
    @out det-out
    calc {3 | math add value 2}
    @go -> calc -> @out`,
  schedule: [ arrive('go', 'x', { sender: sender('bob', { math: ['add'] }) }) ],
  assert: function(t, e) { e.outputs('out', ['']) },
})

det_test('sender: the same command runs absent attenuation (control) [dialect-cmd-sploot]', {
  seed: `outer
    @go from-js
    @out det-out
    calc {3 | math add value 2}
    @go -> calc -> @out`,
  schedule: [ arrive('go', 'x') ],
  assert: function(t, e) { e.outputs('out', [5]) },
})

// ── §13 — identity rides the carrier, never the payload ────────────────────
// A senderless ship whose payload *claims* an identity gets no privilege from
// it; the sender is never the payload's "admin" (it is "" today, the entry
// qname once [sender-attach-entry] lands — never a payload-derived value).
det_test('sender: a payload claiming a user confers no identity [sender-carrier-not-payload]', {
  seed: ECHO,
  schedule: [ arrive('go', { user: 'admin' }) ],
  assert: function(t, e) {
    var out = t.filter(function(x) { return x.port === 'out' }).map(function(x) { return x.value })
    e.ne(out.join(','), 'admin')
  },
})

// ── Sender attachment at entry [sender-attach-entry] [sender-attach-registry] ──
// A senderless ship entering a world-paired port takes the entry port's
// qualified name as its sender (D.entry_sender); a sender registered under
// that qname via D.register_sender wins. The qname form is settled — a port
// on the outer space carries no space prefix (e.g. @in:go), per [qname-structure].
det_test('sender: a senderless ship takes the entry port qname as sender [sender-attach-entry]', {
  seed: ECHO,
  schedule: [ arrive('go', 'x') ],
  assert: function(t, e) { e.outputs('out', ['@in:go']) },
})

// [sender-attach-registry] — a sender registered under the entry port's
// qname is attached instead of the default, carrying its attenuated
// dialect: {math add} is blocked for bob, so calc sploots to ''.
D.register_sender('@in:reg', sender('bob', { math: ['add'] }))
det_test('sender: a registered sender attaches at its entry port [sender-attach-registry]', {
  seed: `outer
    @reg from-js
    @out det-out
    who {process sender}
    calc {math add value 1 to 2}
    @reg -> who -> @out
    @reg -> calc -> @out`,
  schedule: [ arrive('reg', 'x') ],
  assert: function(t, e) { e.outputs('out', ['bob', '']) },
})

run()

// ── Deferred (need machinery not yet present) ──────────────────────────────
// [sender-propagate-downport]/[sender-propagate-error] — need down-port
//   round-trips / error ships carrying the sender (ports/async).
// [id-deterministic]/[qname-*] — need the internal-dock trace (qname + number
//   per dock); procids were dropped from the spec, so observable ids are
//   qnames + content hashes only. See det_test.mjs deferred list.
