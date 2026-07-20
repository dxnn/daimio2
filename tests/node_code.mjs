/*

  This is a set of js tests for ensuring various things about the daimio interpreter.
  
  Todo:
  -- write string->ABlock tests
  -- fix head+block ABlocks
  -- fix head segments
  -- fix everything else

  -> build Dialects
  -> link Dialects and Spaces and PBlocks and stuff

  - write string->PBlock tests
  - fix Psegments / pipelines
  - fix function references
  - fix naming conventions
  - fix space / dialect / state 
  
  - write string->output tests
  - ensure one active process per space
  - fix async behavior
  - fix channels / scoping
  
  - write string -> AB+RL -> PB -> string tests
  
  - do button demo
  
*/


// string->AB tests


// LE PRELUDE

var D = (await import('../daimio/daimio.js')).default

var ERRORS = []
var pass = 0
var pending = 0
var all_registered = false
var reported = false

var string_to_tokens_and_segments_and_block_test
var s2ABt = string_to_tokens_and_segments_and_block_test = function(string, result_tokens, result_segments, result_blocks) {
  var tokens = D.Parser.string_to_tokens(string)
    , segments = D.Parser.string_to_segments(string)
    , block_ref = D.Parser.string_to_block_segment(string)
    , ABlocks = D.BLOCKS
  
  // D.recursive_walk(ABlocks, function(item) {return item.id}, function(item) {delete item.id})
  
  // if(JSON.stringify(ABlocks) == JSON.stringify(result))
  //   return false
    
  ERRORS.push({in: string, 
               out: {tokens: tokens, segments: segments, block_ref: block_ref, blocks: ABlocks}, 
               was: {tokens: result_tokens, segments: result_segments, blocks: result_blocks, fff: "x" + D.run('{(1 2 3) | math add to 4}')} })
  
  D.BLOCKS = {}
}

var head2pipe = function(blockhead, result) {
  // var output = D.blockhead_to_pipeline(blockhead, D.DIALECTS.top)
  
  if(JSON.stringify(output) == JSON.stringify(result))
    return false
    
  ERRORS.push({in: blockhead, out: output, was: result})
}

var funtest = function(string, result) {
  // var space = D.OuterSpace
  //   , segment = D.Parser.string_to_block_segment(string)
  //   , ABlocks = D.BLOCKS
  //   , block = ABlocks[segment.value.id]
  //
  // space.execute(block, function(output) {
  pending++
  D.run(string, function(output) {
    if(JSON.stringify(output) == JSON.stringify(result))
      pass++
    else
      ERRORS.push({in: string, out: output, was: result})

    pending--
    if(all_registered && pending === 0) report()
  })
}


// TESTS GO HERE!!!!

// (The old s2ABt/head2pipe parser-shape tests lived here — a dead format
// asserting internal AST against magic block-number hashes. Their intents
// survive behaviorally: list-literal wiring below [parse-list-lit], named
// blocks + self-reference in d2_spec_test [parse-begin-end-match] [P-total],
// param filling throughout the fun tests.)

// fun tests!

funtest('{math add value 7 to 13}', "20")

funtest('{math add value (7 13)}', "20")

funtest('{7 | math add to 13}', "20")

funtest('{add 7 to 13}', "20")

funtest('{2 | add 5}', "7")

funtest('{(1 2 3) | math add to 4}', "[5,6,7]")

funtest('{(1 2 3) | add 4}', "[5,6,7]")

funtest('{(1 2 3) | add (3 2 1)}', "[4,4,4]")

funtest('{(1 2 3) | add (3 2 1) | add 7}', "[11,11,11]")

funtest('{(1 2 3) | add (4 4 4) | add 7 | math subtract value (1 2 3)}', "[11,11,11]")

funtest('{add 2 to (3 4 5)}', "[5,6,7]")

funtest('{math add value "7" to "13"}', "20")

