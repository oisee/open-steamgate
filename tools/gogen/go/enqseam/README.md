# enqseam

This package is generated Go code's adapter between `CALL FUNCTION
'ENQUEUE_<object>'` / `'DEQUEUE_<object>'` / `'DEQUEUE_ALL'` and the host's
`hostclass.KERNEL_LOCK` callbacks. It builds `enq.Request` from the lock
table registered by the generated program and maps hook results to classic
function exceptions. A nil hook remains a loud `NotCompiled` refusal.
