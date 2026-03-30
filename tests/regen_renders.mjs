import D from '../daimio/daimio.js'
import { extract, layout } from '../site/js/space_layout.js'
import { render, render_space, render_all } from '../site/js/space_ascii.js'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'

var dir = 'tests/space_ascii'
var fixtures = readdirSync(dir, { withFileTypes: true }).filter(function(d) { return d.isDirectory() }).map(function(d) { return d.name })

for (var i = 0; i < fixtures.length; i++) {
  var fdir = dir + '/' + fixtures[i]
  var source = readFileSync(fdir + '/source.dm', 'utf8')
  var options = existsSync(fdir + '/options.json') ? JSON.parse(readFileSync(fdir + '/options.json', 'utf8')) : {}
  var sl = D.seedlikes_from_string(source)
  var names = Object.keys(sl)

  if (existsSync(fdir + '/render.txt')) {
    var rendered = names.length === 1 ? render_space(names[0], sl[names[0]], options) : render_all(sl, options)
    writeFileSync(fdir + '/render.txt', rendered)
  }

  if (existsSync(fdir + '/extract.json')) {
    var extracts
    if (names.length === 1) extracts = extract(names[0], sl[names[0]])
    else {
      extracts = {}
      for (var ni = 0; ni < names.length; ni++)
        extracts[names[ni]] = extract(names[ni], sl[names[ni]])
    }
    writeFileSync(fdir + '/extract.json', JSON.stringify(extracts, null, 2))
  }

  if (existsSync(fdir + '/layout.json')) {
    var laid
    if (names.length === 1) laid = layout(extract(names[0], sl[names[0]]), options)
    else {
      laid = {}
      for (var ni = 0; ni < names.length; ni++)
        laid[names[ni]] = layout(extract(names[ni], sl[names[ni]]), options)
    }
    writeFileSync(fdir + '/layout.json', JSON.stringify(laid, null, 2))
  }

  console.log('updated ' + fixtures[i])
}