funtest('{add 2 to {77 | add 3}}', "82")

funtest('{({77 | add 3} {17 | add 3}) | add}', "100")

funtest('{((1 2) (4 5)) | union}', "[1,2,4,5]")

funtest('{union ((1 2) (4 5))}', "[1,2,4,5]")

funtest('{((1 2) (4 5)) | union (6 7)}', "[[1,2],[4,5],6,7]")

funtest('{(({1} {2 | add 3}) (8 9 (6))) | union}', "[1,5,8,9,[6]]")

funtest('{list map data (1 2 3) block "7"}', "[\"7\",\"7\",\"7\"]")

funtest('{list map data (1 2 3) block "7" | map block "13"}', "[\"13\",\"13\",\"13\"]")

funtest('{logic switch on 2 value (1 :one 2 :two 3 :three)}', "two")

funtest('{list map data (1 2 3) block "{7}"}', "[7,7,7]")

funtest('{(:One {"1 2 3" | string split on " "} :Two)}', "[\"One\",[\"1\",\"2\",\"3\"],\"Two\"]")


// [literal-produces-value]
funtest('asdf', 'asdf')

// [parse-name-lit]
funtest('{:asdf}', 'asdf')

// [parse-brace-structural]
funtest('{"asdf"}', 'asdf')

// [literal-produces-value] [parse-name-lit]
funtest('  asdf {:asdf}  ', '  asdf asdf  ')

funtest('asdf {:asdf} asdf', 'asdf asdf asdf')

// [parse-block-quoted]
funtest('{"{:asdf}"}', 'asdf')

funtest('{"{:asdf}"} ', 'asdf ')

funtest('{"{:asdf}"} bax', 'asdf bax')

funtest('2 {2 | add 2} ', '2 4 ')

funtest('2 {2 | add 2} {2 | times 4}', '2 4 8')

// [parse-block-quoted] [parse-list-lit]
funtest('{(1 {"{2}"} 3)}', "[1,\"{2}\",3]")

// [parse-list-lit] deep nesting + a command inside a nested literal — the
// list-wiring intents of the retired s2ABt parser-shape tests, behaviorally
funtest('{(1 (2 (3 4) (5 6) 7) 8)}', '[1,[2,[3,4],[5,6],7],8]')

funtest('{(1 (2 {3 | math add value 4}) 5)}', '[1,[2,7],5]')

// [pipe-flow] [scope-inject-value] [pipe-dunder]
funtest('{(1 2 3) | map block "{__ | add 4}"}', '[5,6,7]')

// [pipe-dunder]
funtest('{(1 2 3 4 5) | map block "{__ | times __}"}', '[1,4,9,16,25]')

funtest('{(1 2 3 4 5) | map block "{times (__ __ __)}"}', '[1,8,27,64,125]')

funtest('{(1 2 3 4 5) | map block "{(__ __ __) | times}"}', '[1,8,27,64,125]')

// [effectful-unwired-sploot]
// sleep is effectful: bare-run has no wiring, so it sploots to empty.
// (The wired/async behavior lives in det_time_test.mjs [effcmd-process-sleep].)
funtest('{:hello | process sleep for 0}', '')

funtest('{(1 2 3 4 5) | map block "{__ | times __ | times __}"}', '[1,16,81,256,625]')

// [block-named-pipe] [block-forms-equivalent]
funtest('{begin block | map data (1 2 3) | string join on ","} asdf {end block}', ' asdf , asdf , asdf ')

funtest('{(1 2 3) | map block "{add __ to 4}"}', '[5,6,7]')

funtest('{map data (1 2 3 4) block "{__ | add 4} is ok"}', '["5 is ok","6 is ok","7 is ok","8 is ok"]')

funtest('{map data (1 2 3 4) block "ok is {__ | add 4}"}', '["ok is 5","ok is 6","ok is 7","ok is 8"]')

