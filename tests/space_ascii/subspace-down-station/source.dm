worker
  @down:svc
  h {handle}
  h -> @down:svc
outer
  proc {p}
  proc -> worker@down:svc
  worker@down:svc -> proc