import D from '../daimio/daimio.js'
import { readFileSync, appendFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const errors = []
D.on_error = function(command, error) {
  errors.push(error || command)

  // Route to space's error port if available (same as core on_error, minus console.log)
  var space = D.Etc.active_space
  if(space) {
    for(var i = 0, l = space.ports.length; i < l; i++) {
      var port = space.ports[i]
      if(port.flavour === 'err' && !port.station) {
        port.enter(error || command, D.Etc.active_process || null)
        break
      }
    }
  }

  return ""
}

const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

// Warm colors (command structure)
const C_HANDLER = '\x1b[38;5;208m'   // orange
const C_METHOD  = '\x1b[38;5;222m'   // light gold
const C_ALIAS   = '\x1b[38;5;209m'   // salmon
const C_PARAMS  = [
  '\x1b[38;5;174m',                  // dusty rose
  '\x1b[38;5;180m',                  // tan
  '\x1b[38;5;216m',                  // peach
  '\x1b[38;5;223m',                  // buff
  '\x1b[38;5;210m',                  // coral
]

// Cool colors (data / constants)
const C_BRACE  = '\x1b[38;5;75m'     // cornflower blue
const C_PIPE   = '\x1b[38;5;246m'    // gray
const C_STRING = '\x1b[38;5;108m'    // sage green
const C_NAME   = '\x1b[38;5;108m'    // sage green (name literals)
const C_NUMBER = '\x1b[38;5;111m'    // sky blue
const C_SVAR   = '\x1b[38;5;141m'    // medium purple
const C_PVAR   = '\x1b[38;5;74m'     // steel blue
const C_PORT   = '\x1b[38;5;168m'    // hot pink
const C_ERROR  = '\x1b[31m'          // red (errors only)

function flush_errors(stream) {
  while (errors.length) stream.write(C_ERROR + 'error: ' + errors.shift() + RESET + '\n')
}

// DAML syntax highlighting — ANSI escape passthrough must be first in alternation
const DAML_TOKEN = /\x1b\[[0-9;]*[A-Za-z]|"(?:[^"\\]|\\.)*"|[{}]|\|\||[|]|>@\w+|>\$\w+(?:\.\w+)*|\$\w+(?:\.\w+)*|>\w+|__in\b|__\b|_\w+|:\w+|\b\d+(?:\.\d+)?|[a-z]\w*/g

function highlight(s) {
  var depth = 0
  var seg_handler_name = null
  var seg_method = null
  var seg_is_alias = false
  var seg_word_n = 0

  function reset_seg() {
    seg_handler_name = null
    seg_method = null
    seg_is_alias = false
    seg_word_n = 0
  }

  return s.replace(DAML_TOKEN, function(m) {
    if (m[0] === '\x1b') return m

    if (m === '{') { depth++; reset_seg(); return C_BRACE + m + RESET }
    if (m === '}') { depth = Math.max(0, depth - 1); return C_BRACE + m + RESET }
    if (m === '||' || m === '|') {
      reset_seg()
      return (m === '||' ? BOLD : '') + C_PIPE + m + RESET
    }

    if (m[0] === '"') return C_STRING + m + RESET
    if (m.startsWith('>@')) return C_PORT + m + RESET
    if (m.startsWith('>$')) return BOLD + C_SVAR + m + RESET
    if (m[0] === '$') return C_SVAR + m + RESET
    if (m[0] === '>' && m.length > 1) return BOLD + C_PVAR + m + RESET
    if (m === '__in' || m === '__') return BOLD + C_PVAR + m + RESET
    if (m[0] === '_') return C_PVAR + m + RESET
    if (m[0] === ':') return C_NAME + m + RESET
    if (m[0] >= '0' && m[0] <= '9') return C_NUMBER + m + RESET

    // Bare word — color as handler/method/param when inside braces
    if (depth > 0 && m[0] >= 'a' && m[0] <= 'z') {
      var n = seg_word_n++

      if (n === 0) {
        if (D.Commands[m]) {
          seg_handler_name = m
          seg_is_alias = false
          return C_HANDLER + m + RESET
        }
        var alias = D.AliasMap[m]
        if (alias) {
          seg_is_alias = true
          var parts = alias.split(' ')
          var cmd = D.Commands[parts[0]]
          seg_method = cmd && cmd.methods && cmd.methods[parts[1]] || null
          return C_ALIAS + m + RESET
        }
        return m
      }

      if (n === 1 && !seg_is_alias && seg_handler_name) {
        var cmd = D.Commands[seg_handler_name]
        if (cmd && cmd.methods && cmd.methods[m]) {
          seg_method = cmd.methods[m]
          return C_METHOD + m + RESET
        }
        return m
      }

      // Check if it's a param name of the current method
      if (seg_method && seg_method.params) {
        for (var i = 0; i < seg_method.params.length; i++) {
          if (seg_method.params[i].key === m)
            return C_PARAMS[i % C_PARAMS.length] + m + RESET
        }
      }

      return m
    }

    return m
  })
}

