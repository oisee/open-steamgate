# Spin up OSD

Want to try it without installing anything? Open the [browser demo](https://oisee.github.io/open-steamgate/main/app/flp.html).
For your own server, the fastest route is a ready Docker image. The examples
below are complete Portainer stacks: copy one block, set an instance number,
and deploy. The images are currently built for **Linux amd64**.

## Portainer: paste one short stack

In a Docker Standalone environment, choose **Stacks → Add stack → Web editor**.
Give the stack a new name (for example `osd06`), paste **one entire YAML block
below**, and set the Stack environment variable `INSTANCE=06`. Click **Deploy
the stack**. `INSTANCE` must have two digits and belongs in Portainer's Stack
variables: putting it under a service's `environment:` does not set Compose's
port interpolation.

For instance `06`, open `http://DOCKER-HOST:8006/app/flp.html`. HTTPS is on
`44306`, the DIAG stub on `3206`, and the RFC stub on `3306`. The container
creates a self-signed certificate; set `TLS_SAN=DNS:your-host.example` before
the first start if clients use that hostname. The certificate and, for SQLite
or DuckDB, the database persist in named volumes. Keep each database variant
in a different Stack; don't switch engines on an existing data volume.

`docker-draft` tracks the newest published draft. For a repeatable test, set
`OSD_TAG` to the exact value in the [successful image workflow's summary](https://github.com/oisee/open-steamgate/actions/workflows/docker-image.yml).
Both images use that tag and are public on GHCR; no registry credentials are
needed for these draft images.

Start with **SQLite**. **DuckDB** uses the same image with one writable worker.
The **HANA** block connects to an *existing* HANA or HANA Express SQL server;
also set `HANA_HOST`, `HANA_PORT`, `HANA_USER`, `HANA_PASSWORD` and optionally
`HANA_SCHEMA`. HANA is not redistributed in the OSD image. If HANA runs in
another Docker Stack, its host must be reachable from OSD's container; `localhost`
inside OSD is not the HANA host. See [HANA setup and acceptance](docker-image.md).

<!-- BEGIN GENERATED IMAGE STACKS -->

### Ready image: SQLite

Source: [docker/compose.sqlite.yml](../docker/compose.sqlite.yml).

```yaml
# Portainer: set INSTANCE=06 in Stack environment, then paste this entire file.
# OSD_TAG can pin both images to one immutable sha-...-run-... tag.
services:
  osd:
    image: ghcr.io/oisee/open-steamgate:${OSD_TAG:-docker-draft}
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
      OSD_SID: OSD
      STG_ADT_SID: OSD
      STG_DB: file
      TLS_SAN: "${TLS_SAN:-DNS:osd,DNS:localhost,IP:127.0.0.1}"
    ports:
      - "80${INSTANCE:-00}:3030"
      - "443${INSTANCE:-00}:44300"
    volumes:
      - osd-data:/data
      - osd-tls:/opt/osd/.local/tls
    restart: unless-stopped
    stop_grace_period: 60s
  protocols:
    image: ghcr.io/oisee/open-steamgate-protocols:${OSD_TAG:-docker-draft}
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
    ports:
      - "32${INSTANCE:-00}:32${INSTANCE:-00}"
      - "33${INSTANCE:-00}:33${INSTANCE:-00}"
    depends_on:
      osd:
        condition: service_healthy
    restart: unless-stopped
volumes:
  osd-data:
  osd-tls:
```

### Ready image: DuckDB

Source: [docker/compose.duckdb.yml](../docker/compose.duckdb.yml).

```yaml
# Portainer: set INSTANCE=06 in Stack environment, then paste this entire file.
services:
  osd:
    image: ghcr.io/oisee/open-steamgate:${OSD_TAG:-docker-draft}
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
      OSD_SID: OSD
      STG_ADT_SID: OSD
      STG_DB: duckdb
      OSD_WORKERS: "1"
      TLS_SAN: "${TLS_SAN:-DNS:osd,DNS:localhost,IP:127.0.0.1}"
    ports:
      - "80${INSTANCE:-00}:3030"
      - "443${INSTANCE:-00}:44300"
    volumes:
      - osd-data:/data
      - osd-tls:/opt/osd/.local/tls
    restart: unless-stopped
    stop_grace_period: 60s
  protocols:
    image: ghcr.io/oisee/open-steamgate-protocols:${OSD_TAG:-docker-draft}
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
    ports:
      - "32${INSTANCE:-00}:32${INSTANCE:-00}"
      - "33${INSTANCE:-00}:33${INSTANCE:-00}"
    depends_on:
      osd:
        condition: service_healthy
    restart: unless-stopped
volumes:
  osd-data:
  osd-tls:
```

### Ready image: External HANA / HANA Express

Source: [docker/compose.hana.yml](../docker/compose.hana.yml).

```yaml
# Existing HANA / HANA Express SQL endpoint; no SAP server is redistributed.
# Required Stack variables: HANA_HOST, HANA_PORT, HANA_USER, HANA_PASSWORD.
services:
  osd:
    image: ghcr.io/oisee/open-steamgate:${OSD_TAG:-docker-draft}
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
      OSD_SID: OSD
      STG_ADT_SID: OSD
      STG_DB: hana
      HANA_HOST: "${HANA_HOST:?Set the HANA hostname reachable from Docker}"
      HANA_PORT: "${HANA_PORT:?Set the tenant SQL port}"
      HANA_USER: "${HANA_USER:?Set the database user}"
      HANA_PASSWORD: "${HANA_PASSWORD:?Set the database password}"
      HANA_SCHEMA: "${HANA_SCHEMA:-OSD}"
      TLS_SAN: "${TLS_SAN:-DNS:osd,DNS:localhost,IP:127.0.0.1}"
    ports:
      - "80${INSTANCE:-00}:3030"
      - "443${INSTANCE:-00}:44300"
    volumes:
      - osd-tls:/opt/osd/.local/tls
    restart: unless-stopped
    stop_grace_period: 60s
  protocols:
    image: ghcr.io/oisee/open-steamgate-protocols:${OSD_TAG:-docker-draft}
    init: true
    environment:
      INSTANCE: "${INSTANCE:-00}"
    ports:
      - "32${INSTANCE:-00}:32${INSTANCE:-00}"
      - "33${INSTANCE:-00}:33${INSTANCE:-00}"
    depends_on:
      osd:
        condition: service_healthy
    restart: unless-stopped
volumes:
  osd-tls:
```

<!-- END GENERATED IMAGE STACKS -->

After deployment, wait until `osd` is healthy and `protocols` is running.
Check the demo OData endpoint at
`http://DOCKER-HOST:8006/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$format=json`,
create a travel and restart OSD to confirm persistence. The DIAG/RFC ports
are stubs, not a full SAP GUI or RFC implementation. This draft has no
production authentication boundary; expose it only on a trusted network.
For exact test steps and volume notes, see [the image guide](docker-image.md).

## Docker Compose CLI

Use the same short files from the repository root. Set a unique project and
instance number for each variant:

```sh
git clone -b feat/docker-image https://github.com/oisee/open-steamgate.git
cd open-steamgate
INSTANCE=06 docker compose -p osd06 -f docker/compose.sqlite.yml up -d
docker compose -p osd06 -f docker/compose.sqlite.yml ps
```

For DuckDB use `docker/compose.duckdb.yml` and a different project/instance.
For an existing HANA server use `docker/compose.hana.yml` with the required
`HANA_*` variables. `docker compose down` stops a stack without deleting its
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
See [database backends](db-backends.md) for details.

The older source-building Portainer stacks are still available under
[`docker/portainer/`](../docker/portainer/README.md). They download and compile
at startup and are not the recommended quickstart.

The YAML blocks above are embedded verbatim from `docker/compose.*.yml` by
`node scripts/sync-spin.mjs`; CI checks that the page matches those files.
