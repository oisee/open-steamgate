# Compiler client

New creates a lazy v1 NDJSON client; Hello, Check, Status and Close own its lifecycle.
BuildSnapshot pins raw file hashes and rejects paths or symlinks outside the root.
Discovery never uses PATH. Requests serialize; the default 30-second deadline
covers admission, handshake, pipe writes and response reads. Cancellation while
waiting for admission or the mutex returns promptly without recording LastError;
errors during an operation update it under the client mutex.

Each child owns its pipes, buffered answers, reader completion and process wait.
EOF, malformed or oversized lines, wrong ids, write failures and cancellation
during an operation terminate the owned child tree. Unix uses a process group;
Windows starts the child suspended, assigns it to a Job Object with
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, then resumes it. Cleanup terminates and closes
the job even if the direct child has already exited. Failure to establish job
ownership refuses startup with INTERNAL. Cleanup closes both pipes and
waits at most KillGrace (default 2 seconds) for the child; an idle death detected
by the next request uses the same cleanup and RestartBackoff. A complete buffered
answer is delivered even when EOF is already observed. Sidecar stderr is discarded
so logging cannot block protocol progress.

Hello requires both limits as positive integers. Before hello, response lines
are capped at 1 MiB; afterward Options.MaxResponseBytes caps each response line
(default 64 MiB, including the newline). The advertised maxSnapshotBytes limits
source snapshots only; diagnostics can exceed it.
The reader assembles fragmented lines and supports responses larger than 64 KiB
within that limit. Restarts count successful replacement starts, and LastError
preserves the latest recorded failure across successful requests.

A successful Check requires diagnostics as an array (which may be empty),
registryHash and configSha as 64 hexadecimal characters, and inputCount as a
nonnegative integer. Missing, null or malformed required fields return a local
INTERNAL refusal and discard the process. virtualFiles remains optional.

Lifecycle fixtures signal readiness before short cancellation deadlines and
record descendant PIDs. Linux tests adopt/reap orphan fixtures and require ESRCH;
Windows tests poll process termination. Both descendant tests run on Windows
rather than skipping it (cross-compilation alone does not execute those tests).
