# The ADT surface, from the server's side

A milestone, 2026-09-15. `docs/adt-facade.md` reads the contract off the
client's jars; this file records what OSD's server actually answers, so a
reader can tell at a glance what a client can do against it without opening
`tools/adt-facade.mjs`. Every capability here is exercised by a test named in
its row and was checked once against a live Eclipse ADT 3.60 through the
recorder (`STG_ADT_DUMP`, below).

The one sentence: **Eclipse and vsp treat OSD as a real ABAP Cloud system —
they log on, browse the tree to any depth, open and edit every source kind,
save, activate, run unit tests, preview table and CDS data, and create and
delete objects, and every change lands on the local git tree as abapGit
files.** What it does not yet answer is listed at the end, each with the
reason.

## How to reach it

- `npm start` serves the façade under `/sap/bc/adt/` on port 3030, beside the
  OData front on the same port.
- `sh scripts/osd-restart.sh 3030` frees the port by its owner and restarts,
  waiting until discovery answers. `STG_ADT_SID=<SID>` renames the system;
  the default is **OS2** (a client refuses a logon when the id it stored at
  project creation differs from the one reported, so the id is a code default
  and not a variable a restart must remember).
- A client that speaks HTTPS reaches the same façade through the TLS listener
  the runner brings up; the certificate is `.local/tls/osd.crt`.
- `STG_ADT_DUMP=<file.jsonl>` records every exchange under the façade in the
  shape of the A4H oracle captures (method, url, request and response headers
  and body, both bodies base64). Off unless asked, written under `.local/`,
  never tracked. It is how a symptom seen in Eclipse becomes the exact request
  and answer, rather than a replay of what the client "must have" sent.

## Wave 0 — the handshake and the gates

A client decides most of what it can do before it sends a second request, by
reading two documents. Getting these wrong makes the whole façade look empty
with nothing on the wire to show why.

| What | Resource | Note |
|------|----------|------|
| Token + context | `HEAD/GET core/discovery` | `X-CSRF-Token` not the literal `Required`; `sap-contextid` and `SAP_SESSIONID_OS2_001` cookies |
| System identity | `GET core/http/systeminformation` | systemID OS2, client 001, user DEVELOPER |
| Discovery | `GET core/discovery` | every `app:collection` carries an `atom:category term+scheme`, or the client's parser NPEs on the whole document |
| Compatibility graph | `GET compatibility/graph` | the real gate: `compatibilityAvailable` must be present or the client reads every capability as absent and asks for nothing |

The graph is what silently gates features. `SOURCESERVICES/outline` gates the
class and interface outline; `DDIC.DDLSOURCES/ddlSources` gates opening a CDS
view; `PROJECTEXPLORER` without `treePath` keeps the tree on `nodestructure`
rather than a resource we do not serve. Tests: `test/adt-session.mjs`,
`test/adt-facade.mjs` (the gate, the discovery categories, the OS2 identity).

## Wave 1 — browsing a repository

| What | Resource | Shape / gotcha |
|------|----------|----------------|
| Search | `GET repository/informationsystem/search` | `adtcore:objectReferences`; VERSION read only as `A`/`I` |
| Package tree | `POST repository/nodestructure` | `TREE_CONTENT` + `CATEGORIES` + `OBJECT_TYPES`; subpackages are rows, type folders carry the `NODE_ID` the client sends back as `TV_NODEKEY`; **no row carries an empty `OBJECT_URI`/`OBJECT_VIT_URI`** or every node collides as `URI("")` and the tree opens the wrong sibling |
| Cloud tree | `POST repository/informationsystem/virtualfolders/contents` | PACKAGE/GROUP/TYPE drawers, `..P` for direct-only, `preselectionInfo` for one package |
| Object types | `GET repository/informationsystem/objecttypes`, `POST repository/typestructure` | the type metadata the wizard and the tree read |
| Package | `GET packages/:name` | `pak:package` with its links |
| Outline | `GET <collection>/:name/objectstructure` | non-empty, `xml:base` = request URL, identifier/implementation links per member |

The package-tree fix is the load-bearing one for depth: subpackages now open
to any level because each row is a distinct node. Tests: `test/adt-facade.mjs`
(search, the five virtual-folder shapes, the distinct-URI rule, the outline
gate and structure, program structure).

## Wave 2 — reading, editing, activating

