inner
  @in
  @out
  @in -> {__ | add 1} -> @out
outer
  @in
  @out
  @in -> inner.in
  inner.out -> @out