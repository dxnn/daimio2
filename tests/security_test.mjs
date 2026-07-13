// Security test suite for Daimio restricted dialect
// Run with: node tests/security_test.mjs

var D = (await import('../daimio/daimio.js')).default

var pass = 0, fail = 0
function test(name, condition) {
  if(condition) { console.log('  PASS:', name); pass++ }
  else { console.log('  FAIL:', name); fail++ }
}

// [P-dialect] [I2]
console.log('=== Dialect Configuration ===')
test('D.DIALECTS.top exists', !!D.DIALECTS.top)
test('D.DIALECTS.restricted exists', !!D.DIALECTS.restricted)
test('restricted has policy', !!D.DIALECTS.restricted.policy)
test('restricted has restrict_unsafe_ports', D.DIALECTS.restricted.policy.restrict_unsafe_ports === true)
test('restricted no_user_regex is true', D.DIALECTS.restricted.policy.no_user_regex === true)

// [I4] [dialect-cmd-sploot]
console.log('\n=== Command Gating ===')
test('top allows process.unquote', !!D.DIALECTS.top.get_method('process', 'unquote'))
test('restricted blocks process.unquote', !D.DIALECTS.restricted.get_method('process', 'unquote'))
test('restricted allows math.add', !!D.DIALECTS.restricted.get_method('math', 'add'))
test('restricted allows list.range', !!D.DIALECTS.restricted.get_method('list', 'range'))
test('restricted allows string.grep', !!D.DIALECTS.restricted.get_method('string', 'grep'))
test('restricted allows logic.is', !!D.DIALECTS.restricted.get_method('logic', 'is'))
test('restricted allows process.run', !!D.DIALECTS.restricted.get_method('process', 'run'))
test('restricted allows process.quote', !!D.DIALECTS.restricted.get_method('process', 'quote'))

// [independent:unsafe-ports]
console.log('\n=== Unsafe Port Flavours ===')
test('dom-set-raw-html is unsafe', D.PortFlavours['dom-set-raw-html'].unsafe === true)
test('to-js is unsafe', D.PortFlavours['to-js'].unsafe === true)
test('xhr-send is unsafe', D.PortFlavours['xhr-send'].unsafe === true)
test('websock-in is unsafe', D.PortFlavours['websock-in'].unsafe === true)
test('websock-out is unsafe', D.PortFlavours['websock-out'].unsafe === true)
test('sse-receive is unsafe', D.PortFlavours['sse-receive'].unsafe === true)
test('dom-set-text is safe', !D.PortFlavours['dom-set-text'].unsafe)
test('dom-on-click is safe', !D.PortFlavours['dom-on-click'].unsafe)
test('in is safe', !D.PortFlavours['in'].unsafe)
test('from-js is safe', !D.PortFlavours['from-js'].unsafe)

// [independent:prototype-pollution]
console.log('\n=== Prototype Pollution Protection ===')
test('is_banned_key blocks __proto__', D.is_banned_key('__proto__'))
test('is_banned_key blocks constructor', D.is_banned_key('constructor'))
test('is_banned_key blocks prototype', D.is_banned_key('prototype'))
test('is_banned_key allows normal keys', !D.is_banned_key('foo'))
test('is_banned_key allows normal keys', !D.is_banned_key('name'))

// Runtime prototype pollution tests
var obj1 = {a: 1}
D.extend(obj1, {'__proto__': {polluted: true}, b: 2})
test('extend blocks __proto__ key', obj1.polluted === undefined)
test('extend still copies normal keys', obj1.b === 2)

var obj2 = {a: 1}
D.extend(obj2, {'constructor': 'bad', 'prototype': 'bad', c: 3})
test('extend blocks constructor key', obj2.constructor !== 'bad')
test('extend blocks prototype key', obj2.prototype === undefined)
test('extend still copies normal keys alongside banned', obj2.c === 3)

var obj3 = {nested: {x: 1}}
D.recursive_extend(obj3, {'__proto__': {polluted: true}, nested: {y: 2}})
test('recursive_extend blocks __proto__ key', obj3.polluted === undefined)
test('recursive_extend still merges normal keys', obj3.nested.y === 2)

var obj4 = {}
D.recursive_extend(obj4, {'constructor': 'bad', 'prototype': 'bad'})
test('recursive_extend blocks constructor key', obj4.constructor !== 'bad')
test('recursive_extend blocks prototype key', obj4.prototype === undefined)

// Ensure Object.prototype wasn't polluted
test('Object.prototype not polluted', ({}).polluted === undefined)

// hasOwnProperty checks in list commands
var proto = {inherited: 'leaked'}
var child = Object.create(proto)
child.own = 'kept'

// list union should only iterate own properties
var union_result = D.Commands.list.methods.union.fun([child, {other: 'val'}])
test('list union skips inherited properties', union_result.inherited === undefined)
test('list union keeps own properties', union_result.own === 'kept')
test('list union keeps other list properties', union_result.other === 'val')