const eIdx = process.argv.indexOf('-e')
const fIdx = process.argv.indexOf('-f')
if (eIdx !== -1 && process.argv[eIdx + 1]) {
  D.run(process.argv[eIdx + 1], value => {
    flush_errors(process.stderr)
    console.log(value)
  })
} else if (fIdx !== -1 && process.argv[fIdx + 1]) {
  const daml = readFileSync(process.argv[fIdx + 1], 'utf8')
  D.run(daml, value => {
    flush_errors(process.stderr)
    console.log(value)
  })
} else {
  const { createInterface } = await import('readline')

  // String-aware brace/pipe parsing helpers
  function find_unclosed_brace(text) {
    var d = 0, inStr = false
    for (var i = text.length - 1; i >= 0; i--) {
      if (text[i] === '"') inStr = !inStr
      if (inStr) continue
      if (text[i] === '}') d++
      else if (text[i] === '{') { if (d) d--; else return i }
    }
    return -1
  }

  function last_pipe_segment(str) {
    var inStr = false, last = -1
    for (var i = 0; i < str.length; i++) {
      if (str[i] === '"') inStr = !inStr
      else if (!inStr && str[i] === '|') last = i
    }
    return str.slice(last + 1)
  }

  function completer(line) {
    var start = find_unclosed_brace(line)
    if (start === -1) return [[], line]

    var seg = last_pipe_segment(line.slice(start + 1)).trimStart()
    var words = seg.split(/\s+/).filter(Boolean)

    var handlers = Object.keys(D.Commands)
    var aliases = Object.keys(D.Aliases)

    if (words.length === 0) {
      // Just opened { or just after |
      var all = handlers.concat(aliases).sort()
      return [all, '']
    }

    var handler = words[0]
    if (words.length === 1 && !seg.endsWith(' ')) {
      // Partial handler/alias name
      var all = handlers.concat(aliases).sort()
      var hits = all.filter(c => c.startsWith(handler))
      if (hits.length === 1) hits = [hits[0] + ' ']
      return [hits, handler]
    }

    var cmd = D.Commands[handler]
    if (!cmd) return [[], '']

    var methods = Object.keys(cmd.methods || {})
    var method_name = words[1]

    if (words.length === 1 || (words.length === 2 && !seg.endsWith(' '))) {
      // Complete method name
      var partial = method_name || ''
      var hits = methods.filter(m => m.startsWith(partial))
      if (hits.length === 1) hits = [hits[0] + ' ']
      return [hits, partial]
    }

    var method = (cmd.methods || {})[method_name]
    if (!method || !method.params) return [[], '']

    // Complete param names — exclude already-used ones
    var param_names = method.params.map(p => p.key)
    var used = new Set()
    for (var i = 2; i < words.length - (seg.endsWith(' ') ? 0 : 1); i += 2)
      used.add(words[i])
    var partial = seg.endsWith(' ') ? '' : words[words.length - 1]
    var hits = param_names.filter(p => p.startsWith(partial) && !used.has(p))
    if (hits.length === 1) hits = [hits[0] + ' ']
    return [hits, partial]
  }

  const history_path = join(homedir(), '.daimio_history')
  var history = []
  try { history = readFileSync(history_path, 'utf8').split('\n').filter(Boolean).reverse() } catch(e) {}

  const rl = createInterface({ input: process.stdin, output: process.stdout, completer, history })
  rl._writeToOutput = function(str) { rl.output.write(highlight(str)) }
  // Force full-line redraws so highlight() sees the complete line context
  rl._insertString = function(c) {
    this.line = this.line.slice(0, this.cursor) + c + this.line.slice(this.cursor)
    this.cursor += c.length
    this._refreshLine()
  }
  // Content below the prompt: completions + desc + help, all shown together.
  // On each refresh: clear old content, redraw prompt, build and show new content.
  var hasBelow = false
  var origRefreshLine = rl._refreshLine.bind(rl)

  rl._refreshLine = function() {
    if (hasBelow) this.output.write('\x1b[0J')
    hasBelow = false
    origRefreshLine()

    var below = build_below(this.line.slice(0, this.cursor))
    if (below && below.length > 0) {
      var cols = this.columns || 80
      var rows = 1
      this.output.write('\r\n')
      for (var i = 0; i < below.length; i++) {
        this.output.write(below[i] + '\r\n')
        var vlen = below[i].replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length
        rows += Math.max(1, Math.ceil(vlen / cols))
      }
      this.output.write('\x1b[' + rows + 'A')
      this.output.write('\x1b[' + ((this._prompt || '').length + this.cursor + 1) + 'G')
      hasBelow = true
    }
  }

  // Colors and helpers
  var C_DESC = '\x1b[38;5;250m'
  var C_HELP = '\x1b[38;5;243m'

  function format_lines(lines, color) {
    if (!lines || !lines.length) return []
    var out = []
    for (var i = 0; i < lines.length; i++)
      out.push(color + (lines[i] || ' ') + RESET)
    return out
  }

  function to_help_array(h) { return h ? (Array.isArray(h) ? h : [h]) : null }

  function tab_context(line) {
    var start = find_unclosed_brace(line)
    if (start === -1) return { phase: 'handler' }
    var seg = last_pipe_segment(line.slice(start + 1)).trimStart()
    var words = seg.split(/\s+/).filter(Boolean)
    var ends = seg.endsWith(' ')
    var h = words[0], cmd = h && D.Commands[h]
    if (!cmd || (words.length === 1 && !ends))
      return { phase: 'handler' }
    var m = words[1], method = m && cmd.methods && cmd.methods[m]
    if (!method || (words.length === 2 && !ends))
      return { phase: 'method', cmd: cmd }
    return { phase: 'param', cmd: cmd, method: method }
  }

  // Build everything shown below the prompt: completions, then desc, then help
  function build_below(text) {
    // Must be inside an unclosed brace with a non-empty segment
    var start = find_unclosed_brace(text)
    if (start === -1) return null
    var seg = last_pipe_segment(text.slice(start + 1)).trimStart()
    if (seg === '') return null

    var ctx = tab_context(text)
    var lines = []

    // 1. Completion columns (on top)
    var result = completer(text)
    var hits = result[0], partial = result[1]
    if (hits.length > 0 && !(hits.length === 1 && hits[0].trimEnd() === partial)) {
      var maxLen = Math.max(...hits.map(function(h) { return h.length })) + 2
      var termCols = rl.columns || 80
      var colCount = Math.max(1, Math.floor(termCols / maxLen))
      for (var i = 0; i < hits.length; i += colCount) {
        var row = ''
        for (var j = i; j < Math.min(i + colCount, hits.length); j++)
          row += hits[j].padEnd(maxLen)
        lines.push(row.trimEnd())
      }
    }

    // 2-3. Desc and help (context-appropriate)
    var words = seg.split(/\s+/).filter(Boolean)
    var ends = seg.endsWith(' ')

    if (ctx.phase === 'param' && ctx.method) {
      // If last word before space is a param name, show that param's desc
      var paramDesc = null
      if (ends && words.length > 2) {
        var lastWord = words[words.length - 1]
        if (ctx.method.params) {
          for (var k = 0; k < ctx.method.params.length; k++) {
            if (ctx.method.params[k].key === lastWord) {
              paramDesc = ctx.method.params[k].desc
              break
            }
          }
        }
      }
      if (paramDesc) {
        lines = lines.concat(format_lines([paramDesc], C_DESC))
      } else {
        if (ctx.method.desc) lines = lines.concat(format_lines([ctx.method.desc], C_DESC))
        if (ctx.method.help) lines = lines.concat(format_lines(to_help_array(ctx.method.help), C_HELP))
      }
    } else if (ctx.phase === 'method' && ctx.cmd) {
      if (ctx.cmd.desc) lines = lines.concat(format_lines([ctx.cmd.desc], C_DESC))
      if (ctx.cmd.help) lines = lines.concat(format_lines(to_help_array(ctx.cmd.help), C_HELP))
    }

    return lines.length > 0 ? lines : null
  }

  // Tab: insert first match
  rl._tabComplete = function() {
    var line = this.line.slice(0, this.cursor)
    var result = completer(line)
    var hits = result[0], partial = result[1]
    if (!hits.length) return

    var completion = hits[0].slice(partial.length)
    if (!completion.endsWith(' ')) completion += ' '
    this._insertString(completion)
  }
  let buf = ''

  function prompt() {
    rl.question(buf ? '  ' : '> ', line => {
      if (line === '' && buf.trim()) {
        const input = buf
        buf = ''
        appendFileSync(history_path, input + '\n')
        return D.run(input, value => {
          flush_errors(process.stderr)
          console.log(value)
          prompt()
        })
      }
      buf += (buf ? ' ' : '') + line
      prompt()
    })
  }

  prompt()
}
