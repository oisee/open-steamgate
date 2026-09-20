#!/bin/sh
# Private draft bundle launcher. Content stays in this directory; SQLite does not.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$here"
instance=${INSTANCE:-11}
case "$instance" in [0-9][0-9]) ;; *) echo 'INSTANCE must be two digits' >&2; exit 2;; esac
decimal=${instance#0}
export OSD_ROOT="$here"
export OSD_PACKS="$here/packs"
export STG_DB=file
export STG_TLS=${STG_TLS:-0}
export STG_PORT=${STG_PORT:-80$instance}
export OSD_WORKERS=1
osd_data_dir=${OSD_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/open-steamgate}
mkdir -p "$osd_data_dir"
export STG_DB_PATH=${STG_DB_PATH:-$osd_data_dir/osd.sqlite}

./osd up &
osd_pid=$!
bridge_pid=
cleanup() {
  [ -z "$bridge_pid" ] || kill "$bridge_pid" 2>/dev/null || true
  kill "$osd_pid" 2>/dev/null || true
  [ -z "$bridge_pid" ] || wait "$bridge_pid" 2>/dev/null || true
  wait "$osd_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ready=0
count=0
while [ "$count" -lt 120 ]; do
  if ! kill -0 "$osd_pid" 2>/dev/null; then echo 'OSD exited before ready' >&2; exit 1; fi
  if curl -fsS "http://127.0.0.1:$STG_PORT/sap/bc/adt/core/http/build" 2>/dev/null | grep -Eq '"serving":"[^"]+"'; then ready=1; break; fi
  count=$((count + 1))
  sleep 1
done
[ "$ready" -eq 1 ] || { echo 'OSD did not become ready in 120 seconds' >&2; exit 1; }
./osd-up -instance "$decimal" -attach "http://127.0.0.1:$STG_PORT" -stub tape &
bridge_pid=$!
echo "OSD on http://127.0.0.1:$STG_PORT/; DIAG 32$instance; RFC 33$instance; SQLite $STG_DB_PATH"
while kill -0 "$osd_pid" 2>/dev/null && kill -0 "$bridge_pid" 2>/dev/null; do sleep 2; done
if kill -0 "$osd_pid" 2>/dev/null; then echo 'DIAG/RFC bridge exited' >&2; exit 1; fi
wait "$osd_pid"
