# Spin up OSD

Start with the [browser demo](https://oisee.github.io/open-steamgate/main/app/flp.html)
for zero installation. To run your own instance, choose a path below.

## Locally

You need Git, Node.js 24 with npm, OpenSSL and a POSIX shell (Linux, macOS or
WSL). Initial setup downloads dependencies, libraries and demo packs and
compiles the system. It uses the same transpiler/core/GUI pins as CI;
published npm packages alone are not sufficient for this revision.

```sh
git clone https://github.com/oisee/open-steamgate.git
cd open-steamgate
sh docker/portainer/setup-local.sh
npm run osd:tls
STG_PORT=8000 STG_TLS_PORT=44300 node test/run.mjs
```

Open <http://localhost:8000/app/flp.html> or <https://localhost:44300/app/flp.html>.
Trust the generated self-signed certificate in your client. SQLite persists
in `.local/db/osd.sqlite`. Ctrl-C stops the server. For subsequent starts use
only the last command. Setup uses `../transpiler`; if that folder already has
a different revision, it stops without replacing the checkout. Use a fresh
parent directory for a clean installation.

After setup, DuckDB can be selected instead:

```sh
mkdir -p .local/db
STG_DB=duckdb STG_DB_PATH="$PWD/.local/db/osd.duckdb" \
  STG_PORT=8000 STG_TLS_PORT=44300 OSD_WORKERS=1 node test/run.mjs
```

Use one worker for DuckDB's writable file. For an existing HANA server,
export `HANA_HOST`, `HANA_PORT`, `HANA_USER`, `HANA_PASSWORD` and start with
`STG_DB=hana`. The HANA Compose variant below provisions HANA itself too.

### RFC and DIAG locally

Install Go 1.26. With OSD running, open another terminal in the parent folder
of your checkout:

```sh
git clone https://github.com/oisee/open-rfc-go.git
git clone https://github.com/oisee/vibing-steampunk.git vsp
git clone https://github.com/oisee/open-diag-go.git
git -C open-rfc-go checkout 274c0c912ddb93ebbf07b2b5768bbdf97d4104cf
git -C vsp checkout 9886d2727f47506368b0a3c2f1c1766f1200f747
git -C open-diag-go checkout dd36ebe2d1b4c4fe3c9d61c6468cc44981b20e7b
cd open-diag-go
go run ./cmd/osd-up -attach http://localhost:8000 -instance 0 -stub tape
```

The sibling folder names satisfy the Go module's local replacement paths.
This serves DIAG on `3200` and RFC on `3300`. For instance 06 use
`-instance 6` and the matching OSD HTTP address in `-attach`. Ctrl-C stops
the sidecar. The sidecar does not change OSD's HTTP port.

## Docker Compose

You need Docker Engine, Compose v2 and internet access. The bootstrap stacks
use public Node and Go images. They build OSD and the sidecar on first start;
there is no unpublished image to prepare.

From the repository root:

```sh
# SQLite, instance 00
docker compose -p osd00 -f docker/portainer/compose.sqlite.yml up -d

# Or a separate DuckDB instance 06
INSTANCE=06 docker compose -p osd06 -f docker/portainer/compose.duckdb.yml up -d
```

Use different project names and instance numbers for simultaneous stacks.
Each receives separate database, source, certificate and sidecar volumes.
Do not switch database engines against the same stack's existing volumes.

```sh
docker compose -p osd00 -f docker/portainer/compose.sqlite.yml logs -f
docker compose -p osd00 -f docker/portainer/compose.sqlite.yml ps
# Stop while retaining named volumes:
docker compose -p osd00 -f docker/portainer/compose.sqlite.yml down
```

OSD's health check requires a serving runtime and a demo OData row. Only then
does the protocol container start and compile its binary. Initial startup
can take several minutes; a running container may still be compiling.
Do not use `down -v` if you want to retain data.

Restarts reuse the cached source and builds, and do not overwrite edits or
fetch a newer OSD. The examples pin OSD to `53ff28f`; a checkout revision
mismatch stops startup rather than silently running an older version. Use a
new project name for a fresh installation; do not delete database volumes.
Build cache names include the pinned revisions. Some library URLs and container tags still resolve
at install time, so these are not fully reproducible release images.

## Portainer: paste and deploy

Choose a **Docker Standalone** environment, then **Stacks → Add stack → Web
editor**. Give the stack a name, such as `osd06`, and paste one complete file:

| Database | File to paste |
|---|---|
| SQLite — start here | [compose.sqlite.yml](../docker/portainer/compose.sqlite.yml) |
| DuckDB | [compose.duckdb.yml](../docker/portainer/compose.duckdb.yml) |
| HANA Express | [compose.hana.yml](../docker/portainer/compose.hana.yml) |

In **Environment variables**, below the editor, add `INSTANCE=06`, or leave
it unset for `00`. Keep both digits: `06`, not `6`. Click **Deploy the stack**.
There are no bind-mounted host files to create. These examples use Compose
dependency conditions and target Standalone, not Swarm.

`OSD_SUITE_IMAGE` was a placeholder in the first draft and has been removed.
`${INSTANCE:-00}` is resolved from Stack variables. Putting `INSTANCE` under
one service's `environment:` does not supply interpolation values elsewhere
in the YAML. See [Portainer's instructions](https://docs.portainer.io/user/docker/stacks/add).
The CLI can use an `.env` file; [an example](../docker/portainer/.env.example)
is included, but Portainer Web editor does not need it.

### Connection details

| Endpoint | Formula | Instance 00 | Instance 06 |
|---|---|---|---|
| SAP GUI DIAG stub | `32NN` | `3200` | `3206` |
| Eclipse ADT over RFC | `33NN` | `3300` | `3306` |
| HTTP: Fiori/OData/ADT | `80NN` | `8000` | `8006` |
| HTTPS: same endpoints | `443NN` | `44300` | `44306` |

For instance 06, open `http://DOCKER-HOST:8006/app/flp.html`. In Eclipse use
Custom Application Server, host `DOCKER-HOST`, instance `06`, SID `OSD`,
client `001`. The bridge does not validate logon credentials. RFC provides
the ADT tunnel, not arbitrary RFC function modules. DIAG shows a stub screen,
not arbitrary SAP transactions. Use a trusted development network; these
RFC/DIAG listeners have no SNC encryption.

OSD serves HTTPS itself; Caddy is unnecessary. For remote access set
`TLS_SAN=DNS:osd.example.test` **before the first
start**, using the host address your client will connect to. Trust the
self-signed certificate in your browser/Eclipse. Certificates persist in
`/workspace/osd/.local/tls` in the OSD container; changing the variable does
not replace an existing certificate. An ABAP Cloud Project needs HTTPS.

### HANA Express

Use a Linux amd64 host with memory for HANA (budget 8–16 GB) plus OSD and
builds. Read the [SAP image instructions and license](https://hub.docker.com/r/saplabs/hanaexpress).
Then enter these additional Stack variables:

```text
HANA_PASSWORD=<your HANA-compatible master password>
ACCEPT_SAP_LICENSE=YES
```

For CLI, export those variables and run:

```sh
INSTANCE=07 docker compose -p osd07 -f docker/portainer/compose.hana.yml up -d
```

An init container creates the password JSON in a named volume with the
required ownership. HANA receives it read-only and must pass a SQL health
probe before OSD starts. HANA's ports are internal to the stack; the four
application ports still follow `INSTANCE`. Retain the same password for
redeployment: editing the variable does not rotate an existing DB password.

## Complete Portainer stacks

Copy one complete YAML block below; do not combine the variants. Set Stack
variables as described above. HANA additionally requires its password and
explicit SAP license acceptance.

These blocks are generated from `docker/portainer/compose.*.yml`, not edited
by hand. After changing a Compose file, run `node scripts/sync-spin.mjs`
before committing and include the updated `docs/spin.md` in the same commit.
CI checks synchronization on pushes and pull requests with
`node scripts/sync-spin.mjs --check`; it does not change files or create commits.
No release step is required, so the guide on GitHub is immediately copyable.

<!-- BEGIN GENERATED PORTAINER STACKS -->

### SQLite: complete Portainer Stack

Source: [docker/portainer/compose.sqlite.yml](../docker/portainer/compose.sqlite.yml). Copy the entire block into the Web editor.

```yaml
# Portainer Web editor, Docker Standalone. Set INSTANCE=06 (default 00).
# Optional TLS_SAN=DNS:osd.example.test.
# First start downloads sources/dependencies and compiles. See docs/spin.md.
services:
  osd:
    image: node:24-bookworm
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
      TLS_SAN: "${TLS_SAN:-DNS:osd}"
      STG_PORT: "3030"
      STG_TLS_PORT: "44300"
      STG_ADT_SID: OSD
      STG_DB: file
      OSD_WORKERS: "1"
      STG_DB_PATH: /data/osd.sqlite
    volumes:
      - osd-workspace:/workspace
      - osd-data:/data
    ports:
      - "80${INSTANCE:-00}:3030"
      - "443${INSTANCE:-00}:44300"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -eu
        case "$$INSTANCE" in [0-9][0-9]) ;; *) echo "INSTANCE must be two digits, e.g. 06" >&2; exit 2;; esac
        if ! command -v openssl >/dev/null || ! command -v git >/dev/null; then
          apt-get update
          apt-get install -y --no-install-recommends git openssl ca-certificates
        fi
        cd /workspace
        if [ ! -d osd/.git ]; then
          mkdir -p osd
          git -C osd init
          git -C osd remote add origin https://github.com/oisee/open-steamgate.git
        fi
        if ! git -C osd rev-parse --verify HEAD >/dev/null 2>&1; then
          git -C osd fetch --depth 1 origin 53ff28f39d37b3394fd3755e175d9259e45c0669
          git -C osd checkout --detach FETCH_HEAD
        fi
        if [ "$$(git -C osd rev-parse HEAD)" != "53ff28f39d37b3394fd3755e175d9259e45c0669" ]; then
          echo "OSD revision mismatch; use a new project name (keep data volumes)" >&2; exit 1
        fi
        cd osd
        if [ ! -f .portainer-ready-53ff28f-0263e428-52ba51a5-0324e1c1-v1 ]; then
          checkout() {
            repo="$$1"; revision="$$2"; folder="$$3"
            if [ ! -d "$$folder/.git" ]; then
              mkdir -p "$$folder"
            if [ -n "$$(ls -A "$$folder")" ]; then
              echo "Non-repository folder $$folder is not empty; use a fresh directory/project" >&2; exit 1
            fi
              git -C "$$folder" init
              git -C "$$folder" remote add origin "https://github.com/oisee/$$repo.git"
            fi
            if ! git -C "$$folder" rev-parse --verify HEAD >/dev/null 2>&1; then
              git -C "$$folder" fetch --depth 1 origin "$$revision"
              git -C "$$folder" checkout --detach FETCH_HEAD
            fi
            if [ "$$(git -C "$$folder" rev-parse HEAD)" != "$$revision" ]; then
              echo "Expected $$folder at $$revision; existing checkout left intact" >&2
              exit 1
            fi
          }
          npm ci --include=dev --include=optional
          checkout transpiler 0263e42892063be5008eab42a5f836bc19385b82 ../transpiler
          npm --prefix ../transpiler install --ignore-scripts --no-audit --no-fund
          for package in runtime transpiler extras cli; do
            npm --prefix "../transpiler/packages/$$package" install --no-audit --no-fund
          done
          for package in runtime transpiler extras cli; do
            npm --prefix "../transpiler/packages/$$package" run compile
          done
          chmod +x ../transpiler/packages/cli/abap_transpile
          node tools/osd-link.mjs transpiler packages/transpiler
          node tools/osd-link.mjs transpiler-cli packages/cli
          node tools/osd-link.mjs runtime packages/runtime
          checkout open-abap-core 52ba51a5662b93bd5093a9c1adef64bd438ce7f0 .local/lars/open-abap-core
          checkout open-abap-gui 0324e1c1538f7ac63826ebbddab3fbee31c4501c .local/lars/open-abap-gui
          node tools/osd-libs.mjs
          npm run packs:fetch
          npm run transpile
          touch .portainer-ready-53ff28f-0263e428-52ba51a5-0324e1c1-v1
        fi
        if [ ! -f .local/tls/osd.crt ]; then
          mkdir -p .local/tls
          openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
            -keyout .local/tls/osd.key -out .local/tls/osd.crt \
            -subj /CN=osd/O=open-steamgate \
            -addext "subjectAltName=DNS:osd,DNS:localhost,IP:127.0.0.1,$${TLS_SAN}"
        fi
        exec node test/run.mjs
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          Promise.all([
          fetch('http://localhost:3030/sap/bc/adt/core/http/build').then(r=>r.json()).then(j=>{if(!j.system?.serving)throw Error('No runtime')}),
          fetch('http://localhost:3030/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$$top=1&$$format=json').then(r=>{if(!r.ok)throw Error(r.status);return r.json()}).then(j=>{if(!j.d?.results?.length)throw Error('No seed')})
          ]).catch(e=>{console.error(e);process.exit(1)})
      interval: 15s
      timeout: 10s
      start_period: 20m
      retries: 20
    restart: unless-stopped
    stop_grace_period: 60s

  protocols:
    image: golang:1.26-bookworm
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
    volumes:
      - protocol-workspace:/workspace
      - go-cache:/go
    ports:
      - "32${INSTANCE:-00}:32${INSTANCE:-00}"
      - "33${INSTANCE:-00}:33${INSTANCE:-00}"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -eu
        cd /workspace
        checkout() {
          repo="$$1"; revision="$$2"; folder="$$3"
          if [ ! -d "$$folder/.git" ]; then
            mkdir -p "$$folder"
            if [ -n "$$(ls -A "$$folder")" ]; then
              echo "Non-repository folder $$folder is not empty; use a fresh directory/project" >&2; exit 1
            fi
            git -C "$$folder" init
            git -C "$$folder" remote add origin "https://github.com/oisee/$$repo.git"
          fi
          if ! git -C "$$folder" rev-parse --verify HEAD >/dev/null 2>&1; then
            git -C "$$folder" fetch --depth 1 origin "$$revision"
            git -C "$$folder" checkout --detach FETCH_HEAD
          fi
          if [ "$$(git -C "$$folder" rev-parse HEAD)" != "$$revision" ]; then
            echo "Revision mismatch in $$folder; use a new project name (keep data volumes)" >&2; exit 1
          fi
        }
        checkout open-rfc-go 274c0c912ddb93ebbf07b2b5768bbdf97d4104cf open-rfc-go
        checkout vibing-steampunk 9886d2727f47506368b0a3c2f1c1766f1200f747 vsp
        checkout open-diag-go dd36ebe2d1b4c4fe3c9d61c6468cc44981b20e7b open-diag-go
        if [ ! -x /workspace/osd-up-dd36ebe2-274c0c91-9886d272 ]; then
          cd /workspace/open-diag-go
          go build -o /workspace/osd-up-dd36ebe2-274c0c91-9886d272 ./cmd/osd-up
        fi
        exec /workspace/osd-up-dd36ebe2-274c0c91-9886d272 -attach http://osd:3030 -instance "$$INSTANCE" -stub tape
    depends_on:
      osd:
        condition: service_healthy
    restart: unless-stopped

volumes:
  osd-workspace:
  osd-data:
  protocol-workspace:
  go-cache:
```

### DuckDB: complete Portainer Stack

Source: [docker/portainer/compose.duckdb.yml](../docker/portainer/compose.duckdb.yml). Copy the entire block into the Web editor.

```yaml
# Portainer Web editor, Docker Standalone. Set INSTANCE=06 (default 00).
# Optional TLS_SAN=DNS:osd.example.test.
# First start downloads sources/dependencies and compiles. See docs/spin.md.
services:
  osd:
    image: node:24-bookworm
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
      TLS_SAN: "${TLS_SAN:-DNS:osd}"
      STG_PORT: "3030"
      STG_TLS_PORT: "44300"
      STG_ADT_SID: OSD
      STG_DB: duckdb
      OSD_WORKERS: "1"
      STG_DB_PATH: /data/osd.duckdb
    volumes:
      - osd-workspace:/workspace
      - osd-data:/data
    ports:
      - "80${INSTANCE:-00}:3030"
      - "443${INSTANCE:-00}:44300"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -eu
        case "$$INSTANCE" in [0-9][0-9]) ;; *) echo "INSTANCE must be two digits, e.g. 06" >&2; exit 2;; esac
        if ! command -v openssl >/dev/null || ! command -v git >/dev/null; then
          apt-get update
          apt-get install -y --no-install-recommends git openssl ca-certificates
        fi
        cd /workspace
        if [ ! -d osd/.git ]; then
          mkdir -p osd
          git -C osd init
          git -C osd remote add origin https://github.com/oisee/open-steamgate.git
        fi
        if ! git -C osd rev-parse --verify HEAD >/dev/null 2>&1; then
          git -C osd fetch --depth 1 origin 53ff28f39d37b3394fd3755e175d9259e45c0669
          git -C osd checkout --detach FETCH_HEAD
        fi
        if [ "$$(git -C osd rev-parse HEAD)" != "53ff28f39d37b3394fd3755e175d9259e45c0669" ]; then
          echo "OSD revision mismatch; use a new project name (keep data volumes)" >&2; exit 1
        fi
        cd osd
        if [ ! -f .portainer-ready-53ff28f-0263e428-52ba51a5-0324e1c1-v1 ]; then
          checkout() {
            repo="$$1"; revision="$$2"; folder="$$3"
            if [ ! -d "$$folder/.git" ]; then
              mkdir -p "$$folder"
            if [ -n "$$(ls -A "$$folder")" ]; then
              echo "Non-repository folder $$folder is not empty; use a fresh directory/project" >&2; exit 1
            fi
              git -C "$$folder" init
              git -C "$$folder" remote add origin "https://github.com/oisee/$$repo.git"
            fi
            if ! git -C "$$folder" rev-parse --verify HEAD >/dev/null 2>&1; then
              git -C "$$folder" fetch --depth 1 origin "$$revision"
              git -C "$$folder" checkout --detach FETCH_HEAD
            fi
            if [ "$$(git -C "$$folder" rev-parse HEAD)" != "$$revision" ]; then
              echo "Expected $$folder at $$revision; existing checkout left intact" >&2
              exit 1
            fi
          }
          npm ci --include=dev --include=optional
          checkout transpiler 0263e42892063be5008eab42a5f836bc19385b82 ../transpiler
          npm --prefix ../transpiler install --ignore-scripts --no-audit --no-fund
          for package in runtime transpiler extras cli; do
            npm --prefix "../transpiler/packages/$$package" install --no-audit --no-fund
          done
          for package in runtime transpiler extras cli; do
            npm --prefix "../transpiler/packages/$$package" run compile
          done
          chmod +x ../transpiler/packages/cli/abap_transpile
          node tools/osd-link.mjs transpiler packages/transpiler
          node tools/osd-link.mjs transpiler-cli packages/cli
          node tools/osd-link.mjs runtime packages/runtime
          checkout open-abap-core 52ba51a5662b93bd5093a9c1adef64bd438ce7f0 .local/lars/open-abap-core
          checkout open-abap-gui 0324e1c1538f7ac63826ebbddab3fbee31c4501c .local/lars/open-abap-gui
          node tools/osd-libs.mjs
          npm run packs:fetch
          npm run transpile
          touch .portainer-ready-53ff28f-0263e428-52ba51a5-0324e1c1-v1
        fi
        if [ ! -f .local/tls/osd.crt ]; then
          mkdir -p .local/tls
          openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
            -keyout .local/tls/osd.key -out .local/tls/osd.crt \
            -subj /CN=osd/O=open-steamgate \
            -addext "subjectAltName=DNS:osd,DNS:localhost,IP:127.0.0.1,$${TLS_SAN}"
        fi
        exec node test/run.mjs
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          Promise.all([
          fetch('http://localhost:3030/sap/bc/adt/core/http/build').then(r=>r.json()).then(j=>{if(!j.system?.serving)throw Error('No runtime')}),
          fetch('http://localhost:3030/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$$top=1&$$format=json').then(r=>{if(!r.ok)throw Error(r.status);return r.json()}).then(j=>{if(!j.d?.results?.length)throw Error('No seed')})
          ]).catch(e=>{console.error(e);process.exit(1)})
      interval: 15s
      timeout: 10s
      start_period: 20m
      retries: 20
    restart: unless-stopped
    stop_grace_period: 60s

  protocols:
    image: golang:1.26-bookworm
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
    volumes:
      - protocol-workspace:/workspace
      - go-cache:/go
    ports:
      - "32${INSTANCE:-00}:32${INSTANCE:-00}"
      - "33${INSTANCE:-00}:33${INSTANCE:-00}"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -eu
        cd /workspace
        checkout() {
          repo="$$1"; revision="$$2"; folder="$$3"
          if [ ! -d "$$folder/.git" ]; then
            mkdir -p "$$folder"
            if [ -n "$$(ls -A "$$folder")" ]; then
              echo "Non-repository folder $$folder is not empty; use a fresh directory/project" >&2; exit 1
            fi
            git -C "$$folder" init
            git -C "$$folder" remote add origin "https://github.com/oisee/$$repo.git"
          fi
          if ! git -C "$$folder" rev-parse --verify HEAD >/dev/null 2>&1; then
            git -C "$$folder" fetch --depth 1 origin "$$revision"
            git -C "$$folder" checkout --detach FETCH_HEAD
          fi
          if [ "$$(git -C "$$folder" rev-parse HEAD)" != "$$revision" ]; then
            echo "Revision mismatch in $$folder; use a new project name (keep data volumes)" >&2; exit 1
          fi
        }
        checkout open-rfc-go 274c0c912ddb93ebbf07b2b5768bbdf97d4104cf open-rfc-go
        checkout vibing-steampunk 9886d2727f47506368b0a3c2f1c1766f1200f747 vsp
        checkout open-diag-go dd36ebe2d1b4c4fe3c9d61c6468cc44981b20e7b open-diag-go
        if [ ! -x /workspace/osd-up-dd36ebe2-274c0c91-9886d272 ]; then
          cd /workspace/open-diag-go
          go build -o /workspace/osd-up-dd36ebe2-274c0c91-9886d272 ./cmd/osd-up
        fi
        exec /workspace/osd-up-dd36ebe2-274c0c91-9886d272 -attach http://osd:3030 -instance "$$INSTANCE" -stub tape
    depends_on:
      osd:
        condition: service_healthy
    restart: unless-stopped

volumes:
  osd-workspace:
  osd-data:
  protocol-workspace:
  go-cache:
```

### HANA Express: complete Portainer Stack

Source: [docker/portainer/compose.hana.yml](../docker/portainer/compose.hana.yml). Copy the entire block into the Web editor.

```yaml
# Portainer Web editor, Docker Standalone. Set INSTANCE=06 (default 00).
# Optional TLS_SAN=DNS:osd.example.test.
# First start downloads sources/dependencies and compiles. See docs/spin.md.
services:
  osd:
    image: node:24-bookworm
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
      TLS_SAN: "${TLS_SAN:-DNS:osd}"
      STG_PORT: "3030"
      STG_TLS_PORT: "44300"
      STG_ADT_SID: OSD
      STG_DB: hana
      OSD_WORKERS: "1"
      HANA_HOST: hxe
      HANA_PORT: "39017"
      HANA_USER: SYSTEM
      HANA_PASSWORD: ${HANA_PASSWORD:?Set HANA_PASSWORD in Stack variables}
    volumes:
      - osd-workspace:/workspace
      - osd-data:/data
    ports:
      - "80${INSTANCE:-00}:3030"
      - "443${INSTANCE:-00}:44300"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -eu
        case "$$INSTANCE" in [0-9][0-9]) ;; *) echo "INSTANCE must be two digits, e.g. 06" >&2; exit 2;; esac
        if ! command -v openssl >/dev/null || ! command -v git >/dev/null; then
          apt-get update
          apt-get install -y --no-install-recommends git openssl ca-certificates
        fi
        cd /workspace
        if [ ! -d osd/.git ]; then
          mkdir -p osd
          git -C osd init
          git -C osd remote add origin https://github.com/oisee/open-steamgate.git
        fi
        if ! git -C osd rev-parse --verify HEAD >/dev/null 2>&1; then
          git -C osd fetch --depth 1 origin 53ff28f39d37b3394fd3755e175d9259e45c0669
          git -C osd checkout --detach FETCH_HEAD
        fi
        if [ "$$(git -C osd rev-parse HEAD)" != "53ff28f39d37b3394fd3755e175d9259e45c0669" ]; then
          echo "OSD revision mismatch; use a new project name (keep data volumes)" >&2; exit 1
        fi
        cd osd
        if [ ! -f .portainer-ready-53ff28f-0263e428-52ba51a5-0324e1c1-v1 ]; then
          checkout() {
            repo="$$1"; revision="$$2"; folder="$$3"
            if [ ! -d "$$folder/.git" ]; then
              mkdir -p "$$folder"
            if [ -n "$$(ls -A "$$folder")" ]; then
              echo "Non-repository folder $$folder is not empty; use a fresh directory/project" >&2; exit 1
            fi
              git -C "$$folder" init
              git -C "$$folder" remote add origin "https://github.com/oisee/$$repo.git"
            fi
            if ! git -C "$$folder" rev-parse --verify HEAD >/dev/null 2>&1; then
              git -C "$$folder" fetch --depth 1 origin "$$revision"
              git -C "$$folder" checkout --detach FETCH_HEAD
            fi
            if [ "$$(git -C "$$folder" rev-parse HEAD)" != "$$revision" ]; then
              echo "Expected $$folder at $$revision; existing checkout left intact" >&2
              exit 1
            fi
          }
          npm ci --include=dev --include=optional
          checkout transpiler 0263e42892063be5008eab42a5f836bc19385b82 ../transpiler
          npm --prefix ../transpiler install --ignore-scripts --no-audit --no-fund
          for package in runtime transpiler extras cli; do
            npm --prefix "../transpiler/packages/$$package" install --no-audit --no-fund
          done
          for package in runtime transpiler extras cli; do
            npm --prefix "../transpiler/packages/$$package" run compile
          done
          chmod +x ../transpiler/packages/cli/abap_transpile
          node tools/osd-link.mjs transpiler packages/transpiler
          node tools/osd-link.mjs transpiler-cli packages/cli
          node tools/osd-link.mjs runtime packages/runtime
          checkout open-abap-core 52ba51a5662b93bd5093a9c1adef64bd438ce7f0 .local/lars/open-abap-core
          checkout open-abap-gui 0324e1c1538f7ac63826ebbddab3fbee31c4501c .local/lars/open-abap-gui
          node tools/osd-libs.mjs
          npm run packs:fetch
          npm run transpile
          touch .portainer-ready-53ff28f-0263e428-52ba51a5-0324e1c1-v1
        fi
        if [ ! -f .local/tls/osd.crt ]; then
          mkdir -p .local/tls
          openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
            -keyout .local/tls/osd.key -out .local/tls/osd.crt \
            -subj /CN=osd/O=open-steamgate \
            -addext "subjectAltName=DNS:osd,DNS:localhost,IP:127.0.0.1,$${TLS_SAN}"
        fi
        exec node test/run.mjs
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          Promise.all([
          fetch('http://localhost:3030/sap/bc/adt/core/http/build').then(r=>r.json()).then(j=>{if(!j.system?.serving)throw Error('No runtime')}),
          fetch('http://localhost:3030/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$$top=1&$$format=json').then(r=>{if(!r.ok)throw Error(r.status);return r.json()}).then(j=>{if(!j.d?.results?.length)throw Error('No seed')})
          ]).catch(e=>{console.error(e);process.exit(1)})
      interval: 15s
      timeout: 10s
      start_period: 20m
      retries: 20
    depends_on:
      hxe:
        condition: service_healthy
    restart: unless-stopped
    stop_grace_period: 60s

  protocols:
    image: golang:1.26-bookworm
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
    volumes:
      - protocol-workspace:/workspace
      - go-cache:/go
    ports:
      - "32${INSTANCE:-00}:32${INSTANCE:-00}"
      - "33${INSTANCE:-00}:33${INSTANCE:-00}"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -eu
        cd /workspace
        checkout() {
          repo="$$1"; revision="$$2"; folder="$$3"
          if [ ! -d "$$folder/.git" ]; then
            mkdir -p "$$folder"
            if [ -n "$$(ls -A "$$folder")" ]; then
              echo "Non-repository folder $$folder is not empty; use a fresh directory/project" >&2; exit 1
            fi
            git -C "$$folder" init
            git -C "$$folder" remote add origin "https://github.com/oisee/$$repo.git"
          fi
          if ! git -C "$$folder" rev-parse --verify HEAD >/dev/null 2>&1; then
            git -C "$$folder" fetch --depth 1 origin "$$revision"
            git -C "$$folder" checkout --detach FETCH_HEAD
          fi
          if [ "$$(git -C "$$folder" rev-parse HEAD)" != "$$revision" ]; then
            echo "Revision mismatch in $$folder; use a new project name (keep data volumes)" >&2; exit 1
          fi
        }
        checkout open-rfc-go 274c0c912ddb93ebbf07b2b5768bbdf97d4104cf open-rfc-go
        checkout vibing-steampunk 9886d2727f47506368b0a3c2f1c1766f1200f747 vsp
        checkout open-diag-go dd36ebe2d1b4c4fe3c9d61c6468cc44981b20e7b open-diag-go
        if [ ! -x /workspace/osd-up-dd36ebe2-274c0c91-9886d272 ]; then
          cd /workspace/open-diag-go
          go build -o /workspace/osd-up-dd36ebe2-274c0c91-9886d272 ./cmd/osd-up
        fi
        exec /workspace/osd-up-dd36ebe2-274c0c91-9886d272 -attach http://osd:3030 -instance "$$INSTANCE" -stub tape
    depends_on:
      osd:
        condition: service_healthy
    restart: unless-stopped

  hana-init:
    image: node:24-bookworm
    environment:
      HANA_PASSWORD: ${HANA_PASSWORD:?Set HANA_PASSWORD in Stack variables}
      ACCEPT_SAP_LICENSE: ${ACCEPT_SAP_LICENSE:?Set YES after accepting the SAP HANA Express license}
    volumes:
      - hana-password:/password
      - hana-data:/hana/mounts
    entrypoint: ["node", "-e"]
    command:
      - |
        const fs = require('node:fs');
        if (process.env.ACCEPT_SAP_LICENSE !== 'YES') throw Error('Accept SAP license first');
        const password = process.env.HANA_PASSWORD;
        const path = '/password/password.json';
        if (fs.existsSync(path)) {
          if (JSON.parse(fs.readFileSync(path)).master_password !== password)
            throw Error('Existing HANA volume has another password; restore original Stack variable');
        } else {
          fs.writeFileSync(path, JSON.stringify({master_password: password}), {mode: 0o600});
          fs.chownSync(path, 12000, 79);
        }
        fs.chownSync('/hana/mounts', 12000, 79);
    restart: "no"

  hxe:
    image: saplabs/hanaexpress:latest
    platform: linux/amd64
    hostname: hxe
    command: ["--passwords-url", "file:///password/password.json", "--agree-to-sap-license"]
    environment:
      HANA_PASSWORD: ${HANA_PASSWORD:?Set HANA_PASSWORD in Stack variables}
    volumes:
      - hana-data:/hana/mounts
      - hana-password:/password:ro
    depends_on:
      hana-init:
        condition: service_completed_successfully
    ulimits:
      nofile: {soft: 1048576, hard: 1048576}
    sysctls:
      net.ipv4.ip_local_port_range: "40000 60999"
    healthcheck:
      test: ["CMD-SHELL", "/usr/sap/HXE/HDB90/exe/hdbsql -n localhost:39017 -u SYSTEM -p \"$$HANA_PASSWORD\" 'SELECT 1 FROM DUMMY' >/dev/null 2>&1"]
      interval: 15s
      timeout: 10s
      start_period: 5m
      retries: 120
    restart: unless-stopped
    stop_grace_period: 5m

volumes:
  osd-workspace:
  osd-data:
  protocol-workspace:
  go-cache:
  hana-data:
  hana-password:
```

<!-- END GENERATED PORTAINER STACKS -->

## Publishing our own image

The desired release layout is one OSD image containing the runtime and
open-source database drivers, and a separate RFC/DIAG sidecar image. HANA
Express stays an independently pulled SAP image; no HANA server, SAP kernel,
SAP GUI or SAP NW RFC SDK should be bundled into our image. SQLite and DuckDB
are embedded engines; they run in the OSD process. External engines require
an implemented OSD adapter: currently HANA is available; arbitrary database
images cannot be substituted just by changing Compose.

Before publishing, inspect the actual build contents, transitive licenses,
ABAP libraries, demo packs/media and embedded DIAG assets. The runtime's MIT
license alone does not establish redistribution rights for the whole image.
The bootstrap stacks include demo packs; they are not a release packaging
policy for a minimal public image. A prebuilt image will remove the startup
downloads/builds; its registry name will replace the bootstrap service.

## Verification status

Repository access was checked. YAML and embedded scripts are checked locally.
The complete stacks have **not been booted in Docker/Portainer here**: this
environment has no Docker or Podman executable. HANA especially needs a cold
start and restart on the target host. Share startup logs if it fails.

The older [development compose](../docker/compose.yml) expects a prepared
`.local/release` and is not the copy-paste route above.
