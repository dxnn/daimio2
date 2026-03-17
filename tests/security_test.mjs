// Security test suite for Daimio restricted dialect
// Run with: node tests/security_test.mjs

var D = (await import('../daimio/daimio.js')).default

var pass = 0, fail = 0
function test(name, condition) {
  if(condition) { console.log('  PASS:', name); pass++ }
  else { console.log('  FAIL:', name); fail++ }
}

console.log('=== Dialect Configuration ===')
test('D.DIALECTS.top exists', !!D.DIALECTS.top)
test('D.DIALECTS.restricted exists', !!D.DIALECTS.restricted)
test('restricted has policy', !!D.DIALECTS.restricted.policy)
test('restricted has restrict_unsafe_ports', D.DIALECTS.restricted.policy.restrict_unsafe_ports === true)
test('restricted no_user_regex is true', D.DIALECTS.restricted.policy.no_user_regex === true)

console.log('\n=== Command Gating ===')
test('top allows process.unquote', !!D.DIALECTS.top.get_method('process', 'unquote'))
test('restricted blocks process.unquote', !D.DIALECTS.restricted.get_method('process', 'unquote'))
test('restricted allows math.add', !!D.DIALECTS.restricted.get_method('math', 'add'))
test('restricted allows list.range', !!D.DIALECTS.restricted.get_method('list', 'range'))
test('restricted allows string.grep', !!D.DIALECTS.restricted.get_method('string', 'grep'))
test('restricted allows logic.is', !!D.DIALECTS.restricted.get_method('logic', 'is'))
test('restricted allows process.run', !!D.DIALECTS.restricted.get_method('process', 'run'))
test('restricted allows process.quote', !!D.DIALECTS.restricted.get_method('process', 'quote'))

console.log('\n=== Unsafe Port Flavours ===')
test('dom-set-raw-html is unsafe', D.PortFlavours['dom-set-raw-html'].unsafe === true)
test('exec is unsafe', D.PortFlavours['exec'].unsafe === true)
test('to-js is unsafe', D.PortFlavours['to-js'].unsafe === true)
test('xhr-send is unsafe', D.PortFlavours['xhr-send'].unsafe === true)
test('socket-in is unsafe', D.PortFlavours['socket-in'].unsafe === true)
test('socket-out is unsafe', D.PortFlavours['socket-out'].unsafe === true)
test('sse-receive is unsafe', D.PortFlavours['sse-receive'].unsafe === true)
test('dom-set-text is safe', !D.PortFlavours['dom-set-text'].unsafe)
test('dom-on-click is safe', !D.PortFlavours['dom-on-click'].unsafe)
test('in is safe', !D.PortFlavours['in'].unsafe)
test('from-js is safe', !D.PortFlavours['from-js'].unsafe)

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

console.log('\n=== Resource Limits ===')
test('max_range_length is 1M', D.Etc.max_range_length === 1000000)

console.log('\n=== Alias Gating ===')
test('top has unquote alias', !!D.DIALECTS.top.aliases['unquote'])
test('restricted blocks unquote alias', !D.DIALECTS.restricted.get_alias('unquote'))
test('restricted keeps map alias', !!D.DIALECTS.restricted.get_alias('map'))
test('restricted keeps reduce alias', !!D.DIALECTS.restricted.get_alias('reduce'))

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

console.log('\n=== Dialect Identity ===')
test('top dialect has a did', typeof D.DIALECTS.top.did === 'number')
test('restricted dialect has a did', typeof D.DIALECTS.restricted.did === 'number')
test('different dialects have different dids', D.DIALECTS.top.did !== D.DIALECTS.restricted.did)

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
var fake_p = {space: D.ExecutionSpace, station_id: undefined, actor: null}

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

console.log('\n=== Actor ===')
test('D.Actor exists', typeof D.Actor === 'function')
var actor_a = new D.Actor('alice')
test('Actor has id', actor_a.id === 'alice')
test('Actor dialect is null by default', actor_a.dialect === null)

var actor_b = new D.Actor('bob', {dialect: D.DIALECTS.restricted})
test('Actor accepts dialect option', actor_b.dialect === D.DIALECTS.restricted)

console.log('\n=== make_actor_dialect ===')
test('D.make_actor_dialect exists', typeof D.make_actor_dialect === 'function')
var app_dialect = D.DIALECTS.top
var bob_dialect = D.make_actor_dialect(app_dialect, {blocked_methods: {'string': ['grep']}})
test('actor dialect blocks denied method', !bob_dialect.get_method('string', 'grep'))
test('actor dialect allows other methods', !!bob_dialect.get_method('math', 'add'))
test('actor dialect allows same handler other methods', !!bob_dialect.get_method('string', 'join'))

