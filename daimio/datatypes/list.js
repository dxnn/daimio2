import D from '../1_daimio.js'
D.import_type('list', function(value) {
  if(value && typeof value === 'object')
    return value.type == 'Block' ? [] : value
  if(value === '') return []                    // Empty coerces to [] in list context
  return D.to_array(value)
})

