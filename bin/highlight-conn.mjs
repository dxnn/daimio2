#!/usr/bin/env node
// Usage: node bin/highlight-conn.mjs <layout.json> <render.txt> <conn_id>
// Overwrites wire cells for the given connection with 'x' in the render.

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

var paths = laid.paths || []
for (var i = 0; i < paths.length; i++) {
  if (paths[i].conn !== conn_id) continue
  var pts = paths[i].path
  for (var j = 0; j < pts.length - 1; j++) {
    var x0 = pts[j].x, y0 = pts[j].y, x1 = pts[j + 1].x, y1 = pts[j + 1].y
    if (y0 === y1) {
      var xmin = Math.min(x0, x1), xmax = Math.max(x0, x1)
      for (var x = xmin; x <= xmax; x++)
        if (grid[y0] && grid[y0][x]) grid[y0][x] = 'x'
    } else if (x0 === x1) {
      var ymin = Math.min(y0, y1), ymax = Math.max(y0, y1)
      for (var y = ymin; y <= ymax; y++)
        if (grid[y] && grid[y][x0]) grid[y][x0] = 'x'
    }
  }
}

console.log(grid.map(function(row) { return row.join('') }).join('\n'))
