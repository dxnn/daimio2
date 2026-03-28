#!/usr/bin/env node
// Usage: node bin/highlight-conn.mjs <layout.json> <render.txt> <conn_id>
// Overwrites hline/vline cells for the given connection with 'x' in the render.

import { readFileSync } from 'fs'

var args = process.argv.slice(2)
if (args.length < 3) {
  console.error('Usage: highlight-conn.mjs <layout.json> <render.txt> <conn_id>')
  process.exit(1)
}

var laid = JSON.parse(readFileSync(args[0], 'utf8'))
var render = readFileSync(args[1], 'utf8')
var conn_id = args[2]

var lines = render.split('\n')
var grid = lines.map(function(l) { return l.split('') })

for (var i = 0; i < laid.elements.length; i++) {
  var el = laid.elements[i]
  if (!el.conns || el.conns.indexOf(conn_id) < 0) continue
  if (el.type === 'hline') {
    for (var x = el.x; x < el.x + el.length; x++)
      if (grid[el.y] && grid[el.y][x]) grid[el.y][x] = 'x'
  } else if (el.type === 'vline') {
    for (var y = el.y; y < el.y + el.length; y++)
      if (grid[y] && grid[y][el.x]) grid[y][el.x] = 'x'
  }
}

console.log(grid.map(function(row) { return row.join('') }).join('\n'))
