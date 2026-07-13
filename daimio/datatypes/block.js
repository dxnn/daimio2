import D from '../1_daimio.js'
D.import_type('block', function(value) {
  if(D.is_block(value)) {
    // value is a block ref...
    return function(prior_starter, scope, process) {
      // TODO: check value.value.id first, because it might not be in ABLOCKS
      // TODO: how does this fit with parent processes and parallelization?
      var space = process ? process.space : D.ExecutionSpace
        , station_id = process ? process.station_id : false

      // Block-eval recursion bound: past the outer space's depth_bound, the
      // innermost eval sploots to Empty (total, value-producing) instead of
      // nesting further [depth-bound-instance] [depth-nesting-only]. eval_depth
      // tracks synchronous block-eval nesting per space (async re-entries reset
      // it — they cannot stack-overflow).
      if((space.eval_depth || 0) >= space.depth_bound)
        return D.set_error('Recursion depth bound (' + space.depth_bound + ') exceeded')

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

      space.eval_depth = (space.eval_depth || 0) + 1
      try {
        return space.real_execute(D.BLOCKS[value.value.id], inherited, prior_starter, station_id, process && process.sender, process && process.number)
      } finally {
        space.eval_depth--
      }
    }
  }
  else {
    return function() {
      return value
      // return D.stringify(value) // strings just fire away // THINK: why were we stringifying here?
    }
  }
})

