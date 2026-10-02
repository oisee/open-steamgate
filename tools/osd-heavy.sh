#!/usr/bin/env bash
# Run a heavy command (a transpile, a mocha suite, a Playwright run) on an instance
# number of this session's own, instead of one global lock. Sessions on a machine
# share CPU, memory and ports, not files (each worktree builds its own). Each session
# owns a block of instance numbers (agreed 2026-10-02 with Alice: osg-research 40-49,
# stoker 50-59, osg-demo 60-69, abapiti-7c 70-79, dell 80-89), and every port a run
# uses comes from its number, the way the Docker image does it
# (docker/image/free-instance.mjs: 30nn, 32nn, 33nn, 80nn, 443nn).
#
#   OSD_HEAVY_RANGE=40-49 tools/osd-heavy.sh <command...>
#
# OSD_HEAVY_RANGE (default 40-49) is the session's block. OSD_HEAVY_SLOTS (default 2)
# is how many heavy runs this session lets run at once; the machine-wide agreement is
# about four heavy runs in all. No lock is shared with another session.
#
# Two locks are held for the whole command, on file descriptors it inherits: one of
# the session's slots (/tmp/osd-heavy.<range>.slot.<i>.lock) and the instance
# (/tmp/osd-heavy.inst.NN.lock). The instance lock is what makes the number ours: the
# port probe only says the ports are free now, so a run takes the lock first and
# probes under it; a number whose ports something else holds is skipped. A
# background process the command leaves behind inherits the descriptors and keeps
# both until it exits: stop your servers.
#
# Each run gets its own TMPDIR, removed after the command has exited. Stop a run by
# signalling its process group (kill -- -PGID); Ctrl-C does that already.
set -euo pipefail
range=${OSD_HEAVY_RANGE:-40-49}
slots=${OSD_HEAVY_SLOTS:-2}
if ! [[ "$range" =~ ^([1-9][0-9])-([1-9][0-9])$ ]] || [ "${BASH_REMATCH[1]}" -gt "${BASH_REMATCH[2]}" ]; then
  echo "osd-heavy: OSD_HEAVY_RANGE must be two two-digit instance numbers, low-high, not '$range'" >&2
  exit 2
fi
lo=${BASH_REMATCH[1]}; hi=${BASH_REMATCH[2]}
if ! [[ "$slots" =~ ^[1-9][0-9]?$ ]] || [ "$slots" -gt $((hi - lo + 1)) ]; then
  echo "osd-heavy: OSD_HEAVY_SLOTS must be a whole number from 1 to the size of the range ($((hi - lo + 1))), not '$slots'" >&2
  exit 2
fi
[ $# -gt 0 ] || { echo "usage: OSD_HEAVY_RANGE=40-49 tools/osd-heavy.sh <command...>" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
ports_free() {
  node --input-type=module -e "
    const {instancePorts, available} = await import('$here/../docker/image/free-instance.mjs');
    process.exit(await available(instancePorts('$1')) ? 0 : 1);"
}
t0=$(date +%s)
got=""
while [ -z "$got" ]; do
  for i in $(seq 1 "$slots"); do
    exec {slotfd}>>"/tmp/osd-heavy.$range.slot.$i.lock"
    if flock -n "$slotfd"; then got=$i; break; fi
    exec {slotfd}>&-
  done
  [ -n "$got" ] || sleep 2
done
inst=""
for n in $(seq "$lo" "$hi"); do
  exec {instfd}>>"/tmp/osd-heavy.inst.$n.lock"
  if flock -n "$instfd"; then
    if ports_free "$n"; then inst=$n; break; fi
  fi
  exec {instfd}>&-
done
[ -n "$inst" ] || { echo "osd-heavy: no free instance in $range (30nn/32nn/33nn/80nn/443nn)" >&2; exit 1; }
# every port comes from the instance; a port inherited from the caller would escape it
unset OSD_SERVE_PORT STG_PREVIEW_PORT PROBE_HTTP_PORT PROBE_HTTPS_PORT
export OSD_HEAVY_SLOT=$got INSTANCE=$inst STG_PORT=80$inst STG_TLS_PORT=443$inst
export STG_DIAG_PORT=32$inst DIAG_PORT=32$inst STG_RFC_PORT=33$inst
TMPDIR=$(mktemp -d "/tmp/osd-heavy-$inst.XXXXXX"); export TMPDIR
echo "osd-heavy: range $range, slot $got/$slots, INSTANCE=$INSTANCE, STG_PORT=$STG_PORT, STG_TLS_PORT=$STG_TLS_PORT, DIAG=$STG_DIAG_PORT, RFC=$STG_RFC_PORT, waited $(( $(date +%s) - t0 ))s: $*" >&2
# The command runs in the foreground. A Ctrl-C reaches the whole process group. A
# signal sent to this wrapper alone is caught and does nothing: bash runs a trap
# only once the foreground command has returned, so the wrapper never leaves early
# and the TMPDIR is removed after the command, by the EXIT trap. (Untrapped, a TERM
# kills the wrapper at once and removes the TMPDIR under a running command:
# measured.) To stop a run, signal its process group. The exit status is the
# command's own.
trap ':' TERM INT HUP
trap 'rm -rf "$TMPDIR"' EXIT
set +e
"$@"
