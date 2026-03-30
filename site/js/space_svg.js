// site/js/space_svg.js — SVG renderer for laid-out Daimio space topologies
//
// Takes { width, height, elements, paths } from space_layout.js and produces an SVG string.
// Pluggable: same layout interface as space_ascii.js.

import { extract, layout } from './space_layout.js'

var CELL_W = 8
var CELL_H = 16
var PORT_R = 6

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function px(x) { return x * CELL_W }
function py(y) { return y * CELL_H }

export function render(laid_out, options) {
  var w = laid_out.width
  var h = laid_out.height
  var elements = laid_out.elements
  var paths = laid_out.paths || []
  var opt = options || {}
  var cell_w = opt.cell_w || CELL_W
  var cell_h = opt.cell_h || CELL_H

  function cx(x) { return x * cell_w }
  function cy(y) { return y * cell_h }

  var svg_w = w * cell_w
  var svg_h = h * cell_h
  var parts = []

  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + svg_w + '" height="' + svg_h + '" viewBox="0 0 ' + svg_w + ' ' + svg_h + '" style="font-family: monospace">')
  parts.push('<defs>')
  parts.push('  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">')
  parts.push('    <path d="M 0 0 L 10 5 L 0 10 z" fill="#888"/>')
  parts.push('  </marker>')
  parts.push('  <marker id="arrow-back" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">')
  parts.push('    <path d="M 0 0 L 10 5 L 0 10 z" fill="#c44"/>')
  parts.push('  </marker>')
  parts.push('</defs>')

  // 1. Box (outer container)
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type !== 'box') continue
    parts.push('<rect x="' + cx(el.x) + '" y="' + cy(el.y) + '" width="' + cx(el.width) + '" height="' + cy(el.height) + '" fill="#fafafa" stroke="#999" stroke-width="1.5" rx="3"/>')
    if (el.name)
      parts.push('<text x="' + cx(el.x + 2) + '" y="' + (cy(el.y) + cell_h * 0.8) + '" font-size="16" font-weight="bold" fill="#333">' + esc(el.name) + '</text>')
  }

  // 2. Wire paths
  for (var i = 0; i < paths.length; i++) {
    var pts = paths[i].path
    if (pts.length < 2) continue
    var leftward = pts[pts.length - 1].x < pts[0].x
    var color = leftward ? '#c44' : '#888'
    var marker = leftward ? 'url(#arrow-back)' : 'url(#arrow)'
    parts.push('<polyline points="' + pts.map(function(p) { return cx(p.x) + ',' + cy(p.y) }).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" marker-end="' + marker + '"/>')
  }

  // 3. Stations
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type !== 'station') continue
    var sx = cx(el.x), sy = cy(el.y)
    var sw = cx(el.width), sh = cy(el.height)
    var inset = cell_w
    // Trapezoid shape: narrow top, wide middle
    var trap = 'M ' + (sx + inset) + ' ' + sy
      + ' L ' + (sx + sw - inset) + ' ' + sy
      + ' L ' + (sx + sw + cell_w * 0.5) + ' ' + (sy + sh * 0.4)
      + ' L ' + (sx + sw + cell_w * 0.5) + ' ' + (sy + sh * 0.6)
      + ' L ' + (sx + sw - inset) + ' ' + (sy + sh)
      + ' L ' + (sx + inset) + ' ' + (sy + sh)
      + ' L ' + (sx - cell_w * 0.5) + ' ' + (sy + sh * 0.6)
      + ' L ' + (sx - cell_w * 0.5) + ' ' + (sy + sh * 0.4)
      + ' Z'
    parts.push('<path d="' + trap + '" fill="#e8f0fe" stroke="#4a86c8" stroke-width="1.5"/>')
    // Source text
    var text_y = sy + sh * 0.65
    parts.push('<text x="' + (sx + sw / 2) + '" y="' + text_y + '" text-anchor="middle" font-size="14" fill="#333">' + esc(el.source) + '</text>')
    // Name label above
    if (el.name)
      parts.push('<text x="' + (sx + sw / 2) + '" y="' + (sy + cell_h * 0.7) + '" text-anchor="middle" font-size="13" font-weight="bold" fill="#4a86c8">' + esc(el.name) + '</text>')
  }

  // 4. Subspace boxes
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type !== 'subspace_box') continue
    var sx = cx(el.x), sy = cy(el.y)
    var sw = cx(el.width), sh = cy(el.height)
    parts.push('<rect x="' + sx + '" y="' + sy + '" width="' + sw + '" height="' + sh + '" fill="#f0f7f0" stroke="#5a9a5a" stroke-width="1.5" stroke-dasharray="4 3" rx="3"/>')
    parts.push('<text x="' + (sx + sw / 2) + '" y="' + (sy + sh / 2 + 5) + '" text-anchor="middle" font-size="14" font-weight="bold" fill="#5a9a5a">' + esc(el.name) + '</text>')
  }

  // 5. Ports
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type !== 'port') continue
    var px = cx(el.x), py = cy(el.y)
    parts.push('<circle cx="' + px + '" cy="' + py + '" r="' + PORT_R + '" fill="#e67e22" stroke="#c0392b" stroke-width="1"/>')
    // Port label — above the wire, tucked toward the wall
    var label_x = el.dir === 'left' ? px + 2 : px - 2
    var anchor = el.dir === 'left' ? 'start' : 'end'
    parts.push('<text x="' + label_x + '" y="' + (py - PORT_R - 3) + '" text-anchor="' + anchor + '" font-size="12" fill="#c0392b">' + esc(el.key) + '</text>')
  }

  // 6. Text elements (state vars, labels)
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i]
    if (el.type !== 'text' && el.type !== 'label') continue
    parts.push('<text x="' + cx(el.x) + '" y="' + (cy(el.y) + cell_h * 0.7) + '" font-size="13" fill="#666">' + esc(el.text) + '</text>')
  }

  parts.push('</svg>')
  return parts.join('\n')
}

export function render_space(name, seedlike, options) {
  var layout_opts = options || {}
  var laid = layout(extract(name, seedlike), layout_opts)
  return render(laid, options)
}

export function render_all(seedlikes, options) {
  return Object.keys(seedlikes).map(function(n) { return render_space(n, seedlikes[n], options) }).join('\n')
}
