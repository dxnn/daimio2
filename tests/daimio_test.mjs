// Node version of the daimio.html test suite
// Run with: node tests/daimio_test.mjs
//
// Reads tests/daimio.dm, executes Daimio code and checks assertions.
// Ported from the browser-based test runner in tests/daimio.html.

import { readFileSync } from 'fs'

var D = (await import('../daimio/daimio.js')).default

var data = readFileSync(new URL('daimio.dm', import.meta.url), 'utf8')

// these globals are kind of a hack...
var lines = data.split(/\n/).reverse()
var starttime = new Date().getTime()
var win = 0
var lose = 0
var known_lose = 0
var new_lose = 0
var mode = 'text'
var block_name = ''
var code_value = ''
var code_string = ''
var failures = []

// Pre-existing failures — keyed by code string.
// If a failure is in this set, it's known; if not, it's a regression.
var known_failures = new Set([
  // '{5 | >$ints.{$ints | count}}  {// (DATA BUG) //}',  // FIXED: >$x.path passthrough
  '{"{:foo}x" | >$xxx || 123 | >$xxx.y | $xxx}',
  '{* (:a 1 :b 2 :c 3) | list poke path ("#5") value 999}',
  '{() | list poke path ("*" "*") value 999}',
  '{(1 2 3) | list poke path ("*" "*" "*") value 999}',
  '{(1 2 3) | list poke path ("*" "*" "#2") value 999}',
  '{* (:a 1 :b 2 :c 3) | list poke path ( :b ("#2" "#6" "#4") ) value 999}',
  '{* (:a 1 :b 2 :c 3) | list poke path ( "#2" (:d :e) ) value 999}',
  '{((2 1) (3 4) (4 5)) | list poke path ( ("#1" "#3") ("#2" "#4") ) value 999}',
  // '{$dlist |  __.*.one | filter block "{_parent.parent.one.1 | eq :3}"}',  // DISABLED: _parent not yet implemented
  // '{(1 2 3 4 5 6) | list group by "{__ | mod 2}"}',  // FIXED: group by always returns object
  // '{( {* (:a 1)} {* (:a 4)} {* (:a 3)} {* (:a 1)} ) | list group by :a}',  // FIXED: group by always returns object
  // '{(1 2 3 4 5 6 7 8) | list group by "{__ | mod 4}"}',  // FIXED: group by always returns object
  // '{(1 2 3 4 5 6 7 8) | list group by "{__ | mod 4}" | list group by "{__.#1 | mod 2}"}',  // FIXED: group by always returns object
  // '{(1 2 3 4 5 6 7 8) | list group by "{__ | mod 4}" | sort by "{__.#1}" | list reverse | list group by "{__.#1 | mod 2}"}',  // FIXED: group by always returns object
  // '{5 | >foo | (1 2 3) | map block "{__ | add _foo}" with {* (:foo _foo)}}',  // FIXED: undefined vars return false (zero)
  // '{* (:x 3 :y 2 :z 4 :q 1) | list reverse}',  // FIXED: reverse preserves keys
  // '{$data | list sort by {* (:three :desc :one :asc)} | __.*.one}',  // DISABLED: multi-key sort not yet implemented
  // '{$data | list sort by {* (:three :desc :one :desc)} | __.*.one}',  // DISABLED: multi-key sort not yet implemented
  // '{$data | list sort by {* (:two.#2 :desc :one :desc)} | __.*.one}',  // DISABLED: multi-key sort not yet implemented
  // '{$data | list sort by {* (:two.#2 :desc :one :asc)} | __.*.one}',  // DISABLED: multi-key sort not yet implemented
  '{* (:c 3 :b 2 :a 4) | >l | list keys | sort | map block "{_l.{_value}}" with {* (:l _l)}}',
  // '{* (:c 3 :b 2 :a 1) | list sort}',  // FIXED: sort preserves keys on keyed lists
  // '{* (:a 1 :b 2) | >$x | >$x.c}',  // FIXED: >$x.path passthrough
  // '{$x | >$x.d}',  // FIXED: >$x.path passthrough
  // '{* (:xyz :z 10 :z 3 :z 1 :z :a :z)}',  // DISABLED: JS integer key ordering limitation
  // '{* (:xyz :9z 10 :8z 3 :6z 1 :4z :a :2z) | sort}',  // DISABLED: JS integer key ordering limitation
  // '{"2" | is in (2) | then :true else :false}',  // FIXED: added loose equality in is-in
  // '{:ash | >$hash.{"two"}} {$hash}',  // FIXED: >$x.path passthrough
  // '{:ash | >$hash.{"two"}.monkey.flu} {$hash}',  // FIXED: >$x.path passthrough
  '{:ash | >$hash.{"two"}.monkey.{(:x :y :z)}.flu} {$hash}',
  '{123 | >foo || __foo}',
  // '{5 | >foo | (1 2 3) | map block "{__ | subtract _o}"}',  // FIXED: undefined vars return false (zero)
  // '{5 | >foo | (1 2 3) | map block "{__ | range _o}"}',  // FIXED: undefined vars return false (zero)
  // '{(1 2 3) | subtract _zxcv}  {// subtraction and division are weird for this internally //}',  // FIXED: undefined vars return false (zero)
  // '{(1 2 3) | subtract $jklj}',  // FIXED: undefined vars + singleArray false→0
  // '{9 | range _asdf}',  // FIXED: undefined vars return false (zero)
  '{"{123}" | quote}',
  '{"{777}" | quote}',
  '{"{xxx}" | quote}',
])