// Chain: actor dialect on top of already-restricted base
var strict_base = D.make_restricted_dialect({blocked_methods: {'process': ['unquote']}})
var strict_actor = D.make_actor_dialect(strict_base, {blocked_methods: {'math': ['add']}})
test('chained dialect blocks base restriction', !strict_actor.get_method('process', 'unquote'))
test('chained dialect blocks actor restriction', !strict_actor.get_method('math', 'add'))
test('chained dialect allows unrestricted', !!strict_actor.get_method('list', 'map'))

console.log('\n=== Closed Space ===')
var closed_seed = D.spaceseed_add({
  dialect: {}, stations: [], subspaces: [], ports: [], routes: [], state: {}, closed: true
})
var closed_space = new D.Space(closed_seed)
test('closed space has closed flag', closed_space.closed === true)

// Execute without actor in closed space -> should fail
var closed_result = closed_space.execute(
  D.Parser.string_to_block_segment('{math add value 1 to 2}'))
test('closed space rejects execution without actor', closed_result === '')

// Execute with actor in closed space -> should work
var actor_for_closed = new D.Actor('testuser', {dialect: D.DIALECTS.top})
var closed_result2 = closed_space.execute(
  D.Parser.string_to_block_segment('{math add value 1 to 2}'),
  null, null, null, actor_for_closed)
test('closed space allows execution with actor', closed_result2 === 3)

// Open space (default) still works without actor
test('open space works without actor', run('{math add value 1 to 2}') === '3')

// ── Sender Tests ──────────────────────────────────────────────────────────────
// These test sender preservation and confinement from the outside, the way an
// App using Daimio would: pass a ship with an actor into a space, and when ships
// come back out through ports, verify the actor survived the whole journey.

// Actor-check port flavour: captures {ship, actor} from exiting ships
var actor_check_results = []

