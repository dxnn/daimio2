import D from '../../daimio/1_daimio.js'

// Token regex — order matters: longer/more specific patterns first
var TOKEN_RE = /"(?:[^"\\]|\\.)*"|[{}()]|\|\||[|]|>@\w+|>\$\w+(?:\.\w+)*|\$\w+(?:\.\w+)*|>\w+|__in\b|__\b|_\w+|:\w+|\d+(?:\.\d+)?|[a-z]\w*/g

function new_cmd() {
  return {
    phase: 'handler',    // handler, method, param_name, param_value
    handler: null,
    handlerObj: null,
    method: null,
    methodObj: null,
    pnames: [],           // remaining unused param names
    lastParam: null       // last param name consumed (for param_value desc)
  }
}

// Consume a value token in param_value phase → transition to param_name.
// When `end` is provided, only transition if the token doesn't touch the
// cursor boundary (the user might still be typing the value).
// Structural delimiters like } and ) omit `end` to always transition.
var _stopPos  // set by scan(), visible to consume_value
function consume_value(cmd, end) {
  if (cmd && cmd.phase === 'param_value') {
    if (end !== undefined && end >= _stopPos) return
    cmd.phase = 'param_name'
  }
}

function resolve_alias(alias, cmd) {
  var parts = D.AliasMap[alias].split(' ')
  var handler = parts[0]
  var method = parts[1]
  cmd.handler = handler
  cmd.handlerObj = D.Commands[handler] || null
  if (cmd.handlerObj && method && cmd.handlerObj.methods && cmd.handlerObj.methods[method]) {
    cmd.method = method
    cmd.methodObj = cmd.handlerObj.methods[method]
    if (cmd.methodObj.params) {
      cmd.pnames = cmd.methodObj.params.map(function(p) { return p.key })
      // Remove all param names claimed by the alias expansion
      for (var i = 2; i < parts.length; i++) {
        // Skip values (non-lowercase-starting words like '__')
        if (/^[a-z]/.test(parts[i])) {
          var idx = cmd.pnames.indexOf(parts[i])
          if (idx >= 0) cmd.pnames.splice(idx, 1)
        }
      }
    }
  }
  cmd.phase = 'param_name'
}

