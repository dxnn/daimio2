worker
  @down:svc
  h {h}
  h -> @down:svc
outer
  proc {handle}
  worker@down:svc <-> proc