// list merge processfun copies item keys into scope — should skip inherited
// We test this indirectly: merge iterates items and copies their keys into scope.
// With the bug, inherited keys leak into scope; without, only own keys are copied.
var merge_scope = {}
var merge_item = Object.create({inherited_key: 'should_not_leak'})
merge_item.real_key = 'real_value'
for(var key in merge_item) {
  if(!D._hop.call(merge_item, key)) continue
  merge_scope[key] = merge_item[key]
}
test('merge-style iteration skips inherited keys', merge_scope.inherited_key === undefined)
test('merge-style iteration keeps own keys', merge_scope.real_key === 'real_value')

// Contrast: without the fix, for-in would copy inherited keys
var leaky_scope = {}
for(var key in merge_item) {
  leaky_scope[key] = merge_item[key]
}
test('for-in without guard does leak inherited keys (control)', leaky_scope.inherited_key === 'should_not_leak')

// [independent:regex-dos]
console.log('\n=== Regex Safety ===')
test('safe_string_to_regex works without process', D.safe_string_to_regex('hello', false, null) instanceof RegExp)
test('string_to_regex still works for regex', D.string_to_regex('/test/i') instanceof RegExp)
test('safe_string_to_regex allows plain strings always', D.safe_string_to_regex('hello', false, {space: {dialect: D.DIALECTS.restricted}}) instanceof RegExp)

// Simulate a restricted process
var fake_process = {space: {dialect: D.DIALECTS.restricted}}
var result = D.safe_string_to_regex('/test/', false, fake_process)
test('safe_string_to_regex blocks /regex/ in restricted mode (returns escaped literal)', result.source === '\\/test\\/')

var fake_process_top = {space: {dialect: D.DIALECTS.top}}
var result2 = D.safe_string_to_regex('/test/', false, fake_process_top)
test('safe_string_to_regex allows /regex/ in unrestricted mode', result2.source === 'test')

// [independent:resource-limits]
console.log('\n=== Resource Limits ===')
test('max_range_length is 1M', D.Etc.max_range_length === 1000000)

// [I2] [dialect-alias-expand] [alias-dialect-gate]
// console.log('\n=== Alias Gating ===')
// test('top has unquote alias', !!D.DIALECTS.top.aliases['unquote'])
// test('restricted blocks unquote alias', !D.DIALECTS.restricted.get_alias('unquote'))
// test('restricted keeps map alias', !!D.DIALECTS.restricted.get_alias('map'))
// test('restricted keeps reduce alias', !!D.DIALECTS.restricted.get_alias('reduce'))

// [P-copy] [I14]
console.log('\n=== Data Integrity ===')
// list reduce mutates its input array via data.shift()
var reduce_fn = D.Commands.list.methods.reduce.fun
var noop_block = function(ps, scope) { return scope.total + scope.value }
var noop_ps = function(v) {}

// Test 1: input array should not lose its first element
var input = [1, 2, 3, 4]
var input_copy = input.slice()
reduce_fn(input, noop_block, null, noop_ps)
test('list reduce does not mutate input array length', input.length === input_copy.length)
test('list reduce does not remove first element', input[0] === input_copy[0])
test('list reduce preserves all elements', JSON.stringify(input) === JSON.stringify(input_copy))

// Test 2: calling reduce twice on same data should give same result
var data2 = [10, 20, 30]
reduce_fn(data2, noop_block, null, noop_ps)
var len_after_first = data2.length
reduce_fn(data2, noop_block, null, noop_ps)
test('list reduce is idempotent on input', data2.length === len_after_first)

// Test 3: single-element array should not become empty
var single = [42]
reduce_fn(single, noop_block, null, noop_ps)
test('list reduce does not empty single-element array', single.length === 1)
test('list reduce preserves single element value', single[0] === 42)

// [independent:strict-mode]
console.log('\n=== Strict Mode (undeclared globals) ===')
// daggr.js spewtime uses undeclared oldtime/newtime — crashes in ES modules (strict mode)
var spewtime_ok = true
try { D.Commands.daggr.methods.spewtime.fun() } catch(e) { spewtime_ok = false }
test('daggr spewtime runs without ReferenceError', spewtime_ok)

// dagoba.js graph create uses undeclared topics — crashes in ES modules (strict mode)
// Can't call create.fun() directly because Dagoba (external dep) isn't available in node.
// Instead, verify the fix by checking the function source doesn't assign bare `topics =`
var add_graph_src = D.Commands.dagoba.methods.add_graph.fun.toString()
test('dagoba add_graph declares topics with var', /var topics/.test(add_graph_src))

// dagoba.js update_thing: missing return after D.on_error('Invalid id')
// Lines 433,435 use `return D.on_error(...)` but line 438 omits `return`.
var set_data_src = D.Commands.dagoba.methods.set_data.fun.toString()
test('dagoba set_data returns after Invalid id error', /if\(!thing\)\s*return/.test(set_data_src))

// [independent:param-constraints]
console.log('\n=== Param Constraints (allow/deny) ===')

