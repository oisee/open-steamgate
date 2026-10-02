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
# OSD_HEAVY_SLOTS (default 6) is the number of slots: CPU and memory limit it, not
# ports. Lower it if the load climbs to 20 and suites time out. Slot 1 is the old
# /tmp/osd-heavy.lock, so a run still using `flock /tmp/osd-heavy.lock` shares slot 1
# and nothing double-books.
#
# Two locks are held for the whole command, on file descriptors it inherits: the
# slot's and the instance's (/tmp/osd-heavy.inst.NN.lock). The instance lock is what
# makes the number ours: the port probe only says the ports are free now, so a run
# takes the instance lock first and probes under it. When the command ends or dies
# the locks go with it. A background process the command leaves behind inherits the
# descriptors too, and keeps both until it exits: stop your servers.
#
# Each run gets its own TMPDIR, removed when the command ends.
set -euo pipefail
slots=${OSD_HEAVY_SLOTS:-6}
if ! [[ "$slots" =~ ^[0-9]+$ ]] || [ "$slots" -lt 1 ] || [ "$slots" -gt 40 ]; then
  echo "osd-heavy: OSD_HEAVY_SLOTS must be a whole number from 1 to 40, not '$slots'" >&2
  exit 2
fi
[ $# -gt 0 ] || { echo "usage: tools/osd-heavy.sh <command...>" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
slotfile() { if [ "$1" = 1 ]; then echo /tmp/osd-heavy.lock; else echo "/tmp/osd-heavy.lock.$1"; fi; }
ports_free() {
  node --input-type=module -e "
    const {instancePorts, available} = await import('$here/../docker/image/free-instance.mjs');
    process.exit(await available(instancePorts('$1')) ? 0 : 1);"
}
t0=$(date +%s)
got=""
while [ -z "$got" ]; do
  for i in $(seq 1 "$slots"); do
    exec {slotfd}>>"$(slotfile "$i")"
    if flock -n "$slotfd"; then got=$i; break; fi
    exec {slotfd}>&-
  done
  [ -n "$got" ] || sleep 2
done
# the instance: 40 + slot first, then any in 50-89, starting at a random place;
# each candidate is locked first and probed under the lock
inst=""
for n in $((40 + got)) $(seq 50 89 | shuf); do
  exec {instfd}>>"/tmp/osd-heavy.inst.$n.lock"
  if flock -n "$instfd"; then
    if ports_free "$n"; then inst=$n; break; fi
  fi
  exec {instfd}>&-
done
[ -n "$inst" ] || { echo "osd-heavy: no free instance in 40-89 (30nn/32nn/33nn/80nn/443nn)" >&2; exit 1; }
# every port comes from the instance; a port inherited from the caller would escape it
unset OSD_SERVE_PORT STG_PREVIEW_PORT PROBE_HTTP_PORT PROBE_HTTPS_PORT
export OSD_HEAVY_SLOT=$got INSTANCE=$inst STG_PORT=80$inst STG_TLS_PORT=443$inst
export STG_DIAG_PORT=32$inst DIAG_PORT=32$inst STG_RFC_PORT=33$inst
TMPDIR=$(mktemp -d "/tmp/osd-heavy-slot-$got.XXXXXX"); export TMPDIR
trap 'rm -rf "$TMPDIR"' EXIT
echo "osd-heavy: slot $got/$slots, INSTANCE=$INSTANCE, STG_PORT=$STG_PORT, STG_TLS_PORT=$STG_TLS_PORT, DIAG=$STG_DIAG_PORT, RFC=$STG_RFC_PORT, waited $(( $(date +%s) - t0 ))s: $*" >&2
set +e
"$@"
status=$?
exit $status
