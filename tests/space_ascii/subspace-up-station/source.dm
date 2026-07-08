worker
  @down:svc
  h {handle}
  @down:svc <-> h
outer
  proc {p}
  proc -> worker.up:svc
  worker.up:svc -> proc