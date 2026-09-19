# Running it in containers, and connecting an IDE to it

Three configurations exist, they differ by one variable at the database seam,
and the simplest needs nothing installed but docker.

```sh
bun scripts/make-release.mjs .local/release     # the release the image copies
docker build -f docker/Dockerfile -t osd:local .

cd docker
docker compose --profile sqlite up              # nothing else to run
docker compose --profile hana up                # HANA Express beside it
```

The image is the release directory and a CA bundle. Nothing is compiled at
image time: the Bun binary needs no Node and no npm, and the tree it serves
travels beside it.

## The health check is by content

```
wget -qO- http://localhost:3030/sap/bc/adt/core/http/build | grep -q commit
```

Not "the port is open". An unbuilt or half-started system **listens** and
answers 503 to everything, and a comparison against one reports differences
that are not differences — measured, and written down in the backlog as the
first thing branch plumbing had to learn.

## HANA Express

The image is 4.49 GB and wants 8–16 GB of memory. The licence is accepted by
the person running it and the master password is theirs: put it in
`docker/hxe/password.json` as `{"master_password":"…"}` before starting, and
set the same value in `HANA_PASSWORD` for the OSD service. Neither travels in
this repository.

Three corrections to SAP's published recipe, measured on 2026-09-18 and
recorded in [`amdp-in-hana.md`](amdp-in-hana.md):

- `kernel.shmmni` **cannot** be set per container — it is not namespaced and
  docker refuses the flag outright;
- `kernel.shmmax` and `kernel.shmall` should be **inherited**, not set: the
  published values are lower than a modern host already has;
- `Check failed: syscalls` for `move_pages` and `mbind` can be ignored on a
  single-socket machine — those place pages across NUMA nodes and there is one
  node. On a multi-socket host the seccomp profile has to be built by hand.

The health check waits on a **condition** rather than a timeout
(`SELECT 1 FROM DUMMY`), because a cold start was measured once at 169 s and a
slower machine should wait rather than fail.

**What is proven and what is not.** `STG_DB=hana` serves, and `npm run unit`
against HANA is green in 19.1 s — both measured against a HANA Express beside
the host rather than through this compose, which has not been run end to end.
And one negative measurement worth more than the positive ones: the **wire**
suite against HANA does not run slowly, it **hangs** — 21 minutes, no output,
two seconds of process CPU, three open sockets. A process waiting on the
database, not computing. So there is no `e2e-hana` profile here and a longer
timeout would not make one: the thing to wait for does not exist yet.

And HANA is a mode, never a default: per statement it costs 52× a single-row
SELECT and 3.8× a 200-row one ([`db-backends.md`](db-backends.md)).

## Connecting Eclipse (ADT)

OSD answers the ADT surface, so Eclipse treats it as a system
([`adt-facade.md`](adt-facade.md)):

1. **ABAP Cloud Project**, URL `http://localhost:3030` — this is the HTTP
   path, which is what the container exposes.
2. Any user and password: the façade does not check them, because there is
   nothing to check against.
3. The package tree, opening and editing sources, activation, ABAP Unit and
   F8 data preview all answer; every path that does not is recorded, so the
   worklist writes itself.

The other Eclipse kind, **Custom Application Server**, logs on over RFC and
tunnels ADT inside one `SADT_REST_RFC_ENDPOINT` call. That is a different
route and it is not in this compose: see [`adt-over-rfc.md`](adt-over-rfc.md)
and backlog A.13.

## Connecting VS Code (abap-fs)

`murbani.vscode-abap-remote-fs` speaks plain ADT over HTTP with basic auth,
and it asks for one thing at logon that a system has to answer:
`/sap/bc/adt/compatibility/graph`. OSD serves it.

```jsonc
// .vscode/settings.json
"abapfs.remote": {
  "OSD": {
    "url": "http://localhost:3030",
    "username": "developer",
    "password": "any",
    "allowSelfSigned": true
  }
}
```

Honest scope: one route served and tested, **not** a connected client browsing
a tree end to end. What the extension asks for and we lack names itself in
`/osd/not-served`, which is the instrument rather than a guess — backlog A.14
turns that list into a measured coverage number.
