import D from '../1_daimio.js'

D.import_type('anything', function(value) {
  return D.make_nice(value) // THINK: what about blocks?
})

