worker
  @down:svc
  h {handle}
  @down:svc <-> h
outer
  @in
  @out
  @in -> worker.up:svc -> @out