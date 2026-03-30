// site/js/space_ascii.js — ASCII renderer for laid-out Daimio space topologies
//
// Takes { width, height, elements, paths } from space_layout.js and stamps an ASCII grid.
// Pluggable: swap this for an SVG renderer using the same layout output.

import { extract, layout } from './space_layout.js'

export function render(laid_out) {
  var w = laid_out.width
  var h = laid_out.height
  var elements = laid_out.elements
  var paths = laid_out.paths || []

  var grid = []
  for (var y = 0; y < h; y++) {
    grid[y] = []
    for (var x = 0; x < w; x++) grid[y][x] = ' '
  }

  // 1. Stamp box
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type !== 'box') continue
    for (var x = el.x + 1; x <= el.x + el.width - 2; x++) grid[el.y][x] = '_'
    if (el.name) {
      var bname = ' ' + el.name + ' '
      for (var j = 0; j < bname.length && el.x + 2 + j < el.x + el.width - 3; j++)
        grid[el.y][el.x + 2 + j] = bname[j]
    }
    grid[el.y + el.height - 1][el.x] = '|'
    for (var x = el.x + 1; x <= el.x + el.width - 2; x++) grid[el.y + el.height - 1][x] = '_'
    grid[el.y + el.height - 1][el.x + el.width - 1] = '|'
    for (var y = el.y + 1; y < el.y + el.height - 1; y++) {
      grid[y][el.x] = '|'
      grid[y][el.x + el.width - 1] = '|'
    }
  }

  // 2. Stamp ports, labels, text
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type === 'port') grid[el.y][el.x] = 'o'
    else if (el.type === 'label' || el.type === 'text')
      for (var j = 0; j < el.text.length; j++) grid[el.y][el.x + j] = el.text[j]
  }

  // 3. Stamp path wire segments and track h/v directions for intersections
  var h_dir = {}  // 'x,y' → direction
  var v_dir = {}
  for (var i = 0; i < paths.length; i++) {
    var pts = paths[i].path
    for (var j = 0; j < pts.length - 1; j++) {
      var x0 = pts[j].x, y0 = pts[j].y, x1 = pts[j + 1].x, y1 = pts[j + 1].y
      if (y0 === y1) {
        var xmin = Math.min(x0, x1), xmax = Math.max(x0, x1)
        var dir = x1 >= x0 ? 'right' : 'left'
        for (var x = xmin; x <= xmax; x++) { grid[y0][x] = '-'; h_dir[x + ',' + y0] = dir }
      } else if (x0 === x1) {
        var ymin = Math.min(y0, y1), ymax = Math.max(y0, y1)
        var dir = y1 >= y0 ? 'down' : 'up'
        for (var y = ymin; y <= ymax; y++) { grid[y][x0] = '|'; v_dir[x0 + ',' + y] = dir }
      }
    }
  }

  // 4. Compute intersections from h/v overlap
  var dir_char = { down: 'v', up: '^', right: '>', left: '<' }
  for (var k in h_dir) {
    if (!v_dir[k]) continue
    var parts = k.split(','), x = parseInt(parts[0]), y = parseInt(parts[1])
    var h_thru = !!h_dir[(x - 1) + ',' + y] && !!h_dir[(x + 1) + ',' + y]
    var v_thru = !!v_dir[x + ',' + (y - 1)] && !!v_dir[x + ',' + (y + 1)]
    var hd = h_dir[k], vd = v_dir[k]
    grid[y][x] = h_thru && v_thru ? 'O' : h_thru ? dir_char[vd] : v_thru ? dir_char[hd] : dir_char[vd]
  }

  // 5. Stamp stations and subspace_boxes ON TOP of wires
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type === 'station') {
      var sx = el.x, sy = el.y, sw = el.width
      for (var x = sx + 1; x <= sx + sw - 2; x++) grid[sy][x] = '_'
      if (el.name) {
        var sname = ' ' + el.name + ' '
        for (var j = 0; j < sname.length && sx + 2 + j < sx + sw - 3; j++)
          grid[sy][sx + 2 + j] = sname[j]
      }
      grid[sy + 1][sx] = '/'
      grid[sy + 1][sx + sw - 1] = '\\'
      grid[sy + 2][sx - 1] = '('
      var inner = sw
      var content = '  ' + el.source
      while (content.length < inner) content += ' '
      for (var j = 0; j < inner; j++) grid[sy + 2][sx + j] = content[j]
      grid[sy + 2][sx + sw] = ')'
      grid[sy + 3][sx] = '\\'
      for (var x = sx + 1; x <= sx + sw - 2; x++) grid[sy + 3][x] = '_'
      grid[sy + 3][sx + sw - 1] = '/'
    } else if (el.type === 'subspace_box') {
      var sx = el.x, sy = el.y, sw = el.width
      for (var x = sx + 1; x <= sx + sw - 2; x++) grid[sy][x] = '_'
      grid[sy + 1][sx] = '|'
      grid[sy + 1][sx + sw - 1] = '|'
      var inner = sw - 2
      var content = ' ' + el.name
      while (content.length < inner) content += ' '
      for (var j = 0; j < inner; j++) grid[sy + 1][sx + 1 + j] = content[j]
      grid[sy + 2][sx] = 'o'
      grid[sy + 2][sx + sw - 1] = 'o'
      grid[sy + 3][sx] = '|'
      for (var x = sx + 1; x <= sx + sw - 2; x++) grid[sy + 3][x] = '_'
      grid[sy + 3][sx + sw - 1] = '|'
    }
  }

  var lines = []
  for (var y = 0; y < h; y++)
    lines.push(grid[y].join('').replace(/\s+$/, ''))
  return lines.join('\n')
}

export function render_space(name, seedlike, options) {
  return render(layout(extract(name, seedlike), options))
}

export function render_all(seedlikes, options) {
  return Object.keys(seedlikes).map(function(n) { return render_space(n, seedlikes[n], options) }).join('\n\n')
}
