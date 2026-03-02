import D from '../1_daimio.js'
D.import_port_flavour('sse-receive', {
  dir: 'in',
  unsafe: true,
  settings: [
    {
      key: 'thing',
      desc: 'A dom selector for binding',
      type: 'selector'
    },
  ],
  outside_add: function () {
    var channel = new EventSource(this.settings.thing)
    var self = this;
    channel.onmessage = function (e) {
      self.enter(e.data)
    }
  }
})
