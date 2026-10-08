# enqseam

This package is generated Go code's adapter between `CALL FUNCTION
'ENQUEUE_<object>'` / `'DEQUEUE_<object>'` / `'DEQUEUE_ALL'` and the host's
`hostclass.KERNEL_LOCK` callbacks. It builds `enq.Request` from the lock
table registered by the generated program and maps hook results to classic
function exceptions. A nil hook remains a loud `NotCompiled` refusal.

Key widths follow the Node host: fixed character/NUMC/RAW and packed lengths,
DATS 8, TIMS 6, and integer kinds 1 (the initial value "0" has length 1).
The frontend refuses any key it cannot size, naming its table and field.
Only effective scopes 1 and 3 override scope 2; invalid or empty scope text
uses 2, as in the Node lock server.