funtest('{begin foo | map data (1 2 3 4)}{__ | add 4}{end foo}', '[5,6,7,8]')

funtest('{begin foo | map data (1 2 3 4) | string join on " "}{__ | add 4}{__ | add 4}{end foo}', '55 66 77 88')

funtest('{begin foo | map data (1 2 3 4) | string join on " "}{__ | add 4}x{__ | add 4}{end foo}', '5x5 6x6 7x7 8x8')

funtest('{begin foo | map data (1 2 3 4) | string join on "---"}answer: {__ | add 4}{end foo}', 'answer: 5---answer: 6---answer: 7---answer: 8')

funtest('{begin foo | map data (1 2 3 4) | map block "{__ | string transform from :answer to :foo}" | string join on "---"}answer: {__ | add 4}{end foo}', 'foo: 5---foo: 6---foo: 7---foo: 8')

funtest('{begin foo | map data (1 2 3 4) | map block "{__ | string split on ": " | map block "{if {__ | is like :answer} then :foo else "{__ | add 3}" | run}" | string join on ": "}" | string join on "---"}answer: {__ | add 4}{end foo}', 'foo: 8---foo: 9---foo: 10---foo: 11')

// [parse-begin-end-match]
funtest('{begin foo | string split on " " | string join on "---"}Some {a} text{end foo}', 'Some---{a}---text')

// [peek-pos-hit] [pos-one-indexed]
funtest('{(1 2 3) | __.#2}', '2')


funtest('{"asdfasdf" | string transform from "x" to "{__ | string uppercase}"}', 'asdfasdf')

funtest('{"asdfasdf" | string transform from "/x(.)/" to "{__ | string uppercase}"}', 'asdfasdf')


funtest('{"xxffxfasdf" | string transform from "x" to "{__ | string uppercase}"}', 'XXffXfasdf')

funtest('{"fxxffxfasdf" | string transform from "x" to "{__ | string uppercase}"}', 'fXXffXfasdf')


funtest('{"xxffxfasdf" | string transform from "/x/g" to "{__ | string uppercase}"}', 'XXffXfasdf')

funtest('{"xxffxfasdf" | string transform from "/x/" to "{__ | string uppercase}"}', 'Xxffxfasdf')

funtest('{"ffxxffxfasdf" | string transform from "/x/g" to "{__ | string uppercase}"}', 'ffXXffXfasdf')

funtest('{"ffxxffxfasdf" | string transform from "/x/" to "{__ | string uppercase}"}', 'ffXxffxfasdf')


funtest('{"xxffxfasdf" | string transform from "/x(.)/g" to "qq$1gg"}', 'qqxggffqqfggasdf')

funtest('{"xxffxfasdf" | string transform from "/x(.)/" to "qq$1gg"}', 'qqxggffxfasdf')

funtest('{"pxxffxfasdf" | string transform from "/x(.)/g" to "qq$1gg"}', 'pqqxggffqqfggasdf')

funtest('{"pxxffxfasdf" | string transform from "/x(.)/" to "qq$1gg"}', 'pqqxggffxfasdf')


funtest('{"xxffxfasdf" | string transform from "/x(.)/g" to "{__ | string uppercase}"}', 'XXffXFasdf') 

funtest('{"xxffxfasdf" | string transform from "/x(.)/" to "{__ | string uppercase}"}', 'XXffxfasdf')

funtest('{"pxxffxfasdf" | string transform from "/x(.)/g" to "{__ | string uppercase}"}', 'pXXffXFasdf')

funtest('{"pxxffxfasdf" | string transform from "/x(.)/" to "{__ | string uppercase}"}', 'pXXffxfasdf')


// (The self-referential named block test moved to d2_spec_test [P-total];
// a sibling here used the removed merge `with` param — its scope-layering
// intent lives in daimio.dm's MERGE section as "imports win".)

