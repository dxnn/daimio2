/*

            _            _                    _         _   _          _          _
          /\ \         / /\                 /\ \      /\_\/\_\ _     /\ \       /\ \
         /  \ \____   / /  \                \ \ \    / / / / //\_\   \ \ \     /  \ \
        / /\ \_____\ / / /\ \               /\ \_\  /\ \/ \ \/ / /   /\ \_\   / /\ \ \
       / / /\/___  // / /\ \ \             / /\/_/ /  \____\__/ /   / /\/_/  / / /\ \ \
      / / /   / / // / /  \ \ \           / / /   / /\/________/   / / /    / / /  \ \_\
     / / /   / / // / /___/ /\ \         / / /   / / /\/_// / /   / / /    / / /   / / /
    / / /   / / // / /_____/ /\ \       / / /   / / /    / / /   / / /    / / /   / / /
    \ \ \__/ / // /_________/\ \ \  ___/ / /__ / / /    / / /___/ / /__  / / /___/ / /
     \ \___\/ // / /_       __\ \_\/\__\/_/___\\/_/    / / //\__\/_/___\/ / /____\/ /
      \/_____/ \_\___\     /____/_/\/_________/        \/_/ \/_________/\/_________/



    Hi, welcome to Daimio!

    As you make your way through the code you'll often
    see comments like this one. You should read them,
    because they're helpful and occasionally funny!


    Naming conventions:
    D.import_commands   <--- snake_case for functions and constants
    D.SegmentTypes      <--- CamelCase for built-in objects
    D.SPACESEEDS        <--- ALLCAPS for runtime containers

*/

import murmurhash from './lib/murmurhash.js'

var D = {}                            // this is where the magic happens
var _hop = D._hop = Object.prototype.hasOwnProperty

D.BLOCKS = {}
D.DIALECTS = {}
D.SPACESEEDS = {}
D.DECORATORS = []

D.DecoratorIndices = {}               // technically these should be all caps,
D.DecoratorIndices.ByType = {}        // but it's just too much yelling really
D.DecoratorIndices.ByBlock = {}
D.DecoratorIndices.ByTypeBlock = {}

D.Aliases = {}                        // aliases are a grey area:
D.AliasMap = {}                       // one day they may be able to grow at runtime

D.Etc = {}
D.Types = {}
D.Parser = {}
D.Fancies = {}
D.Commands = {}
D.Terminators = {}
D.Pathfinders = []                    // one of these things is not like the others
D.SegmentTypes = {}
D.PortFlavours = {}

D.Constants = {}                      // constants fry, constants fry, any time at all
D.Constants.command_open = '{'
D.Constants.command_closed = '}'
D.Constants.list_open = '('           // currently unused
D.Constants.list_closed = ')'         // currently unused
D.Constants.quote = '"'               // currently unused

D.Etc.process_counter = 1             // this is a bit silly
D.Etc.token_counter = 100000          // FIXME: make Rekey work even with overlapping keys
D.Etc.max_range_length = 1000000      // you can change this in your app

// The single wall-clock source. Effectful time reads route through it so the
// Outside (or a deterministic test runner) can override "now" with a fixed
// value. Returns epoch milliseconds.
D.now = function() { return Date.now() }

D.Etc.FancyRegex = ""                 // this is also pretty silly
D.Etc.Tglyphs = ""                    // and this one too

D.Etc.OptimizationMap = {}            // technically allcaps here too
D.Etc.use_optimizations = 1           // you can change this in your app


  /*ooo   ooooo oooooooooooo ooooo        ooooooooo.   oooooooooooo ooooooooo.    .oooooo..o
  `888'   `888' `888'     `8 `888'        `888   `Y88. `888'     `8 `888   `Y88. d8P'    `Y8
   888     888   888          888          888   .d88'  888          888   .d88' Y88bo.
   888ooooo888   888oooo8     888          888ooo88P'   888oooo8     888ooo88P'   `"Y8888o.
   888     888   888    "     888          888          888    "     888`88b.         `"Y88b
   888     888   888       o  888       o  888          888       o  888  `88b.  oo     .d8P
  o888o   o888o o888ooooood8 o888ooooood8 o888o        o888ooooood8 o888o  o888o 8""88888*/



D.noop     = function() {}
D.identity = function(x) {return x}
D.concat   = function(a,b) {return a.concat(b)}

D.sploot = function(error) {
  // use this to set simple errors
  // a sploot is a soft error: routes to the space's @err port if present,
  // else a silent no-op; runtime totality preserved. Returns "".
  return D.on_error('', error)
}

D.bork = function(message) {
  // a bork is a hard error: a malformed space definition fails to compile
  // and no spaceseed is created [spacedef-hard-error]. Compile-time only.
  // Tagged `is_bork` so a catch site can tell an intended bork from an
  // unexpected JS crash structurally, without matching on the message.
  var error = new Error(message)
  error.is_bork = true
  throw error
}

D.on_error = function(command, error) {
  // Route to the space's error port if available; silent no-op otherwise.
  // The runtime matches by NAME — 'out:err' (spec §4 [err-match-by-name]),
  // with the legacy bare 'err' name/flavour still honored.
  var space = D.Etc.active_space
  if(space && !D.Etc.routing_error) {
    D.Etc.routing_error = true                  // an error during delivery must not recurse
    try {
      for(var i = 0, l = space.ports.length; i < l; i++) { // OPT: this is a slow way to find a port...
        var port = space.ports[i]
        if((port.name === 'out:err' || port.name === 'err' || port.flavour === 'err') && !port.station) {
          port.enter(error || command, D.Etc.active_process || null)  // enter → pair.exit → outside_exit
          break
        }
      }
    } finally { D.Etc.routing_error = false }
  }

  return ""
}

D.make_nice = function(value, otherwise) {
  return D.is_nice(value) ? value : (otherwise || '')
}

D.to_array = function(value) { // DATA
  // this converts non-iterable items into a single-element array
  if(D.is_block(value))         return []
  if(Array.isArray(value))      return value
  if(typeof value == 'object')  return D.obj_to_array(value)
  if(value === false)           return []                     // hmmm...
  if(!D.is_nice(value))         return []                     // double hmmm.
                                return [value]

  // if(D.is_block(value))         return new D.Data([])
  // if(Array.isArray(value))      return new D.Data(value)
  // if(typeof value == 'object')  return new D.Data(D.obj_to_array(value))
  // if(value === false)           return new D.Data([])                     // hmmm...
  // if(!D.is_nice(value))         return new D.Data([])                     // double hmmm.
  //                               return new D.Data([value])
}

D.obj_to_array = function(obj) { // DATA
  var arr = []
  for(var key in obj)
    arr.push(obj[key])
  return arr
}

D.sort_object_keys = function(obj, sorter) { // DATA
  if(typeof obj != 'object')
    return {}

  var newobj = {}
    , keys = Object.keys(obj).sort(sorter)

  for(var i=0, l=keys.length; i < l; i++)
    newobj[keys[i]] = obj[keys[i]]

  return newobj
}

D.blockify = function(value) {
  return D.Types['block'](value)
}

D.stringify = function(value) {
  return D.Types['string'](value)
}

D.execute_then_stringify = function(value, prior_starter, process) {
  if(D.is_block(value)) {
    return D.blockify(value)(prior_starter, {}, process)
  } else {
    return D.stringify(value)
  }
}

D.is_false = function(value) {
  if(!value)
    return true                                 // '', 0, false, NaN, null, undefined

  if(typeof value != 'object')
    return false                                // THINK: is this always right?

  if(Array.isArray(value))
    return !value.length

  if(!D.is_empty(value))
    return false

  return true
}

D.is_empty = function(value) {
  for(var key in value)
    if(_hop.call(value, key))
      return false

  return true
}

D.is_nice = function(value) {
  return value || value == false                // not NaN, null, or undefined
}

D.is_segment = function(value) {
  return value instanceof D.Segment
}

D.is_block = function(value) {
  if(!D.is_segment(value))                      // THINK: this prevents block hijacking (by making an object shaped
    return false                                // like a block), but requires us to e.g. convert all incoming
                                                // JSONified block segments to real segments.
  return value && value.type == 'Block'
      && value.value && value.value.id          // THINK: why do we need this?
}

D.is_numeric = function(value) {
  return (typeof(value) === 'number' || typeof(value) === 'string') && value !== '' && !isNaN(value)
}

D.to_numeric = function(value) {
  if(value === '0') return 0
  if(typeof value == 'number') return value
  if(typeof value == 'string') return +value ? +value : 0
  return 0
}

D.is_banned_key = function(key) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

D.is_regex = function(str) {
  var regex_regex = /^\/.+?\/(g|i|gi|m|gm|im|gim)?$/
  return regex_regex.test(str)
}

D.regex_escape = function(str) {
  var specials = /[.*+?|()\[\]{}\\$^]/g         // .*+?|()[]{}\$^
  return str.replace(specials, "\\$&")
}

D.string_to_regex = function(string, global) {
  if(!D.is_regex(string))
    return RegExp(D.regex_escape(string), (global ? 'g' : ''))

  var flags = string.slice(string.lastIndexOf('/') + 1)
  string = string.slice(1, string.lastIndexOf('/'))

  return RegExp(string, flags)
}

D.safe_string_to_regex = function(string, global, process) {
  if(process && process.space && process.space.dialect
  && process.space.dialect.policy && process.space.dialect.policy.no_user_regex
  && D.is_regex(string)) {
    D.sploot('User-supplied regex patterns are not allowed in restricted mode')
    return RegExp(D.regex_escape(string), (global ? 'g' : ''))
  }
  return D.string_to_regex(string, global)
}

D.shallow_copy = function(value) {
  if(Array.isArray(value))
    return value.slice()
  return JSON.parse(JSON.stringify(value))      // NOTE: only for scrubbed values!
}

D.get_unique_symbol = function() {
  return D.Etc.unique_counter = ++D.Etc.unique_counter || 0
}



D.clone = function(value) {
  if(value && value.toJSON)                     // THINK: for blocks?
    return D.deep_copy(value)

  try {
    return JSON.parse(JSON.stringify(value))
  } catch (e) {
    return D.deep_copy(value)
  }
}

D.deep_copy = function(value) {
  // deep copy an internal variable (primitives and blocks only)
  if(!value || typeof value != 'object')  return value  // number, string, or boolean
  if(D.is_block(value))                   return value  // blocks are immutable, so pass-by-ref is ok.
                                          return D.recursive_leaves_copy(value, D.deep_copy)
}

D.recursive_leaves_copy = function(values, fun, seen) {
  // apply a function to every leaf of a tree, but generate a new copy of it as we go
  // THINK: only used by D.deep_copy, which we maybe don't need anymore
  if(!values || typeof values != 'object') return fun(values);

  seen = seen || []; // only YOU can prevent infinite recursion...
  if(seen.indexOf(values) !== -1) return values;
  seen.push(values);

  var new_values = (Array.isArray(values) ? [] : {}); // NOTE: using new_values in the parse phase (rebuilding the object each time we hit this function) causes an order-of-magnitude slowdown. zoiks, indeed.

  for(var key in values) {
    // try { // NOTE: accessing e.g. input.selectionDirection throws an error, which is super-duper lame
      // FIXME: with 'try' this reliably crashes chrome when called in the above instance. ={
      var val = values[key]
      // this is only called from toPrimitive and deep_copy, which both want blocks
      if(D.is_block(val)) {
        new_values[key] = fun(val); // blocks are immutable
      } else if(D.is_segment(val)) {
        new_values[key] = new D.Segment(val.type, val.value, val)
      } else if(typeof val == 'object') {
        new_values[key] = D.recursive_leaves_copy(val, fun, seen);
      } else {
        new_values[key] = fun(val);
      }
    // } catch(e) {D.on_error(e)}
  }

  return new_values;
};


D.extend = function(base, value) {
  // NOTE: this extends by reference, but also returns the new value
  for(var key in value) {
    if(!_hop.call(value, key)) continue
    if(D.is_banned_key(key)) continue
    base[key] = value[key]
  }
  return base
}

D.recursive_extend = function(base, value) {
  // NOTE: this extends by reference, but also returns the new value
  for(var key in value) {
    if(!_hop.call(value, key))    continue
    if(D.is_banned_key(key))      continue

    if(typeof base[key] == 'undefined') {
      base[key] = value[key]
      continue
    }

    if(typeof base[key]  != 'object') continue  // ignore scalars in base
    if(typeof value[key] != 'object') continue  // can't recurse into scalar

    if(Array.isArray(base) && Array.isArray(value)) {
      if(base[key] == value[key])     continue
      base.push(value[key])
      continue // THINK: this bit is pretty specialized for my use case -- can we make it more general?
    }

    D.recursive_extend(base[key], value[key])
  }

  return base
}


D.scrub_var = function(value) {
  // copy and scrub a variable from the outside world

  try {
    // FIREFOX DOESN'T THROW ON DOM OBJECTS
    // THINK: this is getting really sloppy. how can we simplify?
    if(value instanceof Event || value instanceof Node || value instanceof HTMLElement) {
      value = D.mean_defunctionize(value);
      if(value === null) value = false;
      return value;
    }

    return JSON.parse(JSON.stringify(value)); // this style of copying is A) the fastest deep copy on most platforms and B) gets rid of functions, which in this case is good (because we're importing from the outside world) and C) ignores prototypes (also good).  // DATA
  } catch (e) {
    // D.on_error('Your object has circular references'); // this might get thrown a lot... need lower priority warnings
    value = D.mean_defunctionize(value);
    if(value === null) value = false;
    return value;
  }
};

D.mean_defunctionize = function(values, seen) {
  // this trashes funs and snips circular refs
  if(!D.is_nice(values)) return false;
  if(!values) return values;

  if(typeof values == 'function') return null;
  if(typeof values != 'object') return values;            // number, string, or boolean

  var type = values.constructor.toString().split(' ')[1]
  if(type) {
    var sig = type.slice(0,3)                             // prevents DOM yuckyucks. details here:
    if ( sig == "Nod"                                     // https://github.com/dxnn/daimio/issues/1
      || sig == "HTM"                                     // THINK: can this still leak too much info?
      || sig == "win"
      || sig == "Win"
      || sig == "Mim"
      || sig == "DOM" )
         return null
  }

  seen = seen || [];
  if(seen.indexOf(values) !== -1) return null;            // only YOU can prevent infinite recursion
  seen.push(values);

  var new_values = (Array.isArray(values) ? [] : {});

  for(var key in values) {                                // list or hash: lish. lash. hist? hast? grumble.
    var new_value, value = values[key];
    new_value = D.mean_defunctionize(value, seen);
    if(new_value === null) continue;
    new_values[key] = new_value;
  }

  return new_values;
};


D.get_block = function(ablock_or_segment) {
  // this is only used in D.Space.prototype.execute
  if(!ablock_or_segment)
    return new D.Block()
  if(ablock_or_segment.segments)
    return ablock_or_segment
  else if(ablock_or_segment.value && ablock_or_segment.value.id && D.BLOCKS[ablock_or_segment.value.id])
    return D.BLOCKS[ablock_or_segment.value.id]
  else
    return new D.Block()
}


D.data_trampoline = function(data, processfun, joinerfun, prior_starter, finalfun) {
  /*
    This *either* returns a value or calls prior_starter and returns NaN.
    It *always* calls finalfun if it is provided.
    Used in small doses it makes your possibly-async command logic much simpler.
  */

  var keys = Object.keys(data)
  , size = keys.length
  , index = -1
  , result = joinerfun()
  , asynced = false
  , value, key

  // if(typeof finalfun != 'function') {
  //   finalfun = function(x) {return x}
  // }

  finalfun = finalfun || D.identity

  // THINK: can we add a simple short-circuit to this? undefined, maybe? for things like 'first' and 'every' it'll help a lot over big data

  var inner = function() {
    while(++index < size) {
      key = keys[index]
      value = processfun(data[key], my_starter, key, result)
      if(value !== value) {
        asynced = true // we'll need to call prior_starter when we finish up
        return NaN // send stack killer up the chain
        // [unleash the NaNobots|NaNites]
      }
      result = joinerfun(result, value, key)
    }

    if(asynced)
      return prior_starter(finalfun(result))

    return finalfun(result)
  }

  var my_starter = function(value) {
    result = joinerfun(result, value, key)
    inner()
  }

  // might need a fun for sorting object properties...

  return inner()
}

D.string_concat = function(total, value) {
  total = D.make_nice(total)
  value = D.make_nice(value)
  return D.stringify(total) + D.stringify(value)
}

D.list_push = function(total, value) { // DATA
  if(!Array.isArray(total)) return [] // THINK: is this always ok?
  value = D.make_nice(value)
  total.push(value)
  return total
}

D.list_set = function(total, value, key) { // DATA
  if(typeof total != 'object') return {}

  if(!key) key = Object.keys(total).length

  value = D.make_nice(value)

  total[key] = value
  return total
}

D.scrub_list = function(list) {
  var keys = Object.keys(list)

  if(keys.reduce(function(acc, val) {if(acc == val) return acc+1; else return -1}, 0) == -1)
    return list

  return D.to_array(list)
}

D.mungeLR = function(items, fun) {
  // give each item its time in the sun. also, allow other items to be added, removed, reordered or generally mangled
  var L = []
    , R = items
    , item = {}
    , result = []

  if(!items.length) return items

  do {
    item = R.shift() // OPT: shift is slow
    result = fun(L, item, R)
    L = result[0]
    R = result[1]
  } while(R.length)

  return L
}

D.nicify = function(list, state) {
  var result = []
  for(var i=0, l=list.length; i < l; i++) {
    var item = state[list[i]]
    result.push( D.is_nice(item) ? item
               : typeof list[i] === 'string' ? false : null )       // string keys are var refs; undefined vars = false (zero)
  }
  return result
}

D.filter_ports = function(ports, station, name) {
  for(var i=0, l=ports.length; i < l; i++) {
    var port = ports[i]
    if( port.station === station                                    // triple so undefined !== 0
     && port.name    === name )
        return port
  }
}

D.run = function(daimio, space, scope, ultimate_callback, sender) {
  // This is *always* async, so provide a callback.
  if(daimio == null) return ""

  daimio = "" + daimio // TODO: ensure this is a string in a nicer fashion...

  if(typeof space == 'function') {
    ultimate_callback = space
    space = null
  }

  if(typeof ultimate_callback != 'function') {
    if(!space)
      space = ultimate_callback
    ultimate_callback = null
  }

  if(!space) {
    space = D.ExecutionSpace
  }

  if(!ultimate_callback) {
    ultimate_callback = function(result) {
      // THINK: what should we do here?
      console.log(result)
    }
  }

  // THINK: can we refactor this into a different type of space.execute? can we convert this whole thing into a temporary channel on the space? with a 'log' type gateway or something?
  var prior_starter = function(value) {
    var result = D.execute_then_stringify(value, ultimate_callback, {space: space, station_id: false, sender: sender})
    if(result === result)
      ultimate_callback(result)
  }

  var result = space.execute(D.Parser.string_to_block_segment(daimio), scope, prior_starter, null, sender)
  if(result === result)
    prior_starter(result)

  return ""
}




  /*ooo ooo        ooooo ooooooooo.     .oooooo.   ooooooooo.   ooooooooooooo  .oooooo..o
  `888' `88.       .888' `888   `Y88.  d8P'  `Y8b  `888   `Y88. 8'   888   `8 d8P'    `Y8
   888   888b     d'888   888   .d88' 888      888  888   .d88'      888      Y88bo.
   888   8 Y88. .P  888   888ooo88P'  888      888  888ooo88P'       888       `"Y8888o.
   888   8  `888'   888   888         888      888  888`88b.         888           `"Y88b
   888   8    Y     888   888         `88b    d88'  888  `88b.       888      oo     .d8P
  o888o o8o        o888o o888o         `Y8bood8P'  o888o  o888o     o888o     8""88888*/





