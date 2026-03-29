import D from '../daimio/daimio.js'
import '../site/js/editor.js'

var pass = 0, fail = 0

function assert(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++
  } else {
    fail++
    console.log('FAIL: ' + label)
    console.log('  expected:', JSON.stringify(expected))
    console.log('  actual:  ', JSON.stringify(actual))
  }
}

// === Token types ===

// D.editor_tokens(text) returns [{type, start, end, index?}, ...]
// index is the param's definitional index (only for param tokens)

;(function token_types() {
  var t

  // Basic command: handler, method, params, values
  t = D.editor_tokens('{math add value 3 to 7}')
  assert('basic command - brace open',    t[0], {type: 'brace', start: 0, end: 1})
  assert('basic command - handler',       t[1], {type: 'handler', start: 1, end: 5})
  assert('basic command - method',        t[2], {type: 'method', start: 6, end: 9})
  assert('basic command - param 0',       t[3], {type: 'param', start: 10, end: 15, index: 0})
  assert('basic command - number',        t[4], {type: 'number', start: 16, end: 17})
  assert('basic command - param 1',       t[5], {type: 'param', start: 18, end: 20, index: 1})
  assert('basic command - number 2',      t[6], {type: 'number', start: 21, end: 22})
  assert('basic command - brace close',   t[7], {type: 'brace', start: 22, end: 23})

  // Alias
  t = D.editor_tokens('{add 4 to 7}')
  assert('alias - alias token',          t[1], {type: 'alias', start: 1, end: 4})
  assert('alias - number',               t[2], {type: 'number', start: 5, end: 6})
  assert('alias - param',                t[3], {type: 'param', start: 7, end: 9, index: 1})
  assert('alias - number 2',             t[4], {type: 'number', start: 10, end: 11})

  // Pipes
  t = D.editor_tokens('{3 | add 2}')
  assert('pipe - number',                t[1], {type: 'number', start: 1, end: 2})
  assert('pipe - pipe',                  t[2], {type: 'pipe', start: 3, end: 4})
  assert('pipe - alias',                 t[3], {type: 'alias', start: 5, end: 8})

  // Barrier pipe
  t = D.editor_tokens('{>$x || >@out ||}')
  assert('barrier - svar_write',         t[1], {type: 'svar_write', start: 1, end: 4})
  assert('barrier - barrier pipe',       t[2], {type: 'barrier', start: 5, end: 7})
  assert('barrier - port_send',          t[3], {type: 'port_send', start: 8, end: 13})
  assert('barrier - barrier pipe 2',     t[4], {type: 'barrier', start: 14, end: 16})

  // Variables and implicit
  t = D.editor_tokens('{__ | add __in}')
  assert('vars - implicit __',           t[1], {type: 'implicit', start: 1, end: 3})
  assert('vars - implicit __in',         t[4], {type: 'implicit', start: 10, end: 14})

  t = D.editor_tokens('{$foo.bar | >name}')
  assert('vars - svar read',             t[1], {type: 'svar', start: 1, end: 9})
  assert('vars - pvar write',            t[3], {type: 'pvar_write', start: 12, end: 17})

  t = D.editor_tokens('{_x | add 1}')
  assert('vars - pvar read',             t[1], {type: 'pvar', start: 1, end: 3})

  // String
  t = D.editor_tokens('{:hello | string uppercase}')
  assert('string - name literal',        t[1], {type: 'name', start: 1, end: 7})
  assert('string - handler',             t[3], {type: 'handler', start: 10, end: 16})

  // Quoted string (block)
  t = D.editor_tokens('{"hi there"}')
  assert('quoted string',                t[1], {type: 'string', start: 1, end: 11})

  // Param order: definitional index regardless of typed order
  t = D.editor_tokens('{math add to 5 value 3}')
  assert('param order - to first typed', t[3], {type: 'param', start: 10, end: 12, index: 1})
  assert('param order - value second typed', t[5], {type: 'param', start: 15, end: 20, index: 0})

  // Outside braces: plain text
  t = D.editor_tokens('hello world')
  assert('outside braces - text',        t[0], {type: 'text', start: 0, end: 11})

  // Mixed text and commands
  t = D.editor_tokens('hi {add 1 to 2} bye')
  assert('mixed - text before',          t[0], {type: 'text', start: 0, end: 3})
  assert('mixed - brace open',           t[1], {type: 'brace', start: 3, end: 4})
  assert('mixed - alias',                t[2], {type: 'alias', start: 4, end: 7})
  assert('mixed - text after',           t[7], {type: 'text', start: 15, end: 19})
})()

// === Context at cursor ===

// D.editor_context(text, cursor) returns:
//   { phase, handler, method, partial, completions, desc, help,
//     paramName, pnames }

;(function context_handler_phase() {
  var c

  // Partial handler
  c = D.editor_context('{ma', 3)
  assert('handler partial - phase',       c.phase, 'handler')
  assert('handler partial - partial',     c.partial, 'ma')
  assert('handler partial - has map',     c.completions.indexOf('map') >= 0, true)
  assert('handler partial - has math',    c.completions.indexOf('math') >= 0, true)
  assert('handler partial - has max',     c.completions.indexOf('max') >= 0, true)
  assert('handler partial - no list',     c.completions.indexOf('list') >= 0, false)

  // Empty segment (just opened brace) — no completions
  c = D.editor_context('{', 1)
  assert('empty segment - phase',        c.phase, 'handler')
  assert('empty segment - no partial',   c.partial, '')
})()

