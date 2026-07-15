import D from '../1_daimio.js'

D.import_pathfinder('position', {
  keymatch: function(key) {
    if( (typeof key == 'string') && /#-?\d/.test(key) )
      return 'one'
  },
  gather: function(value, key) {
    if(!value || typeof value != 'object' || D.is_block(value))
      return []                                 // no scalar wrapping [peek-scalar]

    var vkeys = Object.keys(value)
      , position = +key.slice(1)
      , index = (position < 0) ? (vkeys.length + position) : position - 1

    if(position === 0) {                        // #0 is malformed, not a miss [pos-zero-invalid]
      D.on_error('Malformed selector "' + key + '"')
      return []                                 // read sploots: soft error + empty
    }

    var output = value[ vkeys[ index ] ]
    return output !== undefined ? [output] : [] // falsy elements still hit [peek-pos-hit]
  },
  create: function(value, key) {
    var vkeys = Object.keys(value)
      , position = +key.slice(1)
      , index = (position < 0) ? (vkeys.length + position) : position - 1

    if(position === 0) {                        // #0 is malformed [pos-zero-invalid]
      D.on_error('Malformed selector "' + key + '"')
      return []
    }

    if(index < 0 || index >= vkeys.length)
      return []

    return [ value[ vkeys[ index ] ] ]
  },
  set: function(value, key, new_val) {
    var vkeys = Object.keys(value)
      , position = +key.slice(1)
      , index = (position < 0) ? (vkeys.length + position) : position - 1

    if(position === 0) {                        // #0 is malformed [pos-zero-invalid]
      D.on_error('Malformed selector "' + key + '"')
      return                                    // write sploots: soft error + unchanged
    }

    if(index >= 0 && index < vkeys.length)
      value[ vkeys[ index ] ] = new_val
  }
})