// THINK: what should these do?
// funtest('2 {"{2}" | add 2} ', 'asdf bax')
// 
// funtest('2 {2 | add "{2}"} ', 'asdf bax')
// 
// funtest('2 {"{2}" | add "{2}"} ', 'asdf bax')
// 
// funtest('2 {{2} | add "{2}"} ', 'asdf bax')


// funtest('{math add value "{7}" to 13}', 20)
// THINK: what should this do? maybe make add accept only numbers, and use fold/zipwith/etc to add over lists?



// =====================================================
// §10 Content-addressed block dedup
// =====================================================

;(function() {
  // Test 1: identical DAML produces same block.id
  var seg1 = D.Parser.string_to_block_segment('{3 | add 4}')
  var seg2 = D.Parser.string_to_block_segment('{3 | add 4}')
  if (seg1.value.id === seg2.value.id) pass++
  else ERRORS.push({in: 'block identity: identical DAML same id', out: seg2.value.id, was: seg1.value.id})

  // Test 2: D.BLOCKS dedup — second parse reuses entry
  var unique_daml = '{math add value 98701 to 12349}'
  var before = Object.keys(D.BLOCKS).length
  D.Parser.string_to_block_segment(unique_daml)
  var mid = Object.keys(D.BLOCKS).length
  D.Parser.string_to_block_segment(unique_daml)
  var after = Object.keys(D.BLOCKS).length
  if (mid > before && after === mid) pass++
  else ERRORS.push({in: 'D.BLOCKS dedup: second parse reuses', out: 'before=' + before + ' mid=' + mid + ' after=' + after, was: 'mid > before && after === mid'})

  // Test 3: different DAML produces different block.id
  var segA = D.Parser.string_to_block_segment('{3 | add 4}')
  var segB = D.Parser.string_to_block_segment('{3 | add 5}')
  if (segA.value.id !== segB.value.id) pass++
  else ERRORS.push({in: 'block identity: different DAML different id', out: segB.value.id, was: 'not ' + segA.value.id})

  // Test 4: spaceseed identity — same seedlike produces same seed_id
  var seedlike = 'dedup_test\n  @init from-js\n  @out to-js\n  @init -> @out\n'
  var id1 = D.make_some_space(seedlike)
  var id2 = D.make_some_space(seedlike)
  if (id1 === id2 && D.SPACESEEDS[id1] === D.SPACESEEDS[id2]) {
    // Also verify two spaces can be instantiated from the same seed
    var sp1 = new D.Space(id1)
    var sp2 = new D.Space(id2)
    if (sp1 && sp2 && sp1 !== sp2) pass++
    else ERRORS.push({in: 'spaceseed identity: two spaces from same seed', out: 'sp1===sp2 or null', was: 'distinct instances'})
  } else {
    ERRORS.push({in: 'spaceseed identity: same seedlike same id', out: 'id1=' + id1 + ' id2=' + id2, was: 'id1 === id2'})
  }

  // Test 5: PORT declaration order is canonicalized away — same id
  // [seed-canonical-order]. (Two sources differing only in the order their
  // ports are declared compile to the identical seed.)
  var pA = D.make_some_space('canon_ports\n  @a from-js\n  @b to-js\n  @a -> @b\n')
  var pB = D.make_some_space('canon_ports\n  @b to-js\n  @a from-js\n  @a -> @b\n')
  if (pA === pB) pass++
  else ERRORS.push({in: 'canonical order: port declaration order does not affect id [seed-canonical-order]', out: 'pA=' + pA + ' pB=' + pB, was: 'pA === pB'})

  // Test 6: ROUTE (wire) declaration order IS part of identity — different id.
  // Wire order is observable in delivery [sched-tie-wire], so it is NOT
  // canonicalized away; two sources listing the same wires in a different
  // order are different spaces.
  var rA = D.make_some_space('canon_routes\n  @i from-js\n  @x to-js\n  @y to-js\n  @i -> @x\n  @i -> @y\n')
  var rB = D.make_some_space('canon_routes\n  @i from-js\n  @x to-js\n  @y to-js\n  @i -> @y\n  @i -> @x\n')
  if (rA !== rB) pass++
  else ERRORS.push({in: 'wire order is part of identity: route declaration order changes the id [sched-tie-wire]', out: 'rA=' + rA + ' rB=' + rB, was: 'rA !== rB'})
})()


