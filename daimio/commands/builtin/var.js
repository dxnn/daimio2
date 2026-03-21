import D from '../../1_daimio.js'
// commands for cross-boundary state access

D.import_models({
  var: {
    desc: "Commands for reading and writing space variables across boundaries",
    methods: {

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