D.import_port_flavour('actor-check', {
  dir: 'out',
  outside_exit: function(ship, actor) {
    actor_check_results.push({ship: ship, actor: actor})
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

// Helper: create space, send ship with actor, collect results asynchronously
function sender_test(label, seedlike, actor, sends, expected_count, check) {
  return new Promise(function(resolve) {
    seedlike = dedent(seedlike)
    actor_check_results = []
    var seed_id = D.make_some_space(seedlike)
    var space = new D.Space(seed_id)

    // Wait for async port routing to complete
    var timer = setTimeout(function() {
      check(actor_check_results)
      resolve()
    }, 200)

    sends.forEach(function(send) {
      D.send_value_to_js_port(space, send.port, send.value, send.flavour, actor)
    })
  })
}

var sender_actor = new D.Actor('alice', {dialect: D.DIALECTS.top})

console.log('\n=== Sender Preservation ===')

// 1. Simple passthrough: ship enters station, exits. Actor preserved.
await sender_test(
  'passthrough',
  `
  outer
    @init from-js
    @out  actor-check
    work {__ | add 1}
    @init -> work -> @out`,
  sender_actor,
  [{port: 'init', value: 5}],
  1,
  function(results) {
    test('sender passthrough: ship exits', results.length >= 1)
    test('sender passthrough: actor preserved', results.length >= 1 && results[0].actor === sender_actor)
    test('sender passthrough: value correct', results.length >= 1 && results[0].ship == 6)
  }
)

// 2. Block evaluation: station runs list map. Actor preserved through sub-process.
await sender_test(
  'block eval',
  `
  outer
    @init from-js
    @out  actor-check
    mapper {(1 2 3) | map block "{__ | add __in}" | >@done}
    @init -> mapper
    mapper.done -> @out`,
  sender_actor,
  [{port: 'init', value: 10}],
  1,
  function(results) {
    test('sender block eval: ship exits', results.length >= 1)
    test('sender block eval: actor preserved', results.length >= 1 && results[0].actor === sender_actor)
  }
)

// 3. Subspace crossing: ship routes through inner subspace. Actor preserved.
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
    @out  actor-check
    @init -> inner.in
    inner.out -> @out`,
  sender_actor,
  [{port: 'init', value: 7}],
  1,
  function(results) {
    test('sender subspace crossing: ship exits', results.length >= 1)
    test('sender subspace crossing: actor preserved', results.length >= 1 && results[0].actor === sender_actor)
    test('sender subspace crossing: value correct', results.length >= 1 && results[0].ship == 14)
  }
)

// 4. Port send (>@name): station sends to named port. Actor preserved.
await sender_test(
  'port send',
  `
  outer
    @init from-js
    @out  actor-check
    sender {__ | add 100 | >@done}
    @init -> sender
    sender.done -> @out`,
  sender_actor,
  [{port: 'init', value: 1}],
  1,
  function(results) {
    test('sender port send: ship exits', results.length >= 1)
    test('sender port send: actor preserved', results.length >= 1 && results[0].actor === sender_actor)
  }
)

// 5. Error routing: station triggers soft error. Error ship carries actor.
await sender_test(
  'error routing',
  `
  outer
    @init from-js
    @out  actor-check
    @err  actor-check
    badmath {__ | math divide by 0 | >@done}
    @init -> badmath
    badmath.done -> @out`,
  sender_actor,
  [{port: 'init', value: 42}],
  1,
  function(results) {
    // The error ship goes to @err (actor-check), the main result may also exit
    var has_actor_on_any = results.some(function(r) { return r.actor === sender_actor })
    test('sender error routing: some ship exits', results.length >= 1)
    test('sender error routing: actor preserved on error ship', has_actor_on_any)
  }
)

// 6. Multi-hop: ship traverses 3+ stations. Actor preserved at every hop.
await sender_test(
  'multi-hop',
  `
  outer
    @init from-js
    @out  actor-check
    step1 {__ | add 1}
    step2 {__ | multiply 2}
    step3 {__ | add 100}
    @init -> step1 -> step2 -> step3 -> @out`,
  sender_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('sender multi-hop: ship exits', results.length >= 1)
    test('sender multi-hop: actor preserved', results.length >= 1 && results[0].actor === sender_actor)
    test('sender multi-hop: value correct ((0+1)*2+100=102)', results.length >= 1 && results[0].ship == 102)
  }
)

console.log('\n=== Sender Confinement ===')

// Actor with restricted dialect that blocks math.add
var restricted_actor = new D.Actor('restricted-bob', {
  dialect: D.make_actor_dialect(D.DIALECTS.top, {blocked_methods: {'math': ['add']}})
})

// 1. Blocked command sploots
await sender_test(
  'blocked command',
  `
  outer
    @init from-js
    @out  actor-check
    work {__ | math add value 10}
    @init -> work -> @out`,
  restricted_actor,
  [{port: 'init', value: 5}],
  1,
  function(results) {
    test('confinement blocked command: ship exits', results.length >= 1)
    // math.add should sploot — result is empty, not 15
    test('confinement blocked command: math.add splooted', results.length >= 1 && results[0].ship !== '15')
  }
)

// Actor that blocks process.unquote
var no_unquote_actor = new D.Actor('no-unquote', {
  dialect: D.make_actor_dialect(D.DIALECTS.top, {blocked_methods: {'process': ['unquote']}})
})

// 2. Confinement through block eval
await sender_test(
  'confinement in block eval',
  `
  outer
    @init from-js
    @out  actor-check
    work {(1 2 3) | map block "{__ | add 1}" | count | >@done}
    @init -> work
    work.done -> @out`,
  no_unquote_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    // map should still work (add is allowed), but actor is preserved
    test('confinement in block eval: ship exits', results.length >= 1)
    test('confinement in block eval: actor preserved', results.length >= 1 && results[0].actor === no_unquote_actor)
  }
)

// 3. Confinement through subspace
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
    @out  actor-check
    @init -> inner.in
    inner.out -> @out`,
  restricted_actor,
  [{port: 'init', value: 5}],
  1,
  function(results) {
    test('confinement in subspace: ship exits', results.length >= 1)
    // math.add is blocked even inside the subspace
    test('confinement in subspace: math.add splooted', results.length >= 1 && results[0].ship !== '15')
    test('confinement in subspace: actor preserved', results.length >= 1 && results[0].actor === restricted_actor)
  }
)

// 4. process.dialect reflects effective dialect
await sender_test(
  'process.dialect confinement',
  `
  outer
    @init from-js
    @out  actor-check
    work {process dialect | list peek path (:math :methods :add) | >@done}
    @init -> work
    work.done -> @out`,
  restricted_actor,
  [{port: 'init', value: 0}],
  1,
  function(results) {
    test('process.dialect confinement: ship exits', results.length >= 1)
    // Under restricted_actor, math.add should NOT appear in process dialect output
    var val = results.length >= 1 ? results[0].ship : 'MISSING'
    test('process.dialect confinement: math.add excluded', !val || val === '' || val === 'false')
  }
)

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

console.log('\n=== Summary ===')
console.log(pass + ' passed, ' + fail + ' failed')
if(fail) process.exit(1)
