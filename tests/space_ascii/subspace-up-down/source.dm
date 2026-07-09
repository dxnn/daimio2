worker
  @in
  @out
  @in -> {__ | add 1} -> @out
outer
  @in
  @out
  @in -> worker@up:a -> @out
  @in -> worker@down:b -> @out