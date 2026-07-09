import D from '../../1_daimio.js'
// commands for cross-boundary state access

D.import_models({
  var: {
    desc: "Commands for reading and writing space variables across boundaries",
    methods: {

      'read': {
        desc: 'Read a space variable in the current space by computed name',
        help: ['The local, dynamic-name counterpart to $foo: the name is an ordinary value, so {var read name _n} reads whatever variable _n names. No port, no boundary crossing.'],
        examples: [
          ['{var write name :var_read_ex value 7 | var read name :var_read_ex}', '7'],
        ],
        params: [
          {
            key: 'name',
            desc: 'Variable name to read',
            type: 'string',
            required: true,
          }
        ],
        fun: function(name, prior_starter, process) {
          var value = process.space.get_state(name)
          return (value !== undefined) ? value : ''
        },
      },

      'write': {
        desc: 'Write a space variable in the current space by computed name',
        help: ['The local, dynamic-name counterpart to >$foo: performs the same space-variable write and passes the value through. No port, no boundary crossing.'],
        examples: [
          ['{var write name :var_write_ex value 5}', '5'],
        ],
        params: [
          {
            key: 'name',
            desc: 'Variable name to write',
            type: 'string',
            required: true,
          },
          {
            key: 'value',
            desc: 'Value to write',
            type: 'anything',
          }
        ],
        fun: function(name, value, prior_starter, process) {
          process.space.set_state(name, value)
          return value
        },
      },

      'read-out': {
        desc: 'Read a space variable from the parent space via a down port',
        params: [
          {
            key: 'name',
            desc: 'Variable name to read',
            type: 'string',
            required: true,
          }
        ],
        effect: {
          portType: 'cmd:var:read-out',
          defaultValue: '',
        },
        fun: function(name, prior_starter, process) {
          // Default handler: read from current space's state
          var value = process.space.get_state(name)
          return (value !== undefined) ? value : ''
        },
      },

      'write-out': {
        desc: 'Write a value to a space variable in the parent space via a down port',
        params: [
          {
            key: 'name',
            desc: 'Variable name to write',
            type: 'string',
            required: true,
          },
          {
            key: 'value',
            desc: 'Value to write',
            type: 'anything',
          }
        ],
        effect: {
          portType: 'cmd:var:write-out',
          defaultValue: '',
        },
        fun: function(name, value, prior_starter, process) {
          // Default handler: write to current space's state
          process.space.set_state(name, value)
          return value
        },
      },

    }
  }
});
