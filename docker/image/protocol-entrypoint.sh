#!/bin/sh
set -eu
case "$INSTANCE" in [0-9][0-9]) ;; *) echo 'INSTANCE must be two digits' >&2; exit 2;; esac
# Go integer flags treat a leading zero as octal; 08 and 09 must stay decimal.
instance_decimal=${INSTANCE#0}
exec /opt/protocols/osd-up -attach "$OSD_URL" -instance "$instance_decimal" -sid "$OSD_SID" -stub tape