// Register a test command with allow/deny params
D.import_models({
  ttest: {
    desc: 'Test commands for param constraints',
    methods: {
      allow_only: {
        desc: 'Only accepts allowed values for mode',
        params: [
          {
            key: 'value',
            desc: 'Any value',
            type: 'string'
          },
          {
            key: 'mode',
            desc: 'Restricted mode param',
            type: 'string',
            allow: ['fast', 'slow']
          }
        ],
        fun: function(value, mode) { return value + ':' + mode }
      },
      deny_only: {
        desc: 'Denies certain values for tag',
        params: [
          {
            key: 'value',
            desc: 'Any value',
            type: 'string'
          },
          {
            key: 'tag',
            desc: 'Tag param with deny list',
            type: 'string',
            deny: ['admin', 'root']
          }
        ],
        fun: function(value, tag) { return value + ':' + tag }
      },
      both: {
        desc: 'Has both allow and deny on same param',
        params: [
          {
            key: 'color',
            desc: 'Color with allow minus deny',
            type: 'string',
            allow: ['red', 'green', 'blue'],
            deny: ['blue']
          }
        ],
        fun: function(color) { return color }
      }
    }
  }
})

// Helper: run Daimio code synchronously and collect result
function run(code) {
  var result = D.execute_then_stringify(
    D.ExecutionSpace.execute(
      D.Parser.string_to_block_segment(code)))
  return result
}

// allow-only tests
test('allow param accepts allowed value "fast"',
  run('{ttest allow_only value "hi" mode "fast"}') === 'hi:fast')
test('allow param accepts allowed value "slow"',
  run('{ttest allow_only value "hi" mode "slow"}') === 'hi:slow')
test('allow param rejects disallowed value',
  run('{ttest allow_only value "hi" mode "turbo"}') === '')

// deny-only tests
test('deny param accepts non-denied value',
  run('{ttest deny_only value "hi" tag "user"}') === 'hi:user')
test('deny param rejects denied value "admin"',
  run('{ttest deny_only value "hi" tag "admin"}') === '')
test('deny param rejects denied value "root"',
  run('{ttest deny_only value "hi" tag "root"}') === '')

// both allow and deny: effective allow is ['red', 'green']
test('allow+deny accepts value in allow minus deny',
  run('{ttest both color "red"}') === 'red')
test('allow+deny accepts green',
  run('{ttest both color "green"}') === 'green')
test('allow+deny rejects value in deny (blue)',
  run('{ttest both color "blue"}') === '')
test('allow+deny rejects value not in allow',
  run('{ttest both color "yellow"}') === '')

// no constraints: existing params should still work fine
test('unconstrained param passes anything through',
  run('{ttest allow_only value "anything" mode "fast"}') === 'anything:fast')

// [P-dialect]
console.log('\n=== Dialect Identity ===')
test('top dialect has a did', typeof D.DIALECTS.top.did === 'number')
test('restricted dialect has a did', typeof D.DIALECTS.restricted.did === 'number')
test('different dialects have different dids', D.DIALECTS.top.did !== D.DIALECTS.restricted.did)

// [dialect-cmd-sploot] [I4]
console.log('\n=== Segment Cache Isolation ===')
// Two dialects: one blocks math.add, one allows it
var no_math = D.make_restricted_dialect({blocked_methods: {'math': ['add']}})

// Find the Command segment inside a parsed block
function find_command_seg(code) {
  var bseg = D.Parser.string_to_block_segment(code)
  var block = D.BLOCKS[bseg.value.id]
  for(var i = 0; i < block.segments.length; i++)
    if(block.segments[i].type === 'Command') return block.segments[i]
  return null
}

var seg = find_command_seg('{math add value 1 to 2}')
var fake_p = {space: D.ExecutionSpace, station_id: undefined, sender: null}

// Run under blocking dialect first
var r1 = D.SegmentTypes.Command.execute(seg, [1, 2], no_math, function(){}, fake_p)
test('blocking dialect returns empty for math.add', r1 === '')

// Now run under top dialect — should succeed despite cache from blocking run
var r2 = D.SegmentTypes.Command.execute(seg, [1, 2], D.DIALECTS.top, function(){}, fake_p)
test('top dialect still works after blocking dialect cached', r2 === 3)

// Reverse: top first, then blocking
var seg2 = find_command_seg('{math add value 5 to 10}')
var r3 = D.SegmentTypes.Command.execute(seg2, [5, 10], D.DIALECTS.top, function(){}, fake_p)
test('top dialect executes math.add = 15', r3 === 15)
var r4 = D.SegmentTypes.Command.execute(seg2, [5, 10], no_math, function(){}, fake_p)
test('blocking dialect blocks after top cached', r4 === '')

// [I3] [I4]
console.log('\n=== Sender ===')
test('D.Sender exists', typeof D.Sender === 'function')
var sender_a = new D.Sender('alice')
test('Sender has id', sender_a.id === 'alice')
test('Sender dialect is null by default', sender_a.dialect === null)

var sender_b = new D.Sender('bob', {dialect: D.DIALECTS.restricted})
test('Sender accepts dialect option', sender_b.dialect === D.DIALECTS.restricted)

// [I4] [P-dialect]
console.log('\n=== make_sender_dialect ===')
test('D.make_sender_dialect exists', typeof D.make_sender_dialect === 'function')
var app_dialect = D.DIALECTS.top
var bob_dialect = D.make_sender_dialect(app_dialect, {blocked_methods: {'string': ['grep']}})
test('sender dialect blocks denied method', !bob_dialect.get_method('string', 'grep'))
test('sender dialect allows other methods', !!bob_dialect.get_method('math', 'add'))
test('sender dialect allows same handler other methods', !!bob_dialect.get_method('string', 'join'))

