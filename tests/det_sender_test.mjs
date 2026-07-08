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

import { det_test, arrive, sender, known_failures, run } from './det_harness.mjs'

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

// ── Sender attachment at entry (RED — no automatic attachment / registry) ──
// A senderless ship entering @go should take the entry port's qualified name
// as its sender. Today {process sender} is "" (no attachment).
// FLAG: the exact qname form is an open spec question — §10 L941 shows the
// outer space's own port as `@in:init` (no space prefix), while the sender
// extraction cites `main@in:init`. The expected value below encodes the target;
// reconcile it when the qname form is settled.
det_test('sender: a senderless ship takes the entry port qname as sender [sender-attach-entry]', {
  seed: ECHO,
  schedule: [ arrive('go', 'x') ],
  assert: function(t, e) { e.outputs('out', ['@in:go']) },
})

;[
  'sender: a senderless ship takes the entry port qname as sender [sender-attach-entry]',
].forEach(function(l) { known_failures.add(l) })

run()

// ── Deferred (need machinery not yet present) ──────────────────────────────
// [sender-attach-registry] — needs a qname->sender registry consulted in
//   port.enter() (no D.register_sender API exists). Then a senderless ship at
//   a registered, attenuated port sploots forbidden commands.
// [sender-propagate-downport]/[sender-propagate-error] — need down-port
//   round-trips / error ships carrying the sender (ports/async).
// [id-deterministic]/[qname-*] — need the internal-dock trace (qname + number
//   per dock); procids were dropped from the spec, so observable ids are
//   qnames + content hashes only. See det_test.mjs deferred list.
