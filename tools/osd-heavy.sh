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
# Two locks are held for the whole command, by this wrapper alone: one of the
# session's slots (/tmp/osd-heavy.<range>.slot.<i>.lock) and the instance
# (/tmp/osd-heavy.inst.NN.lock). The instance lock is what makes the number ours: the
# port probe only says the ports are free now, so a run takes the lock first and
# probes under it; a number whose ports something else holds is skipped. The
# command does not inherit the lock descriptors, so the slot is the wrapper's lease
# and ends with it: when the command returns, when the wrapper is killed, or when
# the command overruns OSD_HEAVY_TIMEOUT. (Until 2026-10-07 the command inherited
# them, and a server it left behind held the session's slot until somebody found and
# killed it.) A leftover server still holds its ports, and the port probe skips that
# instance; stop your servers all the same.
#
# OSD_HEAVY_TIMEOUT (default 3h, `0` = none; a whole number with an optional unit
# s, m, h or d) bounds the command: TERM when it runs out, KILL a minute later, and
# then the status is timeout(1)'s, 124 (or 137 after the KILL) whatever the command
# did with the TERM. It signals the command itself, not its children.
#
# Each run gets its own TMPDIR, removed after the command has exited. Stop a run by
# signalling its process group (kill -- -PGID); Ctrl-C does that already.
set -euo pipefail
range=${OSD_HEAVY_RANGE:-40-49}
slots=${OSD_HEAVY_SLOTS:-2}
limit=${OSD_HEAVY_TIMEOUT:-3h}
if ! [[ "$limit" =~ ^[0-9]+[smhd]?$ ]]; then
  echo "osd-heavy: OSD_HEAVY_TIMEOUT must be a whole number with an optional unit s, m, h or d, such as 90m, or 0 for none, not '$limit'" >&2
  exit 2
fi
if ! [[ "$range" =~ ^([1-9][0-9])-([1-9][0-9])$ ]] || [ "${BASH_REMATCH[1]}" -gt "${BASH_REMATCH[2]}" ]; then
  echo "osd-heavy: OSD_HEAVY_RANGE must be two two-digit instance numbers, low-high, not '$range'" >&2
  exit 2
fi
lo=${BASH_REMATCH[1]}; hi=${BASH_REMATCH[2]}
if ! [[ "$slots" =~ ^[1-9][0-9]?$ ]] || [ "$slots" -gt $((hi - lo + 1)) ]; then
  echo "osd-heavy: OSD_HEAVY_SLOTS must be a whole number from 1 to the size of the range ($((hi - lo + 1))), not '$slots'" >&2
  exit 2
fi
[[ "$limit" =~ ^0+[smhd]?$ ]] && limit=0
[ $# -gt 0 ] || { echo "usage: OSD_HEAVY_RANGE=40-49 tools/osd-heavy.sh <command...>" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
# OSD_HEAVY_TIMEOUT in seconds (read as decimal even with a leading 0)
seconds() {
  local n=$((10#${1%[smhd]})) u=${1##*[0-9]}
  case "$u" in m) echo $((n * 60)) ;; h) echo $((n * 3600)) ;; d) echo $((n * 86400)) ;; *) echo "$n" ;; esac
}
# the instance and the probe's path go in as arguments, never spliced into the
# JavaScript, and the instance first: free-instance.mjs runs as a command when
# argv[1] ends with its name, and then printed an instance of its own on stdout
ports_free() {
  node --input-type=module -e '
    import {pathToFileURL} from "node:url";
    const [n, probe] = process.argv.slice(1);
    const {instancePorts, available} = await import(pathToFileURL(probe).href);
    process.exit(await available(instancePorts(n)) ? 0 : 1);' "$1" "$here/../docker/image/free-instance.mjs"
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
# command's own, except when OSD_HEAVY_TIMEOUT stops it (see above).
trap ':' TERM INT HUP
trap 'rm -rf "$TMPDIR"' EXIT
set +e
# The lock descriptors are closed for the command: the lease is this wrapper's alone.
# --foreground keeps the command in this process group, so Ctrl-C and kill -- -PGID
# reach it as before.
t1=$(date +%s)
if [ "$limit" = 0 ]; then
  "$@" {slotfd}>&- {instfd}>&-
else
  timeout --foreground --kill-after=60s "$limit" "$@" {slotfd}>&- {instfd}>&-
fi
rc=$?
# 124 and 137 are also what a command says by itself (an inner `timeout`, an OOM
# kill). timeout(1) does not say which it was, so the line is written only when the
# limit has passed as well; a command that itself exits 124 or 137 just as its limit
# runs out is the one case this names wrongly.
if [ "$limit" != 0 ] && { [ "$rc" = 124 ] || [ "$rc" = 137 ]; } && [ $(( $(date +%s) - t1 )) -ge "$(seconds "$limit")" ]; then
  echo "osd-heavy: the command ran past OSD_HEAVY_TIMEOUT=$limit and exited $rc, which is what a stop by the timeout returns; slot $got and INSTANCE=$inst are free again: $*" >&2
fi
exit "$rc"
