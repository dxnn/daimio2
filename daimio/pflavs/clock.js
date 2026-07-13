import D from '../1_daimio.js'
// The Outside's clock. Wire a station's cmd:process:sleep rule to a
// clock-flavoured down port and it answers each sleep-shaped request
// {for, then} with the `then` value once `for` milliseconds have passed
// [effcmd-process-sleep]. Deadlines register on the virtual clock: wall
// timers fire them in production, a det harness advances the clock itself
// [sched-timeout-event].
D.import_port_flavour('clock', {
  dir: 'down',
  outside_exit: function(ship, callback) {
    if(typeof callback != 'function') return    // a plain crossing has no return address: nothing to answer
    var ms = ship && +ship.for || 0
    D.register_timeout(D.now() + ms, function() { callback(ship && ship.then) })
  }
})