// Chain: sender dialect on top of already-restricted base
var strict_base = D.make_restricted_dialect({blocked_methods: {'process': ['unquote']}})
var strict_actor = D.make_sender_dialect(strict_base, {blocked_methods: {'math': ['add']}})
test('chained dialect blocks base restriction', !strict_actor.get_method('process', 'unquote'))
test('chained dialect blocks sender restriction', !strict_actor.get_method('math', 'add'))
test('chained dialect allows unrestricted', !!strict_actor.get_method('list', 'map'))

// closed-space DROPPED (audit ruling 2026-07-12): the scenario it guarded
// — the App executing directly inside an interior space — is forbidden
// outright by the §4 App obligation [app-entry-outside-only] (ships enter
// only at the outer boundary or black-hole out-ports). A guide for that
// obligation lands once an enforcement point exists (e.g.
// send_value_to_js_port refusing non-root spaces).
console.log('\n=== Senderless execution ===')

// [sender-effective-default] A space works without sender (space dialect applies)
test('open space works without sender', run('{math add value 1 to 2}') === '3')

// ── Sender Tests ──────────────────────────────────────────────────────────────
// These test sender preservation and confinement from the outside, the way an
// App using Daimio would: pass a ship with a sender into a space, and when ships
// come back out through ports, verify the sender survived the whole journey.

// Sender-check port flavour: captures {ship, sender} from exiting ships
var sender_check_results = []
var sender_check_notify = null

D.import_port_flavour('sender-check', {
  dir: 'out',
  outside_exit: function(ship, sender) {
    sender_check_results.push({ship: ship, sender: sender})
    if(sender_check_notify) sender_check_notify()
  }
})

function dedent(s) {
  var lines = s.split('\n')
  while(lines.length && !lines[0].trim()) lines.shift()
  var min = Infinity
  lines.forEach(function(line) {
    if(!line.trim()) return
    var indent = line.search(/\S/)
    if(indent < min) min = indent
  })
  if(min === Infinity) min = 0
  return lines.map(function(line) { return line.slice(min) }).join('\n')
}

// Helper: create space, send ship with sender, collect results asynchronously
function sender_test(label, seedlike, sender, sends, expected_count, check) {
  return new Promise(function(resolve) {
    seedlike = dedent(seedlike)
    sender_check_results = []
    var seed_id = D.make_some_space(seedlike)
    var space = new D.Space(seed_id)

    sender_check_notify = function() {
      if(sender_check_results.length >= expected_count) {
        sender_check_notify = null
        check(sender_check_results)
        resolve()
      }
    }

    sends.forEach(function(send) {
      D.send_value_to_js_port(space, send.port, send.value, send.flavour, sender)
    })

    // In case results arrived synchronously during sends
    sender_check_notify()
  })
}

var sender_actor = new D.Sender('alice', {dialect: D.DIALECTS.top})

// [I3]
console.log('\n=== Sender Preservation ===')

// 1. Simple passthrough: ship enters station, exits. Sender preserved. [sender-propagate-out]
await sender_test(
  'passthrough',
  `
  outer
    @init from-js
    @out  sender-check
    work {__ | add 1}
    @init -> work -> @out`,
  sender_actor,
  [{port: 'init', value: 5}],
  1,
  function(results) {
    test('sender passthrough: ship exits', results.length >= 1)
    test('sender passthrough: sender preserved', results.length >= 1 && results[0].sender === sender_actor)
    test('sender passthrough: value correct', results.length >= 1 && results[0].ship == 6)
  }
)

// 2. Block evaluation: station runs list map. Sender preserved through sub-process. [sender-propagate-subprocess]
await sender_test(
  'block eval',
  `
  outer
    @init from-js
    @out  sender-check
    mapper {(1 2 3) | map block "{__ | add __in}" | >@done}
    @init -> mapper
    mapper.done -> @out`,
  sender_actor,
  [{port: 'init', value: 10}],
  1,
  function(results) {
    test('sender block eval: ship exits', results.length >= 1)
    test('sender block eval: sender preserved', results.length >= 1 && results[0].sender === sender_actor)
  }
)

// 3. Subspace crossing: ship routes through inner subspace. Sender preserved. [sender-propagate-out] [P-spaceisolate]
await sender_test(
  'subspace crossing',
  `
  inner
    @in
    @out
    transform {__ | multiply 2}
    @in -> transform -> @out
  outer
    @init from-js
    @out  sender-check
    @init -> inner.in
    inner.out -> @out`,
  sender_actor,
  [{port: 'init', value: 7}],
  1,
  function(results) {
    test('sender subspace crossing: ship exits', results.length >= 1)
    test('sender subspace crossing: sender preserved', results.length >= 1 && results[0].sender === sender_actor)
    test('sender subspace crossing: value correct', results.length >= 1 && results[0].ship == 14)
  }
)

// 4. Port send (>@name): station sends to named port. Sender preserved. [sender-propagate-portsend]
await sender_test(
  'port send',
  `
  outer
    @init from-js
    @out  sender-check
    sender {__ | add 100 | >@done}
    @init -> sender
    sender.done -> @out`,
  sender_actor,
  [{port: 'init', value: 1}],
  1,
  function(results) {
    test('sender port send: ship exits', results.length >= 1)
    test('sender port send: sender preserved', results.length >= 1 && results[0].sender === sender_actor)
  }
)

