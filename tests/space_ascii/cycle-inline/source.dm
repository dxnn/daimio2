test2
  process { __ | >cells }
  try-change { __ | >cells }
  process -> {__ | sleep} -> try-change -> process