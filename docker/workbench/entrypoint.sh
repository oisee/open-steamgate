#!/bin/sh
set -eu

secret=${OSD_IDE_PASSWORD_FILE:-/run/secrets/osd_ide_password}
if [ ! -r "$secret" ]; then
  echo "OSD workbench: password secret is not readable at $secret" >&2
  exit 1
fi
PASSWORD=$(cat "$secret")
if [ -z "$PASSWORD" ]; then
  echo "OSD workbench: password secret is empty" >&2
  exit 1
fi
export PASSWORD

adt_url=${OSD_ADT_URL:-http://host.docker.internal:3030}
adt_user=${OSD_ADT_USER:-developer}
case "$adt_url" in
  http://*) adt_authority=${adt_url#http://} ;;
  https://*) adt_authority=${adt_url#https://} ;;
  *) echo "OSD workbench: OSD_ADT_URL must be an HTTP(S) origin without a path" >&2; exit 1 ;;
esac
case "$adt_authority" in
  ''|*/*|*\?*|*\#*|*[!A-Za-z0-9._:-]*)
    echo "OSD workbench: OSD_ADT_URL must be an HTTP(S) origin without a path" >&2
    exit 1
    ;;
esac
case "$adt_user" in
  *[!A-Za-z0-9._-]*|'') echo "OSD workbench: invalid OSD_ADT_USER" >&2; exit 1 ;;
esac

workspace=/tmp/osd.code-workspace
cat > "$workspace" <<EOF
{
  "folders": [{"path": "/workspace", "name": "open-steamgate"}],
  "settings": {
    "abapfs.remote": {
      "OSD": {
        "url": "$adt_url",
        "username": "$adt_user",
        "password": "any",
        "allowSelfSigned": true
      }
    },
    "telemetry.telemetryLevel": "off",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "git.autofetch": false,
    "git.confirmSync": true
  }
}
EOF

exec /usr/bin/code-server \
  --bind-addr 0.0.0.0:8080 \
  --auth password \
  --disable-telemetry \
  --disable-update-check \
  --extensions-dir /opt/osd-workbench/extensions \
  --user-data-dir /home/coder/.local/share/code-server \
  "$workspace"
