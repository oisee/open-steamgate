# warm-deadline

How long the HTTP front lets the warm compiler work before it calls the
compiler silent, kills it and builds cold (`warmOperation` in
`tools/osd-store-warm.mjs`). After such a timeout warm builds stay off until
the host restarts.

## What the deadline guards

A save that arrives while the compiler is busy waits for it: during the full
prime `transpileStore` awaits the prime, and a warm build is awaited
directly. A hung compiler would hold that save forever. The deadline is how
long a person waits for a save behind a stuck compiler before the save is
built cold.

A deadline that is too short is just as bad: a prime that is working, only
slowly, is killed, and the host never builds warm again. Until 2026-11-11
one fixed 30 s bound covered both a one-object save (~0.5 s) and a
whole-tree prime (20 s on a CI runner, 37.8 s on a 4-core workstation), so
the prime failed on any machine somewhat slower than a CI runner, and on CI
whenever a runner was slow.

## How it is sized

- **A save, a check, an update**: 30 s (`OPERATION_MS`) times the speed factor.
- **The prime**: 16 ms per input file of the compile view (`PRIME_MS_PER_FILE`),
  at least 30 s, times the speed factor. Measured on the reference machine:
  37.8 s for 6924 input files, 5.5 ms each; 16 ms is about three times that.
- **The speed factor**: `calibrate()` times a fixed single-threaded workload
  (strings, small objects, JSON, a hash), best of three rounds, ~60 ms on the
  reference machine (`REFERENCE_CALIBRATION_MS`). Measured time over the
  reference, clamped to 1..8: it never shortens a deadline, and a factor
  past 8 is a broken machine, not a slow one. Measured once per process.
- Everything is capped at 15 minutes.

Measured with one core and a busy loop on it (about 2.3x slower): factor
2.26, prime deadline 250 s, prime 89.9 s.

## Overrides, in order

1. `store.warmDeadlineMs` (tests that want a hang caught in milliseconds)
2. `OSD_WARM_PRIME_DEADLINE_MS` for the prime, `OSD_WARM_DEADLINE_MS` for the rest
3. `OSD_WARM_SPEED_FACTOR` in place of the calibration (a CI job that knows its runner)

## Not hiding a slowdown

The front logs the deadline and how it was reached before the prime, and the
prime's time against it after:

```
warm: prime deadline 117822 ms (base 110784 ms x speed factor 1.06 from calibration, calibration 63.8 ms against 60) for 6924 input files
warm: prime took 37750 ms of its 117822 ms deadline
```

A prime that grows slower shows as a shrinking margin in that second line
long before it fails. Test harnesses that wait for a host to start and prime
(`test/store-cold-build.mjs`, `test/vscode-warm-ready.mjs`) scale their own
waits with `scaled()`, and print the factor they used.

Test: `test/warm-deadline.mjs`.
