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

  function completer(line) {
    // Find the last unclosed { to get the current command context
    var depth = 0, start = -1
    for (var i = line.length - 1; i >= 0; i--) {
      if (line[i] === '}') depth++
      else if (line[i] === '{') { if (depth) depth--; else { start = i; break } }
    }
    if (start === -1) return [[], line]

    var inside = line.slice(start + 1)
    // Strip leading pipes to get current segment
    var raw_seg = inside.split(/\|/).pop()
    var seg = raw_seg.trimStart()
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
  // Temporary content below the prompt (info, completions).
  // Strategy: origRefreshLine runs first (redraws prompt, may clear below),
  // then we write pendingBelow lines AFTER and move cursor back up.
  // On the next refresh (user action), \x1b[0J clears old content first.
  var pendingBelow = null   // array of pre-formatted strings to show below prompt
  var hasBelow = false      // true if there are info/completion lines on screen
  var origRefreshLine = rl._refreshLine.bind(rl)
  rl._refreshLine = function() {
    if (hasBelow) this.output.write('\x1b[0J')
    hasBelow = false
    origRefreshLine()
    if (pendingBelow) {
      var lines = pendingBelow
      pendingBelow = null
      this.output.write('\x1b7')  // save cursor position (row + column)
      this.output.write('\r\n')
      for (var i = 0; i < lines.length; i++)
        this.output.write(lines[i] + '\r\n')
      this.output.write('\x1b8')  // restore cursor position
      hasBelow = true
    }
  }
  // Tab completion: first tab shows all choices + context info, second tab inserts first choice
  var C_DESC = '\x1b[38;5;250m'
  var C_HELP = '\x1b[38;5;243m'
  var prevTabLine = null, prevTabHits = null, prevTabPartial = null

  function format_lines(lines, color) {
    if (!lines || !lines.length) return []
    var out = []
    for (var i = 0; i < lines.length; i++)
      out.push(color + (lines[i] || ' ') + RESET)
    return out
  }

  function to_help_array(h) { return h ? (Array.isArray(h) ? h : [h]) : null }

  function tab_context(line) {
    var d = 0, start = -1
    for (var i = line.length - 1; i >= 0; i--) {
      if (line[i] === '}') d++
      else if (line[i] === '{') { if (d) d--; else { start = i; break } }
    }
    if (start === -1) return { phase: 'handler' }
    var seg = line.slice(start + 1).split(/\|/).pop().trimStart()
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

  function completion_info(ctx, word) {
    if (ctx.phase === 'handler') {
      var c = D.Commands[word]
      if (!c) return null
      return { desc: c.desc || null, help: to_help_array(c.help) }
    }
    if (ctx.phase === 'method' && ctx.cmd) {
      var m = ctx.cmd.methods && ctx.cmd.methods[word]
      if (!m) return null
      return { desc: m.desc || null, help: to_help_array(m.help) }
    }
    if (ctx.phase === 'param' && ctx.method) {
      for (var i = 0; i < ctx.method.params.length; i++) {
        if (ctx.method.params[i].key === word)
          return { desc: ctx.method.params[i].desc || null, help: null }
      }
    }
    return null
  }

  function show_desc_help(info) {
    if (!info || (!info.desc && !info.help)) return
    var lines = []
    if (info.desc) lines = lines.concat(format_lines([info.desc], C_DESC))
    if (info.help) lines = lines.concat(format_lines(info.help, C_HELP))
    pendingBelow = lines
    rl._refreshLine()
  }

  rl._tabComplete = function() {
    var line = this.line.slice(0, this.cursor)
    var result = completer(line)
    var hits = result[0], partial = result[1]
    if (!hits.length) return

    var ctx = tab_context(line)

    if (hits.length === 1) {
      this._insertString(hits[0].slice(partial.length))
      show_desc_help(completion_info(ctx, hits[0].trimEnd()))
      prevTabLine = null
      return
    }

    if (prevTabLine === line && prevTabHits) {
      // Second tab: insert first choice
      this._insertString(prevTabHits[0].slice(prevTabPartial.length) + ' ')
      show_desc_help(completion_info(ctx, prevTabHits[0].trimEnd()))
      prevTabLine = null
      prevTabHits = null
      return
    }

    // First tab: show context info + all choices
    prevTabLine = line
    prevTabHits = hits
    prevTabPartial = partial
    var lines = []

    // Context header
    if (ctx.phase === 'method' && ctx.cmd) {
      if (ctx.cmd.desc) lines = lines.concat(format_lines([ctx.cmd.desc], C_DESC))
      if (ctx.cmd.help) lines = lines.concat(format_lines(to_help_array(ctx.cmd.help), C_HELP))
    } else if (ctx.phase === 'param' && ctx.method) {
      if (ctx.method.desc) lines = lines.concat(format_lines([ctx.method.desc], C_DESC))
      if (ctx.method.help) lines = lines.concat(format_lines(to_help_array(ctx.method.help), C_HELP))
    }

    var maxLen = Math.max(...hits.map(h => h.length)) + 2
    var cols = Math.max(1, Math.floor((this.columns || 80) / maxLen))
    for (var i = 0; i < hits.length; i += cols) {
      var row = ''
      for (var j = i; j < Math.min(i + cols, hits.length); j++) {
        row += hits[j].padEnd(maxLen)
      }
      lines.push(row.trimEnd())
    }
    pendingBelow = lines
    this._refreshLine()
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
