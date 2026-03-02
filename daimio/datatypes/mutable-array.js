import D from '../1_daimio.js'
D.import_type('mutable-array', function(value) { // ugh...
  return D.shallow_copy(D.to_array(value))
})