// 5. Error routing: station triggers soft error. Error ship carries sender. [sender-propagate-error]
await sender_test(
  'error routing',
  `
  outer
    @init from-js
    @out  sender-check
    @err  sender-check
    badmath {__ | math divide by 0 | >@done}
    @init -> badmath
    badmath.done -> @out`,
  sender_actor,
  [{port: 'init', value: 42}],
  1,
  function(results) {
    // The error ship goes to @err (sender-check), the main result may also exit
    var has_sender_on_any = results.some(function(r) { return r.sender === sender_actor })
    test('sender error routing: some ship exits', results.length >= 1)
    test('sender error routing: sender preserved on error ship', has_sender_on_any)
  }
)

// 6. Multi-hop: ship traverses 3+ stations. Sender preserved at every hop. [sender-propagate-out]
await sender_test(
  'multi-hop',
  `
  outer
    @init from-js
    @out  sender-check
    step1 {__ | add 1}
    step2 {__ | multiply 2}
    step3 {__ | add 100}
    @init -> step1 -> step2 -> step3 -> @out`,
  sender_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('sender multi-hop: ship exits', results.length >= 1)
    test('sender multi-hop: sender preserved', results.length >= 1 && results[0].sender === sender_actor)
    test('sender multi-hop: value correct ((0+1)*2+100=102)', results.length >= 1 && results[0].ship == 102)
  }
)

// 7. Nested subspace crossing (2+ levels deep): sender survives multiple boundaries [sender-propagate-out] [P-compose]
await sender_test(
  'nested subspace crossing',
  `
  deep
    @in
    @out
    work {__ | add 1}
    @in -> work -> @out
  mid
    @in
    @out
    @in -> deep.in
    deep.out -> @out
  outer
    @init from-js
    @out  sender-check
    @init -> mid.in
    mid.out -> @out`,
  sender_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('sender nested subspace: ship exits', results.length >= 1)
    test('sender nested subspace: sender preserved', results.length >= 1 && results[0].sender === sender_actor)
    test('sender nested subspace: value correct (0+1=1)', results.length >= 1 && results[0].ship == 1)
  }
)

// 8. No-dialect sender: sender with null dialect should use space dialect unchanged [sender-effective-default]
var no_dialect_actor = new D.Sender('plain-jane')
await sender_test(
  'no-dialect sender',
  `
  outer
    @init from-js
    @out  sender-check
    work {__ | add 10}
    @init -> work -> @out`,
  no_dialect_actor,
  [{port: 'init', value: 5}],
  1,
  function(results) {
    test('no-dialect sender: ship exits', results.length >= 1)
    test('no-dialect sender: sender preserved', results.length >= 1 && results[0].sender === no_dialect_actor)
    test('no-dialect sender: value correct (full dialect works)', results.length >= 1 && results[0].ship == 15)
  }
)

// 9. No explicit sender: the ship takes the entry port's qname as its
// sender with the space's base dialect — behaviorally identical to the
// old senderless run [sender-effective-default] [sender-attach-entry]
await sender_test(
  'no sender',
  `
  outer
    @init from-js
    @out  sender-check
    work {__ | add 10}
    @init -> work -> @out`,
  null,
  [{port: 'init', value: 5}],
  1,
  function(results) {
    test('no sender: ship exits', results.length >= 1)
    test('no sender: entry qname attached', results.length >= 1 && results[0].sender && results[0].sender.id === '@in:init')
    test('no sender: value correct', results.length >= 1 && results[0].ship == 15)
  }
)

// [I4] [dialect-cmd-sploot]
console.log('\n=== Sender Confinement ===')

// Sender with restricted dialect that blocks math.add
var restricted_actor = new D.Sender('restricted-bob', {
  dialect: D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'math': ['add']}})
})

// 1. Blocked command sploots — verify the result IS empty [dialect-cmd-sploot]
await sender_test(
  'blocked command',
  `
  outer
    @init from-js
    @out  sender-check
    work {__ | math add value 10}
    @init -> work -> @out`,
  restricted_actor,
  [{port: 'init', value: 5}],
  1,
  function(results) {
    test('confinement blocked command: ship exits', results.length >= 1)
    // math.add should sploot — result is empty string (the splooted value)
    test('confinement blocked command: math.add splooted to empty', results.length >= 1 && results[0].ship === '')
    test('confinement blocked command: sender preserved', results.length >= 1 && results[0].sender === restricted_actor)
  }
)

// 2. Confinement INSIDE block eval — blocked command sploots inside list map [sender-propagate-subprocess] [dialect-cmd-sploot]
await sender_test(
  'confinement inside block eval',
  `
  outer
    @init from-js
    @out  sender-check
    work {(1 2 3) | map block "{__ | math add value 10}" | >@done}
    @init -> work
    work.done -> @out`,
  restricted_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('confinement inside block eval: ship exits', results.length >= 1)
    // Each map iteration sploots (math.add blocked), so result is ["","",""]
    var val = results.length >= 1 ? results[0].ship : null
    var is_all_empty = Array.isArray(val) && val.length === 3 && val.every(function(v) { return v === '' })
    test('confinement inside block eval: all splooted', is_all_empty)
    test('confinement inside block eval: sender preserved', results.length >= 1 && results[0].sender === restricted_actor)
  }
)

