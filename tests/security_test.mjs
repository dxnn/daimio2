// Security test suite for Daimio restricted dialect
// Run with: node tests/security_test.mjs

globalThis.window = {addEventListener: function(){}, location: {origin: 'test'}, postMessage: function(){}}
globalThis.document = {getElementById: function(){return null}, querySelectorAll: function(){return []}, getElementsByClassName: function(){return []}, createElementNS: function(){return {}}}

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
test('dom-set-html is unsafe', D.PortFlavours['dom-set-html'].unsafe === true)
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

console.log('\n=== Summary ===')
console.log(pass + ' passed, ' + fail + ' failed')
if(fail) process.exit(1)