| What | Resource | Note |
|------|----------|------|
| Read source | `GET <collection>/:name/source/main` | ETag + 304; a class carries its includes |
| Object document | `GET <collection>/:name` | version and changedAt from the store's state |
| Lock | `POST <collection>/:name?_action=LOCK` | dataname `com.sap.adt.lock.Result2`; a library object answers an empty handle |
| Write | `PUT <collection>/:name/source/main?lockHandle=` | stores with the repo's line endings (CRLF/CR → LF); returns the ETag of the stored source; a written-not-activated object reads `version=inactive` so the editor is not wiped |
| Activate | `POST activation` | success is `chkl:messages` with `checkExecuted`/`activationExecuted`/`generationExecuted="true"`; a break names the caller that broke; the modules are transpiled before the answer |
| Unit test | `POST abapunit/testruns` (+ `/evaluation`) | result named by Accept version (Eclipse v2, vsp junit) |
| Check | `POST checkruns` | a dictionary object answers "present and readable" |
| Transport check | `POST cts/transportchecks` | empty RECORDING and REQUESTS: OSD has no CTS, and says so, so the client does not prompt |

Tests: `test/adt-devloop.mjs`, `test/adt-editor.mjs` (lock shape, save keeps
content, inactive state, activation reports, unit naming and evaluation,
CRLF).

## Wave 3 — data, dictionary, F8

| What | Resource | Note |
|------|----------|------|
| Table object | `GET ddic/tables/:name` | `blue:blueSource` + DDL under `source/main` |
| Data element | `GET ddic/dataelements/:name` | `blue:wbobj`/`dtel` from DD04V |
| F8 columns | `GET datapreview/ddic/:name/metadata` | real column metadata from the parsed DD03P, data-element types resolved |
| F8 rows | `POST datapreview/ddic`, `POST datapreview/freestyle` | Open SQL in, SQL out: a comma-less field list (Eclipse ADT 3.60) is joined with commas, `UP TO n ROWS` becomes `LIMIT`, the tilde is the database client's |
| Parser info | `GET ddic/tables/parser/info`, `ddic/ddl/parser` | 404 on purpose — the grammar is the system's own, and a 404 means "not here", not "broken" |

Tests: `test/adt-facade.mjs` (table object, F8 metadata and rows, the
comma-less list), `test/osd-data.mjs` (the Open SQL translation).

## Wave 4 — creating and deleting

| What | Resource | Note |
|------|----------|------|
| Create | `POST <collection>` (classes, interfaces, programs, includes, DDL, packages) | body is the object's own document with name, description and packageRef; answer 201 with the URI in `Location`; writes the two abapGit files (source skeleton + header) in the package's folder; the client's next move is the ordinary lock/PUT/activate |
| Delete | `DELETE <collection>/:name?lockHandle=` | removes the source and its header; a package goes only once it is empty |
| Conflict | — | a second create is 409 `ExceptionResourceIsModified`; a missing package is 404 |

A package **is** a folder: an object of `$ZOSD_TEST_SRC` lands in
`src/zosd_test/src/`, and a new package is a new folder under its parent's,
named after the last link of its name. So a repository made here is one
abapGit pulls, and an object abapGit pulls is one this serves. Tests:
`test/osd-store.mjs` (create, delete, the package-is-a-folder rule),
`test/adt-devloop.mjs` (the create/delete routes over the wire).

## The disk is the other editor

`ObjectStore.watch()` rebuilds the index and the registry when a file appears
or changes under a writable root, so an abapGit pull, a `git checkout`, or an
edit outside ADT is served without a restart — the reverse of create: change
the source on disk and the next read through the façade returns it, and the
next check compiles it. The façade turns this on unless `options.watch` is
false. Verified live through the MCP: a class edited on disk was read back
with its new source, no restart. Test: `test/osd-store.mjs` ("a file that
appears on disk is an object here, once the store watches").

## Refusals

A refusal is `exc:exception` (application/xml) with a type id from the
client's own vocabulary (`ExceptionResourceNotFound`, `ExceptionResourceNoAccess`,
`ExceptionResourceIsModified`, `ExceptionInvalidRequest`). text/plain leaves
the client's `getExceptionData()` null and turns a clean "not here" into an
NPE that never finishes failing. The catch-all under the façade records each
unanswered path by method, so the set of what a strange client asked for and
did not get is the next wave's worklist.

## What it does not answer yet

Each is a real "the façade does not serve this", not a bug, and is recorded so
a client's 404 can be read as a plan rather than a fault.

- **Editor documents for FUGR, MSAG, DOMA, TTYP, VIEW, SHLP.** Each has an
  editor format of its own and none is written; the object is in the tree and
  the search, and opening it is a 404. `test/zosd-test.mjs` lists exactly which.
- **Function groups and modules as create targets.** A group is a folder of
  includes with a header of its own; nothing has asked for one.
- **The DDL/table grammar** (`parser/info`, `ddl/parser`) is answered 404 on
  purpose so the client parses with its built-in version.
- **CTS.** There is no transport system; the boundary to a real system is an
  abapGit archive from a git ref.
