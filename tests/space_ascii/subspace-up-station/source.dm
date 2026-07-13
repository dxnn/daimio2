worker
  @up:svc
  h {handle}
  @up:svc <-> h
outer
  proc {p}
  proc -> worker@up:svc
  worker@up:svc -> proc