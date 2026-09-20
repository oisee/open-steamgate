#!/bin/sh
# Disposable Compose projects only; choose a free test instance in 50–89.
# HXE is opt-in: OSD_TEST_DATABASES='sqlite duckdb hana' ACCEPT_SAP_LICENSE=YES.
set -eu
osd_image=${1:-osd:ci}
client_image=${2:-osd-probes:ci}
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
report_dir=${OSD_ACCEPTANCE_DIR:-"$repo_dir/.local/image-acceptance"}
mkdir -p "$report_dir"
report_dir=$(CDPATH= cd -- "$report_dir" && pwd)
project="osd-image-probe-$$"
export OSD_TAG="smoke-$$"
test_tag="ghcr.io/oisee/open-steamgate:$OSD_TAG"
compose_file=""
compose() { docker compose -p "$project" -f "$compose_file" "$@"; }
cleanup() {
  if [ -n "$compose_file" ]; then
    compose logs --no-color > "$report_dir/${db:-unknown}-containers.log" 2>&1 || true
    compose down --volumes --timeout 300 >/dev/null 2>&1 || true
  fi
  docker image rm "$test_tag" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker tag "$osd_image" "$test_tag"
for db in ${OSD_TEST_DATABASES:-sqlite duckdb}; do
  case "$db" in
    sqlite|duckdb) ;;
    hana)
      [ "${ACCEPT_SAP_LICENSE:-}" = YES ] || { echo 'Set ACCEPT_SAP_LICENSE=YES after accepting the SAP HANA Express license' >&2; exit 2; }
      docker pull saplabs/hanaexpress:latest
      ;;
    *) echo "Unknown acceptance database: $db" >&2; exit 2 ;;
  esac
  INSTANCE=$(docker run --rm --network host --entrypoint node "$client_image" /probe/free-instance.mjs)
  export INSTANCE
  echo "Testing $db with INSTANCE=$INSTANCE (free port scan; Compose validates the actual bind)"
  compose_file="$repo_dir/docker/compose.$db.yml"
  # Test the exact copy-paste YAML, using only a local alias of the tested image.
  # --pull never overrides pull_policy:always during this pre-publication test.
  if ! compose up -d --pull never --wait --wait-timeout 900; then
    compose logs --no-color > "$report_dir/$db-startup.log" 2>&1
    echo "Startup failed for $db instance $INSTANCE; check $report_dir/$db-startup.log (a port may have been claimed after the scan)" >&2
    exit 1
  fi
  for phase in create read; do
    if [ "$phase" = read ]; then
      # Restart the whole stack, including the database server for HXE.
      # Keep volumes: the record written in the previous phase must survive.
      compose stop
      compose up -d --pull never --wait --wait-timeout 900
    fi
    compose exec -T -e PROTOCOL_HOST=127.0.0.1 osd node docker/image/probe.mjs "$phase" > "$report_dir/$db-$phase-persistence.log" 2>&1 || {
      cat "$report_dir/$db-$phase-persistence.log"
      exit 1
    }
    cat "$report_dir/$db-$phase-persistence.log"
    docker run --rm --network host --user "$(id -u):$(id -g)" \
      -e PROBE_HOST=127.0.0.1 -e INSTANCE="$INSTANCE" \
      -e PROBE_HTTP_PORT="80$INSTANCE" -e PROBE_HTTPS_PORT="443$INSTANCE" \
      -e PROBE_LABEL="$db-$phase" -e OSD_TEST_IMAGE="$osd_image" \
      -v "$report_dir:/reports" "$client_image"
  done
  compose down --volumes --timeout 300
  compose_file=""
done
