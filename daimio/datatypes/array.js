import D from '../1_daimio.js'
D.import_type('array', function(value) { // ugh...
  return D.to_array(value)
})

