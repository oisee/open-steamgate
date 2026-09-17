# What is running: the system status as an OData service and a Fiori app

*2026-09-17. The question was "what build is running, on which ports, how
many processes, how much is registered"; the answer is a service, not a
status page, because everything OSD knows about itself can be said in
ABAP over OData, and then a Fiori Elements app renders it for free.*

## The shape

Five DDIC tables under `src/status/` hold the snapshot; five CDS views over
them carry the labels and the associations; one `stg.yaml` makes the
service; a Fiori Elements V2 app renders it; the façade fills the tables
when somebody reads the service.

| table | CDS view | what a row is |
| --- | --- | --- |
| `ZOSD_SYS` | `ZC_OSD_SYSTEM` | the system: SID, host kind, generation built and serving, whether they are in step, work processes, when it started, when the snapshot was taken |
| `ZOSD_PROC` | `ZC_OSD_PROCESS` | a process: pid, role (`facade` or `work`), port, generation, epoch, sockets pinned to it, RSS |
| `ZOSD_PORT` | `ZC_OSD_PORT` | a port: number, protocol (HTTP, HTTPS, RFC, DIAG), what it is for, whether anything is listening |
| `ZOSD_SVC` | `ZC_OSD_SERVICE` | a service: path, kind (`ODATA`, `ICF`, `APC`), handler class, the pack it came from |
| `ZOSD_PACK` | `ZC_OSD_PACK` | a pack: name, order, objects, folders, description |

`ZC_OSD_SYSTEM` exposes four associations, and `src/status/zosd_status.stg.yaml`
turns them into navigation properties, so the service is

```
/sap/opu/odata/sap/ZOSD_STATUS_SRV/SystemSet('OSG')?$expand=to_Processes,to_Ports,to_Services,to_Packs
```

and the object page's facets are those four collections. The UI annotations
(header, header facets, line items, field groups, labels) come from the same
YAML, so `webapp/status/` carries no annotation file of its own — a list
report over the one system row, an object page behind it.

## Where the numbers come from

`tools/osd-status.mjs` takes the snapshot in the façade, which is the only
process that knows all of it: the pool and the supervisor for the work
processes, the listeners it opened for the ports, `tools/osd-icf.mjs` for
ICF services and push channels, the SEGW registry for OData services,
`tools/osd-packs.mjs` for packs, `liveHash` and the serving runtime for the
two generations. RFC and DIAG are reported as `absent` with a note naming
the sibling that would serve them, rather than left out.

It travels as JSON to `POST /osd/status` on a work process, where
`ZCL_OSD_STATUS=>REFRESH` parses it with `/ui2/cl_json` and replaces the
five tables. The work processes share one SQLite file by default
(`test/run.mjs` sets `STG_DB=file`), so one write is enough for all of them.
The refresh happens when a request for the service arrives, so what the app
shows is what was true when it was asked; a failed refresh is logged and the
tables are served as they are.

**Nothing identifies a client.** Sockets are counted, never described: no
addresses, no user names, no session ids. That is the same rule the rest of
the repository keeps, and a status app is exactly where it would be easiest
to break.

## What it cost, and two things measured on the way

- `UI.HeaderFacets` did not exist in the YAML annotation compiler, so the
  object page's header showed only the title and the description and
  everything else fell into the first section. `tools/stg-compile.mjs` now
  emits it beside `UI.Facets` — the same ReferenceFacet, a different term —
  and every Fiori Elements object page in the tree can use it.
- A pid and a port are identifiers, not quantities: as `Edm.Int32` a Fiori
  field groups the digits and a pid reads `173,027`. They are `Edm.String`
  in the model now. Casting them in the CDS view instead
  (`cast(pid as abap.char(10)) as Pid`) does **not** work here: the field
  disappears from the row the generated source class hands back, and the key
  comes out empty (`PortSet()`), which is worth knowing before someone
  reaches for a cast in a view.

## Tests

`test/osd-status.mjs` (the snapshot over a fake runtime and fake listeners),
`ZCL_OSD_STATUS`'s ABAP Unit tests (a snapshot written and read back, a
second refresh replacing the first, malformed JSON changing nothing), and
`test/e2e/status.spec.mjs` in a browser: the row, the header, a work
process, the HTTP port `listening`, a service path, a pack.
