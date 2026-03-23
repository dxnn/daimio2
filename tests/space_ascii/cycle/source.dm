cyc
  @in
  @out
  counter {count}
  sleeper {sleep}
  @in -> counter
  counter -> sleeper
  sleeper -> counter
  counter -> @out