worker
  @down:svc
  h {handle}
  h -> @down:svc
outer
  @in
  @out
  @in -> worker@down:svc -> @out