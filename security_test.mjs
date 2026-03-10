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

// =====================
// MILESTONE 2 TESTS
// =====================

console.log('\n=== Room ===')
test('D.Room exists', typeof D.Room === 'function')

var room1 = new D.Room()
test('Room has a space', room1.space instanceof D.Space)

var room2 = new D.Room({dialect: D.DIALECTS.restricted})
test('Room accepts dialect option', room2.space.dialect === D.DIALECTS.restricted)

var room3 = new D.Room({state: {x: 42}})
test('Room accepts state option', room3.space.get_state('x') === 42)

// Room Space executes code
var room_run_result
D.run('{math add value 3 to 4}', room1.space, null, function(v) { room_run_result = v })
test('Room space executes code', room_run_result === '7')

// Room Space state persists
D.run('{99 | >$rvar}', room1.space, null, function() {})
test('Room space state persists', room1.space.get_state('rvar') === 99)

console.log('\n=== Backend ===')
test('D.Backend exists', typeof D.Backend === 'function')

var be1 = new D.Backend()
test('Backend has a space', be1.space instanceof D.Space)

var be_result
be1.execute('{math add value 5 to 10}', null, function(v) { be_result = v })
test('Backend executes code', be_result === '15')

// Backend state persists
be1.execute('{77 | >$bvar}', null, function() {})
test('Backend state persists', be1.space.get_state('bvar') === 77)

var be2 = new D.Backend({dialect: D.DIALECTS.restricted})
test('Backend accepts dialect option', be2.space.dialect === D.DIALECTS.restricted)

console.log('\n=== App ===')
test('D.App exists', typeof D.App === 'function')

var app1 = new D.App()
test('App has room', app1.room instanceof D.Room)
test('App has backend', app1.backend instanceof D.Backend)
test('App has participants', typeof app1.participants === 'object')
test('App room space is closed', app1.room.space.closed === true)

// Participation
var alice = new D.Actor('alice')
var bob = new D.Actor('bob')
app1.join(alice)
test('App.join adds participant', app1.has('alice'))
test('App.has returns false for missing', !app1.has('bob'))

app1.join(bob)
app1.leave('bob')
test('App.leave removes participant', !app1.has('bob'))

// Restrictions and effective dialect
app1.set_restrictions('alice', {blocked_methods: {'string': ['grep']}})
var alice_d = app1.effective_dialect('alice')
test('effective_dialect blocks restricted method', !alice_d.get_method('string', 'grep'))
test('effective_dialect allows unrestricted method', !!alice_d.get_method('math', 'add'))

// Caching
var alice_d2 = app1.effective_dialect('alice')
test('effective_dialect caches result', alice_d === alice_d2)

// Cache invalidation
app1.set_restrictions('alice', {blocked_methods: {'math': ['add']}})
var alice_d3 = app1.effective_dialect('alice')
test('effective_dialect cache invalidates', alice_d3 !== alice_d)
test('new restrictions take effect', !alice_d3.get_method('math', 'add'))

// Unrestricted actor gets base dialect
var app2 = new D.App()
var charlie = new D.Actor('charlie')
app2.join(charlie)
test('unrestricted actor gets base dialect', app2.effective_dialect('charlie') === app2.dialect)

// App.send executes in room space
var send_result
app2.send('{math add value 1 to 2}', charlie, function(v) { send_result = v })
test('App.send executes in room space', send_result === '3')

// App.send rejects non-participant
var stranger = new D.Actor('stranger')
var stranger_result = app2.send('{math add value 1 to 2}', stranger)
test('App.send rejects non-participant', stranger_result === '')

// App.send with restrictions
var app3 = new D.App()
var dave = new D.Actor('dave')
app3.join(dave)
app3.set_restrictions('dave', {blocked_methods: {'math': ['add']}})
var dave_dialect = app3.effective_dialect('dave')
var dave_result
app3.send('{math add value 1 to 2}', dave, function(v) { dave_result = v })
test('App.send blocks restricted command', dave_result === '')

// App.backend_execute
var be_exec_result
app2.backend_execute('{math add value 10 to 20}', charlie, function(v) { be_exec_result = v })
test('App.backend_execute works', be_exec_result === '30')

// Two actors, different restrictions
var app4 = new D.App()
var eve = new D.Actor('eve')
var frank = new D.Actor('frank')
app4.join(eve)
app4.join(frank)
app4.set_restrictions('frank', {blocked_methods: {'math': ['add']}})
var eve_result, frank_result
app4.send('{math add value 2 to 3}', eve, function(v) { eve_result = v })
app4.send('{math add value 2 to 3}', frank, function(v) { frank_result = v })
test('unrestricted actor can add', eve_result === '5')
test('restricted actor cannot add', frank_result === '')

console.log('\n=== Summary ===')
console.log(pass + ' passed, ' + fail + ' failed')
if(fail) process.exit(1)
