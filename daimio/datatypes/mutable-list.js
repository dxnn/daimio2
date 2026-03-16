import D from '../1_daimio.js'
// THINK: this is only used in `list remove`, but it's a useful place to put the deep copy -- maybe we should change the name, though, so it doesnt't sound like it's going to mutate things: it prevents mutation!
D.import_type('mutable-list', function(value) {
  if(value && typeof value === 'object')
    return D.shallow_copy(value.type == 'Block' ? [value] : value)
  return D.shallow_copy(D.to_array(value))
})