// =====================================================
// Per-space PRNG seeding
// =====================================================

;(function() {
  var seed_id = D.spaceseed_add(
    {dialect: {}, stations: [], subspaces: [], ports: [], routes: [], state: {}})

  // Space with explicit seed has rng function
  var space = new D.Space(seed_id, false, 'test_seed')
  if (typeof space.rng === 'function') pass++
  else ERRORS.push({in: 'prng: space with seed has rng function', out: typeof space.rng, was: 'function'})

  // rng returns number in [0, 1)
  var val = space.rng()
  if (typeof val === 'number' && val >= 0 && val < 1) pass++
  else ERRORS.push({in: 'prng: rng returns number in [0, 1)', out: val, was: 'number in [0, 1)'})

  // Same seed = same sequence
  var space_a = new D.Space(seed_id, false, 'deterministic')
  var space_b = new D.Space(seed_id, false, 'deterministic')
  var a1 = space_a.rng(), b1 = space_b.rng()
  var a2 = space_a.rng(), b2 = space_b.rng()
  if (a1 === b1 && a2 === b2) pass++
  else ERRORS.push({in: 'prng: same seed same sequence', out: [a1, a2], was: [b1, b2]})

  // Different seed = different sequence
  var space_c = new D.Space(seed_id, false, 'seed_one')
  var space_d = new D.Space(seed_id, false, 'seed_two')
  if (space_c.rng() !== space_d.rng()) pass++
  else ERRORS.push({in: 'prng: different seeds different values', out: 'same', was: 'different'})

  // No seed still gets rng
  var space_e = new D.Space(seed_id)
  if (typeof space_e.rng === 'function') pass++
  else ERRORS.push({in: 'prng: no seed still has rng', out: typeof space_e.rng, was: 'function'})

  // prng_seed is stored
  if (space.prng_seed === 'test_seed') pass++
  else ERRORS.push({in: 'prng: prng_seed stored on space', out: space.prng_seed, was: 'test_seed'})

  // Subspace PRNG is derived, not shared: child_seed = hash(parent_seed, name)
  // [random-seeded] [random-per-space] — a space's stream depends only on its
  // own draws, and re-instantiating the same parent reproduces it exactly.
  var child_seed_id = D.spaceseed_add(
    {dialect: {}, stations: [], subspaces: [], ports: [], routes: [], state: {}})
  var parent_seed_id2 = D.spaceseed_add(
    {dialect: {}, stations: [], subspaces: [child_seed_id], ports: [], routes: [], state: {}})
  var parent_space = new D.Space(parent_seed_id2, false, 'parent_seed')
  if (parent_space.subspaces.length && parent_space.subspaces[0].rng !== parent_space.rng) pass++
  else ERRORS.push({in: 'prng: subspace rng derived, not shared [random-seeded]', out: 'same rng reference', was: 'own derived rng'})

  var parent_space2 = new D.Space(parent_seed_id2, false, 'parent_seed')
  parent_space2.rng()                                    // parent draw must not shift the child's stream
  var c1 = parent_space.subspaces.length && parent_space.subspaces[0].rng()
  var c2 = parent_space2.subspaces.length && parent_space2.subspaces[0].rng()
  if (c1 === c2) pass++
  else ERRORS.push({in: 'prng: child stream independent of sibling/parent draws [random-per-space]', out: [c1, c2], was: 'identical first draws'})
})()


// =====================================================
// math random uses per-space PRNG [random-pure] [random-seeded] [random-internal]
// =====================================================

