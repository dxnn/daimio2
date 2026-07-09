inner
  @in
  @out
  @in -> {p} -> @out
outer
  @in
  @out
  @in -> inner@in
  inner@out -> inner@in
  inner@out -> @out
