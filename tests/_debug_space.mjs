var D = (await import('../daimio/daimio.js')).default

function dedent(s) {
  var lines = s.split('\n')
  while(lines.length && !lines[0].trim()) lines.shift()
  var min = Infinity
  lines.forEach(function(line) {
    if(!line.trim()) return
    var indent = line.search(/\S/)
    if(indent < min) min = indent
  })
  if(min === Infinity) min = 0
  return lines.map(function(line) { return line.slice(min) }).join('\n')
}

var s = dedent(`
  inner
    @in
    @out
    double {__ | times 2}
    @in -> double -> @out
  outer
    @init from-js 5
    @out  out
    @init -> inner.in
    inner.out -> @out`)

console.log('---')
s.split('\n').forEach(function(line, i) {
  console.log(i + ': [' + line.search(/\S/) + '] "' + line + '"')
})
console.log('---')
var result = D.make_some_space(s)
console.log('result:', result)