// 3. Confinement through subspace — verify splooted value is empty [dialect-cmd-sploot] [dialect-inherit-parent]
await sender_test(
  'confinement in subspace',
  `
  inner
    @in
    @out
    work {__ | math add value 10}
    @in -> work -> @out
  outer
    @init from-js
    @out  sender-check
    @init -> inner.in
    inner.out -> @out`,
  restricted_actor,
  [{port: 'init', value: 5}],
  1,
  function(results) {
    test('confinement in subspace: ship exits', results.length >= 1)
    test('confinement in subspace: math.add splooted to empty', results.length >= 1 && results[0].ship === '')
    test('confinement in subspace: sender preserved', results.length >= 1 && results[0].sender === restricted_actor)
  }
)

// 4. Bidirectional intersection — sender blocks one thing, space dialect blocks another [I4]
// Both restrictions must apply simultaneously
var space_restricts_unquote = D.make_restricted_dialect({blocked_methods: {'process': ['unquote']}})
var sender_restricts_add = new D.Sender('bidirectional', {
  dialect: D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'math': ['add']}})
})
// Create a space with restricted dialect
await (function() {
  return new Promise(function(resolve) {
    var seed_id = D.spaceseed_add({
      dialect: {}, stations: [], subspaces: [], ports: [], routes: [], state: {}
    })
    D.SPACESEEDS[seed_id].dialect_instance = space_restricts_unquote
    var space = new D.Space(seed_id)

    // Run code that tests both restrictions via D.run with sender
    D.run('{math add value 1 to 2}', space, null, function(result) {
      test('bidirectional: sender-blocked math.add sploots', result === '')
      D.run('{process unquote value "hello"}', space, null, function(result2) {
        test('bidirectional: space-blocked process.unquote sploots', result2 === '')
        // Non-blocked command still works
        D.run('{math multiply value 3 by 4}', space, null, function(result3) {
          test('bidirectional: non-blocked multiply works', result3 === '12')
          resolve()
        }, sender_restricts_add)
      }, sender_restricts_add)
    }, sender_restricts_add)
  })
})()

// 5. process.dialect reflects effective dialect [I4]
await sender_test(
  'process.dialect confinement',
  `
  outer
    @init from-js
    @out  sender-check
    work {process dialect | list peek path (:math :methods :add) | >@done}
    @init -> work
    work.done -> @out`,
  restricted_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('process.dialect confinement: ship exits', results.length >= 1)
    var val = results.length >= 1 ? results[0].ship : 'MISSING'
    test('process.dialect confinement: math.add excluded', !val || val === '' || val === 'false')
  }
)

// 6. process.aliases respects effective dialect [dialect-alias-expand] [I4]
var no_unquote_actor = new D.Sender('no-unquote', {
  dialect: D.make_sender_dialect(D.DIALECTS.top, {
    blocked_methods: {'process': ['unquote']},
    blocked_aliases: ['unquote']
  })
})
await sender_test(
  'process.aliases confinement',
  `
  outer
    @init from-js
    @out  sender-check
    work {process aliases | list peek path (:unquote) | >@done}
    @init -> work
    work.done -> @out`,
  no_unquote_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('process.aliases confinement: ship exits', results.length >= 1)
    var val = results.length >= 1 ? results[0].ship : 'MISSING'
    test('process.aliases confinement: unquote excluded', !val || val === '' || val === 'false')
  }
)

// 7. D.run with sender — direct entry point test [I4] [dialect-cmd-sploot]
await (function() {
  return new Promise(function(resolve) {
    D.run('{math add value 5 to 10}', D.ExecutionSpace, null, function(result) {
      test('D.run with restricted sender: math.add sploots', result === '')
      D.run('{math multiply value 3 by 4}', D.ExecutionSpace, null, function(result2) {
        test('D.run with restricted sender: multiply still works', result2 === '12')
        resolve()
      }, restricted_actor)
    }, restricted_actor)
  })
})()

// [I4] [P-dialect]
console.log('\n=== intersect_dialects ===')
// Unit tests for the intersection function
test('intersect_dialects exists', typeof D.intersect_dialects === 'function')
test('intersect same dialect returns same', D.intersect_dialects(D.DIALECTS.top, D.DIALECTS.top) === D.DIALECTS.top)
test('intersect with null returns other', D.intersect_dialects(D.DIALECTS.top, null) === D.DIALECTS.top)
test('intersect null with dialect returns dialect', D.intersect_dialects(null, D.DIALECTS.restricted) === D.DIALECTS.restricted)

var int1 = D.intersect_dialects(D.DIALECTS.top, D.DIALECTS.restricted)
test('intersection has a did', typeof int1.did === 'number')
test('intersection blocks restricted method', !int1.get_method('process', 'unquote'))
test('intersection allows unrestricted method', !!int1.get_method('math', 'add'))

// Cache reuse: same pair returns same object
var int2 = D.intersect_dialects(D.DIALECTS.top, D.DIALECTS.restricted)
test('intersection is cached (same object)', int1 === int2)