function scan(text, stopPos) {
  if (stopPos === undefined) stopPos = text.length
  _stopPos = stopPos

  var tokens = []
  var stack = []
  var inBrace = false
  var cmd = null
  var outsideStart = 0  // start of current outside-brace text region
  var listDepth = 0     // depth of (...) list literals

  TOKEN_RE.lastIndex = 0
  var match

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index >= stopPos) break

    var m = match[0]
    var start = match.index
    var end = start + m.length

    if (m === '{') {
      if (!inBrace && start > outsideStart)
        tokens.push({type: 'text', start: outsideStart, end: start})
      if (inBrace && cmd) { stack.push(cmd); cmd = new_cmd() }
      else { cmd = new_cmd(); inBrace = true }
      tokens.push({type: 'brace', start: start, end: end})
    }
    else if (m === '}') {
      tokens.push({type: 'brace', start: start, end: end})
      if (stack.length > 0) {
        cmd = stack.pop()
        consume_value(cmd)
      } else {
        cmd = null; inBrace = false; outsideStart = end
      }
    }
    else if (m === '(') {
      if (inBrace) listDepth++
    }
    else if (m === ')') {
      if (listDepth > 0) { listDepth--; if (listDepth === 0 && cmd) consume_value(cmd) }
    }
    else if (!inBrace) { continue }  // skip — included in outside text region
    else if (listDepth > 0) { continue }  // inside list literal — skip command phase changes
    else if (m === '||') {
      tokens.push({type: 'barrier', start: start, end: end})
      if (inBrace) cmd = new_cmd()
    }
    else if (m === '|') {
      tokens.push({type: 'pipe', start: start, end: end})
      if (inBrace) cmd = new_cmd()
    }
    else if (!inBrace) {
      // Outside braces — part of surrounding text (gap detection handles it)
    }
    else if (m[0] === '"') {
      tokens.push({type: 'string', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m.startsWith('>@')) {
      tokens.push({type: 'port_send', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m.startsWith('>$')) {
      tokens.push({type: 'svar_write', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m[0] === '$') {
      tokens.push({type: 'svar', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m === '__' || m === '__in') {
      tokens.push({type: 'implicit', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m[0] === '>' && m.length > 1) {
      tokens.push({type: 'pvar_write', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m[0] === '_') {
      tokens.push({type: 'pvar', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m[0] === ':') {
      tokens.push({type: 'name', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m[0] >= '0' && m[0] <= '9') {
      tokens.push({type: 'number', start: start, end: end})
      consume_value(cmd, end)
    }
    else if (m[0] >= 'a' && m[0] <= 'z' && cmd) {
      // Bare word — classify by command phase
      if (cmd.phase === 'handler') {
        if (D.Commands[m]) {
          cmd.handler = m
          cmd.handlerObj = D.Commands[m]
          cmd.phase = 'method'
          tokens.push({type: 'handler', start: start, end: end})
        }
        else if (D.AliasMap[m]) {
          resolve_alias(m, cmd)
          tokens.push({type: 'alias', start: start, end: end})
        }
        else {
          tokens.push({type: 'text', start: start, end: end})
        }
      }
      else if (cmd.phase === 'method') {
        if (cmd.handlerObj && cmd.handlerObj.methods && cmd.handlerObj.methods[m]) {
          cmd.method = m
          cmd.methodObj = cmd.handlerObj.methods[m]
          if (cmd.methodObj.params)
            cmd.pnames = cmd.methodObj.params.map(function(p) { return p.key })
          cmd.phase = 'param_name'
          tokens.push({type: 'method', start: start, end: end})
        }
        else {
          tokens.push({type: 'text', start: start, end: end})
        }
      }
      else if (cmd.phase === 'param_name') {
        var paramIndex = -1
        if (cmd.methodObj && cmd.methodObj.params) {
          for (var pi = 0; pi < cmd.methodObj.params.length; pi++) {
            if (cmd.methodObj.params[pi].key === m) { paramIndex = pi; break }
          }
        }
        if (paramIndex >= 0) {
          var pnIdx = cmd.pnames.indexOf(m)
          if (pnIdx >= 0) cmd.pnames.splice(pnIdx, 1)
          cmd.lastParam = m
          cmd.phase = 'param_value'
          tokens.push({type: 'param', start: start, end: end, index: paramIndex})
        }
        else {
          // Not a known param — treat as positional value, stay in param_name
          tokens.push({type: 'text', start: start, end: end})
        }
      }
      else if (cmd.phase === 'param_value') {
        // Bare word as param value — consume and return to param_name
        if (end < _stopPos) cmd.phase = 'param_name'
        tokens.push({type: 'text', start: start, end: end})
      }
    }

  }

  // Trailing text outside braces
  if (!inBrace && outsideStart < stopPos) {
    tokens.push({type: 'text', start: outsideStart, end: stopPos})
  }

  return { tokens: tokens, state: { cmd: cmd, stack: stack, inBrace: inBrace } }
}

D.editor_tokens = function(text) {
  return scan(text).tokens
}

D.editor_context = function(text, cursor) {
  // Extract partial word at cursor (lowercase letters + word chars)
  var partial = ''
  var i = cursor - 1
  while (i >= 0 && /[a-z\w]/.test(text[i])) { partial = text[i] + partial; i-- }
  if (partial && !/^[a-z]/.test(partial)) partial = ''

  // Scan up to (but not including) the partial, so state reflects position before partial
  var result = scan(text, cursor - partial.length)
  var st = result.state
  var cmd = st.cmd

  if (!st.inBrace || !cmd) {
    return { phase: 'outside', handler: null, method: null, partial: partial,
             completions: [], desc: null, help: null, paramName: null, pnames: [] }
  }

  var phase = cmd.phase
  var completions = []
  var desc = null
  var help = null

  function to_array(h) { return h ? (Array.isArray(h) ? h : [h]) : null }

  if (phase === 'handler') {
    var all = Object.keys(D.Commands).concat(Object.keys(D.AliasMap))
    completions = all.filter(function(n) { return n.startsWith(partial) }).sort()
  }
  else if (phase === 'method') {
    if (cmd.handlerObj && cmd.handlerObj.methods) {
      completions = Object.keys(cmd.handlerObj.methods)
        .filter(function(n) { return n.startsWith(partial) }).sort()
    }
    if (cmd.handlerObj) {
      desc = cmd.handlerObj.desc || null
      help = to_array(cmd.handlerObj.help)
    }
  }
  else if (phase === 'param_name') {
    completions = cmd.pnames.filter(function(n) { return n.startsWith(partial) }).sort()
    if (cmd.methodObj) {
      desc = cmd.methodObj.desc || null
      help = to_array(cmd.methodObj.help)
    }
  }
  else if (phase === 'param_value') {
    if (cmd.lastParam && cmd.methodObj && cmd.methodObj.params) {
      for (var pi = 0; pi < cmd.methodObj.params.length; pi++) {
        if (cmd.methodObj.params[pi].key === cmd.lastParam) {
          desc = cmd.methodObj.params[pi].desc || null
          break
        }
      }
    }
  }

  return {
    phase: phase,
    handler: cmd.handler,
    method: cmd.method,
    partial: partial,
    completions: completions,
    desc: desc,
    help: help,
    paramName: cmd.lastParam,
    pnames: cmd.pnames.slice()
  }
}
