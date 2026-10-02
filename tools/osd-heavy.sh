#!/usr/bin/env bash
# Run a heavy command (a transpile, a mocha suite, a Playwright run) in one of a few
# slots, instead of one global lock. Sessions on this machine share CPU and memory,
# and two test servers must not take the same ports; files are not shared (each
# worktree builds its own). So a slot is a lock plus its own instance number, and
# every port a run uses comes from that number, the way the Docker image does it
# (docker/image/free-instance.mjs: 30nn, 32nn, 33nn, 80nn, 443nn).
#
#   tools/osd-heavy.sh <command...>      e.g. tools/osd-heavy.sh npx mocha test/dsl-l3.mjs
#
# OSD_HEAVY_SLOTS (default 6) is the number of slots: CPU and memory limit it, not ports. Lower it if the load climbs to 20 and suites time out. Slot 1 is the old
# /tmp/osd-heavy.lock, so a run still using `flock /tmp/osd-heavy.lock` shares slot 1
# and nothing double-books. The lock is held on a file descriptor the command
# inherits: when the command ends, or dies, the slot is free again.
set -euo pipefail
slots=${OSD_HEAVY_SLOTS:-6}
here=$(cd "$(dirname "$0")" && pwd)
lockfile() { if [ "$1" = 1 ]; then echo /tmp/osd-heavy.lock; else echo "/tmp/osd-heavy.lock.$1"; fi; }
t0=$(date +%s)
got=""
while [ -z "$got" ]; do
  for i in $(seq 1 "$slots"); do
    exec {fd}>>"$(lockfile "$i")"
    if flock -n "$fd"; then got=$i; break; fi
    exec {fd}>&-
  done
  [ -n "$got" ] || sleep 2
done
# the slot's instance: 40 + slot, or any free one in 50-89 if something outside holds its ports (a Docker stack, a server someone left running)
inst=$((40 + got))
inst=$(node --input-type=module -e "
  const {instancePorts, available, chooseInstance} = await import('$here/../docker/image/free-instance.mjs');
  const want = '$inst';
  console.log(await available(instancePorts(want)) ? want : await chooseInstance());
")
export OSD_HEAVY_SLOT=$got INSTANCE=$inst STG_PORT=80$inst STG_TLS_PORT=443$inst
export TMPDIR=/tmp/osd-heavy-slot-$got; mkdir -p "$TMPDIR"
echo "osd-heavy: slot $got/$slots, INSTANCE=$INSTANCE, STG_PORT=$STG_PORT, STG_TLS_PORT=$STG_TLS_PORT, waited $(( $(date +%s) - t0 ))s: $*" >&2
exec "$@"
