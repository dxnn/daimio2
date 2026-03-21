import D from '../daimio/daimio.js'
import '../daimio/editor.js'
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

  // Completer for readline (delegates to D.editor_context)
  function completer(line) {
    var ctx = D.editor_context(line, line.length)
    if (ctx.phase === 'outside') return [[], line]
    var hits = ctx.completions.slice()
    if (hits.length === 1) hits = [hits[0] + ' ']
    return [hits, ctx.partial]
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

  var C_DESC = '\x1b[38;5;250m'
  var C_HELP = '\x1b[38;5;243m'
  var C_SEL  = '\x1b[7m'       // inverse video for selected completion
  var C_NSEL = '\x1b[27m'      // reset inverse

  // Tab-cycling state
  var selIdx = null        // null = no selection, 0+ = cycling index
  var selHits = null       // completions array frozen at selection start
  var selPartial = null    // partial word at selection start

  // Build everything shown below the prompt using D.editor_context
  function build_below(text) {
    var ctx = D.editor_context(text, text.length)
    if (ctx.phase === 'outside') return null
    if (ctx.phase === 'handler' && ctx.partial === '') return null

    var lines = []

    // 1. Completion columns (on top), with selection highlight
    var hits = ctx.completions
    if (hits.length > 0 && !(hits.length === 1 && hits[0] === ctx.partial)) {
      var maxLen = Math.max(...hits.map(function(h) { return h.length })) + 2
      var termCols = rl.columns || 80
      var colCount = Math.max(1, Math.floor(termCols / maxLen))
      for (var i = 0; i < hits.length; i += colCount) {
        var row = ''
        for (var j = i; j < Math.min(i + colCount, hits.length); j++) {
          var cell = hits[j].padEnd(maxLen)
          if (selIdx !== null && j === selIdx)
            cell = C_SEL + cell + C_NSEL
          row += cell
        }
        lines.push(row.trimEnd())
      }
    }

    // 2. Desc
    if (ctx.desc) lines.push(C_DESC + ctx.desc + RESET)

    // 3. Help
    if (ctx.help) {
      for (var i = 0; i < ctx.help.length; i++)
        lines.push(C_HELP + (ctx.help[i] || ' ') + RESET)
    }

    return lines.length > 0 ? lines : null
  }

  // Tab: single match inserts directly, multiple matches cycle with highlight
  rl._tabComplete = function() {
    var text = this.line.slice(0, this.cursor)
    var ctx = D.editor_context(text, text.length)
    if (!ctx.completions.length) return

    if (ctx.completions.length === 1) {
      var completion = ctx.completions[0].slice(ctx.partial.length)
      if (!completion.endsWith(' ')) completion += ' '
      selIdx = null; selHits = null; selPartial = null
      this._insertString(completion)
      return
    }

    if (selIdx === null) {
      selHits = ctx.completions
      selPartial = ctx.partial
      selIdx = 0
    } else {
      selIdx = (selIdx + 1) % selHits.length
    }
    this._refreshLine()
  }

  // Intercept keys during tab-cycling: space confirms, escape/other cancels
  var origTtyWrite = rl._ttyWrite.bind(rl)
  rl._ttyWrite = function(s, key) {
    if (selIdx !== null) {
      if (key && key.name === 'tab') {
        return origTtyWrite.call(this, s, key)
      }
      if (s === ' ') {
        var completion = selHits[selIdx].slice(selPartial.length) + ' '
        selIdx = null; selHits = null; selPartial = null
        this._insertString(completion)
        return
      }
      // Any other key: cancel selection, process normally
      selIdx = null; selHits = null; selPartial = null
    }
    origTtyWrite.call(this, s, key)
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