//    ______  _______ _______  _____   ______ _______ _______  _____   ______ _______
//    |     \ |______ |       |     | |_____/ |_____|    |    |     | |_____/ |______
//    |_____/ |______ |_____  |_____| |    \_ |     |    |    |_____| |    \_ ______|
//


D.add_decorator = function(block_id, type, value, unique) {
  var decorator = { block: block_id
                  , type: type
                  , value: value }
    , existing_decorators

  if(unique) {
    existing_decorators = D.get_decorators(block_id, type)
    if(existing_decorators && existing_decorators.length) {
      return existing_decorators[0]
    }
  }

  if(!D.DecoratorIndices.ByType[type]) {
    D.DecoratorIndices.ByType[type] = []
  }
  if(!D.DecoratorIndices.ByBlock[block_id]) {
    D.DecoratorIndices.ByBlock[block_id] = []
  }
  if(!D.DecoratorIndices.ByTypeBlock[type + '-' + block_id]) {
    D.DecoratorIndices.ByTypeBlock[type + '-' + block_id] = []
  }

  D.DECORATORS.push(decorator)
  D.DecoratorIndices.ByType[type].push(decorator)
  D.DecoratorIndices.ByBlock[block_id].push(decorator)
  D.DecoratorIndices.ByTypeBlock[type + '-' + block_id].push(decorator)

  return decorator
}

D.get_decorators = function(by_block, by_type) {
  var decorators = D.DECORATORS

  if(!by_block) {
    if(by_type) {
      decorators = D.DecoratorIndices.ByType[by_type]
    }
  }
  else {
    if(by_type) {
      decorators = D.DecoratorIndices.ByTypeBlock[by_type + '-' + by_block]
    } else {
      decorators = D.DecoratorIndices.ByBlock[by_block]
    }
  }

  return decorators
}


//     _____   _____   ______ _______ _______
//    |_____] |     | |_____/    |    |______
//    |       |_____| |    \_    |    ______|
//


// A port flavour has a dir [in, out, out/in, in/out (inback outback? up down?)], and dock and add functions


D.track_event = function(type, selector, parent, callback, options) {
  // options contains:
  // 'scrub'    -- a callback to be used instead of the standard value detector
  // 'nochain'  -- a boolean flag that prevents walking the parent chain [YAGNI]
  // 'passthru' -- a boolean flag which causes events to keep their default behavior

/*

  changes:
  - allow 'document' itself as a valid selector
  - allow a 'parent' element (and set the listener on the parent instead of on document)
  - a passthru param that pushes the event back in to the stream and marks it so it isn't caught again
  - a 'scrub' callback to be used instead of the standard value detector


  TODO:
  - test value selector and scrubber
  - test parent setting
  - test passthru

*/

  options = options || {}
  D.Etc.events = D.Etc.events || {}

  if(!D.Etc.events[type]) {
    D.Etc.events[type] = {by_class: {}, by_id: {}}

    parent = parent ? document.getElementById(parent) : document

    parent.addEventListener(type, function(event) {
      var target = event.target
      var particulars
      var cname

      if(event.passthru) return true

      // walk the target.parentNode chain up to null, checking each item along the way until you find one
      // OPT: make walking the parent chain optional (use a port param to ask for it)
      while(!particulars && target) {
        particulars = tracked.by_id[target.id]
        if(particulars) break

        cname = target.className
        if(cname) {
          cname = cname.hasOwnProperty('baseVal') ? cname.baseVal : cname
          cname.split(/\s+/).forEach(function(name) {
            particulars = particulars || tracked.by_class[name] // TODO: take all matches instead of just first
          })
        }

        if(particulars) break
        target = target.parentNode
      }

      if(!particulars) return true

      if(particulars.passthru) {
        event.passthru = true
      } else {
        event.stopPropagation()
        event.preventDefault()
      }

      var value =
          particulars.scrub
        ? particulars.scrub(event, target)
        : D.default_scrub(event, target)

      particulars.callback(value, event)

    }, false)
  }

  var tracked = D.Etc.events[type]
  var particulars = {callback: callback, scrub: options.scrub, passthru: options.passthru}

  if(selector[0] == '.') {
    tracked.by_class[selector.slice(1)] = particulars
  } else {
    tracked.by_id[selector] = particulars
  }
}

D.untrack_event = function(type, target, parent, callback) {
  if(!D.Etc.events)        return false
  if(!D.Etc.events[type])  return false

  var tracked = D.Etc.events[type]
  var obj = target[0] == '.' ? tracked.by_class : tracked.by_id

  if(!obj || !obj[target]) return false
  if(callback && obj[target] != callback) return false

  delete obj[target]
}

D.default_scrub = function(event, target) {
  return target.attributes['data-value']                          // it's easy to read if you think of
       ? target.attributes['data-value'].value                    // this like a quasi-cond statement.

       : target.value != undefined
       ? target.value

       : target.attributes.value
      && target.attributes.value.value

      || target.text
      || D.scrub_var(event)
      || true
}

D.send_value_to_js_port = function(space, port_name, value, port_flavour, sender, number) {
  port_flavour = port_flavour || 'from-js'

  for ( var i=0, l=space.ports.length; i < l; i++)
    if( space.ports[i].name == port_name
     && space.ports[i].flavour == port_flavour )
      { space.ports[i].pair.enter(value, (sender || number !== undefined) ? {sender: sender, number: number} : undefined)
        return true }

  // black-hole out-ports are App entry surfaces too [app-entry-outside-only]:
  // a world value there enters the parent's wiring as a ship, senderless →
  // it takes the out-port's qname [blackhole-out-enter] [blackhole-sender-outer]
  for(var i=0, l=space.subspaces.length; i < l; i++) {
    var sub = space.subspaces[i]
    if(sub.seed && sub.seed.blackhole) {
      for(var j=0, k=sub.ports.length; j < k; j++) {
        var hp = sub.ports[j]
        if((hp.name == port_name || hp.name == 'out:' + port_name)
            && hp.name.split(':')[0] == 'out' && hp.pair) {
          hp.pair.exit(value, { sender: sender || D.entry_sender(hp, hp), number: number })
          return true
        }
      }
    }
    else if(D.send_value_to_js_port(sub, port_name, value, port_flavour, sender, number))
      return true
  }

  return false
}



// ── Deterministic dispatch ───────────────────────────────────────────
// Every deferred ship delivery is keyed (number, wire, seq): number is the
// emitting process's scheduler number (virtual time, carrier metadata like
// sender — never payload [sched-ship-vtime]); wire is the carrying wire's
// declaration ordinal in its space's source (no-wire deliveries sort after
// all wired ones at their number [sched-tie-wire]); seq is a global
// monotone tiebreak that keeps per-wire FIFO [sched-wire-fifo].
// schedule_delivery still defers one D.setImmediate tick per item (the det
// harness counts those for settle), but each tick delivers the LOWEST
// pending item, not the one that scheduled it — so a space docks its
// lowest-numbered pending ship next. [space-queue] [sched-dock-lowest]

// ── Virtual-time timeouts ────────────────────────────────────────────
// A timeout is a clock event [sched-timeout-event]: deadlines register
// here and fire when the clock passes them — deterministically via an
// injected clock advance (the det harness sets D.Etc.wall_timeouts =
// false and drives D.advance_clock itself), or by wall timers in
// production. Due deadlines fire in (deadline, registration) order.
D.Etc.default_timeout = 10000
D.Etc.default_depth_bound = 100        // block-eval recursion bound per outer space (§5/§11)
D.Etc.pending_timeouts = []
D.Etc.timeout_seq = 0
D.Etc.wall_timeouts = true

D.register_timeout = function(deadline, fn) {
  D.Etc.pending_timeouts.push({ deadline: deadline, seq: D.Etc.timeout_seq++, fn: fn })
  if(D.Etc.wall_timeouts && typeof setTimeout == 'function') {
    var t = setTimeout(function() { D.advance_clock() }, Math.max(0, deadline - D.now()) + 1)
    if(t && t.unref) t.unref()                    // never hold a host process open
  }
}

D.advance_clock = function() {
  var now = D.now()
    , due = []
    , rest = []
  D.Etc.pending_timeouts.forEach(function(item) {
    (item.deadline <= now ? due : rest).push(item)
  })
  D.Etc.pending_timeouts = rest
  due.sort(function(a, b) { return a.deadline - b.deadline || a.seq - b.seq })
  due.forEach(function(item) { item.fn() })
}

D.Etc.delivery_heap = []
D.Etc.delivery_seq = 0

var delivery_before = function(a, b) {
  return a.n < b.n
      || (a.n == b.n && (a.w < b.w
      || (a.w == b.w && a.s < b.s)))
}

D.schedule_delivery = function(number, fn, wire_ordinal) {
  var heap = D.Etc.delivery_heap
    , item = {n: number || 0, w: wire_ordinal === undefined ? Infinity : wire_ordinal, s: D.Etc.delivery_seq++, fn: fn}
    , i = heap.length

  heap.push(item)
  while(i > 0) {                                  // sift up
    var p = (i - 1) >> 1
    if(delivery_before(heap[p], item)) break
    heap[i] = heap[p]
    i = p
  }
  heap[i] = item

  D.setImmediate(D.deliver_next)
}

D.deliver_next = function() {
  var heap = D.Etc.delivery_heap
  if(!heap.length) return

  var min = heap[0]
    , last = heap.pop()

  if(heap.length) {
    var i = 0
    for(;;) {                                     // sift down
      var l = 2*i + 1
        , r = l + 1
        , m = i
      if(l < heap.length && delivery_before(heap[l], m == i ? last : heap[m])) m = l
      if(r < heap.length && delivery_before(heap[r], m == i ? last : heap[m])) m = r
      if(m == i) break
      heap[i] = heap[m]
      i = m
    }
    heap[i] = last
  }

  min.fn()
}

D.port_standard_exit = function(ship, process) {
  var outs = this.outs
    , sender = process && process.sender
    , number = process && process.number

  // a black hole has the world INSIDE: a ship exiting at one of its ports
  // fires the flavour's world-facing method bound inward, fire-and-forget
  // [blackhole-in-exit] [blackhole-flavour-inside]
  if(this.space && this.space.seed && this.space.seed.blackhole)
    return this.outside_exit(ship, sender)

  // smashed socket content cannot emit: a late response from a destroyed
  // process is a ghost [socket-smash]
  if(this.space && this.space._smashed)
    return D.sploot('Ghost ship: output from smashed socket content')

  // THINK: this makes the interface feel more responsive on big pages, but is it the right thing to do?
  if(this.space)
    for(var i=0, l=outs.length; i < l; i++)
      D.schedule_delivery(number, function(out) {
        return function() { out.enter(ship, {sender: sender, number: number}) }
      }(outs[i]), this.out_ordinals[i])
  else
    this.outside_exit(ship, sender) // ORLY? No delay?
}

D.port_standard_pairup = function(port) {
  this.pair = port
  port.pair = this
}

// A port's qualified name: its space's path plus the §3 endpoint form
// ('@dir' bare, '@dir:name' named) [qname-structure]. Pass the INSIDE half.
D.port_qname = function(port) {
  var name = port.name
    , name_dir = name.split(':')[0]
    , endpoint = (name_dir == 'in' || name_dir == 'out' || name_dir == 'up' || name_dir == 'down')
                 ? '@' + name                     // the name carries its dir (dir keywords are
                 : '@' + (port.dir || '') + ':' + name  // reserved in @-position); else the flavour's
    , path = port.space ? port.space.space_path() : ''
  return path ? path + endpoint : endpoint
}

// [sender-attach-registry]: the App registers (attenuated) senders under
// entry-port qnames; a senderless ship entering there carries that sender.
D.Etc.sender_registry = {}
D.register_sender = function(qname, sender) {
  D.Etc.sender_registry[qname] = sender
}

// The sender a senderless ship acquires at an entry point (a world-paired
// port or a black-hole out-port [blackhole-sender-outer]): the registered
// sender for the port's qname, else the qname with the space's base
// dialect [sender-attach-entry]. Pass the INSIDE half; the default is
// memoized on `memo_on` (the entering half).
D.entry_sender = function(inside_port, memo_on) {
  var qname = D.port_qname(inside_port)
  return D.Etc.sender_registry[qname]
      || memo_on._entry_sender
      || (memo_on._entry_sender = new D.Sender(qname, {dialect: inside_port.space.dialect}))
}

D.port_standard_enter = function(ship, process) {
  var sender = process && process.sender
    , number = process && process.number

  // ── Sender attachment at entry ─────────────────────────────────────
  // A senderless ship crossing in from the world takes the entry port's
  // qname as its sender (registered sender if the App bound one, else
  // the qname with the space's base dialect — behaviorally identical to
  // before, but attributed). Attachment never overrides an existing
  // sender. [sender-attach-entry] [sender-attach-no-override]
  if(!sender && !this.space && this.pair && this.pair.space)
    sender = D.entry_sender(this.pair, this)

  // no new ship enters draining content: it buffers at the socket and
  // releases into the fresh content after the swap [socket-drain]
  if(this.pair && this.pair.space && this.pair.space._drain_pending) {
    this.pair.space._drain_buffer.push({ port: this, ship: ship, sender: sender, number: number })
    return
  }

  // a smashed content's boundary is severed: anything still crossing in
  // is a ghost [socket-smash]
  if(this.pair && this.pair.space && this.pair.space._smashed)
    return D.sploot('Ghost ship: arrival at smashed socket content')

  // ── Round-trip port occupancy ──────────────────────────────────────
  // A spaced round-trip pair (up/down flavour, both halves live in
  // spaces) holds one piece of local state: occupancy, kept on the
  // inside half. A request enters from the requester's side (parent
  // side of an up port, inside of a down port) and occupies; requests
  // arriving while occupied queue at the port [port-one-at-a-time].
  // The first ship at the other side while occupied IS the response
  // (ordinal, provenance-blind) and frees — delivered onward via the
  // standard crossing, or to a recorded respond callback (wiring-rule
  // targets). A ship there while free is a ghost: dropped with a soft
  // error [upport-ghost-after-first]. World-paired halves are exempt.
  // See design/roundtrip-signalflip-draft.md.
  if(this.pair && this.pair.space && this.space
      && (this.dir == 'up' || this.dir == 'down')) {
    var inside = this.space.parent === this.pair.space ? this
               : this.pair.space.parent === this.space ? this.pair
               : null
    var requesting = this.dir == 'up' ? this !== inside : this === inside

    if(inside && requesting) {
      if(inside._rt_occupied) {
        inside._rt_queue = inside._rt_queue || []
        inside._rt_queue.push({ port: this, ship: ship, sender: sender, number: number
                              , respond: process && process.respond })
        return
      }
      inside._rt_occupied = true
      inside._rt_return = (process && process.respond) || null

      // the occupancy carries a deadline: past it, the PORT emits the empty
      // response onward itself and frees [timeout-resume-empty]; the era
      // guard keeps a stale deadline off a later occupant.
      inside._rt_era = (inside._rt_era || 0) + 1
      var era = inside._rt_era
        , response_half = this === inside ? inside.pair : inside
      var timeout_ms = this._wire_timeout || inside._wire_timeout
                    || (inside.pair && inside.pair._wire_timeout)
                    || D.Etc.default_timeout
      D.register_timeout(D.now() + timeout_ms, function() {
        if(!inside._rt_occupied || inside._rt_era !== era) return
        D.sploot('Round-trip port timed out: "' + inside.name + '"')
        response_half.enter('')
      })
    }
    else if(inside) {                                     // response side
      if(!inside._rt_occupied)
        return D.sploot('Ghost ship: unrequested arrival at round-trip port "' + this.name + '"')

      inside._rt_occupied = false
      var respond = inside._rt_return
      inside._rt_return = null

      var queued = inside._rt_queue && inside._rt_queue.shift()
      if(queued)                                          // admit the next queued request
        D.schedule_delivery(queued.number, function() {
          queued.port.enter(queued.ship, { sender: queued.sender, number: queued.number
                                         , respond: queued.respond })
        })

      if(respond)
        return respond(ship, number)                      // the response crossing's number rides to the re-dock
    }
  }

  if(this.pair)
    return this.pair.exit(ship, (sender || number !== undefined) ? {sender: sender, number: number} : undefined)

  if(!this.station)
    return D.sploot('Every port must have a pair or a station')

  this.space.dock(ship, this.station, sender, number) // THINK: always async...?
}

D.port_standard_sync = function(ship, callback) {
  var out  = this.outs[0]
    , pair = this.pair

  D.setImmediate(function() {
    if(!pair)                                               // station port
      return out ? out.sync(ship, callback) : ''

    if(!pair.space)                                         // outside port
      return pair.outside_exit(ship, callback)

    return pair.sync(ship, callback)                        // space port
  })

  return NaN
}


D.import_port_flavour = function(flavourname, pflav) {
  if(D.PortFlavours[flavourname])
    return D.sploot('That port flavour has already been im-port-ed')

  // TODO: just use Port or something as a proto for pflav, then the fall-through is automatic

  if(!pflav)
    return D.sploot('That flavour is not desirable')

  if(!pflav.settings)                             // settings are params for port construction
    pflav.settings = []                           // THINK: error if no settings?

  if(typeof pflav.add != 'function')
    pflav.add = D.noop                            // noop, so we can call w/o checking

  if(typeof pflav.exit != 'function')
    pflav.exit = D.port_standard_exit

  if(typeof pflav.outside_add != 'function')
    pflav.outside_add = D.noop

  if(typeof pflav.outside_exit != 'function')
    pflav.outside_exit = D.noop

  if(typeof pflav.pairup != 'function')
    pflav.pairup = D.port_standard_pairup

  if(typeof pflav.enter != 'function')
    pflav.enter = D.port_standard_enter

  if(typeof pflav.sync != 'function' && pflav.dir == 'down')
    pflav.sync = D.port_standard_sync

  // if([pflav.enter, pflav.add].every(function(v) {return typeof v == 'function'}))
  //   return D.sploot("That port flavour's properties are invalid")

  D.PortFlavours[flavourname] = pflav
  return true
}


//    _______ _______ __   _ _______ _____ _______ _______
//    |______ |_____| | \  | |         |   |______ |______
//    |       |     | |  \_| |_____  __|__ |______ ______|
//


D.import_fancy = function(ch, obj) {
  if(typeof ch != 'string') return D.on_error('Fancy character must be a string')
  // ch = ch[0] // only first char matters
  if(!D.Fancies[ch]) {
    // TODO: check obj.eat
    D.Fancies[ch] = obj
  } else {
    D.sploot('Your fancies are more borken')
  }

  D.Etc.FancyRegex = RegExp(Object.keys(D.Fancies)
                                  .sort(function(a, b) {return a.length - b.length})
                                  .map(function(str) {return '^' + D.regex_escape(str) + '\\w'})
                                  .join('|'))
}

D.import_fancy(':', {
  eat: function(token) {
    token.type = 'String'
    token.value = token.value.slice(1)
    return [token] // reuse the existing token to retain the inputs and key and whatnot
  }
})

D.import_fancy('>@', {
  eat: function(token) {

    // TODO: throw a runtime error if it's not a valid port

    token.type = 'PortSend'
    token.value = {to: token.value.slice(2)}

    return [token]
  }
})

D.import_fancy('>$', {
  eat: function(token) {

    // >$foo sets space var foo. >$foo.baz.baa desugars to:
    //   >tempN | list poke path (:baz :baa) data $foo value _tempN | >$foo | _tempN
    // The save/get pair ensures the original pipe value passes through unchanged.

    var pieces = D.Parser.split_on(token.value, '.')
      , name = pieces.shift().slice(2)
      , poke_tokens = []

    token.type = 'VariableSet'
    token.value = {type: 'space', name: name}

    if(pieces.length) {
      pieces = pieces.map(function(item) {
        return item[0] != '{'
             ? '"' + item + '"'
             : item
      })

      // Unique temp var name for saving/restoring the pipe value
      var temp_name = '_poke' + D.Etc.token_counter

      var save = new D.Token('VariableSet', {type: 'pipeline', name: temp_name})
      save.prevkey = token.prevkey

      var path = new D.Token('List', pieces.join(' '))
        , poker = new D.Token('Command', 'list poke data $' + name)

      poker.names = ['path', 'value']
      poker.inputs = [path.key, save.key]

      token.names = ['value']
      token.inputs = [poker.key]

      var get = new D.Token('Variable', {type: 'pipeline', name: temp_name})

      poke_tokens = [save, path, poker]
      return poke_tokens.concat(token, get)
    }

    return [token]
  }
})