;(function context_method_phase() {
  var c

  // After handler + space: method completion
  c = D.editor_context('{math ', 6)
  assert('method list - phase',           c.phase, 'method')
  assert('method list - has add',         c.completions.indexOf('add') >= 0, true)
  assert('method list - has multiply',    c.completions.indexOf('multiply') >= 0, true)
  assert('method list - desc',            c.desc, 'Commands for math')

  // Partial method
  c = D.editor_context('{math a', 7)
  assert('method partial - phase',       c.phase, 'method')
  assert('method partial - partial',     c.partial, 'a')
  assert('method partial - has add',     c.completions.indexOf('add') >= 0, true)
  assert('method partial - no multiply', c.completions.indexOf('multiply') >= 0, false)
})()

;(function context_param_phase() {
  var c

  // After method + space: param name completion
  c = D.editor_context('{math add ', 10)
  assert('param list - phase',           c.phase, 'param_name')
  assert('param list - has value',       c.completions.indexOf('value') >= 0, true)
  assert('param list - has to',          c.completions.indexOf('to') >= 0, true)
  assert('param list - method desc',     c.desc, 'What kind of snake is good at math?')
  assert('param list - method help',     Array.isArray(c.help), true)

  // Partial param name
  c = D.editor_context('{math add v', 11)
  assert('param partial - phase',        c.phase, 'param_name')
  assert('param partial - partial',      c.partial, 'v')
  assert('param partial - has value',    c.completions.indexOf('value') >= 0, true)
  assert('param partial - no to',        c.completions.indexOf('to') >= 0, false)

  // After param name + space: param value phase
  c = D.editor_context('{math add value ', 16)
  assert('param value - phase',          c.phase, 'param_value')
  assert('param value - desc',           c.desc, 'Augend: a numeric value or array of them')

  // After param value + space: next param name
  c = D.editor_context('{math add value 3 ', 18)
  assert('next param - phase',           c.phase, 'param_name')
  assert('next param - has to',          c.completions.indexOf('to') >= 0, true)
  assert('next param - no value',        c.completions.indexOf('value') >= 0, false)

  // Second param value
  c = D.editor_context('{math add value 3 to ', 21)
  assert('second param value - phase',   c.phase, 'param_value')
  assert('second param value - desc',    c.desc, 'Addend: a numeric value or array of the same')
})()

;(function context_alias() {
  var c

  // Alias resolves to handler+method, shows params
  c = D.editor_context('{add ', 5)
  assert('alias param - phase',          c.phase, 'param_name')
  assert('alias param - has to',         c.completions.indexOf('to') >= 0, true)
  // 'value' is pre-filled by alias, should be excluded
  assert('alias param - no value',       c.completions.indexOf('value') >= 0, false)
})()

;(function context_string_awareness() {
  var c

  // Pipe inside a string should not split the segment
  c = D.editor_context('{list map block "{__ | add 1}" path ', 36)
  assert('string pipe - phase',          c.phase, 'param_value')
  assert('string pipe - handler is list', c.handler, 'list')
  assert('string pipe - method is map',  c.method, 'map')

  // Braces inside a string should not affect nesting
  c = D.editor_context('{list map block "{add 1}" ', 26)
  assert('string brace - handler',       c.handler, 'list')
  assert('string brace - method',        c.method, 'map')
})()

;(function context_nested_commands() {
  var c

  // Nested command: context should be for the inner command
  // 'range' is an alias for 'list range length', so after resolving: param_name phase
  c = D.editor_context('{list map data {range ', 22)
  assert('nested - phase',               c.phase, 'param_name')
  assert('nested - partial',             c.partial, '')
  assert('nested - handler',             c.handler, 'list')
  assert('nested - method',              c.method, 'range')

  // After closing inner command, back to outer
  // {range 5} consumed as value for 'data' param, then 'block' is next param → param_value
  c = D.editor_context('{list map data {range 5} block ', 31)
  assert('nested closed - handler',      c.handler, 'list')
  assert('nested closed - method',       c.method, 'map')
  assert('nested closed - phase',        c.phase, 'param_value')
})()

;(function context_pipes() {
  var c

  // After pipe, new segment starts fresh
  c = D.editor_context('{3 | math ', 10)
  assert('after pipe - phase',           c.phase, 'method')
  assert('after pipe - handler',         c.handler, 'math')

  // After barrier pipe
  c = D.editor_context('{>$x || add ', 12)
  assert('after barrier - phase',        c.phase, 'param_name')
})()

// === Summary ===
console.log('\n' + (pass + fail) + ' tests: ' + pass + ' passed, ' + fail + ' failed')
if (fail === 0) console.log('\nAll passing!')
else { console.log('\n' + fail + ' FAILING'); process.exit(1) }
