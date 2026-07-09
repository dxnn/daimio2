inner
  @in
  @out
  @in -> {__ | add 1} -> @out
outer
  @in
  @out
  @in -> {__ | add 1} -> inner@in
  inner@out -> {__ | add 2} -> @out