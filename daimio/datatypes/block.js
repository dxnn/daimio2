import D from '../1_daimio.js'
D.import_type('block', function(value) {
  if(D.is_block(value)) {
    // value is a block ref...
    return function(prior_starter, scope, process) {
      // TODO: check value.value.id first, because it might not be in ABLOCKS
      // TODO: how does this fit with parent processes and parallelization?
      var space = process ? process.space : D.ExecutionSpace
        , station_id = process ? process.station_id : false

      var inherited = {}
      if(process && process.state) {
        for(var key in process.state)
          if(+key != +key)                                   // copy named keys, skip numeric indices
            inherited[key] = process.state[key]
      }
      if(process && process.pipeline_vars) {                 // pipeline vars stored separately from wiring refs
        for(var key in process.pipeline_vars)
          inherited[key] = process.pipeline_vars[key]
      }
      for(var key in scope)                                  // caller scope overrides
        inherited[key] = scope[key]

      if(process && process.state && process.state.secret) { // FIXME: this seems really quite silly
        inherited.parent_process = process
        inherited.secret = process.state.secret
      }
      return space.real_execute(D.BLOCKS[value.value.id], inherited, prior_starter, station_id, process && process.actor)
    }
  }
  else {
    return function() {
      return value
      // return D.stringify(value) // strings just fire away // THINK: why were we stringifying here?
    }
  }
})