function eat_line(value, prior_starter) {
  var whitespace='', wscount=0
    , line = lines.pop()

  /*
    There's four modes:
    - text, which just displays regular text based on whitespace and other factors
    - code, which is a single line of code
    - block, which is a big block of code
    - assert, the value the code should process to
  */

  // mode switcher
  if(mode != 'block') {
    if(/^\s*\{begin /.test(line)) {
      code_string = ''
      block_name = line.match(/^\s*\{begin (\w+)/)[1]
      mode = 'block' // begin a block
    }
    else if(mode == 'code') {
      mode = 'assert' // switch to assert
    }
    else if(/^\s*\{/.test(line)) {
      code_string = line
      mode = 'code' // begin a line of code
    }
    else if(mode == 'assert') {
      mode = 'text' // switch back to text
    }
  }

  // continue the block
  if(mode == 'block') {
    code_string += "\n" + line

    // end the block
    if(new RegExp("\{end " + block_name + '\}').test(line)) {
      mode = 'code'
    }
  }

  // handle code
  if(mode == 'code') {
    code_string = code_string.replace(/^\s+|\s+$/g, '')

    code_value = D.execute_then_stringify(
                   D.ExecutionSpace.execute(
                     D.Parser.string_to_block_segment(code_string), null, prior_starter))
    return code_value
  }

  // handle asserts
  if(mode == 'assert') {
    if(code_value === false) {
      code_value = ''
    }

    if(typeof(code_value) != 'string') {
      code_value = JSON.stringify(code_value) ? JSON.stringify(code_value) : ''
    }

    if(code_value.trim() === line.trim()) {
      win++
    } else {
      lose++
      var is_known = known_failures.has(code_string.trim())
      if(is_known) known_lose++
      else new_lose++
      failures.push({code: code_string, expected: line.trim(), actual: code_value.trim(), known: is_known})
    }
  }

  return true
}

function done() {
  var endtime = new Date().getTime()

  console.log('\n=== Daimio Test Suite ===')
  console.log('Completed ' + (win + lose) + ' tests in ' + ((endtime - starttime) / 1000) + ' seconds.')
  console.log(win + ' passed, ' + lose + ' failed (' + known_lose + ' known, ' + new_lose + ' new)')

  if(new_lose) {
    console.log('\nREGRESSIONS:')
    failures.filter(function(f) { return !f.known }).forEach(function(f) {
      console.log('  Code:     ' + f.code)
      console.log('  Expected: ' + f.expected)
      console.log('  Actual:   ' + f.actual)
      console.log('')
    })
  }

  if(known_lose) {
    console.log('\nKnown failures: ' + known_lose)
  }

  if(!lose) console.log('\nYou win!')

  if(new_lose) process.exit(1)
}

D.data_trampoline(lines, eat_line, D.string_concat, function() {}, done)