D.import_fancy('>', {
  eat: function(token) {

    // TODO: THROW AN ERROR IF IT ALREADY EXISTS IN THE PROCESS
    // NOTE: this doesn't need {list poke} because you can only set it once

    token.type = 'VariableSet'
    token.value = {type: 'pipeline', name: token.value.slice(1)}

    return [token]
  }
})

D.import_fancy('__', {
  eat: function(token) {
    token.type = 'PipeVar'

    // if(token.value == '__') // regular magic pipe
    //   return [token]
    // token.value = '__' // TODO: this probably isn't right
    // token.value = token.value.slice(1)

    var pieces = D.Parser.split_on(token.value, '.')
    token.value = pieces.shift()

    if(token.value != '__' && token.value != '__in') {
      D.sploot('Only __ and __in are allow to start with __')
      token.type = 'String'                                           // error segment stays in pipeline
      token.value = ''                                                // and produces empty value
      return [token]
    }

    return [token].concat(D.eat_fancy_var_pieces(pieces, token))
  }
})

D.import_fancy('_', {
  eat: function(token) {
    return D.eat_fancy_var(token, 'pipeline')
  }
})

D.import_fancy('$', {
  eat: function(token) {
    return D.eat_fancy_var(token, 'space')
  }
})

D.eat_fancy_var = function(token, type) {
  var pieces = D.Parser.split_on(token.value, '.')
  var name = pieces.shift().slice(1)

  token.type = 'Variable'
  token.value = {type: type, name: name}

  return [token].concat(D.eat_fancy_var_pieces(pieces, token))
}

D.eat_fancy_var_pieces = function(pieces, token) {
  if(!pieces.length)
    return []

  // inline peek filtering
  pieces = pieces.map(function(item) {
    return item[0] != '{'
         ? '"' + item + '"'
         : item
  })

  var path = new D.Token('List', pieces.join(' '))
    , peeker = new D.Token('Command', 'list peek')

  peeker.names = ['data', 'path']
  peeker.inputs = [token.key, path.key]

  return [path, peeker]
}


//    _______ _______  ______ _______ _____ __   _ _______ _______  _____   ______ _______
//       |    |______ |_____/ |  |  |   |   | \  | |_____|    |    |     | |_____/ |______
//       |    |______ |    \_ |  |  | __|__ |  \_| |     |    |    |_____| |    \_ ______|
//

D.import_terminator = function(ch, obj) {
  if(typeof ch != 'string') return D.on_error('Terminator character must be a string')
  // ch = ch[0] // only first char matters
  if(!D.Terminators[ch]) D.Terminators[ch] = []
  D.Terminators[ch].push(obj)
  D.Etc.Tglyphs += ch
}

// TODO: these should do more than just return a fancy parser...

D.terminate = function(ch, verb, params) {
  if(!D.Terminators[ch]) return false
  var fun, terminators = D.Terminators[ch]

  for(var i=0, l=terminators.length; i < l; i++) {
    fun = terminators[i][verb]
    if(typeof fun != 'function') continue
    fun.apply(terminators[i], params)
  }
}

D.import_terminator('|', { // pipe
  eat: function(stream, state) {
    stream.next()
    return 'bracket'
  }
})

// THESE DO NOTHING:

D.import_terminator('^', { // lift
  eat: function(stream, state) {
    stream.next()
    return 'bracket'
  }
})

D.import_terminator('/', { // comment
  eat: function(stream, state) {
    while(stream.peek() === '/') stream.next()
    state.commentLevel++
    state.stack[state.stack.length-1].onTerminate.commentLevel-- // set parent's onTerminate
    // state.stack[state.stack.length-1].onClose.commentLevel-- // set parent's onClose
    return 'comment'
  }
})


//    _______        _____ _______ _______ _______ _______
//    |_____| |        |   |_____| |______ |______ |______
//    |     | |_____ __|__ |     | ______| |______ ______|
//


D.import_models = function(new_models) {
  for(var model_key in new_models) {
    var model = new_models[model_key]
      , methods = model['methods'] || {}

    for(var method_key in methods) {                // P-effectpartition: exactly one of fun / effect
      var method = methods[method_key]
      if(!method.fun == !method.effect) {           // both, or neither
        D.sploot('Command "' + model_key + ' ' + method_key + '" must have exactly one of fun or effect')
        delete methods[method_key]
      }
    }

    if(!D.Commands[model_key]) {
      D.Commands[model_key] = model
    }
    else {
      D.extend(D.Commands[model_key]['methods'], model['methods'])
    }
  }
}

D.import_aliases = function(values) {

  // TODO: move this inside Dialects
  // THINK: this only accepts fully-formed handler/method combos, with simple params (no new ablocks). is that ideal?
  D.extend(D.AliasMap, values)

  for(var key in values) {
    var value = values[key]
    value = D.Parser.string_to_tokens('{' + value + '}')
    D.Aliases[key] = value // do some checking or something
  }
}



//    _______ __   __  _____  _______ _______
//       |      \_/   |_____] |______ |______
//       |       |    |       |______ ______|
//


D.import_type = function(key, fun) {
  // Daimio's type system is dynamic, weak, and latent, with implicit user-definable casting via type methods.
  D.Types[key] = fun
  // TODO: add some type checking
};



//     _____  _______ _______ _     _ _______ _____ __   _ ______  _______  ______ _______
//    |_____] |_____|    |    |_____| |______   |   | \  | |     \ |______ |_____/ |______
//    |       |     |    |    |     | |       __|__ |  \_| |_____/ |______ |    \_ ______|
//


D.import_pathfinder = function(name, pf) {
  if(typeof pf.keymatch != 'function')
    pf.keymatch = function(key) {return false} // return false if N/A, 'one' if you're singular, otherwise 'many'

  if(typeof pf.gather != 'function')
    pf.gather = D.identity // returns a list of all matched items

  pf.name = name

  D.Pathfinders.push(pf)
  // find returns a list of matching items, empty for none, null for N/A [or value/null, if amount is one]
}

D.peek = function(base, path) {
  // Scalar/Empty semantics per §10 (audit ruling A, 2026-07-12):
  //   peek(v, Star :: rest) = [peek(child, rest) for child in v]  [peek-star]
  //   affine selectors (Key/Pos) yield exactly one result per item —
  //   the hit, or Empty for a miss or a scalar base [peek-scalar]
  //   [peek-key-miss] [peek-pos-miss]. Star over a scalar contributes
  //   nothing (a scalar has no children).
  // Par keeps the ORIGINAL staging semantics (listfinder: each sub-path's
  // result becomes an item, the remaining path applies to those items).
  // The spec's [peek-par] fold formula CONFLICTS with the corpus's
  // designed series/parallel alternation — an open design decision; the
  // fold-asserting guides stay RED meanwhile. See extra/coverage/DECISIONS.md.
  path = D.to_array(path)

  if(!path.length)
    return base

  var todo = [base]
    , many_flag = false

  for(var i=0, l=path.length; i < l; i++) {
    var key = path[i]
      , new_todo = []
      , pf, test

    // choose our pathfinder
    for(var j=0, k=D.Pathfinders.length; j < k; j++) {
      pf = D.Pathfinders[j]
      test = pf.keymatch(key)

      if(test == 'many')
        many_flag = true

      if(test)
        break
    }

    if(!pf)
      return D.sploot('No matching pathfinder was found')

    for(var j=0, k=todo.length; j < k; j++) {
      if(test == 'many')                                    // traversal: children only, arity varies
        new_todo = new_todo.concat(pf.gather(todo[j], key))
      else {                                                // affine: exactly one result per item
        var got = pf.gather(todo[j], key)
        new_todo.push(got.length ? got[0] : '')             // miss/scalar → Empty
      }
    }

    todo = new_todo
  }

  if(many_flag)
    return todo

  return todo.length ? todo[0] : false
}

