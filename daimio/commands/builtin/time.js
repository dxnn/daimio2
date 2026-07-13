import D from '../../1_daimio.js'
// commands for managing temporal anomalies

D.import_models({
  time: {
    desc: "Commands for exploding temporal quonsets",
    methods: {

      now: {
        desc: 'Returns the current time as a structured value',
        help: ['Effectful: the response comes from the Outside through the',
               'cmd:time:now port — canonically a {time stampwrap}-shaped value.',
               'Unwired, it sploots [effect-outside-time].'],
        examples: [
          // third element = the wired handler [effcmd-time-now]
          ['{time now | peek :stamp}', '42', '{* (:stamp 42)}'],
        ],
        params: [],
        effect: {
          portType: 'cmd:time:now',
        },
      },

      stampwrap: {
        desc: "",
        params: [
          {
            key: 'value',
            desc: 'A timestamp',
            type: 'number',
          }
        ],
        fun: function(value) {
          // stampwrap requires a timestamp; with none it wraps the 0 stamp
          // (the epoch) — it never reads the current clock. {time now} is the
          // effectful command that reads "now".
          var date = value
                   ? new Date(value * 1000) // convert to milliseconds
                   : new Date(0)

          if(isNaN(date.valueOf()))
            return D.set_error('Invalid timestamp')

          return { year:   date.getFullYear()
                 , month:  date.getMonth() + 1
                 , day:    date.getDate()
                 , hour:   date.getHours()
                 , minute: date.getMinutes()
                 , second: date.getSeconds()
                 , stamp:  Math.floor(date.getTime() / 1000) // convert to seconds
                 }
        },
      },

    }
  }
});