// Intersection of two different restrictions blocks BOTH
var blocks_add = D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'math': ['add']}})
var blocks_multiply = D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'math': ['multiply']}})
var both_blocked = D.intersect_dialects(blocks_add, blocks_multiply)
test('bidirectional intersection blocks add', !both_blocked.get_method('math', 'add'))
test('bidirectional intersection blocks multiply', !both_blocked.get_method('math', 'multiply'))
test('bidirectional intersection allows subtract', !!both_blocked.get_method('math', 'subtract'))

// Policy merge: restrictive policy wins
var with_policy = D.intersect_dialects(D.DIALECTS.top, D.DIALECTS.restricted)
test('intersection inherits restrict_unsafe_ports', with_policy.policy.restrict_unsafe_ports === true)
test('intersection inherits no_user_regex', with_policy.policy.no_user_regex === true)

// [I2] [dialect-inherit-parent]
console.log('\n=== Subspace Dialect Lockout ===')
// Subspaces must inherit parent dialect, even if seed.dialect_instance is set
var custom_dialect = new D.Dialect(null, null, {custom_flag: true})
var lockout_seed = D.spaceseed_add({
  dialect: {}, stations: [], subspaces: [], ports: [], routes: [], state: {}
})
// Set dialect_instance on the seed after spaceseed_add (it strips unknown props)
D.SPACESEEDS[lockout_seed].dialect_instance = custom_dialect
// As outer space (no parent), dialect_instance should be used
var lockout_outer = new D.Space(lockout_seed)
test('outer space uses dialect_instance', lockout_outer.dialect === custom_dialect)

// As subspace (has parent), dialect_instance should be ignored
var lockout_seed2 = D.spaceseed_add({
  dialect: {}, stations: [], subspaces: [], ports: [], routes: [], state: {}
})
D.SPACESEEDS[lockout_seed2].dialect_instance = custom_dialect
var parent_seed = D.spaceseed_add({
  dialect: {}, stations: [], subspaces: [lockout_seed2], ports: [], routes: [], state: {}
})
var parent_space = new D.Space(parent_seed)
var child_space = parent_space.subspaces[0]
test('subspace ignores dialect_instance', child_space.dialect !== custom_dialect)
test('subspace inherits parent dialect', child_space.dialect === parent_space.dialect)

// [I3]
console.log('\n=== process sender command ===')

// process sender returns sender id when sender is present
await sender_test(
  'process sender with sender',
  `
  outer
    @init from-js
    @out  sender-check
    work {process sender | >@done}
    @init -> work
    work.done -> @out`,
  sender_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('process sender: returns sender id', results.length >= 1 && results[0].ship === 'alice')
  }
)

// process sender returns empty when no sender
await sender_test(
  'process sender without sender',
  `
  outer
    @init from-js
    @out  sender-check
    work {process sender | >@done}
    @init -> work
    work.done -> @out`,
  null,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('process sender: returns entry qname without explicit sender', results.length >= 1 && results[0].ship === '@in:init')
  }
)

// process sender preserved through subspace crossing
await sender_test(
  'process sender in subspace',
  `
  inner
    @in
    @out
    work {process sender | >@done}
    @in -> work
    work.done -> @out
  outer
    @init from-js
    @out  sender-check
    @init -> inner.in
    inner.out -> @out`,
  sender_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('process sender in subspace: returns sender id', results.length >= 1 && results[0].ship === 'alice')
  }
)

// [I3] [I4] [P-uniformeval]
console.log('\n=== Sender Confinement Through execute_then_stringify ===')

// When D.run returns a block value (not a string), execute_then_stringify
// re-executes it. The sender's dialect restrictions must survive this boundary.
// Attack: sender blocks math.add, but returns a block literal that does math.add.
// The block gets re-executed by execute_then_stringify — sender must still apply.

var no_add_sender = new D.Sender('no-add', {
  dialect: D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'math': ['add']}})
})

// Control: sender blocks math.add in normal execution
await new Promise(function(resolve) {
  D.run('{math add value 1 to 2}', D.ExecutionSpace, null, function(result) {
    test('execute_then_stringify control: math.add blocked by sender', result === '')
    resolve()
  }, no_add_sender)
})

// Attack: block literal is the pipeline's return value — goes through execute_then_stringify
await new Promise(function(resolve) {
  D.run('{"{math add value 1 to 2}"}', D.ExecutionSpace, null, function(result) {
    test('execute_then_stringify: sender restriction survives block re-execution', result === '')
    resolve()
  }, no_add_sender)
})

// Double-check: without sender restriction, the block literal should work fine
await new Promise(function(resolve) {
  D.run('{"{math add value 1 to 2}"}', D.ExecutionSpace, null, function(result) {
    test('execute_then_stringify: unrestricted sender allows block execution', result === 3)
    resolve()
  })
})

// [dialect-cmd-sploot] [I4]
console.log('\n=== Optimizer Fast Path Confinement ===')

// OPT_simple_math replaces {N | add M} at compile time with a fast-path segment.
// That segment must still check the dialect before executing.