;(function() {
  var seed_id = D.spaceseed_add(
    {dialect: {}, stations: [], subspaces: [], ports: [], routes: [], state: {}})

  // [random-seeded] Same seed → same {math random} output
  pending += 2
  var result_a, result_b
  D.run('{math random max 100}', new D.Space(seed_id, false, 'rng_test'), null, function(out) {
    result_a = out
    pending--
    if(all_registered && pending === 0) report()
  })
  D.run('{math random max 100}', new D.Space(seed_id, false, 'rng_test'), null, function(out) {
    result_b = out
    // Both spaces seeded with 'rng_test' — first random value must match
    if(result_a === result_b) pass++
    else ERRORS.push({in: '[random-seeded] same seed same result', out: result_a, was: result_b})
    pending--
    if(all_registered && pending === 0) report()
  })

  // [random-internal] PRNG state not accessible as space variable
  pending++
  D.run('{$rng}', new D.Space(seed_id, false, 'rng_test'), null, function(out) {
    if(out === '') pass++
    else ERRORS.push({in: '[random-internal] prng not in space vars', out: out, was: ''})
    pending--
    if(all_registered && pending === 0) report()
  })
})()


// =====================================================
// [spacesyn-implicit-ports] Stations have exactly _in and _out, no _error
// =====================================================

;(function() {
  var seed_id = D.make_some_space('stest\n  foo {__}\n  @init from-js\n  @out to-js\n  @init -> foo -> @out\n')
  var space = new D.Space(seed_id)
  var station_ports = space.ports.filter(function(p) { return p.station })
  var names = station_ports.map(function(p) { return p.name }).sort()
  if(JSON.stringify(names) === JSON.stringify(['_in', '_out'])) pass++
  else ERRORS.push({in: '[spacesyn-implicit-ports] station ports are _in and _out only',
    out: JSON.stringify(names), was: '["_in","_out"]'})
})()


// =====================================================
// [error-unwired-dropped] on_error is silent when no @err port
// =====================================================

;(function() {
  var logged = []
  var orig_log = console.log
  console.log = function() { logged.push([].slice.call(arguments)) }
  D.on_error('test', 'silent error')
  console.log = orig_log
  var has_error_log = logged.some(function(args) { return /silent error/.test(args.join(' ')) })
  if(!has_error_log) pass++
  else ERRORS.push({in: '[error-unwired-dropped] on_error should not console.log without @err port',
    out: 'logged: ' + JSON.stringify(logged), was: 'no output'})
})()


// §1 P-effectpartition: a command has exactly one of fun / effect.
// import_models must reject a method declaring both, or neither.
;(function() {
  // [P-effectpartition] both fun and effect -> registration bork
  D.import_models({
    parttest: {
      desc: 'effect partition test handler',
      methods: {
        both: {
          desc: 'illegally has both',
          params: [],
          effect: { portType: 'cmd:parttest:both' },
          fun: function() { return 'ran' },
        },
        neither: {
          desc: 'illegally has neither',
          params: [],
        },
        pure: {
          desc: 'legally pure',
          params: [],
          fun: function() { return 'pure' },
        },
      }
    }
  })

  var methods = D.Commands.parttest && D.Commands.parttest.methods || {}
  if(!methods.both) pass++
  else ERRORS.push({in: '[P-effectpartition] method with both fun and effect',
    out: 'registered', was: 'rejected at registration'})
  if(!methods.neither) pass++
  else ERRORS.push({in: '[P-effectpartition] method with neither fun nor effect',
    out: 'registered', was: 'rejected at registration'})
  if(methods.pure) pass++
  else ERRORS.push({in: '[P-effectpartition] valid pure method',
    out: 'rejected', was: 'registered'})
})()


