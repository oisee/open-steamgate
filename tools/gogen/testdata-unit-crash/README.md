# Runner crash attribution fixture

`B_RECUR` uses the recursive repro in TASK.md. The three other owners pass.
Run with `GOGEN_UNIT_MAX_STACK=65536` to cap Go's stack at 64 KiB for a cheap,
deterministic fatal overflow; normal runners keep Go's default stack limit.
With `--jobs 1`, A finishes before B dies, then B, C and D run individually.
With `--jobs 2` and no timing history, A/C share one shard and B/D the other.
The tests count actual processes and verify that completed classes never retry.
