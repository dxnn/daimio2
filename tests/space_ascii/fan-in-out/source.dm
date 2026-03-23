fio
  @in:a
  @in:b
  @in:c
  @in:d
  @in:e
  @out:a
  @out:b
  @out:c
  @out:d
  @out:e
  hub {process}
  @in:a -> hub
  @in:b -> hub
  @in:c -> hub
  @in:d -> hub
  @in:e -> hub
  hub -> @out:a
  hub -> @out:b
  hub -> @out:c
  hub -> @out:d
  hub -> @out:e