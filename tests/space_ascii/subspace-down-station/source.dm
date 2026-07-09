worker
  @up:svc
  h {handle}
  @up:svc <-> h
outer
  proc {p}
  proc -> worker@down:svc
  worker@down:svc -> proc