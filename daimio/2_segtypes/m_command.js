import D from '../1_daimio.js'
~function() {

  // HELPER FUNS

  function build_paramlist(segment, method, inputs) {
    var piped  = false
    var typefun
    var paramlist = []

    for(var index in method.params) {                                   // build paramlist from inputs and typefuns
      var method_param = method.params[index]
      // var param_value = undefined
      var key = method_param.key
      var name_index = segment.value.names.indexOf(key)
      var paramlist_obj = {key: -1}

      if(name_index != -1) {
        paramlist_obj.key = name_index
        // param_value = inputs[name_index]
      }

      if( !piped
       && ( paramlist_obj.key === -1
         || inputs[paramlist_obj.key] === null ) ) {                    // make map of names to inputs
        name_index = segment.value.names.indexOf('__pipe__')
        piped = true
        if(name_index != -1) {
          paramlist_obj.key = name_index
          // param_value = inputs[name_index]
        }

        // ok, so. if the alias has a dangling param, and we snip it, then we map name to a different place.
        // that's not good, because if we run this again we might have that value the next time,
        // and we'll need to remap the inputs all over again. yuck yuck stupid stupid.
        //

      }

      if(method_param.type && D.Types[method_param.type])               // make map of names to types+wrapper
        paramlist_obj.typefun = D.Types[method_param.type]
      else
        paramlist_obj.typefun = D.Types.anything

      if(method_param.allow) paramlist_obj.allow = method_param.allow
      if(method_param.deny)  paramlist_obj.deny  = method_param.deny
      paramlist_obj.name = method_param.key

      if(paramlist_obj.key == -1) {
        // if(param_value !== undefined) {
          // param_value = typefun(param_value)
        // }
        if(method_param.fallback) {
          paramlist_obj.value = paramlist_obj.typefun(method_param.fallback)
          // param_value = typefun(method_param.fallback)
        }
        else if(method_param.required) {
          if(!segment.errors)
            segment.errors = []
          var error = 'Missing required parameter "' + method_param.key
                    + '" for command "' + segment.value.handler
                    + " " + segment.value.method + '"'
          segment.errors.push(error)
          // param_value = typefun(undefined)
          paramlist_obj.value = paramlist_obj.typefun(undefined)
        }
        else if(!method_param.undefined) {
          // param_value = typefun(undefined)
          paramlist_obj.value = paramlist_obj.typefun(undefined)
        }
      }

      // params.push(param_value)
      paramlist.push(paramlist_obj)
    }

    return paramlist
  }

  function check_constraint(pval, pfunk) {
    if(!pfunk.allow && !pfunk.deny) return true

    var allowed = pfunk.allow
    if(allowed && pfunk.deny)
      allowed = allowed.filter(function(v) { return pfunk.deny.indexOf(v) === -1 })

    if(allowed) return allowed.indexOf(pval) !== -1
    return pfunk.deny.indexOf(pval) === -1                          // deny only
  }

  function prep_params(paramlist, inputs) {
    var params = []
    for(var i=0, l=paramlist.length; i < l; i++) {
      var pfunk = paramlist[i]
      var pval  = pfunk.key == -1
                ? pfunk.value
                : pfunk.typefun(inputs[pfunk.key])                  // we have to do this part at runtime

      if(!check_constraint(pval, pfunk)) {
        D.sploot('Value "' + pval + '" not allowed for parameter "' + pfunk.name + '"')
        return false
      }

      params.push(pval)
    }
    return params
  }

  function glob_match(pattern, name) {
    var ps = pattern.split(':'), ns = name.split(':')
    if(ps.length != ns.length) return false
    for(var i=0, l=ps.length; i < l; i++)
      if(ps[i] != '*' && ps[i] != ns[i]) return false
    return true
  }

  function more_specific(a, b) {                                    // literal beats *, left-to-right
    var as = a.split(':'), bs = b.split(':')                        // [wiring-most-specific]
    for(var i=0, l=as.length; i < l; i++) {
      if(as[i] != '*' && bs[i] == '*') return true
      if(as[i] == '*' && bs[i] != '*') return false
    }
    return false
  }

  function match_rule(space, holder_key, holder_index, cmdname) {
    var rules = space.seed.rules || []
      , best = null
    for(var i=0, l=rules.length; i < l; i++) {
      var rule = rules[i]
      if(rule[holder_key] != holder_index) continue
      if(!glob_match(rule.pattern, cmdname)) continue
      if(!best || more_specific(rule.pattern, best.pattern)) best = rule
    }
    return best
  }

  function boundary_rule(space, cmdname) {                          // the request surfaces at space's boundary:
    var parent = space.parent                                       // the parent's rules govern it, holder = space
    if(!parent) return null
    var index = parent.subspaces.indexOf(space) + 1                 // 1-indexed, matches compile numbering
    if(!index) return null
    return match_rule(parent, 'holder_space', index, cmdname)
  }

  function run_effect(segment, inputs, prior_starter, process) {
    var effect  = segment.method.effect
      , cmdname = effect.portType.slice(4)                          // 'cmd:time:now' -> 'time:now' [cmd-name-encode]
      , space   = process.space
      , rule    = process.station_id
              ? match_rule(space, 'holder_station', process.station_id, cmdname)
              : null
      , rule_space = space
      , chain_timeouts = []                                         // explicit timeouts along the walked chain

    if(!rule) {                                                     // unmatched in my own space: surface at my boundary
      rule = boundary_rule(rule_space, cmdname)
      if(rule) rule_space = rule_space.parent
    }
    if(rule && rule.timeout) chain_timeouts.push(rule.timeout)

    while(rule && rule.forward && rule_space.parent) {              // explicit @cmd forwarding surfaces the request
      rule = boundary_rule(rule_space, cmdname)                     // at the matching space's own boundary [cmd-forward]
      if(rule && rule.timeout) chain_timeouts.push(rule.timeout)
      if(rule) rule_space = rule_space.parent
    }

    if(!rule || rule.forward)                                       // no wiring anywhere along the chain —
      return D.sploot('Unwired effectful command "'              // sploot to empty
                      + segment.value.handler + ' '                // [effectful-unwired-sploot]
                      + segment.value.method + '"')

    var params = prep_params(segment.paramlist, inputs)
    if(params === false) return ""

    var request = { handler: segment.value.handler                  // [effcmd-request-val]
                  , method:  segment.value.method }
    for(var i=0, l=segment.method.params.length; i < l; i++)
      request[segment.method.params[i].key] = params[i]

    var answered = false                                            // the transient cmd port lives exactly as long
    var respond_once = function(value) {                            // as one request [cmd-transient]: first response
      if(answered)                                                  // resumes, the rest ghost [P-singleresponse]
        return D.sploot('Ghost ship: late response for ' + effect.portType)
      answered = true
      prior_starter(value)
    }

    // A response that crossed a port re-docks the held process by the entry
    // rule [sched-reentry-uniform]: its number becomes max(space counter,
    // response number) + 1 and the counter follows. A world/App/timeout
    // response carries no number and enters at the boundary frontier
    // [sched-entry-frontier]. Station-target rule responses stay flat
    // (same-space sub-process, no port crossing).
    var respond_redock = function(value, resp_number) {
      if(answered)
        return D.sploot('Ghost ship: late response for ' + effect.portType)
      if(resp_number === undefined) resp_number = space.root_frontier()
      process.number = Math.max(space.counter || 0, resp_number) + 1
      space.counter = process.number
      space.raise_frontier(process.number)
      respond_once(value)
    }

    // every request gets a deadline: the MIN of the explicit timeouts
    // along the walked rule chain — an unset hop inherits the nearest
    // enclosing explicit value [timeout-inherit], and no outer value can
    // extend an inner one [timeout-min-chain] — else the instance default
    // [wiring-default-timeout]. When it fires unanswered, the waiting
    // process resumes EMPTY [timeout-resume-empty] and any later response
    // ghosts against the answered flag [timeout-ghost-drop].
    D.register_timeout(D.now() + (chain_timeouts.length
                                  ? Math.min.apply(null, chain_timeouts)
                                  : D.Etc.default_timeout), function() {
      if(answered) return
      D.sploot('Request timed out: ' + effect.portType)
      respond_redock('')                                            // a timeout firing is an external event: it
    })                                                              // enters at the frontier [sched-entry-frontier]

    if(rule.target_port) {                                          // port target: request exits, response re-enters
      var port = rule_space.ports[rule.target_port - 1]

      if(port.pair && port.pair.space) {                            // paired space port (sibling up-port / boundary
        port.enter(request, { sender: process.sender                // down chain): occupy it, with the invoking
                            , number: process.number                // transient cmd port as the return address
                            , respond: respond_redock })            // [wiring-target-upport]
        return NaN
      }

      if(typeof port.sync === 'function')                           // world ports: sync with callback;
        port.sync(request, respond_redock)                          // sync defaults only onto down flavours
      else
        D.port_standard_sync.call(port, request, respond_redock)
      return NaN
    }

    // station target: its _out value is the contract response
    // [wiring-target-station] [station-contract-out]
    var in_port = rule_space.ports[rule.target_in - 1]
      , block   = D.BLOCKS[rule_space.seed.stations[in_port.station - 1]]

    if(rule_space === space) {                                      // same space: the requester holds it, so the
      var sub = new D.Process(space, block, {'__in': request},      // target runs as a direct sub-process, sharing
                              respond_once, in_port.station,        // the requester's number (flat numbering)
                              process.sender, process.number)
      var value = sub.run()
      if(value === value) {
        answered = true                                             // sync round trip: the deadline must not re-fire it
        return value                                                // fully synchronous round-trip
      }
      return NaN                                                    // sub went async; respond_once resumes us
    }

    var pvalue = rule_space.execute(block, {'__in': request},       // ancestor space: normal serial execution —
                                    respond_once, in_port.station,  // queues if busy [serial-one-at-a-time]
                                    process.sender, process.number)
    if(pvalue === pvalue) {
      answered = true                                               // sync round trip: the deadline must not re-fire it
      return pvalue                                                 // ancestor was idle; synchronous round-trip
    }

    return NaN                                                      // queued or async; respond_once resumes us
  }

  function run_fun(segment, inputs, prior_starter, process) {
    if(segment.errors) {
      segment.errors.forEach(function(error) {D.sploot(error)})
      return ""                                                     // THINK: maybe {} or {noop: true} or something
    }                                                               // so false flows through instead of previous value

    if(segment.method.effect)                                       // effectful commands have no fun: route the
      return run_effect(segment, inputs, prior_starter, process)    // request through the wiring rules

    var params = prep_params(segment.paramlist, inputs)
    if(params === false) return ""
    params.push(prior_starter)
    params.push(process)
    return segment.method.fun.apply(
             segment.handler,
             params)
  }

  // MAIN STUFF

  D.SegmentTypes.Command = {
    try_lex: function(string) {
      if(!/[a-z]/.test(string[0]))                                  // TODO: move all regexs into D.Constants
        return string

      return new D.Token('Command', string)
    }
  , munge_tokens: function(L, token, R) {
      if(token.done)
        return [L.concat(token), R]

      var items = D.Parser.split_on_space(token.value)
        , new_tokens = []

      token.names = token.names || []
      token.inputs = token.inputs || []

      if(items.length == 1) {                                       // {math}
        token.type = 'Alias'
        token.value = {word: items[0]}
        items = []
      }

      else if(items.length == 2) {
        if(/^[a-z]/.test(items[1])) {                               // {math add}
          token.type = 'Command'
          token.value = {handler: items[0], method: items[1]}
        }
        else {                                                      // {add 1}
          token.type = 'Alias'
          token.value = {word: items[0]}
          token.names.push('__alias__')

          var value = items[1]
            , some_tokens = D.Parser.strings_to_tokens(value)
            , some_token = some_tokens[some_tokens.length - 1] || {}

          token.inputs.push(some_token.key || null)
          new_tokens = new_tokens.concat(some_tokens)
        }

        items = []
      }

      else if(!/^[a-z]/.test(items[1])) {                           // {add 1 to 3}
        token.type = 'Alias'
        token.value = {word: items[0]}
        items[0] = '__alias__'
      }
      else if(!/^[a-z]/.test(items[2])) {                           // {add to 1}
        token.type = 'Alias'
        token.value = {word: items[0]}
        items.shift()                                               // OPT: these shifts are probably slow...
      }
      else {                                                        // {math add value 1}
        token.type = 'Command'
        token.value = { handler: items.shift()
                      , method: items.shift()}                      // collect H & M
      }

      while(items.length) {                                         // collect params
        var word = items.shift()

        if(!/^[a-z]/.test(word) && word != '__alias__') {           // ugh derp
          D.sploot('Invalid parameter name "' + word
                   + '" for "' + JSON.stringify(token.value)
                   + '"')
          if(items.length)
            items.shift()
          continue
        }

        if(!items.length) {                                         // THINK: ???
          token.names.push(word)
          token.inputs.push(null)
          continue
        }

        var value = items.shift()
          , some_tokens = D.Parser.strings_to_tokens(value)
          , some_token = some_tokens[some_tokens.length - 1] || {}

        token.names.push(word)
        token.inputs.push(some_token.key || null)
        new_tokens = new_tokens.concat(some_tokens)
      }

      for(var i=0, l=new_tokens.length; i < l; i++) {
        if(!new_tokens[i].prevkey)
          new_tokens[i].prevkey = token.prevkey
      }

      token.done = true

      return [L, new_tokens.concat(token, R)]                       // aliases need to be reconverted even
    }                                                               // if there's no new tokens
  , token_to_segments: function(token) {
      token.value.names = token.names
      return [new D.Segment(token.type, token.value, token)]        // TODO: suck out any remaining null params here
    }
  , execute: function(segment, inputs, dialect, prior_starter, process) {
      var did = dialect.did
      var dc = segment._dcache && segment._dcache[did]

      if(dc) {
        segment.handler   = dc.handler
        segment.method    = dc.method
        segment.paramlist = dc.paramlist
        segment.errors    = dc.errors
        return run_fun(segment, inputs, prior_starter, process)
      }

      segment.errors = null
      segment.handler = dialect.get_handler(segment.value.handler)
      segment.method  = dialect.get_method( segment.value.handler
                                          , segment.value.method )

      if(!segment.method) {
        var error = 'You have failed to provide an adequate method: '
              + segment.value.handler + ' ' + segment.value.method
        D.sploot(error)
        segment.errors = [error]

        if(!segment._dcache) segment._dcache = {}
        segment._dcache[did] = {handler: segment.handler, method: null, paramlist: null, errors: segment.errors}

        return ""                                                   // THINK: maybe {} or {noop: true} or something
      }                                                             // so false flows through instead of previous value

      // if we have to rerun this, cancel the paramlist.
      // we'll know we have to rerun it if the 'null' input elements are different.

      // we need to think more about the differences between
      // {9 | range _asdf} and {9 | range $asdf}
      // because if we change that then this problem goes away.

      // if(paramlist) {
      //   if(paramlist.length != segment.nulls.length)
      //     paramlist = false
      //   else
      //     for(var i=0, l=paramlist.length; i < l; i++) {
      //       if(paramlist[i] == null != segment.nulls[i])
      //         paramlist = false, break
      //     }
      // }


      segment.paramlist = build_paramlist(segment, segment.method, inputs)

      if(!segment._dcache) segment._dcache = {}
      segment._dcache[did] = {
        handler: segment.handler, method: segment.method,
        paramlist: segment.paramlist, errors: segment.errors
      }

      return run_fun(segment, inputs, prior_starter, process)
    }
  }
}();