// §5/§11 recursion depth bound: a per-outer-space limit on block-eval NESTING,
// set at creation (opts.depth_bound), inherited by subspaces, enforced at the
// block apply demand — past it the innermost eval sploots to Empty (total).
;(function() {
  var seed = D.make_some_space('outer\n  +inner\n    @in -> @out')

  // [depth-bound-instance] creation-time knob; subspaces inherit it; unset
  // falls back to the module default.
  var bounded = new D.Space(seed, null, undefined, '', { depth_bound: 3 })
  if(bounded.depth_bound === 3) pass++
  else ERRORS.push({in: '[depth-bound-instance] outer space takes opts.depth_bound',
    out: bounded.depth_bound, was: 3})
  if(bounded.subspaces[0] && bounded.subspaces[0].depth_bound === 3) pass++
  else ERRORS.push({in: '[depth-bound-instance] subspace inherits the bound',
    out: bounded.subspaces[0] && bounded.subspaces[0].depth_bound, was: 3})
  if(D.make_execution_space().depth_bound === D.Etc.default_depth_bound) pass++
  else ERRORS.push({in: '[depth-bound-instance] unset uses the module default',
    out: D.make_execution_space().depth_bound, was: D.Etc.default_depth_bound})

  // [depth-nesting-only] a self-recursive block nests exactly depth_bound levels
  // ($n counts them), then the innermost eval sploots to Empty — no stack blow.
  var body = '{$n | math add value 1 | >$n || $self | run}'
  var driver = '{>$n value 0 || "' + body + '" | unquote | >$self || $self | run}'
  function recurse(bound) {
    var sp = new D.Space(seed, null, undefined, '', { depth_bound: bound })
      , res = '<none>', n = '<none>'
    D.run(driver, sp, {}, function(r) { res = r })
    D.run('{$n}', sp, {}, function(r) { n = r })
    return { res: res, n: String(n) }
  }
  var r3 = recurse(3), r7 = recurse(7)
  if(r3.res === '' && r3.n === '3') pass++
  else ERRORS.push({in: '[depth-nesting-only] recursion sploots to Empty at the bound',
    out: JSON.stringify(r3), was: 'res="" n=3'})
  if(r7.n === '7') pass++
  else ERRORS.push({in: '[depth-nesting-only] the bound sets the reachable nesting depth',
    out: JSON.stringify(r7), was: 'n=7'})

  // [depth-nesting-only] SEQUENTIAL (non-nested) evals never accumulate: eight
  // map iterations under a bound of 2 all succeed (each is depth 1).
  var sp2 = new D.Space(seed, null, undefined, '', { depth_bound: 2 })
    , mapres = '<none>'
  D.run('{(1 2 3 4 5 6 7 8) | list map block "{__ | math add value 1}"}', sp2, {}, function(r) { mapres = r })
  if(mapres === '[2,3,4,5,6,7,8,9]') pass++
  else ERRORS.push({in: '[depth-nesting-only] sequential evals do not hit the nesting bound',
    out: JSON.stringify(mapres), was: '[2,3,4,5,6,7,8,9]'})
})()


// WRAP IT ALL UP WITH A BOW

var show_errors = function(error) {
  for(var key in error) {
    console.log(key + ': ' + JSON.stringify(error[key], null, 2))
  }
  console.log("")
}

// // Old synchronous check — replaced by async report() below
// if(ERRORS.length) {
//   console.log("ERRORS!\n")
//   ERRORS.forEach(show_errors)
// }
// else {
//   console.log('you win!')
// }

all_registered = true
if(pending === 0) report()

function report() {
  if(reported) return
  reported = true
  var total = pass + ERRORS.length
  console.log('\n=== node_code Tests ===')
  console.log(total + ' tests: ' + pass + ' passed, ' + ERRORS.length + ' failed')

  if(ERRORS.length) {
    console.log('\nFailures:')
    ERRORS.forEach(show_errors)
  }

  if(!ERRORS.length) console.log('\nYou win!')

  if(ERRORS.length) process.exit(1)
}
