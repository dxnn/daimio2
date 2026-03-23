test4
  @init from-js
  initializer {init}
  process {proc}
  try-change {change}
  changed {changed}
  @init -> initializer
  initializer -> process -> changed
  process -> {sleep} -> try-change -> process
  @touched dom-on-click .touch
  save-change {save}
  @touched -> save-change