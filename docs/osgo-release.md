# OSGo release binary in CI

The `vscode-v0.N.NNNN` release includes `osgo-linux-x64`,
`osgo-linux-arm64`, `osgo-darwin-arm64`, and `osgo-windows-x64.exe`, each
with a matching `.sha256`. The Go executable runs the compiled OData
services with a pure Go SQLite driver. It does not need Node, a Go installation,
or a separate database server. OSGo does **not** serve ADT yet; the readiness
route is `GET /health`, not `/sap/bc/adt/core/http/build`.

Pin a tested release tag in consumer CI and download both files from that
tag. For example, on Linux x64:

```sh
tag=vscode-v0.N.NNNN
asset=osgo-linux-x64
gh release download "$tag" -R oisee/open-steamgate -p "$asset" -p "$asset.sha256"
sha256sum -c "$asset.sha256"
chmod +x "$asset"
./"$asset" -version
mkdir -p "$RUNNER_TEMP/osgo-home"
./"$asset" -home "$RUNNER_TEMP/osgo-home" -port 3095 &
pid=$!
ready=0
for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:3095/health | grep -q '"status":"ready"'; then
    ready=1
    break
  fi
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then echo 'OSGo did not become ready' >&2; exit 1; fi
curl --fail 'http://127.0.0.1:3095/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json'
kill "$pid"
```

`-home` puts the SQLite database at `<home>/osgo.sqlite`; a fresh directory
is a full data reset. `-db <path>` chooses a database file explicitly and
overrides `-home` and `STG_DB_PATH`. `-home` overrides `STG_DB_PATH`. With no
path setting the database is in memory and reseeded at each start. `-port`
overrides `OSD_PORT`, which overrides `STG_PORT`; the default is 3095. The listener binds to `127.0.0.1` unless
`-addr` specifies another address. Keep the listener private: OSGo does not
provide authentication.

The compiled OData services and seed rows are in the executable. The optional
webapp, pack pages, media, and ADT object store still use files from `-root`
or `-media` when present. CI that only needs the service and data can run the
binary in an empty working directory as shown above.
