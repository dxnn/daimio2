import D from '../1_daimio.js'


D.import_port_flavour('in', {
  dir: 'in'
})

D.import_port_flavour('err', {
  dir: 'out'
  // TODO: ???
})

D.import_port_flavour('out', {
  dir: 'out'
})

D.import_port_flavour('up', {
  dir: 'up'
  // THINK: this can only live on a space, not a station
})

// A socket's two implicit port-likes (§8): not really ports — no inside,
// no pair. A ship arriving is Astroglot that replaces the slot's content.
// [socket-portlike-implicit]
D.import_port_flavour('socket-load', {
  dir: 'in',
  enter: function(ship, process) { D.socket_load(this, ship, 'drain') }
})

D.import_port_flavour('socket-load-smash', {
  dir: 'in',
  enter: function(ship, process) { D.socket_load(this, ship, 'smash') }
})

D.import_port_flavour('down', {
  dir: 'down',
  settings: [
    {
      key: 'thing',
      desc: 'A dom selector for binding',
      type: 'selector'
    },
    {
      key: 'parent',
      desc: 'A dom element contain thing. Defaults to document.',
      type: 'id'
    },
  ]
  // exit falls through to port_standard_exit: a ship crossing a down-port
  // pair rides the wires like any other crossing. (An earlier stub here
  // swallowed every ship — round-trip discipline is the port occupancy
  // machinery's job, not exit's. See design/roundtrip-signalflip-draft.md.)
})


