import D from '../../1_daimio.js'
// commands for processing Daimio

D.import_models({
  process: {
    desc: "Commands for processing Daimio in various interesting ways",
    methods: {

      sleep: {
        desc: "'Did I fall asleep? Shall I go now?'",
        params: [
          {
            key: 'for',
            desc: 'A number of milliseconds to sleep',
            type: 'number',
            required: true
          },
          {
            key: 'then',
            desc: "Something to do after -- usually populated by the previous pipeline segment",
            type: 'anything',
          },
        ],
        fun: function(_for, then, prior_starter) {
          if(!_for) {
            D.setImmediate(function() {
              prior_starter(then)
            })
          }
          else {
            setTimeout(function() {
              prior_starter(then)
            }, _for)
          }

          return NaN
        },
      },

      // THINK: a command that lets you pass a handler, method, and hash o' params, for those fancy occasions.

      tap: {
        desc: "Send a message to the _tap port",
        params: [
          {
            key: 'value',
            desc: 'This is returned from the command, and is the default message value',
            type: 'anything',
            required: true
          },
          {
            key: 'send',
            desc: 'The message to send; defaults to value param'
          },
        ],
        fun: function(value, send) {
          /*
            {$foo | log}            // for when you want to return nothing after
            {$foo | tap}            // for when you want to pass that thing along
            {$foo | log (__ :here)} // pass $foo along, but send (__ :here) to the log

            so... the first case should also return $foo, right? so log and tap are synonyms?
            or tap is hardcoded, and you can't give it the second param.
            and then log and tap are still different, because the first case does what it says.
            ok, do that.

            no no no. you don't need two commands. just this:

            {123 | tap | add 1}
            {123 | tap (__ :asdf) | add 1}

            that's it.

            longform:

            {process tap value 123 | add 1}
            {process tap value 123 send (__ :asdf) | add 1}

          */

          // THINK: we should defunc things, or something, probably... maybe like this?
          // actually, we should probably use D.scrub_var or the ilk. we want blocks to stringify, but not lists.
          value = (typeof value === 'function') ? value() : value

          // TODO: send a message to a _tap port instead of calling console.log
          console.log(send ? send : value) // THINK: 'send' is "" when unset (why?), so we can't send falsy messages...

          return value
        },
      },

      downport: {
        desc: "Create a downport from this pipeline",
        params: [
          {
            key: 'value',
            desc: 'The value passed into the downport',
            type: 'anything',
          },
          {
            key: 'name',
            desc: 'The name of the port you seek',
            type: 'string',
          },
        ],
        fun: function(value, name, prior_starter, process) {
          // find the correct port, using port.name [this is a runtime value, which is stinky -- it can change]
          // TODO: lock the command-port relationship in at spaceseed creation time
          var port = process.space.ports.filter(function(port) {
                       return (port.name == name && port.station == process.station_id)
                     })[0]

          if(!port)
            return D.set_error('No corresponding port exists on this station')

          // send the value, go async while we wait for the reply

          var callback = function(value) {
            prior_starter(value)
          }

          port.exit(value, callback, process) // yuck: process is only here for 'exec' ports :(

          return NaN
        },
      },

      quote: {
        desc: "Return a pure string, possibly containing Daimio",
        examples: [
          ['{process quote value "{1 | add 2}"}', '{1 | add 2}'],
        ],
        params: [
          {
            key: 'value',
            desc: "A string",
            type: "string",
            required: true,
          },
        ],
        fun: function(value) {
          return value // type system handles the escaping
        },
      },

      unquote: {
        desc: "Convert a string into a block. This will eventually execute (it's a bit like a delayed run), so use it carefully",
        examples: [
          ['{"{1 | add 2}" | process unquote | process run}', '3'],
        ],
        params: [
          {
            key: 'value',
            desc: "A string",
            type: "string",
            required: true,
          },
        ],
        fun: function(value) {
          return D.Parser.string_to_block_segment(value)
        },
      },

      dialect: {
        desc: "Return the current dialect's command catalog",
        help: 'Returns a structured list of all commands available in the current dialect, including desc, help, params, and examples for each method.',
        examples: [
          ['{process dialect | list peek path (:math :methods :add :desc)}', 'What kind of snake is good at math?'],
        ],
        params: [],
        fun: function(prior_starter, process) {
          var dialect = process.effective_dialect || process.space.dialect || D.DIALECTS.top
          var commands = dialect.commands || D.Commands
          var result = {}

          for(var handler_key in commands) {
            if(!D._hop.call(commands, handler_key)) continue
            var handler = commands[handler_key]

            // check dialect gating
            if(dialect.get_handler && !dialect.get_handler(handler_key)) continue

            var handler_out = { desc: handler.desc || '' }
            if(handler.help) handler_out.help = handler.help

            var methods = handler.methods || {}
            var methods_out = {}

            for(var method_key in methods) {
              if(!D._hop.call(methods, method_key)) continue

              // check dialect gating
              if(dialect.get_method && !dialect.get_method(handler_key, method_key)) continue

              var method = methods[method_key]
              var method_out = { desc: method.desc || '' }

              if(method.help) method_out.help = method.help
              if(method.examples) method_out.examples = method.examples
              if(method.params) {
                method_out.params = method.params.map(function(p) {
                  var param_out = { key: p.key }
                  if(p.desc) param_out.desc = p.desc
                  if(p.type) param_out.type = p.type
                  if(p.required) param_out.required = true
                  return param_out
                })
              }

              methods_out[method_key] = method_out
            }

            handler_out.methods = methods_out
            result[handler_key] = handler_out
          }

          return result
        },
      },

      aliases: {
        desc: "Return the current dialect's alias map",
        help: 'Returns a keyed list mapping alias names to their expansions.',
        examples: [
          ['{process aliases | list peek path (:add)}', 'math add value'],
        ],
        params: [],
        fun: function(prior_starter, process) {
          var dialect = process.effective_dialect || process.space.dialect || D.DIALECTS.top
          var aliases = dialect.aliases || D.Aliases
          var result = {}

          for(var key in D.AliasMap) {
            if(!D._hop.call(D.AliasMap, key)) continue

            // check dialect gating
            if(dialect.get_alias && !dialect.get_alias(key)) continue

            result[key] = D.AliasMap[key]
          }

          return result
        },
      },

      run: {
        desc: "Completely process some Daimio code",
        examples: [
          ['{process run block "{add 1 to 2}"}', '3'],
          ['{process run block "{__in | add 10}" value 5}', '15'],
        ],
        params: [
          {
            key: 'block',
            desc: "Some Daimio code",
            type: "block",
            required: true,
          },
          {
            key: 'value',
            desc: 'Input for the block (__in)',
            type: 'anything'
          },
        ],
        fun: function(block, value, prior_starter, process) {
          var scope = {}
          if(value !== "")
            scope['__in'] = value

          return block(function(value) {
            prior_starter(value)
          }, scope, process)

          // return NaN

          // var space = D.OuterSpace
          // space.real_execute(value, callback)
          // TODO: fix me this is stupid it needs the right space

          // return D.run(value)
        },
      },

    }
  }
});
