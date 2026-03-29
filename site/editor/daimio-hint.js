(function() {

  function daimioHint(editor) {
    if (typeof D === 'undefined' || !D.editor_context) return false

    var cur = editor.getCursor()
    var text = editor.getValue()
    var offset = editor.indexFromPos(cur)
    var ctx = D.editor_context(text, offset)

    if (ctx.phase === 'outside' || ctx.phase === 'param_value') return false
    if (!ctx.completions.length) return false
    if (ctx.completions.length === 1 && ctx.completions[0] === ctx.partial) return false

    return {
      list: ctx.completions.map(function(c) {
        return { text: c + ' ', displayText: c }
      }),
      from: editor.posFromIndex(offset - ctx.partial.length),
      to: cur
    }
  }

  CodeMirror.registerHelper("hint", "daimio", daimioHint);
})()
