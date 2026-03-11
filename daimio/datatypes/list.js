import D from '../1_daimio.js'
D.import_type('list', function(value) {
  if(value && typeof value === 'object')
    return value.type == 'Block' ? [] : value
  return D.to_array(value)
})