D.poke = function(base, path, value) {
  // NOTE: this mutates *in place* and returns the mutated base

  path = D.to_array(path)

  // [poke-empty-path] empty path replaces entirely: poke(v, [], new) = new
  if(!path.length)
    return value

  if(typeof base != 'object' || base === null || D.is_block(base)) {
    // [poke-key-scalar-affine] Key on scalar (affine): replace with {key: ...}
    // [poke-pos-scalar] Pos on scalar: return scalar unchanged
    // [poke-star-scalar] Star on scalar: return scalar unchanged
    // (blocks are scalars here: paths never traverse into a block's insides)
    var first = path[0]
    if(Array.isArray(first)) {                  // Par: delegate each sub-path
      var rest0 = path.slice(1)                 // sequentially [poke-par-sequential]
      for(var pi=0, pl=first.length; pi < pl; pi++) {
        var sub0 = first[pi]
        base = D.poke(base, (Array.isArray(sub0) ? sub0 : [sub0]).concat(rest0), value)
      }
      return base
    }
    if(first === '*') return base
    if(typeof first === 'string' && /^#-?\d/.test(first)) return base
    base = {}  // Key on scalar (affine): replace with object
  }

  var todo = [base]
    , parents = [null]
    , pkeys = [null]
    , star_seen = false

  for(var i=0, l=path.length; i < l; i++) {
    var key = path[i]
      , pf, test

    // --- Par: handle directly via recursive D.poke ---
    if(Array.isArray(key)) {
      var rest = path.slice(i + 1)
      for(var p=0; p < key.length; p++) {
        var sub = key[p]
          , full_path = (Array.isArray(sub) ? sub : [sub]).concat(rest)
        for(var j=0; j < todo.length; j++) {
          var result = D.poke(todo[j], full_path, value)
          if(result !== todo[j]) {
            if(parents[j]) parents[j][pkeys[j]] = result
            if(todo[j] === base) base = result
            todo[j] = result
          }
        }
      }
      return base
    }

    // --- Star: set flag ---
    if(key === '*') star_seen = true

    // --- choose our pathfinder ---
    for(var j=0, k=D.Pathfinders.length; j < k; j++) {
      pf = D.Pathfinders[j]
      test = pf.keymatch(key)
      if(test) break
    }

    if(!pf)
      return D.sploot('No matching pathfinder was found')

    if(i < l - 1) {
      // --- intermediate step: create/traverse ---
      var new_todo = [], new_parents = [], new_pkeys = []

      for(var j=0, k=todo.length; j < k; j++) {
        // [poke-key-unkeyed-fail] non-numeric string key on non-empty unkeyed array: soft error + skip
        if(Array.isArray(todo[j]) && todo[j].length && test == 'one' && typeof key == 'string' && !/^#-?\d/.test(key) && !/^\d+$/.test(key)) {
          D.sploot('Cannot poke key "' + key + '" into an unkeyed list')
          continue
        }
        // [poke-key-empty] empty array + string key: convert to object (empty ≡ Empty)
        if(Array.isArray(todo[j]) && !todo[j].length && test == 'one' && typeof key == 'string' && !/^#-?\d/.test(key)) {
          var obj = {}
          if(parents[j]) parents[j][pkeys[j]] = obj
          if(todo[j] === base) base = obj
          todo[j] = obj
        }

        var children = pf.create(todo[j], key)

        // resolve parent keys based on pathfinder type
        var child_keys
        if(key === '*') {
          child_keys = Object.keys(todo[j])
        } else if(typeof key === 'string' && /^#-?\d/.test(key)) {
          var vkeys = Object.keys(todo[j])
            , position = +key.slice(1)
            , idx = (position < 0) ? (vkeys.length + position) : position - 1
          child_keys = (idx >= 0 && idx < vkeys.length) ? [vkeys[idx]] : []
        } else {
          child_keys = [key]
        }

        for(var m=0; m < children.length; m++) {
          var cv = children[m]
            , ck = child_keys[m]
          // scalar mid-path: traversal (star_seen) → skip; affine → recurse so
          // the base-level scalar dispatch decides (Key promotes, Pos/Star
          // leave the scalar unchanged) [poke-key-scalar-affine]
          // [poke-pos-scalar] [poke-star-scalar]
          if(typeof cv !== 'object' || cv == null) {
            if(star_seen) continue
            var sub = D.poke(cv, path.slice(i + 1), value)
            if(sub !== cv) todo[j][ck] = sub
            continue
          }
          new_todo.push(cv)
          new_parents.push(todo[j])
          new_pkeys.push(ck)
        }
      }

      todo = new_todo
      parents = new_parents
      pkeys = new_pkeys
    }
    else {
      // --- last step: set value ---
      for(var j=0, k=todo.length; j < k; j++) {
        // [poke-key-unkeyed-fail] non-numeric string key on non-empty unkeyed array: soft error + skip
        if(Array.isArray(todo[j]) && todo[j].length && test == 'one' && typeof key == 'string' && !/^#-?\d/.test(key) && !/^\d+$/.test(key)) {
          D.sploot('Cannot poke key "' + key + '" into an unkeyed list')
          continue
        }
        // [poke-key-empty] empty array + string key: convert to object
        if(Array.isArray(todo[j]) && !todo[j].length && test == 'one' && typeof key == 'string' && !/^#-?\d/.test(key)) {
          var obj = {}
          if(parents[j]) parents[j][pkeys[j]] = obj
          if(todo[j] === base) base = obj
          todo[j] = obj
        }
        pf.set(todo[j], key, value)
      }
    }
  }

  return base
}

D.delete_path = function(base, path) {
  // Remove the entry at a path focus (§10 Delete). Mutates in place and
  // returns the base; positional deletes splice [delete-pos]; Par uses
  // collect-then-remove from the original structure, reverse index order
  // per level, overlapping targets removed once [delete-par-collect]
  // [delete-par-overlap].
  path = D.to_array(path)

  if(!path.length)
    return ''                                             // [delete-empty-path]

  if(!base || typeof base != 'object' || D.is_block(base))
    return base                                           // scalar: no focus, unchanged

  var foci = []                                           // {parent, key} pairs, collected first

  var walk = function(v, p) {
    var key = p[0]
      , rest = p.slice(1)

    if(Array.isArray(key)) {                              // Par: each sub-path extends with rest
      for(var i=0, l=key.length; i < l; i++) {
        var sub = key[i]
        walk(v, (Array.isArray(sub) ? sub : [sub]).concat(rest))
      }
      return
    }

    if(!v || typeof v != 'object' || D.is_block(v)) return  // scalar mid-path: nothing to focus

    var ks = []
    if(key === '*')                                       // [delete-star]
      ks = Object.keys(v)
    else if(typeof key == 'string' && /^#-?\d/.test(key)) {
      var vkeys = Object.keys(v)
        , position = +key.slice(1)
        , idx = (position < 0) ? (vkeys.length + position) : position - 1
      if(position === 0)                                    // #0 is malformed [pos-zero-invalid]
        D.on_error('Malformed selector "' + key + '"')      // ks stays [] → unchanged
      else if(idx >= 0 && idx < vkeys.length) ks = [vkeys[idx]]  // [delete-pos] else unchanged
    }
    else if(Array.isArray(v)) {                           // [delete-key-unkeyed]: key coercion
      if(/^\d+$/.test(key)) ks = (+key < v.length) ? [key] : []
      else D.sploot('Cannot delete key "' + key + '" from an unkeyed list')
    }
    else                                                  // [delete-key-keyed]: no-op if missing
      ks = D._hop.call(v, key) ? [key] : []

    for(var i=0, l=ks.length; i < l; i++) {
      if(!rest.length) foci.push({parent: v, key: ks[i]})
      else walk(v[ks[i]], rest)
    }
  }
  walk(base, path)

  var groups = []                                         // dedup + group by parent
  foci.forEach(function(f) {
    for(var i=0, l=groups.length; i < l; i++)
      if(groups[i].parent === f.parent) {
        if(groups[i].keys.indexOf(f.key) < 0) groups[i].keys.push(f.key)
        return
      }
    groups.push({parent: f.parent, keys: [f.key]})
  })

  groups.forEach(function(g) {
    if(Array.isArray(g.parent))
      g.keys.map(Number).sort(function(a, b) {return b - a})  // reverse order: no shifting
            .forEach(function(idx) { g.parent.splice(idx, 1) })
    else
      g.keys.forEach(function(k) { delete g.parent[k] })
  })

  return base
}

D.map_path = function(base, path, apply_fn, prior_starter, path_acc) {
  // Recursive path-guided structural transformation.
  // Descends along path, applies apply_fn at focus points, rebuilds structure.
  // Uses NaN/callback async convention throughout.

  path_acc = path_acc || []

  // Empty path (leaf): apply the block
  if(!path.length)
    return apply_fn(base, prior_starter, null, null, path_acc)

  // Scalar/null with non-empty path: unchanged, no block applied
  if(typeof base !== 'object' || base === null)
    return base

  var step = path[0]
    , rest = path.slice(1)

  // Par (array key): sequential left-to-right
  if(Array.isArray(step)) {
    var idx = 0, went_async = false
    var next = function() {
      while(idx < step.length) {
        var sub = step[idx++]
        var full = (Array.isArray(sub) ? sub : [sub]).concat(rest)
        var result = D.map_path(base, full, apply_fn, function(val) {
          base = val; next()
        }, path_acc)
        if(result !== result) { went_async = true; return NaN }
        base = result
      }
      if(went_async) return prior_starter(base)
      return base
    }
    return next()
  }

  // Star: iterate all children via data_trampoline
  if(step === '*') {
    var child_keys = Object.keys(base)
    var processfun = function(child, starter, key) {
      var ci = child_keys.indexOf(key)
      var cp = path_acc.concat(key)
      if(!rest.length) return apply_fn(child, starter, key, ci, cp)
      return D.map_path(child, rest, apply_fn, starter, cp)
    }
    return D.data_trampoline(base, processfun, D.list_set, prior_starter, D.scrub_list)
  }

  // Key / Position: find pathfinder, gather child
  var pf, test
  for(var j=0, k=D.Pathfinders.length; j < k; j++) {
    pf = D.Pathfinders[j]
    test = pf.keymatch(step)
    if(test) break
  }

  if(!pf) return base

  var children = pf.gather(base, step)
  if(!children.length) return base  // missing key/pos → unchanged

  // Resolve actual key (positions → 0-indexed key string)
  var rkey
  if(typeof step === 'string' && /^#-?\d/.test(step)) {
    var vkeys = Object.keys(base)
      , position = +step.slice(1)
      , idx = (position < 0) ? (vkeys.length + position) : position - 1
    rkey = vkeys[idx]
  } else {
    rkey = step
  }

  var ci = Object.keys(base).indexOf(rkey)
  var cp = path_acc.concat(rkey)

  if(!rest.length) {
    var result = apply_fn(children[0], function(val) {
      base[rkey] = val; prior_starter(base)
    }, rkey, ci, cp)
    if(result !== result) return NaN
    base[rkey] = result
    return base
  }

  var result = D.map_path(children[0], rest, apply_fn, function(val) {
    base[rkey] = val; prior_starter(base)
  }, cp)
  if(result !== result) return NaN
  base[rkey] = result
  return base
}


  /*ooooooo.         .o.       ooooooooo.    .oooooo..o oooooooooooo ooooooooo.
  `888   `Y88.      .888.      `888   `Y88. d8P'    `Y8 `888'     `8 `888   `Y88.
   888   .d88'     .8"888.      888   .d88' Y88bo.       888          888   .d88'
   888ooo88P'     .8' `888.     888ooo88P'   `"Y8888o.   888oooo8     888ooo88P'
   888           .88ooo8888.    888`88b.         `"Y88b  888    "     888`88b.
   888          .8'     `888.   888  `88b.  oo     .d8P  888       o  888  `88b.
  o888o        o88o     o8888o o888o  o888o 8""88888P'  o888ooooood8 o888o  o88*/


D.Parser.get_next_thing = function(string, ignore_begin) {
  var first_open, next_open, next_closed

  first_open = next_open = next_closed = string.indexOf(D.Constants.command_open);

  if(first_open == -1) return string  // no Daimio here
  if(first_open > 0) return string.slice(0, first_open)  // trim non-Daimio head

  do {
    next_open = string.indexOf(D.Constants.command_open, next_open + 1)
    next_closed = string.indexOf(D.Constants.command_closed, next_closed) + 1
  } while(next_closed && next_open != -1 && next_closed > next_open)

  // TODO: add a different mode that returns the unfulfilled model / method etc (for autocomplete)
  if(!next_closed) {
    // THINK: should we emit a soft error here? An unmatched '{' is valid literal text,
    // but it might indicate a typo the user would want to know about.
    // D.on_error("No closing brace for '" + string + "'")
    return string.slice(0, 1)  // unmatched '{' is literal text; continue scanning after it
  }

  if(ignore_begin || string.slice(0,7) != D.Constants.command_open + 'begin ')
    return string.slice(0, next_closed)  // not a block

  var block_name = string.match(/^\{begin (\w+)/)
  if(!block_name) {
    return string.slice(0, next_closed)  // not a valid block name; treat as regular command
  }
  block_name = block_name[1];

  var end_tag = D.Constants.command_open + 'end ' + block_name + D.Constants.command_closed
    , end_begin = string.indexOf(end_tag, next_closed)
    , end_end = end_begin + end_tag.length;

  if(end_begin === -1) {
    D.on_error("No end tag for block '" + block_name + "'");
    return string.slice(0, next_closed)  // no {end NAME} found; treat as regular command
  }

  // THINK: we're going to go ahead and deal with the block right here... is this the right place for this?
  // No, no it really isn't

  return string.slice(0, end_end);
}


D.Parser.string_to_block_segment = function(string) {
  var segment = D.Parser.segments_to_block_segment(D.Parser.string_to_segments(string))
    , block_id = segment.value.id

  segment.original_string = string                                    // per-segment source for toJSON
  D.add_decorator(block_id, 'OriginalString', string, true)           // fallback for blocks without segment context
  return segment
}

D.Parser.segments_to_block_segment = function(segments) {
  var wiring = {}

  // TODO: refactor this into get_wiring or something
  for(var i=0, l=segments.length; i < l; i++) {
    var segment = segments[i]

    if(segment.inputs && segment.inputs.length) {
      wiring[segment.key] = segment.inputs
    }
  }

  var block   = new D.Block(segments, wiring)
    , segment = new D.Segment('Block', {id: block.id})

  return segment
}

D.Parser.pipeline_string_to_tokens = function(string, quoted) {
  var tokens = []
    , P = D.Parser
    , strings = []

  if(typeof string != 'string')
    return string || []

  if(string.slice(0,7) == D.Constants.command_open + 'begin ') { // in a block
    var pipeline = D.Parser.get_next_thing(string, true)
      , block_match = pipeline.match(/^\{begin (\w+)/)

    if(!block_match) {
      D.sploot('Invalid block name in ' + pipeline)
      return []
    }

    var block_name = block_match[1]
      , end_tag = D.Constants.command_open + 'end ' + block_name + D.Constants.command_closed
      , body = string.slice(pipeline.length, -end_tag.length)
      , segment = D.Parser.string_to_block_segment(body)

    pipeline = '"foo" ' + pipeline.slice(7+block_name.length, -1) // trim '{begin \w+' and trailing '}'
    strings = P.split_on_terminators(pipeline)
    strings[0] = '"' + body + '"'
  }
  else {
    if(string[0] != '{' && string.slice(-1) != '}') {
      D.sploot('That string is not a pipeline')
      return []
    }

    string = string.slice(1, -1)

    strings = P.split_on_terminators(string)
  }

  var new_tokens = P.strings_to_tokens(strings, true)

  // for(var i=0, l=new_tokens.length; i < l; i++) {
  //   if(!new_tokens[i].position)
  //     new_tokens[i].position = i+1
  // }

  if(quoted && new_tokens.length)
    new_tokens[0].prevkey = '__in'

  return new_tokens
}

D.Parser.strings_to_tokens = function(strings) {
  var tokens = []
    , extract_munger = ''
    , munge_munger = ''
    , P = D.Parser

  if(typeof strings == 'string')
    strings = [strings]

  if(!strings.map)
    return []

  tokens = strings
           .map(P.lexify)
           .reduce(D.concat, [])

  extract_munger = function(L, token, R) { // TODO: refactor this
    var type = D.SegmentTypes[token.type]
    if(!type) return [L, R] // no know type
    if(!type.extract_tokens) return [L.concat(token), R]
    return type.extract_tokens(L, token, R) // for terminators etc
  }

  tokens = D.mungeLR(tokens, extract_munger)

  // for(var key in D.SegmentTypes) {
  //   var type = D.SegmentTypes[key]
  // }

      // TODO: this needs to run over each SegmentType for each item... like, if something shoves new stuff on the list, we need to scan all of that R stuff with each item before we move on, rather than scanning each item...
      // TODO: so have mungeLR invoke a FAMILY of functions.
      // USECASE: list inside command inside list inside command... likely borks.

  munge_munger = function(L, token, R) {
    var type = D.SegmentTypes[token.type]
    if(!type) return [L, R] // no know type
    if(!type.munge_tokens) return [L.concat(token), R]
    return type.munge_tokens(L, token, R)
  }

  tokens = D.mungeLR(tokens, munge_munger)

  return tokens
}

D.Parser.string_to_tokens = function(string) {
  var output = []
    , result = false
    , block_inputs = []
    , chunk = D.Parser.get_next_thing(string)

  if(chunk.length == string.length && chunk[0] == D.Constants.command_open && chunk.slice(-1) == D.Constants.command_closed) {
    // only one chunk, so make regular pipeline
    return D.Parser.pipeline_string_to_tokens(chunk)
  }
  else {
    // make blockjoin
    do {
      string = string.slice(chunk.length)
      result = []

      if(chunk[0] == D.Constants.command_open && chunk.slice(-1) == D.Constants.command_closed) {
        result = D.Parser.pipeline_string_to_tokens(chunk, true)
      } else {
        result = [new D.Token('String', chunk)]
        // output.push(D.Parser.strings_to_tokens(chunk))
      }

      if(result.length) {
        output = output.concat(result)
        block_inputs.push(result[result.length - 1].key)
      }
    } while(chunk = D.Parser.get_next_thing(string))

    var joiner = new D.Token('Blockjoin', '')
    joiner.inputs = block_inputs
    output.push(joiner)
  }

  return output
  // return output.reduce(D.concat, [])
}

D.Parser.tokens_to_segments = function(tokens) {
  var segments = []
    , munger = ''
    , P = D.Parser

  segments = tokens.map(function(token) {return D.SegmentTypes[token.type].token_to_segments(token)})
                   .reduce(D.concat, [])

  // for(var key in D.SegmentTypes) {
  //   var type = D.SegmentTypes[key]
  //
  //   if(!type.munge_segments)
  //     continue
  //
  //   munger = function(L, segment, R) {
  //
  //     if(segment.type != key) return [L.concat(segment), R]
  //     return type.munge_segments(L, segment, R)
  //   }
  //
  //   segments = D.mungeLR(segments, munger)
  // }

  munger = function(L, segment, R) {
    var type = D.SegmentTypes[segment.type]
    if(!type) return [L, R] // no know type
    if(!type.munge_segments) return [L.concat(segment), R]
    return type.munge_segments(L, segment, R)
  }

  segments = D.mungeLR(segments, munger)

  return segments
}

D.Parser.string_to_segments = function(string) {
  return D.Parser.tokens_to_segments(D.Parser.string_to_tokens(string))
}


D.Parser.lexify = function(string) {
  /// NOTE: this always returns an ARRAY of tokens!

  var P = D.Parser
    , types = Object.keys(D.SegmentTypes)
    , lexers = types.map(function(type) {return D.SegmentTypes[type].try_lex})

  if(string.trim)
    string = string.trim() // THINK: is there a better place for this?

  for(var i=0, l=lexers.length; i < l; i++) {
    if(typeof string != 'string')
      return Array.isArray(string) ? string : [string]

    string = lexers[i](string)
  }

  return Array.isArray(string) ? string : [string]
}

D.Parser.split_on = function(string, regex, label) {
  if(typeof string != 'string')
    return string

  if(!(regex instanceof RegExp))
    regex = RegExp('[' + D.regex_escape(regex) + ']')

  var output = []
    , inside = []
    , special = /["{()}]/
    , match_break = 0
    , char_matches = false
    , we_are_matching = false

  for(var index=0, l=string.length; index < l; index++) {

    /*
      we need to not match when
      - inside quotes
      - unmatched parens
      - unmatched braces
    */

    var this_char = string[index]
      , am_inside = inside.length

    if(this_char == '"' && inside.length == 1 && inside[0] == '"')
      inside = []

    if(this_char == '"' && !am_inside)
      inside = ['"']

    if(this_char == '{')
      inside.push('{')

    if(this_char == '(')
      inside.push('(')

    if(this_char == '}' || this_char == ')')
      inside.pop() // NOTE: this means unpaired braces or parens in quotes are explicitly not allowed...

    char_matches = regex.test(this_char)

    // if(!!am_inside == !!inside.length) // not transitioning
    //   continue
    //   output.push(string.slice(match_break, index + 1))
    //   match_break = index + 1
    // }
    //
    // if(!am_inside && inside.length) {
    //   output.push(string.slice(match_break, index))
    //   match_break = index
    // }
    //
    // if(special.test(this_char))
    //   continue
    //

    if(am_inside && inside.length)
      continue

    if(we_are_matching === char_matches)
      continue

    if(we_are_matching) { // stop matching
      if(label)
        output.push(new D.Token(label, string.slice(match_break, index)))

      match_break = index
      we_are_matching = false
    }

    else { // start matching
      if(index)
        output.push(string.slice(match_break, index))

      match_break = index
      we_are_matching = true
    }
  }

  // if(match_break < index) {
  //   var lastbit = string.slice(match_break, index)
  //   if(lastbit.length) {
  //     output.push(lastbit)
  //   }
  // }

  if(match_break < index) {
    var lastbit = string.slice(match_break, index)
    if(regex.test(lastbit[0])) { // at this point lastbit is homogenous
      if(label)
        output.push(new D.Token(label, string.slice(match_break, index)))
    } else {
      output.push(lastbit)
    }
  }
  return output
}

D.Parser.split_on_terminators = function(string) {
  // TODO: make Tglyphs work with multi-char Terminators
  return D.Parser.split_on(string, D.Etc.Tglyphs, 'Terminator')
}

D.Parser.split_on_space = function(string) {
  return D.Parser.split_on(string, /[\s\u00a0]/)
}


// D.Parser.rekey = function(L, segment, R) {
//   if(!segment) return [L, R]
//
//   var old_key = segment.key
//   var new_key = L.length
//
//   // TODO: holymuckymuck, is this ever ugly and slow. clean me!
//   for(var i=0, l=R.length; i < l; i++) {
//     var future_segment = R[i]
//     var index
//
//     if(future_segment.inputs) {
//       while(true) {
//         index = future_segment.inputs.indexOf(old_key)
//         if(index == -1) break
//         future_segment.inputs[index] = new_key
//       }
//     }
//
//     if( future_segment.value
//      && future_segment.value.name
//      && future_segment.value.name == old_key)
//         future_segment.value.name = new_key
//   }
//
//   segment.key = new_key
//   return [L.concat(segment), R]
// }




    /*ooooo.   oooooooooo.     oooo oooooooooooo   .oooooo.   ooooooooooooo  .oooooo..o
   d8P'  `Y8b  `888'   `Y8b    `888 `888'     `8  d8P'  `Y8b  8'   888   `8 d8P'    `Y8
  888      888  888     888     888  888         888               888      Y88bo.
  888      888  888oooo888'     888  888oooo8    888               888       `"Y8888o.
  888      888  888    `88b     888  888    "    888               888           `"Y88b
  `88b    d88'  888    .88P     888  888       o `88b    ooo       888      oo     .d8P
   `Y8bood8P'  o888bood8P'  .o. 88P o888ooooood8  `Y8bood8P'      o888o     8""88888P'
                            `Y88*/


//     ______          _____  _______ _     _
//     |_____] |      |     | |       |____/
//     |_____] |_____ |_____| |_____  |    \_
//

D.Block = function(segments, wiring) {

  /*
    head is an array of Segment objects, which look like {
      type: ""
      value: ...
      params: {}
      ins: {}
      outs: []
    }
    required:
    type is Number, String, List, Command, Alias, Block
      --> during processing, various transformer types are available (currently Terminator and Fancy)
    value is {Handler: "", Method: ""} for Command, raw value otherwise
    optional:
    params is an 1D key/value for Command or Alias with "!" as implicit key and NULL for referenced values
    ins' keys are param keys, values are previous outs
    outs are labels for partial products

    Block is a block reference -- typically hash id
    Transformers are processed prior to ABlockiness (currently terminators and fancy)
    Aliases are converted to Commands prior to PBlockiness (and Command values are then enhanced with method pointer)
  */


  // // soooooo... this assumes head is a bunch of segments OR body is a bunch of strings or ABlocks. right. gotcha.
  //
  // if(head) {
  //   // ensure it's an array of Segments, I suppose...
  //   this.head = head
  // }
  //
  // if(body) {
  //   // TODO: filter out extracted blocks
  //
  //   // ensure it's an array of strings and ABlocks, then take the string or block's id
  //   if(body.some && !body.some(function(item) {return (typeof item != 'string') && !item.id}).length) {
  //     this.body = body.filter(function(item) { return !item.adjunct })
  //                     .map(function(item) { return (typeof item == 'string') ? item : {'block': item.id} })
  //      // THINK: this 'block' bit is a bod block ref. should we use segments here instead?
  //   }
  // }
  //
  // if(!this.head && !this.body) // THINK: when does this happen? what should we return?
  //   this.body = []

  if(!Array.isArray(segments))
    segments = []

  // TODO: ensure all segments are segments

  if(!wiring || (typeof wiring != 'object'))
    wiring = {}

  var pair = D.wash_keys(segments, wiring)                    // OPT: this happens for each optimizer
  segments = pair.segments                                    // but it's only needed once at the end
  wiring   = pair.wiring

  this.segments = segments
  this.wiring = wiring

  var json = JSON.stringify(this)
    , hash = murmurhash(json)

  if(!D.BLOCKS[hash])                                         // THINK: take this out and put it elsewhere?
    D.BLOCKS[hash] = this                                     // or... how is block access limited? or... huh.

  this.id = hash
}

D.wash_keys = function(segments, wiring) {
  var new_wiring = {}
  var temp_wiring = {}
  var new_segments = []
  var reverse_wiring = {}

  for(var key in wiring) {
    var wire = wiring[key]
    for(var i=0, l=wire.length; i < l; i++)
      reverse_wiring[wire[i]] = reverse_wiring[wire[i]]
                              ? reverse_wiring[wire[i]].concat(key)
                              : [key] }

  for(var j=0, k=segments.length; j < k; j++) {
    var segment = segments[j]
    var index = new_segments.length
    var my_key = segment.key || j
    var my_wires = reverse_wiring[my_key] || []
    var input_index = -1

    if( !my_wires.length                                 // toss anything that isn't linked to the final segment
     && j != k-1                                         // except the final segment itself, obviously
     && segment.type != 'VariableSet'                    // 'Put' segtypes are purely side effects
     && segment.type != 'PortSend'                       // TODO: change these to 'PutSpaceVar' and 'PutPort'
     &&  ( segment.type != 'Command'
        && segment.value.method != 'run'                 // two commands are also side-effect based...
        && segment.value.method != 'sleep' ))            // FIXME: find a nice way to deal with that
           continue

    for(var i=0, l=my_wires.length; i < l; i++) {
      if(!temp_wiring[my_wires[i]])
        temp_wiring[my_wires[i]] = []
      while((input_index = wiring[my_wires[i]].indexOf(my_key, input_index+1)) != -1)
        temp_wiring[my_wires[i]][input_index] = index }

    if(temp_wiring[my_key])
      new_wiring[index] = temp_wiring[my_key]

    // am i missing any keys?
    if(wiring[my_key]) {
      for(var x=0, z=wiring[my_key].length; x < z; x++) {
        if(!new_wiring[index])
          new_wiring[index] = []
        if(new_wiring[index][x] === undefined)
          new_wiring[index][x] = wiring[my_key][x]
      }
    }

    // put the value.name in the wiring
    // then build an old_key_new_key map
    // and switch this at that point
    // but also if it's in the wiring who cares?
    // oh but we need this for final pipevars
    // because otherwise who's going to speak for them?

    //     if( future_segment.value
    //      && future_segment.value.name
    //      && future_segment.value.name == old_key)
    //         future_segment.value.name = new_key


    // 'run' is used purely for side effects sometimes like {"{2 | >$foo}" | run | $foo}
    // so we can't get rid of it just because it's not linked to the output.
    // also, things that are linked to >@ have the same problem.
    // also, any command that has a downport.
    // sucky sucky suck suck stupid stupid
    // also 'wait'


    var new_seg = new D.Segment(segment.type, segment.value, null)
    if(segment.original_string) new_seg.original_string = segment.original_string
    new_segments.push(new_seg)
  }

  return {segments: new_segments, wiring: new_wiring}
}



//    _______  _____  _     _ _______ __   _
//       |    |     | |____/  |______ | \  |
//       |    |_____| |    \_ |______ |  \_|
//

D.Token = function(type, value) {
  this.key = D.Etc.token_counter++
  this.type = type
  this.value = value
}


//    _______ _______  ______ _______ _______ __   _ _______
//    |______ |______ |  ____ |  |  | |______ | \  |    |
//    ______| |______ |_____| |  |  | |______ |  \_|    |
//

D.Segment = function(type, value, token) {
  this.type = type || 'String'
  this.value = D.make_nice(value)

  if(token === null)
    return this

  if(!token)
    token = {}

  this.prevkey = token.prevkey || false
  this.names = token.names || []
  this.inputs = token.inputs || []
  this.key = token.key || false

  // THINK: how do we allow storage / performance optimizations in the segment structure -- like, how do we fill in the params ahead of time?

  // TODO: refactor the above... oy. pseudosegments vs real segments, default values, etc...

  /*
    Segments also have
    params -- commands have these (it's a hash of segments)
    paramlist -- params post-dialecticalization
    method -- post-d, for Command segments

    Segment types:
      paramable: String, Number, Block, Input, Null (for alias dangling params)
      paramfree: List, Command, Alias
      temporary: Fing, Begin, Fancy, Pipeline

    ABlock segments (and beyond) have their keys changed to pipeline position and Input segments remapped
  */
}

D.Segment.prototype.toJSON = function() {
  var type = D.SegmentTypes[this.type]

  // THINK: unfortunately this is triggered by ABlock() before murmurhashing, which probably will screw something up someday.

  if(type && type.toJSON) {
    return type.toJSON(this)
  } else {
    return JSON.stringify(this.value)
  }
}


//    ______  _____ _______        _______ _______ _______
//    |     \   |   |_____| |      |______ |          |
//    |_____/ __|__ |     | |_____ |______ |_____     |
//

D.Dialect = function(commands, aliases, policy) {
  this.did = D.get_unique_symbol()

  /*
    A Space is an execution context for Blocks.
    Each Space has a fixed Block that handles incoming messages by
    - dispatching based on message parameters
    - executing the message as code
    - feeding the message through the fixed Block as data
    Spaces may send messages to each other through channels via the space gateway.
    Each Space has a private variable context for mutable space variables.
    Each Space is responsible for its own Processes, but we're using a setTimeout to queue messages
      (to avoid blowing the stack and to keep things ordered correctly)



    Frozen space data:
      state: {}
      dialect:
        commands: {}
        aliases: {}
      ports:
        name:
        flavour: name [contains: dir, add, dock]
        settings: flavour data
        outs: [port_index]
        typehint:
        space: id
        station: index?
      stations:
        block: id
        name: ?

    Instances of ports have the flavour in prototype, and have more outs added by parent space.

    D.SPACESEEDS is for abstract spaces, ie the spacial data that is imported/exported.
    D.OuterSpace refers to the outermost space [but we should make this an array to allow multiple independent "bubbles" to operate... maybe].
    An individual space is only referenced from its parent space... or maybe there's a weakmap cache somewhere or something.
  */

  this.commands = commands ? D.deep_copy(commands) : D.Commands
  this.aliases = aliases ? D.clone(aliases) : D.Aliases
  this.policy = policy || {}
  // this.parent = parent
}

D.Dialect.prototype.get_handler = function(handler) {
  if(  handler
    && this.commands
    && this.commands[handler]
    && this.commands[handler]
  ) {
    return this.commands[handler]
  }

  return false
}

D.Dialect.prototype.get_method = function(handler, method) {
  if(  handler
    && method
    && this.commands
    && this.commands[handler]
    && this.commands[handler].methods
    && this.commands[handler].methods[method]
  ) {
    return this.commands[handler].methods[method]
  }

  return false
}

D.make_restricted_dialect = function(options) {
  options = options || {}

  var blocked_methods = options.blocked_methods || {
    'process': ['unquote']
  }
  var blocked_aliases = options.blocked_aliases || ['unquote']

  var policy = {
    restrict_unsafe_ports: options.restrict_unsafe_ports !== false,
    no_user_regex: options.no_user_regex !== false
  }

  // Use live D.Commands/D.Aliases references (no copy) to avoid load-order timing issues.
  // Blocklists are checked in overridden get_handler/get_method instead.
  var dialect = new D.Dialect(null, null, policy)

  dialect.get_handler = function(handler) {
    if(blocked_methods[handler] === true) return false
    return D.Dialect.prototype.get_handler.call(this, handler)
  }

  dialect.get_method = function(handler, method) {
    if(blocked_methods[handler] === true) return false
    if(blocked_methods[handler] && blocked_methods[handler].indexOf(method) !== -1) return false
    return D.Dialect.prototype.get_method.call(this, handler, method)
  }

  dialect.get_alias = function(name) {
    if(blocked_aliases.indexOf(name) !== -1) return false
    return this.aliases[name] || false
  }

  return dialect
}

D.make_sender_dialect = function(base_dialect, options) {
  options = options || {}
  var blocked_methods = options.blocked_methods || {}
  var blocked_aliases = options.blocked_aliases || []

  var dialect = new D.Dialect(null, null, base_dialect.policy)

  dialect.get_handler = function(handler) {
    if(blocked_methods[handler] === true) return false
    return base_dialect.get_handler(handler)
  }

  dialect.get_method = function(handler, method) {
    if(blocked_methods[handler] === true) return false
    if(blocked_methods[handler] && blocked_methods[handler].indexOf(method) !== -1) return false
    return base_dialect.get_method(handler, method)
  }

  dialect.get_alias = function(name) {
    if(blocked_aliases.indexOf(name) !== -1) return false
    if(base_dialect.get_alias) return base_dialect.get_alias(name)
    return base_dialect.aliases ? base_dialect.aliases[name] || false : D.Aliases[name] || false
  }

  return dialect
}

D._dialect_intersection_cache = {}

D.intersect_dialects = function(d1, d2) {
  if(!d1 || !d2) return d1 || d2
  if(d1 === d2) return d1

  var cache_key = d1.did + ':' + d2.did
  if(D._dialect_intersection_cache[cache_key])
    return D._dialect_intersection_cache[cache_key]

  var policy = {}
  if(d1.policy.restrict_unsafe_ports || d2.policy.restrict_unsafe_ports)
    policy.restrict_unsafe_ports = true
  if(d1.policy.no_user_regex || d2.policy.no_user_regex)
    policy.no_user_regex = true

  var dialect = new D.Dialect(null, null, policy)

  dialect.get_handler = function(handler) {
    return d1.get_handler(handler) && d2.get_handler(handler)
  }

  dialect.get_method = function(handler, method) {
    return d1.get_method(handler, method) && d2.get_method(handler, method)
  }

  dialect.get_alias = function(name) {
    var a1 = d1.get_alias ? d1.get_alias(name) : (d1.aliases ? d1.aliases[name] : false)
    var a2 = d2.get_alias ? d2.get_alias(name) : (d2.aliases ? d2.aliases[name] : false)
    return a1 && a2 ? a1 : false
  }

  D._dialect_intersection_cache[cache_key] = dialect
  return dialect
}

D.Sender = function(id, options) {
  options = options || {}
  this.id      = id
  this.dialect = options.dialect || null
}


//     _____   _____   ______ _______
//    |_____] |     | |_____/    |
//    |       |_____| |    \_    |
//

D.Port = function(port_template, space) {
  var flavour = port_template.flavour
    , settings = port_template.settings
    , station = port_template.station
    , name = port_template.name
    , typehint = port_template.typehint

  var pflav = D.PortFlavours[flavour]

  if(!pflav)
    return D.sploot('Port flavour "' + flavour + '" could not be identified')

  if(pflav.unsafe && space && space.dialect && space.dialect.policy.restrict_unsafe_ports) {
    return D.sploot('Port flavour "' + flavour + '" is not allowed in this space')
  }

  // if(D.PORTS[name])
  //   return D.sploot('That port has already been added')

  if(!name)
    name = 'port-' + Math.random()

  // if(!space)
  //   return D.sploot('Every port must have a space')

  var port = Object.create(pflav)

  port.outs = []
  port.out_ordinals = []                  // per-out: the carrying wire's declaration ordinal [sched-tie-wire]
  port.name = name
  port.space = space
  port.flavour = flavour
  port.station = station || undefined
  port.typehint = typehint
  port.settings = D.make_nice(settings, {})

  port.pair = false

  if(port.space)
    port.add()
  else
    port.outside_add()

  if(port.space && !port.space.parent && !port.station && !port.subspace) {
    var outside_template = D.clone(port_template)
    delete outside_template['space']
    var outside_port = new D.Port(outside_template)
    outside_port.pairup(port)
  }

  return port
}



//    ______  _______ _______ _______
//    |     \ |_____|    |    |_____|
//    |_____/ |     |    |    |     |
//

D.DataObj =
{  _data : []
,  get val()     {return this._data}
,  set val(to)   {this._data = to}
,  get keys()    {return Object.keys(this._data)}
,  set keys(x)   {}
,  get length()  {return this._data.length}
,  set length(x) {}
}

D.Data = function(init) {
  var self = Object.create(D.DataObj)
  self.val = init
  return self
}



   /*ooooo..o ooooooooo.         .o.         .oooooo.   oooooooooooo
  d8P'    `Y8 `888   `Y88.      .888.       d8P'  `Y8b  `888'     `8
  Y88bo.       888   .d88'     .8"888.     888           888
   `"Y8888o.   888ooo88P'     .8' `888.    888           888oooo8
       `"Y88b  888           .88ooo8888.   888           888    "
  oo     .d8P  888          .8'     `888.  `88b    ooo   888       o
  8""88888P'  o888o        o88o     o8888o  `Y8bood8P'  o888oooooo*/


D.Space = function(seed_id, parent, prng_seed, name, opts) {
  // D.SPACESEEDS[seed_id] contains id, dialect, state, ports, stations, subspaces, routes
  // TODO: validate parent
  // THINK: validate seed_id?

  var seed = D.SPACESEEDS[seed_id]
    , self = this

  if(!seed)
    return D.sploot('Invalid spaceseed')

  this.seed = seed
  this.state = {}
  this.parent = parent || false // false is outer
  this.name = name || ''        // '' for the outer root [qname-structure]

  // Block-eval recursion bound, set once on the outer space and inherited by
  // every subspace [depth-bound-instance] [depth-nesting-only]. The current
  // nesting depth (eval_depth) is tracked per space in the block apply demand.
  this.depth_bound = parent
    ? parent.depth_bound
    : ((opts && opts.depth_bound) || D.Etc.default_depth_bound)

  // Per-space PRNG [random-seeded] [random-per-space]: each subspace derives
  // its own seed from the parent's seed and its name — order-independent,
  // and a space's stream depends only on its own draws.
  this.prng_seed = parent
    ? String(murmurhash(parent.prng_seed + ' ' + this.name))
    : (prng_seed || Math.random().toString(36))
  var old_random = Math.random
  Math.seedrandom(this.prng_seed)
  this.rng = Math.random
  Math.random = old_random

  // set dialect before ports so port whitelist check works
  // subspaces inherit parent dialect (I2: dialect monotonicity)
  this.dialect = parent
    ? parent.dialect
    : (seed.dialect_instance || D.DIALECTS.top)

  // Apply seed dialect restrictions (§3 dialect declarations)
  // Only outer space can declare dialect; subspace declarations are a soft error
  if(seed.dialect && Object.keys(seed.dialect).length) {
    if(parent) {                                    // ANY shape soft-errors [dialect-outer-only]
      D.sploot('Subspace cannot declare its own dialect restrictions')
    } else if(seed.dialect.blocked_methods) {
      var restricted = D.make_restricted_dialect(seed.dialect)
      this.dialect = D.intersect_dialects(this.dialect, restricted)
    }
  }

  // add all the ports at once
  this.ports = seed.ports.map(function(port, index) {return new D.Port(port, self)})

  // add outs to ports; each out remembers its wire's declaration ordinal
  // (the tie-break key [sched-tie-wire]); a wire's nominal timeout stamps
  // the round-trip ports it touches [wire-timeout-explicit]
  seed.routes.forEach(function(route, ri) {
    self.ports[route[0]-1].outs.push(self.ports[route[1]-1])
    self.ports[route[0]-1].out_ordinals.push(ri)
    if(route[2]) {
      ;[self.ports[route[0]-1], self.ports[route[1]-1]].forEach(function(p) {
        if(p.dir == 'up' || p.dir == 'down') p._wire_timeout = route[2]
      })
    }
  })

  // add all my children (names ride from the seed for qnames + PRNG derivation)
  this.subspaces = seed.subspaces.map(function(seed_id, i) {
    return new D.Space(seed_id, self, undefined, seed.subspace_names && seed.subspace_names[i])
  })

  // pair my subspace ports
  this.subspaces.forEach(function(subspace, subspace_index) {
    var port_name_to_port = {}

    for(var key in seed.ports) {
      var port = seed.ports[key]
      if(port.space != subspace_index+1) // 1-indexed
        continue
      port_name_to_port[port.name] = self.ports[key]
    }

    subspace.ports
      .filter(function(port) {return port.space === subspace         // THINK: when is it not?
                                  && !port.station                   // keep out stations
                                  && !port.pair                      // keep out subsubspaces
                                  && port_name_to_port[port.name]})  // just in case we've missed something
      .forEach(function(port) {port_name_to_port[port.name].pairup(port)})
  })

  // socket port-likes know their slot: they act on the subspace directly
  seed.ports.forEach(function(p, i) {
    if(p.space && (p.flavour == 'socket-load' || p.flavour == 'socket-load-smash')) {
      self.ports[i].socket_parent = self
      self.ports[i].socket_index = p.space - 1
    }
  })

 // NOTE: DON'T DELETE THIS YET -- decide what you're doing with dialects first.
//  if(this.parent) {
//    var parent_dialect = this.parent.dialect ? this.parent.dialect : D.DIALECTS.top
//    this.dialect = new D.Dialect(parent_dialect.commands, parent_dialect.aliases)
//    // if(seed.dialect.commands && seed.dialect.commands.minus) {
//    //   var minus = seed.dialect.commands.minus
//    if(seed.dialect.commands && seed.dialect.minus) {
//      var minus = seed.dialect.minus
//      for(var key in minus) {
//        var value = minus[key]
//
//        if(value === true) {
//          delete this.dialect.commands[key]
//          continue
//        }
//
//        value.forEach(function(method) {
//          try {
//            delete this.dialect.commands[key].methods[method]
//          } catch(e) {}
//        })
//      }
//    }
//  }

  // yoiks
  this.only_one_process = true
  this.processes = []
  this.queue = []

  if(seed.blackhole)                                // tell the App a hole formed,
    D.notify_blackhole('on_blackhole', this)        // synchronously, before any ship
}                                                   // docks [blackhole-manifest]

// The App-facing black-hole manifest [blackhole-manifest]: everything the
// App needs to bind the hole — where it is now (qname), its surface
// (ports), and its declared metadata (the wrap-stable binding key
// [blackhole-meta]).
D.blackhole_manifest = function(space) {
  return {
    qname: space.space_path(),
    name: space.name,
    ports: space.seed.ports.map(function(p) {
      return { name: p.name
             , dir: p.name.split(':')[0]
             , flavour: p.flavour
             , settings: (p.settings && p.settings.all) ? p.settings.all.slice(1, -1) : [] }
    }),
    meta: space.seed.meta
  }
}

// Formation/teardown notifications: synchronous outputs to the App, not
// ships; a hook throw is caught and never aborts construction or a socket
// transition [manifest-hook-soft]. No-op unless the App set the hook.
D.notify_blackhole = function(hook, space) {
  if(typeof D.Etc[hook] != 'function') return
  try { D.Etc[hook](D.blackhole_manifest(space)) }
  catch(e) {
    D.sploot('Black-hole ' + (hook == 'on_blackhole' ? 'formation' : 'teardown')
              + ' hook error: ' + e.message)
  }
}

// Teardown notifications for every hole inside a replaced content tree,
// fired at the transition's commit point [blackhole-teardown].
D.teardown_blackholes = function(space) {
  if(!space) return
  if(space.seed && space.seed.blackhole)
    D.notify_blackhole('on_blackhole_teardown', space)
  ;(space.subspaces || []).forEach(function(sub) { D.teardown_blackholes(sub) })
}

// Replace a socket slot's content with freshly-loaded Astroglot (§8).
// A runtime load never borks — bad input sploots and the current content
// is untouched [socket-load-sploot]. The frame (name, parent wiring, the
// two port-likes) persists; everything else is replaced, so svars never
// survive a transition [socket-svars-reset] [socket-load-replace].
// NOTE: mode is accepted but drain (finish in-flight work, buffer
// arrivals) is not yet distinguished from smash — both replace at once.
// Honest drain needs busy-content tracking (virtual-time milestone).
D.socket_load = function(port, src, mode) {
  var parent = port.socket_parent
    , idx = port.socket_index
    , old = parent.subspaces[idx]

  var seed_id
  try { seed_id = D.make_some_space(String(src)) }
  catch(e) { return D.sploot('Socket load splooted: ' + e.message) }

  var newseed = D.SPACESEEDS[seed_id]
  if(!newseed)
    return D.sploot('Socket load splooted: no space compiled')
  if(newseed.blackhole)                             // [blackhole-no-socket-load] (load side)
    return D.sploot('Socket load splooted: a black hole cannot be loaded')

  var busy = old && (old.processes.length || old.queue.length || old._drain_pending)

  if(mode == 'drain' && busy) {
    // the old content finishes its in-flight work first; ships arriving
    // mid-drain buffer at the socket (numbers unchanged [sched-hop-free])
    // and release into the new content when it lands [socket-drain]. The
    // swap fires from cleanup() when the old content goes idle — bounded
    // by the in-flight work's own timeouts, so a drain cannot hang.
    old._drain_pending = { parent: parent, idx: idx, seed_id: seed_id }
    old._drain_buffer = old._drain_buffer || []
    return
  }

  if(busy) {
    // smash: the old content is destroyed at once — svars, queued and
    // in-flight ships; a waiting process ceases to matter and its later
    // response ghosts at the severed boundary [socket-smash]
    old._smashed = true
    old.processes = []
    old.queue = []
  }

  D.perform_socket_swap(parent, idx, seed_id, old)
}

D.perform_socket_swap = function(parent, idx, seed_id, old) {
  D.teardown_blackholes(old)                        // [blackhole-teardown]
  var fresh = new D.Space(seed_id, parent, undefined, old && old.name)
  parent.subspaces[idx] = fresh

  // the parent's wiring of the slot re-applies to the new content's ports
  // by name; a wire naming a port the new content lacks goes inert until
  // demand-created [socket-wiring-demand]
  parent.seed.ports.forEach(function(p, i) {
    if(p.space != idx + 1) return
    if(p.flavour == 'socket-load' || p.flavour == 'socket-load-smash') return  // the frame
    var mine = parent.ports[i]
      , match = null
    fresh.ports.forEach(function(fp) {
      if(!fp.station && !fp.pair && fp.name == mine.name) match = fp
    })
    if(match) mine.pairup(match)
    else mine.pair = false
  })
}

// Qualified names [qname-structure]: a space's qname is its path of
// subspace names from the outer root, '/'-separated (root = '').
D.Space.prototype.space_path = function() {
  if(!this.parent) return ''
  var parent_path = this.parent.space_path()
  return parent_path ? parent_path + '/' + this.name : this.name
}

// A station's bare name; anonymous stations are named s1, s2, ... in
// canonical order [qname-anon-station] [seed-canonical-order].
D.Space.prototype.station_name = function(station_id) {
  if(!this._qnames) {
    var names = this.seed.station_names || []
      , anon = 0
    this._qnames = this.seed.stations.map(function(_, i) {
      return names[i] != null ? names[i] : 's' + (++anon)
    })
  }
  return this._qnames[station_id - 1] || String(station_id)
}

// A station appends its name to its space's path [qname-structure].
D.Space.prototype.station_qname = function(station_id) {
  var name = this.station_name(station_id)
    , path = this.space_path()
  return path ? path + '/' + name : name
}

// The source text a block was compiled from (kept as a decorator, outside
// the content-hashed block itself).
D.block_source = function(block_id) {
  var decs = D.get_decorators(block_id, 'OriginalString')
  return (decs && decs.length) ? decs[0].value : '{}'
}

// §8: a serialized space is Astroglot — the definition plus CURRENT svar
// values. The DECLARED dialect restriction is part of the definition and
// serializes [serialize-keeps-dialect-decl]; the instance dialect and the
// parent's wiring of this space do not. Subspaces serialize recursively as
// sigil-marked nested definitions holding their current content; a block
// in an svar serializes as its source text, dead on reload
// [serialize-block-dead].
// Seed-level station naming: declared name, else s1, s2, ... by canonical
// position [qname-anon-station] [seed-canonical-order].
D.seed_station_name = function(seed, station_id) {
  var names = seed.station_names || [], anon = 0, out = []
  for(var i = 0; i < seed.stations.length; i++)
    out.push(names[i] != null ? names[i] : 's' + (++anon))
  return out[station_id - 1] || String(station_id)
}

// Seed-level canonical serializer: works from a compiled seed alone. A live
// Space passes itself as `live` so CURRENT svar values and live (possibly
// socket-swapped) subspace content serialize instead of the initial
// definition. Anonymous stations serialize inline in their wire chains
// [serialize-anon-inline]; a generated name appears only for hand-built
// shapes no chain can carry (a parsed anon is always one chain occurrence).
D.serialize_seed = function(seed, indent, label, live) {
  var pad = indent || ''
    , inner = pad + '  '
    , lines = []
    , station_name = function(id) { return D.seed_station_name(seed, id) }

  lines.push(pad + (label || (live && live.name) || 'outer'))

  if(seed.dialect && Object.keys(seed.dialect).length)
    lines.push(inner + JSON.stringify(seed.dialect))

  if(seed.meta)                                     // [serialize-keeps-hole-meta]
    lines.push(inner + JSON.stringify(seed.meta))

  seed.ports.forEach(function(p) {                  // own ports only: stations get
    if(p.station || p.space) return                 // theirs implicitly; subspace ports
    var parts = (p.settings && p.settings.all)      // live in the child's definition
              ? p.settings.all.slice(0, -1)
              : [p.flavour]
    var decl = inner + '@' + p.name
    if(!(parts.length == 1 && parts[0] == p.name))  // bare port: flavour defaults
      decl += '  ' + parts.join(' ')
    lines.push(decl)
  })

  var state_keys = {}
  Object.keys(seed.state || {}).forEach(function(k) { state_keys[k] = 1 })
  if(live) Object.keys(live.state).forEach(function(k) { state_keys[k] = 1 })
  Object.keys(state_keys).forEach(function(k) {
    var v = live ? live.get_state(k) : seed.state[k]
    if(D.is_block(v)) v = D.block_source(v.value.id)
    lines.push(inner + '$' + k + ' ' + (JSON.stringify(v) || '""'))
  })

  // wire chains, merging anons inline [serialize-anon-inline]
  var names = seed.station_names || []
  var anon_of_port = function(idx) {
    var p = seed.ports[idx - 1]
    return p && p.station && names[p.station - 1] == null ? p.station : 0
  }
  var anon_out_port = {}, anon_has_in = {}, routes_from = {}
  seed.ports.forEach(function(p, pi) {
    if(p.station && names[p.station - 1] == null && p.name == '_out')
      anon_out_port[p.station] = pi + 1
  })
  seed.routes.forEach(function(r, ri) {
    ;(routes_from[r[0]] = routes_from[r[0]] || []).push(ri)
    if(anon_of_port(r[1])) anon_has_in[anon_of_port(r[1])] = true
  })

  var endpoint = function(idx) {
    var p = seed.ports[idx - 1]
    if(!p) return '@unknown'
    if(p.station)
      return (p.name == '_in' || p.name == '_out')
             ? station_name(p.station)
             : station_name(p.station) + '@' + p.name
    if(p.space)
      return ((seed.subspace_names && seed.subspace_names[p.space - 1]) || 'sub' + (p.space - 1))
             + '@' + p.name
    return '@' + p.name
  }

  var consumed = {}, inlined = {}, route_lines = []
  seed.routes.forEach(function(r, ri) {
    if(consumed[ri]) return
    var src_anon = anon_of_port(r[0])
    if(src_anon && anon_has_in[src_anon]) return    // a continuation; its starter emits it
    consumed[ri] = true
    var parts = [src_anon ? D.block_source(seed.stations[src_anon - 1]) : endpoint(r[0])]
    if(src_anon) inlined[src_anon] = true
    var cur = r, timeout = r[2]
    while(true) {
      var da = anon_of_port(cur[1])
      if(!da) { parts.push(endpoint(cur[1])); break }
      parts.push(D.block_source(seed.stations[da - 1]))
      inlined[da] = true
      var nexts = (routes_from[anon_out_port[da]] || []).filter(function(x) { return !consumed[x] })
      if(!nexts.length) break                       // the anon is the chain's sink
      cur = seed.routes[nexts[0]]
      consumed[nexts[0]] = true
      if(cur[2] && !timeout) timeout = cur[2]
    }
    route_lines.push(inner + parts.join(' -> ') + (timeout ? '  ' + timeout : ''))
  })
  seed.routes.forEach(function(r, ri) {             // hand-built leftovers: old form
    if(consumed[ri]) return
    route_lines.push(inner + endpoint(r[0]) + ' -> ' + endpoint(r[1]) + (r[2] ? '  ' + r[2] : ''))
    if(anon_of_port(r[0])) delete inlined[anon_of_port(r[0])]
    if(anon_of_port(r[1])) delete inlined[anon_of_port(r[1])]
  })

  seed.stations.forEach(function(block_id, i) {     // declared stations; an anon
    if(names[i] == null && inlined[i + 1]) return   // only when no chain carried it
    lines.push(inner + station_name(i + 1) + ' ' + D.block_source(block_id))
  })

  if(live) {
    live.subspaces.forEach(function(sub, i) {
      var sig = sub.seed.blackhole ? '*' : sub.seed.socket ? '!' : '+'
        , name = (seed.subspace_names && seed.subspace_names[i]) || sub.name || ('sub' + i)
      lines.push(sub.serialize(inner, sig + name))
    })
  } else {
    ;(seed.subspaces || []).forEach(function(sid, i) {
      var subseed = D.SPACESEEDS[sid]
      if(!subseed) return
      var sig = subseed.blackhole ? '*' : subseed.socket ? '!' : '+'
        , name = (seed.subspace_names && seed.subspace_names[i]) || ('sub' + i)
      lines.push(D.serialize_seed(subseed, inner, sig + name))
    })
  }

  route_lines.forEach(function(l) { lines.push(l) })

  ;(seed.rules || []).forEach(function(rule) {
    var holder = rule.holder_station
                 ? station_name(rule.holder_station)
                 : ((seed.subspace_names && seed.subspace_names[rule.holder_space - 1]) || 'sub' + (rule.holder_space - 1))
      , target = rule.forward ? '@cmd'
               : rule.target_port ? endpoint(rule.target_port)
               : station_name(seed.ports[rule.target_in - 1].station)
    lines.push(inner + holder + '@cmd:' + rule.pattern + ' <-> ' + target
             + (rule.timeout ? '  ' + rule.timeout : ''))
  })

  return lines.join('\n')
}

D.Space.prototype.serialize = function(indent, label) {
  return D.serialize_seed(this.seed, indent, label, this)
}

D.Space.prototype.root_frontier = function() {
  var s = this
  while(s.parent) s = s.parent
  return s.frontier || 0                          // highest number processed in the runtime subtree
}

D.Space.prototype.raise_frontier = function(number) {
  var s = this
  while(s.parent) s = s.parent
  if(!s.frontier || number > s.frontier) s.frontier = number
}

D.Space.prototype.set_state = function(param, value) {
  return this.state[param] = value
}

D.Space.prototype.get_state = function(param) {
  return (typeof this.state[param] != 'undefined') ? this.state[param] : this.seed.state[param]
}

D.Space.prototype.loadSubspace = function(daml) {
  // Parse DAML source text into a space seed and install as a subspace
  var seed_id = D.make_some_space(daml)
  if (typeof seed_id !== 'number')
    return D.sploot('Failed to load subspace from DAML')

  // Create the subspace with this space as parent
  var subspace = new D.Space(seed_id, this)
  this.subspaces.push(subspace)

  // Create paired ports: for each of the subspace's space-level ports,
  // create a matching port in the parent and pair them together
  var self = this
  subspace.ports
    .filter(function(port) {
      return port.space === subspace                               // belongs to the subspace
          && !port.station                                         // not a station port
          && !port.pair                                            // not already paired (sub-subspace)
    })
    .forEach(function(port) {
      // Create an outside port for the parent side
      var outside_template = {flavour: port.flavour, name: port.name, settings: port.settings || {}}
      var parent_port = new D.Port(outside_template)               // no space → outside port
      parent_port.pairup(port)
    })

  return subspace
}

D.Space.prototype.dock = function(ship, station_id, sender, ship_number) {
  if(ship_number === undefined)                                     // external entry: numbered at the runtime
    ship_number = this.root_frontier()                              // boundary's frontier at ENTRY [sched-entry-frontier]

  var block_id = this.seed.stations[station_id - 1]
  var block    = D.BLOCKS[block_id]
  var out_port = D.filter_ports(this.ports, station_id, '_out')

  if(!out_port)
    return D.sploot('That out port is unavailable')

  // The process number is assigned when the ship actually STARTS — a ship
  // queued behind a held space re-numbers past the wait [sched-dock-max],
  // and the dock hook fires then, not at arrival. The output closure takes
  // the number at completion time (via my_starter), so a process renumbered
  // across an async boundary [sched-reentry-uniform] emits at its current
  // number; the docking slot backstops the synchronous-completion paths.
  var docking = { ship: ship }
  var prior_starter =                                               // THINK: we're jumping straight to exit here.
        function(value, number_out) {out_port.exit(value, {sender: sender, number: number_out !== undefined ? number_out : docking.number})}
  var scope = {"__in": ship}                                        // TODO: find something better...
  var value = this.execute(block, scope, prior_starter, station_id, sender, ship_number, docking)

  if(value === value)
    prior_starter(value)

  // this.station_id = false // THINK: if we go async in here it toasts the station_id...
  // THINK: do we need to send back NaN? there's probably no callstack here to speak of...
}

D.Space.prototype.please_change_your_seed_to = function(seed_id) {
  var old_seed = this.seed
    , new_seed = D.SPACESEEDS[seed_id]

  if(!new_seed)
    return D.sploot('You done messed up')

  if(JSON.stringify(old_seed) == JSON.stringify(new_seed))
    console.log('Identical seeds')

  // we're going to assume that if a subspace has changed, we'll receive a tell_my_parent request instead of a please_change_your_seed_to request. so if we're here and subspaces are different its because we need to add/remove subspaces.

  if(JSON.stringify(old_seed.subspaces) != JSON.stringify(new_seed.subspaces))
    console.log('subspaces differ')

  if(JSON.stringify(old_seed.stations) != JSON.stringify(new_seed.stations))
    console.log('stations differ')
  // station mod -> no change, but add/remove needs change... how do we tell?

  if(JSON.stringify(old_seed.routes) != JSON.stringify(new_seed.routes))
    console.log('routes differ')

  if(JSON.stringify(old_seed.ports) != JSON.stringify(new_seed.ports))
    console.log('ports differ')



  // so we just...
  // - make a new space.
  // - re-pair my ports.
  // uh but timers... and unfinished processes... and state...
  // let's assume we're making the smallest change we can, in a single space.
  // we can copy the state of the old space...
  // but can we copy over the processes?
  // this is a bad way of doing it.

  if(JSON.stringify(old_seed.dialect) != JSON.stringify(new_seed.dialect))  // dialect don't exist yet
    console.log('dialects differ')

  if(JSON.stringify(old_seed.state) != JSON.stringify(new_seed.state))      // seed state is just a fallthrough
    console.log('state differs')


  this.seed = new_seed
  this.tell_my_parent(new_seed)
}

D.Space.prototype.change_seed = function(seed_id) {
  // this points the space to a new seed, while maintain as much of its live state as it can
  // [usually used when modifying just one thing about the space -- don't try to do more than one]
  // space properties: state, ports, subspaces. everything else is in the seed.

  // did a subspace change? pass the word along.

  // did a port change?
    // new port: add it
    // missing port: remove it
    // one port different: transform it (somehow...) <- this is the only tricky bit, maybe

  // did my routes change? do nothing. ----> or maybe have the ports update their routes?

  // did some state change? do nothing. [live state overrides old state, and falls through otherwise]

  // did a station change? do nothing. // TODO: once you start caching processed stations by dialect, clear that cache

  // did the dialect change? do nothing. // TODO: once you start caching processed stations by dialect, clear that cache
}


// D.Space.prototype.hi_i_have_a_new_template_please_update_yourself = function(child, old_template) {
//   // this tells the parent that i have a new template so it needs to update itself and its own template
//
//   // switch all my ports from old space id to new space id
//   // make a new template based on the port mods
//   // tell my parent
//   if(!this.parent)
//     return false
// }

// D.Space.prototype.add_port = function(port) {
//   var port = new D.Port(this, port.flavour, port.settings, this.stations[port.station], port.name, port.typehint)
//   this.ports.push(port)
//
//   return this.export_and_update()
// }

// D.Space.prototype.remove_port = function(port) {
//
//   // TODO: remove the port's routes
//   return this.export_and_update()
// }
//
// D.Space.prototype.add_route = function(from_port, to_port) {
//   // TODO: check ports
//   from_port.outs.slice
//
//   return this.export_and_update()
// }
//
// D.Space.prototype.remove_route = function(from_port, to_port) {
//
//   return this.export_and_update()
// }
//
// D.Space.prototype.add_station = function(block) {
//   // TODO: check block for blockiness or get from ABLOCKS
//   // TODO: add standard station ports (in / out / error)
//
//   this.stations.push(block)
//   return this.export_and_update()
// }
//
// D.Space.prototype.remove_station = function(station) {
//   var index = this.stations.indexOf(station)
//
//   if(index == -1)
//     return D.sploot('No such station found')
//
//   // TODO: remove the station's ports
//
//   this.stations.splice(index, 1) // THINK: this won't work concurrently -- is that ok?
//   return this.export_and_update()
// }
//
// D.Space.prototype.add_space = function(space) {
//
//   return this.export_and_update()
// }
//
// D.Space.prototype.remove_space = function(index) {
//
//   return this.export_and_update()
// }
//
// D.Space.prototype.export_and_update = function(index) {
//   // yurm
//   if(this.loading)
//     return false // we're loading, no need to change
//
//
// }


// D.Space.prototype.deliver = function(message, prior_starter) {
//   // execute the block, with the message loaded in as __
//   var scope = {"__in": message} // TODO: find something better...
//   this.execute(this.block, scope, prior_starter)
// }

// TODO: move this all into a Process, instead of doing it here.
// THINK: there's no protection in here again executing multiple processes concurrently in the same space -- which is bad. find a way to bake that in. [except for those cases of desired in-pipeline parallelism, of course]
D.Space.prototype.execute = function(ablock_or_segment, scope, prior_starter, station_id, sender, number, docking) {
  var self = this
    , block = D.get_block(ablock_or_segment)

  // if(!when_done) {
  //   when_done = function(result) {
  //     // THINK: what should we do here?
  //     D.sploot("No when_done callback sent to space.execute for result: " + D.stringify(result))
  //   }
  // }

  if(this.processes.length && this.only_one_process) {
    // Queue the work: execute when current process completes
    this.queue.push({block: block, scope: scope, prior_starter: prior_starter, station_id: station_id, sender: sender, number: number, docking: docking})
    return NaN
  }

  return self.real_execute(block, scope, prior_starter, station_id, sender, number, docking)
}

D.Space.prototype.real_execute = function(block, scope, prior_starter, station_id, sender, number, docking) {
  var self = this
    , process
    , block = D.try_optimize(block)

  // var new_when_done = function(value) {
  //   self.cleanup(self.pid, self.last_value)
  //   if(when_done)
  //     when_done(value)
  // }

  if(docking) {                                                     // a station dock starting NOW: assign its number
    number = Math.max(this.counter || 0, number) + 1                // [sched-dock-max]
    this.counter = number
    this.raise_frontier(number)
    docking.number = number

    // Deterministic-harness trace hook (additive; no-op unless set). Fires on
    // every station dock with the station's qualified name [qname-structure].
    if(D.Etc.on_dock)
      D.Etc.on_dock({ space: this, station_id: station_id, qname: this.station_qname(station_id)
                    , ship: docking.ship, sender: sender, number: number })
  }

  if(!prior_starter) {
    prior_starter = function() {}
  }

  // override the prior_starter here -- THIS function is the prior starter now. (basically, remember to cleanup after yourself.)

  var my_starter = function(value) {
    self.cleanup(process)
    prior_starter(value, process.number)                            // completion carries the process's CURRENT number
  }

  process = new D.Process(this, block, scope, my_starter, station_id, sender, number)
  this.processes.push(process)

  var result = this.try_execute(process)
  this.cleanup(process)
  return result
}

D.Space.prototype.try_execute = function(process) {
  try {
    return process.run()
  } catch(e) {
    D.sploot(e.message)
  }
}

D.Space.prototype.cleanup = function(process) {
  if(!process.asynced) {
    this.scrub_process(process.pid)
    // this.run_listeners(process.last_value, listeners) // THINK: is process.last_value right?
  }

  this.run_queue()

  // a pending drain swaps once the old content is idle; buffered ships
  // release into the new content in key order via the delivery heap
  // [socket-drain] [sched-hop-free]
  if(this._drain_pending && this.is_idle()) {
    var pend = this._drain_pending
      , buffered = this._drain_buffer || []
    this._drain_pending = null
    this._drain_buffer = []
    D.perform_socket_swap(pend.parent, pend.idx, pend.seed_id, this)
    buffered.forEach(function(b) {
      D.schedule_delivery(b.number, function() {
        b.port.enter(b.ship, { sender: b.sender, number: b.number })
      })
    })
  }
}

D.Space.prototype.run_queue = function() {
  if(this.processes.length || !this.queue.length) return     // busy or nothing to do

  var self = this
  var best = 0
  for(var i = 1; i < this.queue.length; i++)                 // [space-queue]: lowest number first; strict <
    if((this.queue[i].number || 0) < (this.queue[best].number || 0)) best = i   // keeps FIFO among equals
  var item = this.queue.splice(best, 1)[0]

  D.setImmediate(function() {
    var result = self.real_execute(item.block, item.scope, item.prior_starter, item.station_id, item.sender, item.number, item.docking)
    if(result === result)
      item.prior_starter(result)                             // was queued (async from caller's perspective) but completed sync
  })
}

D.Space.prototype.scrub_process = function(pid) {
  // OPT: store a ref or something make this faster
  for(var i=0, l=this.processes.length; i < l; i++) {
    if(this.processes[i].pid == pid) {
      var proc = this.processes[i]
      this.processes.splice(i, 1)
      break
    }
  }
}


// ── Deterministic-harness hooks (additive) ───────────────────────────
// A space is idle when nothing is running and nothing is queued. An
// async process waiting on a world response stays in `processes`, so
// this correctly reads "not idle" until that response arrives.
D.Space.prototype.is_idle = function() {
  return !this.processes.length && !this.queue.length
}

// A bare, isolated execution space (its own svar `state`). Backs
// D.ExecutionSpace and lets tests get a fresh, non-leaking space per run.
D.make_execution_space = function() {
  return new D.Space(D.spaceseed_add(
    { dialect: { commands: {}, aliases: {} }, stations: [], subspaces: [],
      ports: [], routes: [], state: {} }))
}

// (Quiescence *driving* — settle — lives in the deterministic test harness:
// it needs to count outstanding setImmediate deferrals, which is cleanest to
// instrument at harness import once the engine is fully loaded.)



D.try_optimize = function(block) {
  if(!D.Etc.use_optimizations) return block

  var map = D.Etc.OptimizationMap                      // THINK: a weakmap might work well here
  var block_id = block.id

  if(map[block_id])
    return map[block_id]

  for(var i=0, l=D.Optimizers.length; i < l; i++)
    block = D.Optimizers[i].fun(block)

  map[block_id] = block
  return block
}



D.Optimizers = []
D.import_optimizer = function(name, priority, fun) {
  if( priority <= 0                                    // priority is between 0 and 1 *exclusive*
   || priority >= 1 )                                  // this means you can always fit something
      priority  = 0.5                                  // at start or end, up to float precision.

  var opt = { fun: fun                                 // fun takes a block as an argument and
            , name: name                               // returns a block (same or different)
            , priority: priority }

  D.Optimizers.push(opt)
  D.Optimizers.sort(function(a, b) { return a.priority - b.priority })
}



  /*ooooooo.   ooooooooo.     .oooooo.     .oooooo.   oooooooooooo  .oooooo..o  .oooooo..o
  `888   `Y88. `888   `Y88.  d8P'  `Y8b   d8P'  `Y8b  `888'     `8 d8P'    `Y8 d8P'    `Y8
   888   .d88'  888   .d88' 888      888 888           888         Y88bo.      Y88bo.
   888ooo88P'   888ooo88P'  888      888 888           888oooo8     `"Y8888o.   `"Y8888o.
   888          888`88b.    888      888 888           888    "         `"Y88b      `"Y88b
   888          888  `88b.  `88b    d88' `88b    ooo   888       o oo     .d8P oo     .d8P
  o888o        o888o  o888o  `Y8bood8P'   `Y8bood8P'  o888ooooood8 8""88888P'  8""88888*/


D.Process = function(space, block, scope, prior_starter, station_id, sender, number) {

  /*
      A Process executes a single Block from start to finish, executing each segment in turn and handling the wiring.
      Returns the last value from the Block's pipeline, or passes that value to prior_starter() and returns NaN if any segments go async.
      Each Process is used only once, for that one Block execution, and then goes away.
      A Process may launch sub-processes, depending on the segments in the Block.
  */

  this.pid = D.Etc.process_counter++
  this.sender = sender || null
  this.number = number || 0                                     // scheduler number (virtual time); sub-processes
                                                                // share the root's number — flat numbering
  this.effective_dialect = sender && sender.dialect
    ? D.intersect_dialects(sender.dialect, space.dialect)
    : space.dialect
  this.starttime = Date.now()
  this.current = 0
  this.space = space
  this.block = block
  // this.when_done = when_done
  this.prior_starter = prior_starter
  this.asynced = false
  this.station_id = station_id

  var self = this
  this.my_starter = function(value) {
    self.last_value = value
    self.state[self.current] = value                            // TODO: fix this it isn't general // DATA
    self.current++
    self.run()
  }

  this.state = scope || {}                                      // process-level vars, like wiring,
                                                                // should be local to the process
  if(this.state['__in'] === undefined)
    this.state['__in'] = ""                                     // ha ha jk oh wait we need this
}

D.Process.prototype.done = function() {
  var output = this.last_value                                  // default output

  if(this.block.wiring['*out']) {                               // THINK: this isn't currently used anywhere...
    var outs = this.block.wiring['*out']
    if(outs.length == 1) {
      output = this.state[outs[0]] // DATA
    }
    else {
      output = []
      for(var i=0, l=outs.length; i < l; i++) {
        output.push(this.state[outs[i]])                        // THINK: sometimes array sometimes not is always weird // DATA
      }
    }
  }

  output = D.make_nice(output)                                  // THINK: should probably do this for each
                                                                // possible output in the array form
  if(this.asynced) {
    this.asynced = false                                        // ORLY??
    if(this.prior_starter)
      this.prior_starter(output)
    return undefined
  }

  return output
}

D.Process.prototype.run = function() {
  var value = ""
  var segs  = this.block.segments
  var wires = this.block.wiring
  var dialect = this.effective_dialect
  var current = this.current
  var segment = segs[current]

  D.Etc.active_space = this.space
  D.Etc.active_process = this

  while(segment) {
    value = this.next(segment, current, wires, dialect)             // TODO: this is not a trampoline
    if(value !== value) {
      this.current = current
      this.asynced = true
      return NaN                                                    // NaN is the "I took the callback route" signal...
    }
    this.last_value = value
    this.state[current] = value                                     // TODO: fix this it isn't general // DATA
    current++
    segment = segs[current]
  }

  return this.done()
}

D.Process.prototype.next = function(segment, current, wires, dialect) {
  var type = D.SegmentTypes[segment.type]
  var key  = segment.key || current
  var wire = wires[key]

  var inputs = wire ? D.nicify(wire, this.state) : [] // DATA

  return type.execute(segment, inputs, dialect, this.my_starter, this)
}



   /*ooooo..o                                                                             .o8
  d8P'    `Y8                                                                            "888
  Y88bo.      oo.ooooo.   .oooo.    .ooooo.   .ooooo.   .oooo.o  .ooooo.   .ooooo.   .oooo888   .oooo.o
   `"Y8888o.   888' `88b `P  )88b  d88' `"Y8 d88' `88b d88(  "8 d88' `88b d88' `88b d88' `888  d88(  "8
       `"Y88b  888   888  .oP"888  888       888ooo888 `"Y88b.  888ooo888 888ooo888 888   888  `"Y88b.
  oo     .d8P  888   888 d8(  888  888   .o8 888    .o o.  )88b 888    .o 888    .o 888   888  o.  )88b
  8""88888P'   888bod8P' `Y888""8o `Y8bod8P' `Y8bod8P' 8""888P' `Y8bod8P' `Y8bod8P' `Y8bod88P" 8""888P'
               888
              o88*/


/*

  EVERYTHING BELOW HERE IS CRAZYPANTS

*/


/*
  Adding a new SPACESEED is complicated.
  - does it have an id?
    - remove if != hash(json)
  - do the parts check out?
    - if dialect, stations, subspaces, ports, routes or state are invalid, err
  - order all the parts
  - hash, add, and return id
*/

D.spaceseed_add = function(seed) {
  var good_props = { dialect: 1, stations: 1, subspaces: 1, ports: 1, routes: 1, state: 1, rules: 1
                   , station_names: 1, subspace_names: 1     // declared names, canonical order [qname-structure]
                   , blackhole: 1, socket: 1                 // space-kind flags (§3 sigils)
                   , meta: 1 }                               // hole metadata [blackhole-meta]
    , item

  for(var key in seed)
    if(!good_props[key])
      delete seed[key] // ensure no errant properties, including id

  // TODO: check dialect [id -> D.DIALECTS]
  // TODO: check stations [array of id -> D.BLOCKS]
  // TODO: check subspaces [array of id -> D.SPACESEEDS]
  // TODO: check ports [array of port things]
  // TODO: check routes [array of port indices]
  // TODO: check state [a jsonifiable object] [badseeds]

  // TODO: tab detection and elimination

  seed = D.clone(seed) // keep the ref popo off our tails
  seed = D.sort_object_keys(seed)
  seed.state = D.sort_object_keys(seed.state)


  var sorted_stations = D.clone(seed.stations).sort(function(a,b) {return a - b})
    , station_index_to_ports = {}
    , new_stations = []
    , last_offset = {}

  if(JSON.stringify(seed.stations) != JSON.stringify(sorted_stations)) {

    seed.ports.forEach(function(port) {
      var item = station_index_to_ports[port.station]
      item ? item.push(port) : station_index_to_ports[port.station] = [port]
    })

    var station_map = {}

    seed.stations.forEach(function(station, index) {
      var old_index = index + 1
        , new_index = sorted_stations.indexOf(station, last_offset[station]) + 1

      station_map[old_index] = new_index

      if(station_index_to_ports[old_index]) {
        station_index_to_ports[old_index].forEach(function(port) {
          port.station = new_index
        })
      }

      last_offset[station] = new_index
    })

    ;(seed.rules || []).forEach(function(rule) {
      if(rule.holder_station) rule.holder_station = station_map[rule.holder_station]
    })

    if(seed.station_names) {                    // names ride the same permutation
      var old_station_names = seed.station_names
      seed.station_names = seed.stations.map(function(_, index) { return null })
      seed.stations.forEach(function(_, index) {
        seed.station_names[station_map[index + 1] - 1] = old_station_names[index]
      })
    }

    seed.stations = sorted_stations
  }


  var sorted_subspaces = D.clone(seed.subspaces).sort(function(a,b) {return a - b})
    , space_index_to_ports = {}
    , new_subspaces = []
    , last_offset = {}

  if(JSON.stringify(seed.subspaces) != JSON.stringify(sorted_subspaces)) {

    seed.ports.forEach(function(port) {
      var item = space_index_to_ports[port.space]
      item ? item.push(port) : space_index_to_ports[port.space] = [port]
    })

    var space_map = {}

    seed.subspaces.forEach(function(subspace, index) {
      var old_index = index + 1
        , new_index = sorted_subspaces.indexOf(subspace, last_offset[subspace]) + 1

      space_map[old_index] = new_index

      if(space_index_to_ports[old_index]) {
        space_index_to_ports[old_index].forEach(function(port) {
          port.space = new_index
        })
      }

      last_offset[subspace] = new_index
    })

    ;(seed.rules || []).forEach(function(rule) {
      if(rule.holder_space) rule.holder_space = space_map[rule.holder_space]
    })

    if(seed.subspace_names) {                   // names ride the same permutation
      var old_subspace_names = seed.subspace_names
      seed.subspace_names = seed.subspaces.map(function() { return null })
      seed.subspaces.forEach(function(_, index) {
        seed.subspace_names[space_map[index + 1] - 1] = old_subspace_names[index]
      })
    }

    seed.subspaces = sorted_subspaces
  }


  // oh dear


  var port_sort = function(portA, portB) {
    if(portA.space != portB.space)
      return portA.space > portB.space

    if(portA.station && portA.station != portB.station)
      return portA.station > portB.station

    if(portA.subspace && portA.subspace != portB.subspace)
      return portA.subspace > portB.subspace

    return portA.name > portB.name
  }

  // ensure the right properties, in sort order
  var good_port_props = ['space', 'station', 'name', 'flavour', 'typehint', 'settings']
  var ports = seed.ports.map(function(port) {
    var newport = {}
    for(var key in good_port_props)
      newport[good_port_props[key]] = port[good_port_props[key]]
    return newport
  })
  var sorted_string_ports = ports.map(JSON.stringify).sort()
  var route_clone = D.clone(seed.routes)

  if(JSON.stringify(seed.ports) != JSON.stringify(sorted_string_ports)) {
    // go through each item, find its match and modify all containing routes

    var port_index_to_routes = {}

    route_clone.forEach(function(route, index) {
      route.index = index

      item = port_index_to_routes[route[0]]
      item ? item.push(route) : port_index_to_routes[route[0]] = [route]

      item = port_index_to_routes[route[1]]
      item ? item.push(route) : port_index_to_routes[route[1]] = [route]
    })

    var port_map = {}

    ports.forEach(function(port, index) {
      var port = ports[index]
        , old_index = index + 1 // +1 for offset array indices
        , new_index = sorted_string_ports.indexOf(JSON.stringify(port)) + 1

      port_map[old_index] = new_index

      if(port_index_to_routes[old_index]) {
        port_index_to_routes[old_index].forEach(function(route) {
          if(route[0] == old_index)
            seed.routes[route.index][0] = new_index
          if(route[1] == old_index)
            seed.routes[route.index][1] = new_index
        })
      }
    })

    ;(seed.rules || []).forEach(function(rule) {
      if(rule.target_port) rule.target_port = port_map[rule.target_port]
      if(rule.target_in)   rule.target_in   = port_map[rule.target_in]
      if(rule.target_out)  rule.target_out  = port_map[rule.target_out]
    })

  }
  seed.ports = sorted_string_ports.map(JSON.parse)

  // these we can just sort. phew!
  seed.routes.sort(function(routeA, routeB) {
    if(routeA[0] != routeB[0])
      return routeA[0] > routeB[0]

    return routeA[1] > routeB[1]
  })

  seed.id = D.spaceseed_hash(seed)
  D.SPACESEEDS[seed.id] = seed // THINK: collision resolution?

  return seed.id
}

D.spaceseed_hash = function(seed) {
  return murmurhash(JSON.stringify(seed))
}


D.make_some_space = function(stringlike, templates) {
  // A malformed definition borks HARD [spacedef-hard-error]: the throw
  // propagates and no spaceseed is created. Callers with partial input
  // (editors, harnesses) wrap their own try/catch.
  return D.make_spaceseeds(D.seedlikes_from_string(stringlike, templates))
}

D.seedlikes_from_string = function(stringlike, templates, scope_chain) {
  // scope_chain: resolvers for the enclosing lexical chain, innermost
  // first [spacesyn-scope-chain] — each maps a name to a seedlike key
  // among the definitions COMPLETE when the child parse began. Local defs
  // live under globally-unique 'name::N' keys, which bare-name references
  // never match — visibility flows only through the chain. A socket child
  // gets an EMPTY chain: nothing outside its own subtree is referenceable
  // [socket-scope-barrier].
  var seedlikes = {}
    , seed_offset = -1
    , prop_offset = -1
    , seed_name = ''
    , this_seed = {}
    , continuation = ''
    , action = ''
    , action_name = ''
    , sigil = ''
    , maybe_subspace = false
    , subspace_buffer = []
    , templates = templates || {}
    , scope_chain = scope_chain || []
    , top_sources = {}                              // raw source per definition, as
    , top_raw = []                                  // written [state-ref]

  var finalize_source = function(name, lines) {     // append a definition's raw text to its
    top_sources[name] = (top_sources[name] ? top_sources[name] + '\n' : '')  // accumulated
                      + lines.join('\n').replace(/\s+$/, '')                  // source [state-ref]
  }

  var resolve_space = function(name) {              // innermost shadows [spacesyn-shadow-local]
    if(this_seed.subspaces[name]) return this_seed.subspaces[name]
    if(seedlikes[name]) return name
    for(var ci = 0; ci < scope_chain.length; ci++) {
      var hit = scope_chain[ci](name)
      if(hit) return hit
    }
    return false
  }

  // THINK: if we use parser combinators, can we uncombinate in reverse to get back our string?
  // first break it apart by lines and organize into seedlikes

  // flush the pending property action (also called at end-of-input, so the
  // last property no longer needs a trailing line to land)
  var flush_action = function() {
    if(!action) return
    var value

      continuation = continuation.replace(/^\s+|\s+$/g, '')

      if(action == 'dialect') {
        var json_decl
        try {json_decl = JSON.parse(continuation)}
        catch(e) {
          D.bork((this_seed.blackhole ? 'Invalid JSON in black-hole metadata: '
                 : 'Invalid JSON in dialect declaration: ')
                 + continuation)           // [spacesyn-dialect] [blackhole-meta]
        }
        if(this_seed._json_seen)
          D.bork('A space body takes at most one JSON object declaration: ' + continuation)
        this_seed._json_seen = true
        if(this_seed.blackhole)
          this_seed.meta = json_decl              // [blackhole-meta]
        else
          this_seed.dialect = json_decl
      }

      if(action == 'port') {
        if(action_name.indexOf('cmd:') == 0)        // [demandport-create]
          D.bork('cmd: ports are demand-created and cannot be declared: @' + action_name)
        value = continuation ? continuation.split(/\s+/) : [action_name]
        if(value[0] == 'socket-load' || value[0] == 'socket-load-smash')
          D.bork('the socket-load flavour is retired — declare the socket with !name; '
                 + 'its port-likes are implicit: @' + action_name)  // [socket-portlike-implicit]
        this_seed.ports[action_name] = value //.map(function(item) {return item.replace(/^\s+|\s+$/g, '')})
      }

      if(action == 'state') {
        if(continuation === '') {
          // $name alone: the var is simply not set [spacesyn-state]
        } else if(/^[a-z][a-z0-9_-]*$/.test(continuation)) {
          // bare word: definition reference [state-ref] — true/false/null
          // read as names (Daimio has no booleans or nulls)
          var refkey = resolve_space(continuation)
          if(!refkey)
            D.bork('State reference "' + continuation + '" resolves to '
                   + 'no visible definition: $' + action_name)  // [state-ref-unresolved-bork]
          if(!this_seed.state_refs) this_seed.state_refs = {}  // refs live OUT-OF-BAND, never
          this_seed.state_refs[action_name] = refkey           // inside the value [state-ref]
        } else {
          try {this_seed.state[action_name] = JSON.parse(continuation)}
          catch(e) {
            D.bork('State value is neither a definition name nor valid JSON: $'
                   + action_name + ' ' + continuation)
          }
        }
      }

      if(action == 'station') {
        if(sigil) {                                 // sigil-marked nested space definition [spacesyn-subspace-nested]
          // a * sigil rides into the child parse so the child knows it is a
          // black hole DURING its body parse (JSON -> meta [blackhole-meta]);
          // the child's chain adds this level's completed definitions —
          // except a socket child, whose chain is empty [socket-scope-barrier]
          var child_chain = sigil == '!' ? [] : [function(name) {
            return this_seed.subspaces[name] || (seedlikes[name] && name) || false
          }].concat(scope_chain)
          var child = D.seedlikes_from_string((sigil == '*' ? '*' : '') + action_name
                                              + "\n" + subspace_buffer.join("\n"),
                                              templates, child_chain)
          var local_key = action_name + '::' + (D.Etc.local_def_counter = (D.Etc.local_def_counter || 0) + 1)
          for(var child_name in child) {
            if(child_name == action_name) {
              if(sigil == '!') child[child_name].socket = true       // [spacesyn-socket]
              if(sigil == '*') child[child_name].blackhole = true    // [spacesyn-blackhole]
              seedlikes[local_key] = child[child_name]
            } else {
              seedlikes[child_name] = child[child_name]  // grandchild '::' keys are globally unique
            }
          }
          this_seed.subspaces[action_name] = local_key   // shadows any top-level name [spacesyn-shadow-local]
        }
        else {
          var structural = maybe_subspace && subspace_buffer.filter(function(bline) {
            var head = bline.replace(/^\s+/, '')
            return head[0] == '@' || head[0] == '$' || head.indexOf('->') >= 0
          }).length

          if(structural)                            // a bare block is always a station — never a silent subspace
            D.bork('A nested space definition requires its sigil '
                   + '(+name subspace, *name black hole, !name socket): '
                   + action_name)            // [spacesyn-sigil-required]

          if(!continuation && templates[action_name])
            continuation = templates[action_name]
          this_seed.stations[action_name] = {value: continuation}
        }
      }

      sigil = ''
      maybe_subspace = false
      subspace_buffer = []
      continuation = ''
      action = ''
      }

  stringlike+="\n" // catches unfinished continuations

  // prescan to fix split lines
  // "aaaaaaandy\naaaaasdf\n\aaakj32".replace(RegExp('\na{' + n + ',}', 'gm'), ' ')
  // THINK: the above would work instead of relying on the ordering complexity below... but we'd need to get prop_offset *before* starting the forEach, so multiple passes. which might not be that bad. though we'd also miss out on saving the multiline blocks, but maybe that doesn't matter?

  stringlike.split("\n").forEach(function(line) {
    var this_offset = line.length - line.replace(/^\s+/,'').length
      , name='', value=''

    top_raw.push(line)                              // verbatim, before any trimming

    line = line.replace(/^\s+|\s+$/g, '')
    if(!line)
      return

    if(line[0] == '/')
      return

    if(seed_offset < 0)
      seed_offset = this_offset

    if(this_offset != seed_offset) {
      if(prop_offset < 0) {
        prop_offset = this_offset
      }

      if(this_offset > prop_offset) {
        if(maybe_subspace)                          // capture the block body verbatim, indentation preserved
          subspace_buffer.push(new Array(this_offset + 1).join(' ') + line)

        if(line.indexOf('->') == -1) {
          continuation += " " +line
          return
        }

        if(maybe_subspace)                          // -> lines belong to the block, not the parent's wires
          return
      }
    }

    flush_action()

    if(this_offset == seed_offset) {
      if(seed_name) {
        if(seedlikes[seed_name]) {
          D.recursive_extend(seedlikes[seed_name], this_seed)
        } else {
          seedlikes[seed_name] = this_seed
        }
      }

      if(line[0] == '+' || line[0] == '!')          // [spacesyn-sigil-required] [socket-load-not-root]
        D.bork('The ' + line[0] + ' sigil marks a nested space definition; '
               + 'top-level spaces are bare (or *name for a black hole): ' + line)

      if(seed_name)                                 // finalize the previous definition's raw
        finalize_source(seed_name, top_raw.slice(0, -1))  // text (this label line excluded)
      top_raw = top_raw.slice(-1)                   // the new label starts the next source

      var top_blackhole = line[0] == '*'            // [spacesyn-blackhole]
      seed_name = top_blackhole ? line.slice(1) : line
      this_seed = {ports:{}, state:{}, routes:[], dialect:{}, stations:{}, subspaces:{}, rules:[]}
      if(top_blackhole) this_seed.blackhole = true

      return
    }

    continuation = line

    if(line[0] == '{') {
      // a body-level line is a JSON declaration (dialect/metadata) only when
      // it parses as a single JSON object; otherwise a line-initial '{' opens
      // a wire's inline anonymous station [spacesyn-json-vs-wire]
      var lone_json = false
      try {JSON.parse(line); lone_json = true} catch(e) {}
      if(lone_json) {
        action = 'dialect'
        return
      }
      if(line.indexOf('->') == -1)
        D.bork((this_seed.blackhole ? 'Invalid JSON in black-hole metadata: '
               : 'Invalid JSON in dialect declaration: ') + line)
      // falls through: a wire whose first endpoint is an inline station
    }

    name = line.split(' ', 1)[0]
    continuation = line.slice(name.length).replace(/^\s+|\s+$/g, '')

    if(name[0] == '@' && line.indexOf('->') == -1) {
      action_name = name.slice(1)                   // e.g. 'in:init', 'out', 'out:err'
      action = 'port'
      return
    }

    if(name[0] == '$') {
      action_name = name.slice(1)
      action = 'state'
      return
    }

    if(/^[+!*][a-z]/.test(name) && line.indexOf('->') == -1) {
      if(continuation)                              // a sigil label takes an indented body, nothing inline
        D.bork('A nested space definition takes an indented body: ' + line)
      sigil = name[0]                               // [spacesyn-subspace-nested]
      action_name = name.slice(1)
      action = 'station'
      maybe_subspace = true
      subspace_buffer = []
      return
    }

    if(continuation[0] == '{' || line.indexOf('->') == -1) {
      action_name = name
      action = 'station'
      if(!continuation) {                           // bare name — may open a subspace block
        maybe_subspace = true
        subspace_buffer = []
      }
      return
    }

    continuation = ''
    action = ''

    if(/<->/.test(line)) {
      // Contract wiring, port-first: LHS is a round-trip port (my @up/@down,
      // or a subspace down port); RHS is a station, inline {block}, my down
      // port, or a subspace up port. Two routes: request leg + response leg.
      // A holder@cmd:glob LHS is a wiring rule — stored, not routed (item B).
      // Malformed contracts bork [spacedef-hard-error] [roundtrip-enex-lhs].
      var parts = line.split('<->')
      if(parts.length != 2)
        D.bork('A contract must have exactly two endpoints: ' + line)

      var lhs = parts[0].replace(/^\s+|\s+$/g, '')
        , rhs = parts[1].replace(/^\s+|\s+$/g, '')
        , lkey, rkey
        , wire_timeout

      var cmd_at = lhs.indexOf('@cmd:')
      if(cmd_at > 0) {                                   // cmd wiring rule: holder@cmd:glob <-> target [timeout]
        var rule_bits = rhs.split(/\s+/)
          , holder = lhs.slice(0, cmd_at)
          , target = rule_bits[0]

        var holder_key = resolve_space(holder)           // a rule pulls referenced spaces in,
        if(holder_key)                                   // just like a wire does (locals first)
          this_seed.subspaces[holder] = holder_key

        if(target[0] != '@') {                           // sibling-port (name@up) or station target
          var tname = target.split(/[@.]/)[0]
            , tkey = resolve_space(tname)
          if(tkey)
            this_seed.subspaces[tname] = tkey
        }

        this_seed.rules.push({ holder:  holder
                             , pattern: lhs.slice(cmd_at + 5)
                             , target:  target
                             , timeout: rule_bits[1] ? +rule_bits[1] : undefined })
        return
      }

      var tmatch = rhs.match(/^(.*\S)\s+(\d+)$/)     // trailing integer: nominal
      if(tmatch) {                                     // timeout in ms (all wires, §3)
        wire_timeout = +tmatch[2]
        rhs = tmatch[1]
      }

      if(lhs[0] == '@') lhs = lhs.slice(1)
      if(lhs.indexOf('@') > 0) lhs = lhs.replace('@', '.')

      if(lhs.indexOf('.') > 0) {                         // subspace port: only sub@down[:x] enters a contract as LHS
        var lsplit = lhs.split('.', 2)
          , lspace = resolve_space(lsplit[0])
        if(!lspace || !/^down(:|$)/.test(lsplit[1]))
          D.bork('Contract LHS must be an up/down port or a subspace down port: ' + line)
        this_seed.subspaces[lsplit[0]] = lspace
        lkey = lhs
      }
      else {
        var ldecl = this_seed.ports[lhs]
          , lflav = ldecl && D.PortFlavours[ldecl[0]]
          , ldir  = lflav ? lflav.dir : lhs.split(':')[0]
        if(ldir != 'up')                                 // my-own contract LHS is Enter-N-Exit: @up only
          D.bork('Contract LHS must be an @up port, or a subspace @down/@cmd port: ' + line)
        if(!ldecl)
          this_seed.ports[lhs] = [ldir]                  // implicit creation, default flavour for the direction
        lkey = lhs
      }

      if(rhs[0] == '{') {                                // inline block fulfills the contract: mint its station
        var confake = 'station-' + Math.random().toString().slice(2)
        this_seed.stations[confake] = {value: rhs, anon: true}
        rhs = confake
      }

      if(rhs[0] == '@') {                                // my down port responds (or forwards)
        var rport = rhs.slice(1)
          , rdecl = this_seed.ports[rport]
          , rflav = rdecl && D.PortFlavours[rdecl[0]]
          , rdir  = rflav ? rflav.dir : rport.split(':')[0]
        if(rdir != 'down')                               // my-own contract RHS is Exit-N-Reenter: @down only
          D.bork('Contract RHS must be a station, an @down port, or a subspace @up port: ' + line)
        if(!rdecl)
          this_seed.ports[rport] = [rdir]
        rkey = rport
      }
      else if(rhs.indexOf('@') > 0 || rhs.indexOf('.') > 0) {
        var rnorm  = rhs.indexOf('@') > 0 ? rhs.replace('@', '.') : rhs
          , rsplit = rnorm.split('.', 2)
          , rspace = resolve_space(rsplit[0])
        if(this_seed.stations[rsplit[0]])
          D.bork('A station named port cannot fulfill a contract (use the bare station name): ' + line)
        if(!rspace || !/^up(:|$)/.test(rsplit[1]))
          D.bork('Contract RHS must be a station, a down port, or a subspace up port: ' + line)
        this_seed.subspaces[rsplit[0]] = rspace
        rkey = rnorm
      }

      if(rkey) {
        this_seed.routes.push(wire_timeout ? [lkey, rkey, wire_timeout] : [lkey, rkey])
        this_seed.routes.push(wire_timeout ? [rkey, lkey, wire_timeout] : [rkey, lkey])
      } else {
        this_seed.routes.push(wire_timeout ? [lkey, rhs + '.in', wire_timeout] : [lkey, rhs + '.in'])  // station implicit ports still use '.' internally
        this_seed.routes.push(wire_timeout ? [rhs + '.out', lkey, wire_timeout] : [rhs + '.out', lkey])
      }
      return
    }

    if(/->/.test(line)) {                          // THINK: should this use continuations also?

      var faf_timeout
      var ftmatch = line.match(/^(.*\S)\s+(\d+)$/)   // trailing integer: nominal timeout
      if(ftmatch && ftmatch[1].slice(-1) != '{') {     // in ms, applied to each hop (§3)
        faf_timeout = +ftmatch[2]
        line = ftmatch[1]
      }

      var push_route = function(r) {
        this_seed.routes.push(faf_timeout ? r.concat(faf_timeout) : r)
      }

      var route = []
      line.split('->').forEach(function(part, index) {
        part = part.replace(/^\s+|\s+$/g, '')

        if(part[0] == '{') {
          var fakename = 'station-' + Math.random().toString().slice(2)
          this_seed.stations[fakename] = {value: part, anon: true}
          part = fakename
        }

        if(/^[+!*]/.test(part))                     // references always use the bare name
          D.bork('Sigils appear only at definition sites; endpoints use the bare name: '
                 + part)                     // [blackhole-ref-bare]

        if(part.indexOf('@') > 0)                  // name@port endpoint (§3) — '.' is the internal key form
          part = part.replace('@', '.')

        if(part[0] == '@') {
          var pkey = part.slice(1)
            , pdir = pkey.split(':')[0]
          if(!this_seed.ports[pkey] && /^(in|out|up|down)$/.test(pdir))
            this_seed.ports[pkey] = [pdir]         // implicit creation, default flavour [port-implicit-create]
          route.push(pkey)                         // direction doesn't matter for ports
        }
        else if(part.indexOf('.') >= 0) {          // subspace, or station?
          var split = part.split('.', 2)
            , name = split[0]
            , port = split[1]

          // THINK: this implies you can't have like-named stations and spaces
          if(this_seed.stations[name]) {
            this_seed.stations[name].extraports = this_seed.stations[name].extraports
                                                ? this_seed.stations[name].extraports.concat([port])
                                                : [port]
          } else if(resolve_space(name)) {         // innermost visible wins [spacesyn-scope-chain]
            this_seed.subspaces[name] = resolve_space(name)  // TODO: foo.in, foo-1.in, foo-2.in, etc
          } else {
            D.bork('Subspace "' + name + '" is not visible here (undefined, '
                   + 'incomplete, or outside a socket barrier)') // [spacesyn-unresolved-ref] [spacesyn-subspace-before-ref] [socket-scope-barrier]
          }
          if(route.length) {
            route.push(part)                     // destination (entering subspace)
            if(!route[0] || !route[1]) {
              D.sploot('Port not found in line: ' + line)
              route = []
            } else {
              push_route(route)
              route = [part]                     // also becomes source for next route
            }
          } else {
            route.push(part)                     // source (exiting subspace)
          }
        }
        else {                                     // station dir matters
          if(!route.length)
            route.push(part + '.out')
          else {
            route.push(part + '.in')               // TODO: ensure pushed route isn't null,null
            if(!route[0] || !route[1]) {
              D.sploot('Port not found in line: ' + line)
              route = []
            }
            else {
              push_route(route)
              route = [part + '.out']
            }
          }
        }

        // TODO: lists should create complete N-partite graphs: (@in1 @in2) -> (s1 s2) -> (@out1 @out2)

        if(route.length == 2) {
          // only the port branch reaches here with a full pair
          if(!route[0] || !route[1]) {
            D.sploot('Port not found in line: ' + line)
            route = []
          }
          else {
            push_route(route)
            route = [route[1]]          // a mid-chain port is the next hop's source
          }
        }
      })

      return
    }
  })

  flush_action()

  if(JSON.stringify(this_seed) != JSON.stringify({ports:{}, state:{}, routes:[], dialect:{}, stations:{}, subspaces:{}, rules:[]})) {
    if(seedlikes[seed_name]) {
      D.recursive_extend(seedlikes[seed_name], this_seed)
    } else {
      seedlikes[seed_name] = this_seed
    }
  }

  if(seed_name)                                     // finalize the last definition and
    finalize_source(seed_name, top_raw)             // attach raw sources [state-ref]
  for(var sname in top_sources)
    if(seedlikes[sname]) seedlikes[sname].source = top_sources[sname]
    // seedlikes[seed_name] = this_seed

  return seedlikes
}

D.make_spaceseeds = function(seedlikes) {
  var seedmap = {}
    , newseeds = {}

  for(var seedkey in seedlikes) {
    var seed = seedlikes[seedkey]
      , ports = seed.ports || {}
      , state = seed.state || {}
      , routes = seed.routes || []
      , dialect = seed.dialect || {}
      , stations = seed.stations || {}
      , subspaces = seed.subspaces || {}
      , newseed = {}

    newseed.state = {}
    for(var sk in state)                            // plain state values pass through untouched —
      newseed.state[sk] = state[sk]                 // a user object is never inspected for sentinels

    var state_refs = seed.state_refs || {}          // definition references [state-ref] live out-of-band:
    for(var rk in state_refs) {                     // resolve each to the referenced def's canonical
      var refsl = seedlikes[state_refs[rk]]         // source, captured at compile [state-ref-parse-time]
      newseed.state[rk] = refsl && refsl.source != null ? refsl.source : ''  // raw text, as written
    }
    newseed.dialect = dialect // TODO: check dialect
    if(seed.blackhole) newseed.blackhole = true
    if(seed.socket)    newseed.socket = true
    if(seed.meta)      newseed.meta = seed.meta     // [blackhole-meta]

    for(var cname in subspaces)                     // one component namespace per body
      if(stations[cname])
        D.bork('A station and a subspace share a name: ' + cname
               + ' in ' + seedkey)           // [spacesyn-name-collision]

    if(seed.blackhole) {                            // §4 black holes: ports only, in/out only,
      if(Object.keys(stations).length || Object.keys(state).length || routes.length)
        D.bork('A black hole has no interior — ports only: '
               + seedkey)                    // [blackhole-only-ports] [blackhole-no-interior]
      for(var key in ports) {
        var bdir = key.split(':')[0]
        if(bdir == 'up' || bdir == 'down')
          D.bork('A black hole has in/out ports only: @' + key)  // [blackhole-inout-only]
        var bflav = ports[key][0] == key            // bare decl: generic OPPOSING flavour
                  ? (bdir == 'in' ? 'out' : 'in')   // [blackhole-default-flavour]
                  : ports[key][0]
        var bfdir = D.PortFlavours[bflav] && D.PortFlavours[bflav].dir
        if(bfdir && bfdir == bdir)
          D.bork('A black hole port flavour must oppose its direction: @' + key
                 + ' ' + bflav)              // [blackhole-flavour-oppose]
        ports[key] = [bflav].concat(ports[key].slice(1))
      }
    }

    var port_key_to_index = {}
    newseed.ports = []
    for(var key in ports) {
      newseed.ports.push({flavour: ports[key][0], settings: {thing: (ports[key][1] || key), all: ports[key].concat(key)}, name: key }) // TODO: oh dear this should not be
      port_key_to_index[key] = newseed.ports.length // note 1-indexed
    }

    var station_key_to_index = {}
    newseed.stations = []
    newseed.station_names = []                  // declared names; null = anonymous
                                                // (canonical order after spaceseed_add)
    for(var key in stations) {                  // (qnames name anons s1, s2, ... [qname-anon-station])
      newseed.stations.push(D.Parser.string_to_block_segment(stations[key].value).value.id) // block id
      newseed.station_names.push(stations[key].anon ? null : key)
      var index = newseed.stations.length // note 1-indexed
      station_key_to_index[key] = index
      // add my ports
      port_key_to_index[key + '.in'] = newseed.ports.push({flavour: 'in', name: '_in', station: index})
      port_key_to_index[key + '.out'] = newseed.ports.push({flavour: 'out', name: '_out', station: index})
      // any extras?
      if(stations[key].extraports) {
        var extras = stations[key].extraports
        for(var i=0, l=extras.length; i < l; i++) {
          var extra    = extras[i]
          var downport = extra.slice(-1) == '*'
          var exname   = downport ? extra.slice(0, -1) : extra
          var exflav   = downport ? 'down' : 'out'
          port_key_to_index[key + '.' + exname] = newseed.ports.push({flavour: exflav, name: exname, station: index})
        }
      }
    }

    var subspace_key_to_index = {}
    newseed.subspaces = []
    newseed.subspace_names = []                 // declared names [qname-structure]
                                                // (canonical order after spaceseed_add)
    for(var key in subspaces) {
      var spacekey = subspaces[key]
      newseed.subspaces.push(seedmap[spacekey]) // space id // TODO: error if not in seedmap
      newseed.subspace_names.push(key)

      var index = newseed.subspaces.length // note 1-indexed
      subspace_key_to_index[key] = index

      // add subspace ports
      for(var portkey in seedlikes[spacekey].ports) {
        var subport = newseeds[spacekey].ports.filter(function(port) {return port.name == portkey})[0]
        newseed.ports.push({space: index, flavour: subport.flavour, name: subport.name, settings: subport.settings}) // oy vey
        port_key_to_index[key + '.' + portkey] = newseed.ports.length // note 1-indexed
      }

      // a socket's two implicit port-likes live on the parent side of the
      // slot [socket-portlike-implicit] [socket-portlike-endpoint]
      if(newseeds[spacekey] && newseeds[spacekey].socket) {
        ;['socket-load', 'socket-load-smash'].forEach(function(pl) {
          newseed.ports.push({space: index, flavour: pl, name: pl})
          port_key_to_index[key + '.' + pl] = newseed.ports.length
        })
      }
    }

    // compile cmd wiring rules: resolve holder and target names to indices
    // (station names don't survive into the compiled seed). Matched at
    // effect-invocation time — the demand-created cmd port consults these.
    newseed.rules = []
    var rule_seen = {}
    ;(seed.rules || []).forEach(function(rule) {
      var compiled = { pattern: rule.pattern, timeout: rule.timeout }
        , dupkey = rule.holder + '@cmd:' + rule.pattern

      if(rule_seen[dupkey])                                 // [wiring-no-duplicate]
        D.bork('Duplicate wiring rule pattern: ' + dupkey)
      rule_seen[dupkey] = true

      if(station_key_to_index[rule.holder])
        compiled.holder_station = station_key_to_index[rule.holder]
      else if(subspace_key_to_index[rule.holder])
        compiled.holder_space = subspace_key_to_index[rule.holder]
      else
        D.bork('Unknown wiring rule holder "' + rule.holder + '"')

      if(rule.target == '@cmd') {                           // forward to my own boundary [cmd-forward]
        compiled.forward = true
      }
      else if(rule.target[0] == '@') {                      // my own port (world/down)
        compiled.target_port = port_key_to_index[rule.target.slice(1)]
        if(!compiled.target_port)
          D.bork('Unknown wiring rule target "' + rule.target + '"')
      }
      else if(rule.target.indexOf('@') > 0 || rule.target.indexOf('.') > 0) {
        compiled.target_port = port_key_to_index[rule.target.replace('@', '.')]  // sibling up-port
        if(!compiled.target_port)
          D.bork('Unknown wiring rule target "' + rule.target + '"')
      }
      else {                                                // station in this space [wiring-target-station]
        compiled.target_in  = port_key_to_index[rule.target + '.in']
        compiled.target_out = port_key_to_index[rule.target + '.out']
        if(!compiled.target_in)
          D.bork('Unknown wiring rule target "' + rule.target + '"')
      }

      newseed.rules.push(compiled)
    })

    newseed.routes =
      routes.map(function(route) {
        var one = port_key_to_index[route[0].replace(/\*$/, '')]
          , two = port_key_to_index[route[1].replace(/\*$/, '')]

        if(!one)
          D.sploot('Invalid route: ' + route[0])
        if(!two)
          D.sploot('Invalid route: ' + route[1])

        if(!one || !two)
          return []

        return route[2] ? [one, two, route[2]] : [one, two]
        // newseed.routes.push([port_key_to_index[route[0]], port_key_to_index[route[1]]])
      })

    newseed.routes = newseed.routes
                            .filter(function(route) {
                              return route.length
                            })

    newseeds[seedkey] = newseed
    seedmap[seedkey] = D.spaceseed_add(newseed)
  }

  var rootkey = seedmap['outer'] ? 'outer' : seedkey
  if(seedlikes[rootkey] && seedlikes[rootkey].blackhole)
    D.bork('The root space cannot be a black hole: ' + rootkey)  // [blackhole-not-root]

  return seedmap[rootkey]
}



// SPACE ELVES

D.get_templates = function(template_attr) {
  template_attr    = template_attr || 'data-daimio-template'
  var template_els = document.querySelectorAll('[' + template_attr + ']')

  return [].reduce.call(template_els, function(acc, template) {
           var name  = template.attributes.getNamedItem(template_attr).value
           acc[name] = template.innerHTML .replace(/ \| &gt;/g, ' | >') // FIXME: this is super dumb
           template.innerHTML = ""
           return acc
         }, {})
}

D.get_seedlikes = function(seedlike_class) {
  seedlike_class   = seedlike_class || 'spaceseeds'
  var seedlike_els = document.getElementsByClassName(seedlike_class)

  return [].map.call(seedlike_els, function(node) {
            return node.text
         }).join("\n")
}

D.make_me_a_space_as_fast_as_you_can = function(seedlike_class, template_attr) {
  var templates = D.get_templates(seedlike_class)
  var seedlikes = D.get_seedlikes(template_attr)
  var outerseed = D.make_some_space(seedlikes, templates)
  document.getElementsByTagName('body')[0].style.display = ''         // invisible body prevents fouc
  return new D.Space(outerseed)
}



export default D
