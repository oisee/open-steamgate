# Spin up OSD

Want to try it without installing anything? Open the [browser demo](https://oisee.github.io/open-steamgate/main/app/flp.html).
For your own server, the fastest route is one ready Docker image containing
OSD and the DIAG/RFC stubs. The examples below are complete Portainer stacks:
copy one block and deploy. The multi-platform `draft` tag supports
**Linux amd64** and **Linux arm64**; Docker selects the matching image.

## Portainer: paste one short stack

In a Docker Standalone environment, choose **Stacks → Add stack → Web editor**.
Give the stack a new name, paste **one entire YAML block below**, and click
**Deploy the stack**. The defaults are deliberately distinct: SQLite **11**,
DuckDB **15**, HANA Express **17** and PostgreSQL **19**. No instance variable is required.
To override one, set a two-digit `INSTANCE` in Portainer's Stack variables;
putting it under a service's `environment:` does not set Compose's port
interpolation.

For instance `11`, open `http://DOCKER-HOST:8011/app/flp.html`. HTTPS is on
`44311`, the DIAG stub on `3211`, and the RFC stub on `3311`. Substitute
`15`, `17` or `19` for the other stacks. The container
creates a self-signed certificate; set `TLS_SAN=DNS:your-host.example` before
the first start if clients use that hostname. The certificate and, for SQLite
or DuckDB, the database persist in named volumes. Keep each database variant
in a different Stack; don't switch engines on an existing data volume.

`draft` tracks the newest published multi-platform draft. For a repeatable
cross-platform test, set `OSD_TAG` to the unique `sha-…-run-…` tag from the successful
[multi-arch workflow's summary](https://github.com/oisee/open-steamgate/actions/workflows/docker-multiarch.yml).
The stacks request the OSD image from GHCR on each deployment, so an older
locally cached `draft` is not silently reused. If a stack was already
pasted into Portainer, update its Web editor YAML or set `OSD_TAG` to a new
immutable tag before redeploying; changing this document does not update an
existing Portainer stack.
The single image is public on GHCR; no registry credentials are needed.
On a 64-bit ARM host, use the SQLite or DuckDB block unchanged. Do not use the HANA Express block there:
its SAP image is pinned to `linux/amd64`. PostgreSQL is not yet part of the
ARM64 acceptance suite. See [Raspberry Pi](#raspberry-pi-arm64) below.

Start with **SQLite**. **DuckDB** uses the same image with one writable worker.
The **HANA Express** block starts a *new HXE container* alongside OSD. Its
only required Stack variable is `ACCEPT_SAP_LICENSE=YES`, which you should
set only after reading and accepting [SAP's HANA Express terms](https://hub.docker.com/r/saplabs/hanaexpress).
It uses the demo master password `OSD17_Demo!ChangeMe` unless you set
`HANA_PASSWORD` before first deployment. This known password and unauthenticated
OSD are for an isolated test network only; HXE's SQL port is not published on
the host. Reuse the same password with an existing volume. See
[HANA setup and acceptance](docker-image.md).
The one-shot `hana-init` service uses the same OSD image and should show
**Exited (0)**; it prepares HXE's password file before the database starts.
Automated protocol checks and SAP-TUI screen artifacts are described in
[image acceptance](docker-image.md#build-and-automation).
The PostgreSQL block starts a fresh PostgreSQL server in the same Stack. Its
demo password should be changed before first start outside an isolated network;
its SQL port is private to the Stack.

<!-- BEGIN GENERATED IMAGE STACKS -->

### Ready image: SQLite

Source: [docker/compose.sqlite.yml](../docker/compose.sqlite.yml).

```yaml
# Portainer: SQLite demo, default instance 11 (8011/44311/3211/3311).
services:
  osd:
    image: ghcr.io/oisee/open-steamgate:${OSD_TAG:-draft}
    pull_policy: always
    init: true
    environment:
      INSTANCE: "${INSTANCE:-11}"
      OSD_SID: OSD
      STG_ADT_SID: OSD
      STG_RFC_AUTH_MODE: "${STG_RFC_AUTH_MODE:-demo}"
      STG_DB: file
      TLS_SAN: "${TLS_SAN:-DNS:osd,DNS:localhost,IP:127.0.0.1}"
    ports:
      - "80${INSTANCE:-11}:3030"
      - "443${INSTANCE:-11}:44300"
      - "32${INSTANCE:-11}:32${INSTANCE:-11}"
      - "33${INSTANCE:-11}:33${INSTANCE:-11}"
    volumes:
      - osd-data:/data
      - osd-tls:/opt/osd/.local/tls
    restart: unless-stopped
    stop_grace_period: 60s
volumes:
  osd-data:
  osd-tls:
```

### Ready image: DuckDB

Source: [docker/compose.duckdb.yml](../docker/compose.duckdb.yml).

```yaml
# Portainer: DuckDB demo, default instance 15 (8015/44315/3215/3315).
services:
  osd:
    image: ghcr.io/oisee/open-steamgate:${OSD_TAG:-draft}
    pull_policy: always
    init: true
    environment:
      INSTANCE: "${INSTANCE:-15}"
      OSD_SID: OSD
      STG_ADT_SID: OSD
      STG_RFC_AUTH_MODE: "${STG_RFC_AUTH_MODE:-demo}"
      STG_DB: duckdb
      OSD_WORKERS: "1"
      TLS_SAN: "${TLS_SAN:-DNS:osd,DNS:localhost,IP:127.0.0.1}"
    ports:
      - "80${INSTANCE:-15}:3030"
      - "443${INSTANCE:-15}:44300"
      - "32${INSTANCE:-15}:32${INSTANCE:-15}"
      - "33${INSTANCE:-15}:33${INSTANCE:-15}"
    volumes:
      - osd-data:/data
      - osd-tls:/opt/osd/.local/tls
    restart: unless-stopped
    stop_grace_period: 60s
volumes:
  osd-data:
  osd-tls:
```

### Ready image: New HANA Express + OSD

Source: [docker/compose.hana.yml](../docker/compose.hana.yml).

```yaml
# Portainer: new HANA Express + OSD, instance 17. Set ACCEPT_SAP_LICENSE=YES.
# Demo password is a known default; change HANA_PASSWORD before first start
# outside an isolated test network. HXE's SQL port is not published to host.
services:
  hana-init:
    image: ghcr.io/oisee/open-steamgate:${OSD_TAG:-draft}
    pull_policy: always
    user: "0:0"
    entrypoint: ["node", "docker/image/hana-init.mjs"]
    environment:
      ACCEPT_SAP_LICENSE: "${ACCEPT_SAP_LICENSE:?Set YES after accepting the SAP HANA Express license}"
      HANA_PASSWORD: "${HANA_PASSWORD:-OSD17_Demo!ChangeMe}"
    volumes:
      - hana-data:/hana/mounts
    restart: "no"

  hxe:
    image: saplabs/hanaexpress:latest
    platform: linux/amd64
    hostname: hxe
    command: ["--passwords-url", "file:///hana/mounts/password.json", "--agree-to-sap-license"]
    environment:
      HANA_PASSWORD: "${HANA_PASSWORD:-OSD17_Demo!ChangeMe}"
    volumes:
      - hana-data:/hana/mounts
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

  osd:
    image: ghcr.io/oisee/open-steamgate:${OSD_TAG:-draft}
    pull_policy: always
    init: true
    environment:
      INSTANCE: "${INSTANCE:-17}"
      OSD_SID: OSD
      STG_ADT_SID: OSD
      STG_RFC_AUTH_MODE: "${STG_RFC_AUTH_MODE:-demo}"
      STG_DB: hana
      HANA_HOST: hxe
      HANA_PORT: "39017"
      HANA_USER: SYSTEM
      HANA_PASSWORD: "${HANA_PASSWORD:-OSD17_Demo!ChangeMe}"
      HANA_SCHEMA: "${HANA_SCHEMA:-OSD}"
      TLS_SAN: "${TLS_SAN:-DNS:osd,DNS:localhost,IP:127.0.0.1}"
    ports:
      - "80${INSTANCE:-17}:3030"
      - "443${INSTANCE:-17}:44300"
      - "32${INSTANCE:-17}:32${INSTANCE:-17}"
      - "33${INSTANCE:-17}:33${INSTANCE:-17}"
    volumes:
      - osd-tls:/opt/osd/.local/tls
    depends_on:
      hxe:
        condition: service_healthy
    restart: unless-stopped
    stop_grace_period: 60s

volumes:
  hana-data:
  osd-tls:
```

### Ready image: New PostgreSQL + OSD

Source: [docker/compose.postgres.yml](../docker/compose.postgres.yml).

```yaml
# Portainer: new PostgreSQL + OSD, default instance 19 (8019/44319/3219/3319).
# Demo password is public; change POSTGRES_PASSWORD before first start outside
# an isolated test network. PostgreSQL's SQL port is not published to host.
services:
  postgres:
    image: postgres:17-bookworm
    environment:
      POSTGRES_USER: osd
      POSTGRES_DB: osd
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:-OSD19_Demo!ChangeMe}"
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U osd -d osd"]
      interval: 5s
      timeout: 5s
      retries: 30
    restart: unless-stopped
    stop_grace_period: 60s

  osd:
    image: ghcr.io/oisee/open-steamgate:${OSD_TAG:-draft}
    pull_policy: always
    init: true
    environment:
      INSTANCE: "${INSTANCE:-19}"
      OSD_SID: OSD
      STG_ADT_SID: OSD
      STG_RFC_AUTH_MODE: "${STG_RFC_AUTH_MODE:-demo}"
      STG_DB: postgres
      PGHOST: postgres
      PGPORT: "5432"
      PGUSER: osd
      PGPASSWORD: "${POSTGRES_PASSWORD:-OSD19_Demo!ChangeMe}"
      PGDATABASE: osd
      TLS_SAN: "${TLS_SAN:-DNS:osd,DNS:localhost,IP:127.0.0.1}"
    ports:
      - "80${INSTANCE:-19}:3030"
      - "443${INSTANCE:-19}:44300"
      - "32${INSTANCE:-19}:32${INSTANCE:-19}"
      - "33${INSTANCE:-19}:33${INSTANCE:-19}"
    volumes:
      - osd-tls:/opt/osd/.local/tls
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    stop_grace_period: 60s

volumes:
  pg-data:
  osd-tls:
```

<!-- END GENERATED IMAGE STACKS -->

After deployment, wait until `osd` is healthy; its healthcheck covers HTTP,
OData, DIAG and RFC. HANA's first start can take several minutes.
Check the demo OData endpoint at
`http://DOCKER-HOST:8011/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$format=json`,
create a travel and restart OSD to confirm persistence. The DIAG/RFC ports
are the bounded DIAG tape and ADT-over-RFC profiles, not a full SAP GUI or
universal RFC server. The examples explicitly use `STG_RFC_AUTH_MODE=demo` so
Eclipse can log on with demo credentials; expose them only on a trusted
network. For a shared host, set it to `static` and provide `STG_RFC_USER`,
`STG_RFC_PASSWORD` and optionally `STG_RFC_CLIENT`.
For exact test steps and volume notes, see [the image guide](docker-image.md).

## Raspberry Pi (ARM64)

The ARM64 image was built and smoke-tested on a native ARM64 runner with
SQLite and DuckDB, including HTTP/HTTPS ADT and OData, the DIAG tape on 32nn,
ADT-over-RFC on 33nn, and persistence across a whole-stack restart. SQLite
also ran on a **Raspberry Pi 4 with 2 GB RAM**, Debian 13 (trixie) arm64:
the container became healthy and served ADT/OData with its existing database
after an image update. HANA Express is not supported by this ARM64 recipe.

On the Pi, check `uname -m` reports `aarch64` and `getconf LONG_BIT` reports
`64`. In Portainer, paste the complete SQLite or DuckDB Stack above; `draft`
selects ARM64 automatically. The default instances are 11 and 15. For a
repeatable deployment, use an immutable `sha-…-arm64` tag from
the [successful ARM64 workflow](https://github.com/oisee/open-steamgate/actions/workflows/docker-arm64.yml)
instead of `draft`. No QEMU or host-wide emulator registration is needed
on the Pi.

Without Portainer, from a checkout of this repository on the Pi:

```sh
docker compose -p osd11 -f docker/compose.sqlite.yml up -d --wait
docker compose -p osd11 -f docker/compose.sqlite.yml ps
curl -fsS http://localhost:8011/sap/bc/adt/core/http/build
```

Use `docker/compose.duckdb.yml` and project `osd15` for DuckDB. Compose gives
each project its own database and TLS volumes. Keep the same project name on
redeployment; `docker compose down -v` **deletes the database volume**.

System Status always shows container architecture and runtime OS. To show the
**host** OS and Raspberry Pi model as well, add these read-only mounts under
the `osd` service's `volumes:` before deploying (only on a host where both
source paths exist):

```yaml
      - /etc/os-release:/run/host/os-release:ro
      - /proc/device-tree/model:/run/host/device-model:ro
```

For an existing Stack, back up its database volume first, then redeploy the
**same Stack** with a newer `OSD_TAG`; do not delete or rename its volumes.
For a container started manually with `docker run`, first pull the chosen
new image, stop the old container gracefully, and copy `/data` from the
stopped container to a backup directory. Start a new container with the same
named data/TLS volumes and port mappings, but a different container name; keep
the stopped old container for rollback. An image pull alone does not update a
running container. Verify the build endpoint, a previously saved Travel and
System Status before removing any rollback copy. The tested Pi update kept
`osd-pi-data:/data` and `osd-pi-tls:/opt/osd/.local/tls`; these are examples,
not universal volume names.

## Docker Compose CLI

Use the same short files from the repository root. Set a unique project name
for each variant; their default instance numbers already differ:

```sh
git clone https://github.com/oisee/open-steamgate.git
cd open-steamgate
docker compose -p osd11 -f docker/compose.sqlite.yml up -d
docker compose -p osd11 -f docker/compose.sqlite.yml ps
```

For DuckDB use `docker/compose.duckdb.yml` with project `osd15`. For HANA
Express, accept its license and set `ACCEPT_SAP_LICENSE=YES`, then use
`docker/compose.hana.yml` with project `osd17`. `docker compose down` stops a stack without deleting its
named volumes; do not use `down -v` if you want to keep data.

## Locally, without Docker

Requires Git, Node.js 24 with npm, OpenSSL and a POSIX shell (Linux, macOS or
WSL). The first run downloads source dependencies and compiles them:

```sh
git clone https://github.com/oisee/open-steamgate.git
cd open-steamgate
sh docker/portainer/setup-local.sh
npm run osd:tls
STG_PORT=8000 STG_TLS_PORT=44300 node test/run.mjs
```

Open `http://localhost:8000/app/flp.html` or
`https://localhost:44300/app/flp.html`. SQLite persists in
`.local/db/osd.sqlite`; later starts need only the final command. For DuckDB,
set `STG_DB=duckdb`, `STG_DB_PATH="$PWD/.local/db/osd.duckdb"` and
`OSD_WORKERS=1` before that last command. For an existing HANA server, set
`STG_DB=hana` plus `HANA_HOST`, `HANA_PORT` (tenant SQL port), `HANA_USER`,
`HANA_PASSWORD` and optionally `HANA_SCHEMA=OSD`, then run the same last
command. Use a dedicated schema and keep the password out of shell history.
For an existing PostgreSQL database, set `STG_DB=postgres`, `PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD` and `PGDATABASE`; use a dedicated database. Use a
PostgreSQL-capable image published from commit `0d816d8` or newer; images
published before it reject `STG_DB=postgres`. In Portainer, set `OSD_TAG` to
the immutable tag from the successful Docker workflow run if you want to pin
the exact tested image instead of tracking `draft`.
See [database backends](db-backends.md) for details.

Leave `STG_PORT=8000 STG_TLS_PORT=44300 node test/run.mjs` running in the first
terminal. In a second terminal, from the same directory, start the built-in
MIT JavaScript protocol listeners (no Go installation or sidecar is needed):

```sh
INSTANCE=11 STG_PORT=8000 node tools/protocols/server.mjs
```

This listens on DIAG `3211` and RFC `3311`. The RFC bridge carries ADT
requests such as `SADT_REST_RFC_ENDPOINT` to the Node server's HTTP endpoint;
the DIAG port serves the tape stub. Stop the bridge with Ctrl-C, then stop
Node. To use another instance, change `INSTANCE` (and check both ports are
free). `STG_PORT` tells the RFC listener which local HTTP endpoint to use.

The files under [`docker/portainer/`](../docker/portainer/README.md) are
generated copies of the same four ready-image stacks. The older source-build
Compose recipes are retained in Git history.

The YAML blocks above are embedded verbatim from `docker/compose.*.yml` by
`node scripts/sync-spin.mjs`; CI checks the page and Portainer copies against
those files.