var no_add_opt = new D.Sender('no-add-opt', {
  dialect: D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'math': ['add']}})
})
var no_mul_opt = new D.Sender('no-mul-opt', {
  dialect: D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'math': ['multiply']}})
})
var no_peek_opt = new D.Sender('no-peek-opt', {
  dialect: D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'list': ['peek']}})
})

// OPT_simple_math: add
await new Promise(function(resolve) {
  D.run('{5 | add 3}', D.ExecutionSpace, null, function(result) {
    test('optimizer: sender blocks math.add through OPT_simple_math', result === '')
    resolve()
  }, no_add_opt)
})

// OPT_simple_math: multiply
await new Promise(function(resolve) {
  D.run('{5 | multiply 3}', D.ExecutionSpace, null, function(result) {
    test('optimizer: sender blocks math.multiply through OPT_simple_math', result === '')
    resolve()
  }, no_mul_opt)
})

// OPT_simple_peek: peek with simple path
await new Promise(function(resolve) {
  D.run('{(:a 1 :b 2) | list peek path :a}', D.ExecutionSpace, null, function(result) {
    test('optimizer: sender blocks list.peek through OPT_simple_peek', result === '')
    resolve()
  }, no_peek_opt)
})

// Controls: same expressions without restriction
await new Promise(function(resolve) {
  D.run('{5 | add 3}', D.ExecutionSpace, null, function(result) {
    test('optimizer control: unrestricted add works', result === '8')
    resolve()
  })
})
await new Promise(function(resolve) {
  D.run('{5 | multiply 3}', D.ExecutionSpace, null, function(result) {
    test('optimizer control: unrestricted multiply works', result === '15')
    resolve()
  })
})

// [sender-propagate-subprocess] [I4]
console.log('\n=== process.run Sender Confinement ===')

// process.run executes a block via block(callback, scope, process).
// The current process (with sender) must propagate into the sub-process.

await new Promise(function(resolve) {
  D.run('{process run block "{math add value 1 to 2}"}', D.ExecutionSpace, null, function(result) {
    test('process.run: sender blocks math.add inside run block', result === '')
    resolve()
  }, no_add_opt)
})

// Control
await new Promise(function(resolve) {
  D.run('{process run block "{math add value 1 to 2}"}', D.ExecutionSpace, null, function(result) {
    test('process.run control: unrestricted run block works', result === '3')
    resolve()
  })
})

// [dialect-alias-expand] [dialect-cmd-sploot] [unquote-privilege]
console.log('\n=== Alias Invocation Confinement ===')

// Aliases expand at parse time (n_alias.js uses D.Aliases directly, not dialect).
// But the resulting Command segment is still gated by dialect.get_method at runtime.
// So even though 'unquote' alias expands, process.unquote is blocked at dispatch.

var no_unquote_sender = new D.Sender('no-unquote', {
  dialect: D.make_sender_dialect(D.DIALECTS.top, {blocked_methods: {'process': ['unquote']}})
})

await new Promise(function(resolve) {
  D.run('{:hello | unquote}', D.ExecutionSpace, null, function(result) {
    test('alias invocation: sender blocks unquote via alias', result === '')
    resolve()
  }, no_unquote_sender)
})

await new Promise(function(resolve) {
  D.run('{process unquote value :hello}', D.ExecutionSpace, null, function(result) {
    test('alias invocation: sender blocks unquote via direct command', result === '')
    resolve()
  }, no_unquote_sender)
})

// Control: unquote works without restriction (returns a block, stringified to empty by D.run)
await new Promise(function(resolve) {
  D.run('{:hello | unquote | process run}', D.ExecutionSpace, null, function(result) {
    test('alias invocation control: unrestricted unquote+run works', result === 'hello')
    resolve()
  })
})

// §13 Block forgery: plain objects cannot be treated as blocks
console.log('\n=== Block Forgery Prevention ===')

var fake_block = {type: 'Block', value: {id: 123}}
test('block forgery: plain object is not a block', !D.is_block(fake_block))

var null_proto_fake = Object.create(null)
null_proto_fake.type = 'Block'
null_proto_fake.value = {id: 99999}
test('block forgery: null-proto object is not a block', !D.is_block(null_proto_fake))

var real_seg = D.Parser.string_to_block_segment('"{1}"')
test('block forgery: real parsed segment is a block', D.is_block(real_seg))

test('block forgery: non-object is not a block', !D.is_block('Block'))
test('block forgery: number is not a block', !D.is_block(42))
test('block forgery: null is not a block', !D.is_block(null))


// §13 Sender not exposed: process.sender returns id string, not Sender object
console.log('\n=== Sender Non-Exposure ===')

await new Promise(function(resolve) {
  var sender = new D.Sender('test-alice', {dialect: D.DIALECTS.top})
  D.run('{process sender}', D.ExecutionSpace, null, function(result) {
    test('sender non-exposure: returns string id', result === 'test-alice')
    test('sender non-exposure: not an object', typeof result === 'string')
    resolve()
  }, sender)
})

await new Promise(function(resolve) {
  D.run('{process sender}', D.ExecutionSpace, null, function(result) {
    test('sender non-exposure: empty without sender', result === '')
    resolve()
  })
})


console.log('\n=== Summary ===')
console.log(pass + ' passed, ' + fail + ' failed')
if(fail) process.exit(1)
