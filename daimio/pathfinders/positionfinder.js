import D from '../1_daimio.js'

D.import_pathfinder('position', {
  keymatch: function(key) {
    if( (typeof key == 'string') && /#-?\d/.test(key) )
      return 'one'
  },
  gather: function(value, key) {
    var safe_value = (typeof value == 'object') ? value : [value]
      , vkeys = Object.keys(safe_value)
      , position = +key.slice(1)
      , index = (position < 0) ? (vkeys.length + position) : position - 1
      , output = safe_value[ vkeys[ index ] ]

    return output ? [output] : []
  },
  create: function(value, key) {
    var vkeys = Object.keys(value)
      , position = +key.slice(1)
      , index = (position < 0) ? (vkeys.length + position) : position - 1

    if(index < 0 || index >= vkeys.length)
      return []

    if(typeof value[ vkeys[ index ] ] != 'object')
      value[ vkeys[ index ] ] = []

    return [ value[ vkeys[ index ] ] ]
  },
  set: function(value, key, new_val) {
    var vkeys = Object.keys(value)
      , position = +key.slice(1)
      , index = (position < 0) ? (vkeys.length + position) : position - 1

    if(index >= 0 && index < vkeys.length)
      value[ vkeys[ index ] ] = new_val
  }
})
