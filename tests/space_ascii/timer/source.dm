timer
  @in:step
  @in:speed
  @out:display
  $count 0
  $step 1
  $time 500
  @in:step -> {__ | add $count | >$count} -> @out:display
  @in:speed -> {__ | >$time} -> @out:display