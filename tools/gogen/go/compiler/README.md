# Compiler client

New creates a lazy v1 NDJSON client; Hello, Check, Status and Close own its lifecycle.
BuildSnapshot pins raw file hashes and rejects paths or symlinks outside the root.
Discovery never uses PATH. Requests serialize; the default 30-second deadline
covers admission, handshake, pipe writes and response reads. Cancellation while
waiting for admission or the mutex returns promptly without recording LastError;
errors during an operation update it under the client mutex.

Each child owns its pipes, buffered answers, reader completion and process wait.
EOF, malformed or oversized lines, wrong ids, write failures and cancellation
during an operation terminate the process group. Cleanup closes both pipes and
waits at most KillGrace (default 2 seconds) for the child; an idle death detected
by the next request uses the same cleanup and RestartBackoff. A complete buffered
answer is delivered even when EOF is already observed. Sidecar stderr is discarded
so logging cannot block protocol progress.

Hello requires both limits as positive integers. Before hello, response lines
are capped at 1 MiB; afterward the cap is maxSnapshotBytes, including the newline.
The reader assembles fragmented lines and supports responses larger than 64 KiB
within that limit. Restarts count successful replacement starts, and LastError
preserves the latest recorded failure across successful requests.
