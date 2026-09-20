#!/bin/sh
# Disposable CI resources only. No access to an existing Portainer stack.
set -eu
osd_image=${1:-osd:ci}
protocol_image=${2:-osd-protocols:ci}
probe="osd-image-probe-$$"
cleanup() {
  docker rm -f "$probe" "$probe-protocols" >/dev/null 2>&1 || true
  docker volume rm "$probe-data" "$probe-tls" >/dev/null 2>&1 || true
  docker network rm "$probe-net" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker network create "$probe-net" >/dev/null
wait_ready() {
  count=0
  until docker exec "$probe" node docker/image/healthcheck.mjs; do
    count=$((count + 1))
    if [ "$count" -ge 60 ]; then docker logs "$probe"; return 1; fi
    sleep 2
  done
}
for db in file duckdb; do
  docker volume create "$probe-data" >/dev/null
  docker volume create "$probe-tls" >/dev/null
  docker run -d --init --name "$probe" --network "$probe-net" --network-alias osd \
    -e STG_DB="$db" -e INSTANCE=06 -v "$probe-data:/data" -v "$probe-tls:/opt/osd/.local/tls" "$osd_image" >/dev/null
  wait_ready
  docker run -d --init --name "$probe-protocols" --network "$probe-net" --network-alias protocols \
    -e INSTANCE=06 "$protocol_image" >/dev/null
  # osd-up needs no compilation; wait for listeners with a bounded probe loop.
  count=0
  until docker exec "$probe" node -e 'const s=require("node:net").connect(3206,"protocols");s.setTimeout(2000,()=>s.destroy(Error("timeout")));s.on("connect",()=>s.end());s.on("error",()=>process.exit(1))'; do
    count=$((count + 1))
    if [ "$count" -ge 20 ]; then docker logs "$probe-protocols"; exit 1; fi
    sleep 1
  done
  docker exec -e PROTOCOL_HOST=protocols "$probe" node docker/image/probe.mjs create
  docker restart -t 30 "$probe" >/dev/null
  wait_ready
  docker exec -e PROTOCOL_HOST=protocols "$probe" node docker/image/probe.mjs read
  docker rm -f "$probe" "$probe-protocols" >/dev/null
  docker volume rm "$probe-data" "$probe-tls" >/dev/null
done
