import D from '../daimio/daimio.js'
import { render_space, render_all } from '../site/js/space_ascii.js'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'

var dir = 'tests/space_ascii'
var fixtures = readdirSync(dir, { withFileTypes: true }).filter(function(d) { return d.isDirectory() }).map(function(d) { return d.name })

for (var i = 0; i < fixtures.length; i++) {
  var fdir = dir + '/' + fixtures[i]
  if (!existsSync(fdir + '/render.txt')) continue
  var source = readFileSync(fdir + '/source.dm', 'utf8')
  var options = existsSync(fdir + '/options.json') ? JSON.parse(readFileSync(fdir + '/options.json', 'utf8')) : {}
  var sl = D.seedlikes_from_string(source)
  var names = Object.keys(sl)
  var rendered = names.length === 1 ? render_space(names[0], sl[names[0]], options) : render_all(sl, options)
  writeFileSync(fdir + '/render.txt', rendered)
  console.log('updated ' + fixtures[i])
}
