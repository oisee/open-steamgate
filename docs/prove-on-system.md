# Prove on a system: the same ABAP Unit on OSG and on a sandbox

`tools/osd-prove-on-system.mjs` takes a folder of abapGit-named objects and
puts it on a sandbox system through abapGit. It runs each class's ABAP Unit
there, compares the test methods with OSG, and then deletes exactly what it
brought.

```
node tools/osd-prove-on-system.mjs <folder> --unit <deploy unit> [--manifest m.json]
     [--package $ZOSG_TMP_X] [--keep] [--osg count|run] [--server <mcp server>]
node tools/osd-prove-on-system.mjs --cleanup --package $ZOSG_TMP_X     # needs the run's receipt
```

**Use it on a sandbox only, and never on a productive or customer system.**
The tool imports, runs and deletes. It accepts only a local package (a name
that starts with `$`) and refuses any other name before it sends anything.
It reaches the system through the vsp MCP server that `OSD_MCP_CONFIG`
names (default: `.mcp.json` at the repository root, which is gitignored).
Use `--server`/`OSD_MCP_SERVER` when that file configures more than one
server. No host, user or client name is written in the tool.

## What goes through vsp, and what stays ours

**Minimum vsp: v2.58.0-54** (vibing-steampunk `main` at `0a83078`, #301).
An older vsp answers `execute_abap` as text, and the tool then refuses at
the preflight ("the answer is not JSON"). The import and the deletion also
need ZADT_VSP with its git service and abapGit on the system (`vsp install
zadt-vsp`), deletes allowed, and the `$` package inside vsp's
`--allowed-packages`.

| Step | Through | Why |
|---|---|---|
| import (fresh mode) | vsp `git_import_zip` (`overwrite: false`), and `git_import_status` while its job runs | abapGit on the system as a background job; nothing that exists is overwritten, an object of another package refuses |
| deletion of the run's objects | vsp `git_delete_objects`, with exactly the list our decision made | each object through vsp's ADT delete gate, only the package's TADIR items, the package only when empty |
| the run's repository row | `git_delete_objects` with `delete_repo: true`, only when this run's import created the row (`repoCreated`) and it is still the one registered, by key and name | vsp drops an offline repository only of a package left empty |
| residue | vsp `read DEVC <package> {inventory}` **and** our own count, which must agree | two independent reads of the same state |
| ABAP Unit | vsp `test` (its JSON: `ok`, `counts`, `classes`) | the method comparison reads the classes; a run vsp calls not ok fails |
| preflight, receipt stamps and content hashes, chunk reads, the cleanup decision, the residue count, the class check | our snippets through `execute_abap` | they are the tool's rules, not abapGit's import |
| `--in-place` deploy and restore, its repository row | our own deploy snippet and `dropRepoAbap` | see below |

Every snippet that still runs hands its result back with **one
`RETURN_VALUE( lt_out )`** as its last statement: `lt_out` is a table of
`{k, v}` strings, and vsp serialises it into `result_text` as JSON
(`[{"K":..,"V":..}, ...]`). The last row is `end=OSDPROVE`. The tool reads
nothing out of an alert title any more, and fails closed on:

- an answer that is not JSON (an older vsp, or a cut answer);
- a snippet that did not finish (vsp's `failure`, with the line of the
  snippet where it stopped);
- no value, or more than one;
- a `result_text` that is not JSON (cut), a row that is not `{K, V}` of
  strings, or no end row at the end.

**Why `--in-place` keeps its own deploy.** It must decline the deletes abapGit
plans (the AFTER zip carries no `package.devc.xml`, so abapGit plans to
delete the package's own entry, measured on A4H). vsp's `git_import_zip`
updates an existing object only with `overwrite: true`, and `overwrite`
also requires deletes to be allowed, so the two cannot be had together.
The deploy snippet stays, and only its reporting moved to `RETURN_VALUE`.

**What changed for the guarantees.**

- The cleanup's decision and its deletion used to be one dialog step: the
  snippet checked each object and handed it to `zcl_abapgit_objects=>delete`
  in the same step. They are now two MCP calls, our decision and then vsp's
  `git_delete_objects`. An edit made in the seconds between the two is not
  seen, and the object is deleted with it. The repository check has the same
  gap: the decision reads the registered row's key and name, and vsp then
  drops the row registered for the package. The tool reports it if vsp
  unregistered another key than the run's.
- vsp deletes through ADT, one object at a time (two rounds for
  dependencies), not through abapGit's object layer.
- vsp drops the repository row only once the package is empty, so an object
  the cleanup keeps (a foreign edit) now keeps the row too. Before, the row
  went anyway. A later `--cleanup` finds the row by the receipt's key.
- A refused import: vsp removes the repository it created. The tool then
  hands `git_delete_objects` the package's own entry (`DEVC <package>`),
  which vsp never deletes as an item ("skipped"); vsp then deletes the
  package only if nothing is in it and no repository is registered for it.
- An import job that did not finish (still pending after the polls, an
  unknown status, a call that broke) skips the cleanup entirely: the job may
  still be writing into the package. The run fails and says to ask
  `git_import_status` and to remove the package by hand.
- The residue check is stronger: besides the TADIR counts, a receipt object
  whose TADIR row is gone must have no REPOSRC / DD rows left (its stamp must
  read empty), and vsp's inventory must list the same objects, subpackages
  and repository as our count.

## It deletes only what it brought, unchanged

The run creates its own package and so owns it:

- The package must not exist when the run starts.
- No object of the zip may exist yet, in any package.
- The run deletes an object only if it is in the run's **receipt** and its
  version stamp is unchanged since the import, **or** its stamp moved and
  its content is still the one the receipt hashed (a re-activation is not
  an edit).
- It deletes only its own repository row: the one named `OSDPROVE <package>`
  whose key is the key its own import reported **and** that this import
  created (`repoCreated` in vsp's answer, `repoCreated` in the receipt). A
  receipt written before that field existed never deletes the row; the
  cleanup says so. A refused import's row is removed by vsp itself.
- It deletes the package (created by this run) only when nothing else is in it.

There is no abapGit `purge` and there is no `--reuse`. The zip's object
list alone never authorises a delete. **Objects** need the receipt. The run's
repository row and its empty package are recognised by identity: name and
key, and emptiness.

### The run receipt

Right after an import that was not refused, the run writes
`.local/prove-runs/<package>.json` (gitignored; `OSD_PROVE_RUNS` names
another folder). It holds:

- the package;
- the repository key and name, and whether this run's import created it;
- the zip's object list;
- for each object that the import wrote into the package, its TADIR
  identity, a version stamp read on the system right after the import, and
  the content hash described below.

The stamps are read by a small snippet (`receiptAbap`), and the cleanup
reads them again with the same ABAP:

| Kind | Stamp |
|---|---|
| CLAS, INTF | the newest REPOSRC `UDAT`+`UTIME` over abapGit's own include list (`zcl_abapgit_oo_factory=>get_by_type( )->get_includes( )`, the list abapGit's `changed_by` reads), plus how many of those includes exist |
| PROG | its REPOSRC `UDAT`+`UTIME` |
| TABL, DTEL, DOMA, TTYP | the active DD02L / DD04L / DD01L / DD40L row's `AS4DATE`+`AS4TIME` |
| DDLS | the active DDDDLSRC row's `AS4DATE`+`AS4TIME` (**to be measured on A4H**: abapGit's own DDLS object reads the source through `IF_DD_DDL_HANDLER~READ` with `get_state = 'A'` into `DDDDLSRCV`, whose `AS4USER`/`AS4DATE`/`AS4TIME` its `changed_by` uses; the table and field names are read off that source and off memory of the DDIC, not yet seen on a system) |

Any other kind gets no stamp. Such an object is not in the receipt, the run
reports it, and it is never deleted. DCLS (access controls) is one: abapGit
reads it through a handler into `ACM_S_DCLSRC` and the table behind that is not
known here, so it is not stamped and not deleted. Its content *can* be hashed
(abapGit serialises any object) and its files would be `.dcls.asdcls` and
`.dcls.xml`; giving it a stamp, or deleting a stamp-less object by hash alone,
is not done.

#### The content hash (fresh mode)

A moved stamp is not an edit. Measured on A4H twice: an `--in-place` run
(or any deploy) on a package that a fresh `--keep` run installed re-activates
DDIC objects, so their version stamps (REPOSRC `UDAT`/`UTIME`, DD
`AS4DATE`/`AS4TIME`) change while the content does not, and the fresh run's
`--cleanup` refused them as "changed since the import" and they had to be
removed by hand.

So the receipt also holds, per object, the SHA-256 of each file of its abapGit
serialisation (`files: [{name, sha256, size, cx?}]`, and `hash`, the SHA-256 of
the sorted `name=sha256` lines, the same `objectHash` as the in-place
snapshot). The hash is read **by the in-place mode's own snippet**
(`hashItemBlock` / `serializeBlock` in `tools/osd-prove-inplace.mjs`:
`zcl_abapgit_objects=>serialize`, `cl_abap_message_digest` SHA-256), shared and
not copied, and inside the receipt snippet, in the same dialog step as the
stamp. The cleanup snippet uses the same `serializeBlock` for its comparison, so
both sides hash the same bytes.

The rule, in the cleanup's decision snippet (one step; the deletion of what
it decides is the next call, vsp's `git_delete_objects`):

- stamp unchanged: delete, as before (the hash plays no part);
- stamp moved (or unreadable) and the receipt has hashes for the object:
  abapGit serialises it now; if its files are exactly the receipt's (same
  names, same hashes), delete (`rehashed=` in the report, "re-activated, not
  edited" in the log); otherwise keep it, report `hashdiff=` and fail the
  run: "a foreign edit";
- stamp moved and no hash in the receipt (an old receipt, or an object abapGit
  could not serialise at receipt time): keep it as before. The cleanup says so
  in its log ("decided by the version stamp alone, as before").

A hash never *adds* a delete where the stamp did not: if the stamp is unchanged
the object goes, hash or not, so the same-second limit below is unchanged. A
serialisation that raises at cleanup time keeps the object (fail closed, and the
problem names it).

**XML, and what is sound.** abapGit rewrites XML on serialisation, so a hash of
raw bytes could in principle differ for a file nobody edited. Measured on A4H
(`--in-place`, run 3): all 13 XML files were byte-equal after a deploy, so the
byte hash alone is the rule that held. When the byte hash of an XML file still
differs, the cleanup does not treat that as an edit by default and does not
ignore it either. At receipt time each XML file is also read back by chunks (the
chunk carries the file's hash, so it is that version) and the SHA-256 of its
**canonical element tree** (`canonicalXml`, the in-place mode's: attributes
sorted, whitespace-only text dropped only between the element children of an
element that has some (indentation), the text of a leaf kept exactly so `<a> </a>`
differs from `<a/>`, `xml:space="preserve"` keeping everything in its subtree,
entities and CDATA read, declaration and comments ignored; a file that is not one well-formed tree has none) is stored as
`cx`. At cleanup, an object whose stamp moved and whose hash differs is
accepted only if **every differing file is XML, the set of file names is the
same, each such file has a `cx`, and its canonical tree now equals it**. Then the
tool runs the decision snippet a second time with that object's *current*
file hashes as the expected ones, so the snippet checks again, in its own step,
that the object is still exactly what was read; the second decision replaces the
first, and only then is anything deleted. Why this is sound: a canonical tree keeps every element name, attribute
and non-blank text, so an edit of a value or a structure changes it; what it
ignores (indentation, attribute order, line endings, declaration, comments)
carries no content abapGit would deserialise. Why it is limited to XML: a
source file differing in bytes is an edit, by the same measurement that found
XML equal. A receipt whose XML has no `cx` (the read-back failed) decides by
bytes only. The cost is one chunk read per XML file at receipt time.

**Limit of the stamp.** The stamps have one-second resolution, the system's
own change stamps. A change made in the *same second* as the stamp it
replaces is not seen. Any later edit of a class include moves that
include's `UDAT`+`UTIME` past the recorded maximum and is seen. The
package is created by the run, and without `--keep` it exists only for the
run. Such an edit would have to come from someone writing into it in that
second.

A second limit: the stamps read *active* rows only (REPOSRC `r3state = 'A'`,
DDIC `as4local = 'A'`). An edit saved but not activated while `--keep`
leaves the package in place does not move the stamp, and a later
`--cleanup` deletes the object together with that inactive version. Only
the run's own objects in its own temporary `$` package are affected, and
only on an explicit `--cleanup`.

The content hash above covers an object whose stamp moved. It does not close
the same-second case (a stamp that did not move deletes as before) nor the
saved-but-inactive case. Reading the hash for every object, whatever its stamp,
would close both, at the cost of refusing what a stamp lets through today; not
done here.

A refused import writes no receipt, and neither does an import whose stamps
could not be read. In both cases the cleanup deletes no object.

A complete cleanup removes the receipt. An incomplete one keeps it, so that
`--cleanup` can try again.

## The steps

Every step is a separate, small MCP call, because a long call can be cut.
The long ones carry vsp's `timeout` (300 s).

1. **Zip.** The tool lays the folder out the same way as
   `tools/osd-abapgit-zip.mjs`: only objects that the deploy unit lists,
   and the build fails closed on anything else.
   - The zip is written in process (`zipInProcess` in
     `tools/osd-abapgit-zip.mjs`: deflate, sorted paths, fixed timestamp),
     not by the `zip` binary, so the tool spawns no child.
   - A unit that puts no class in the zip fails here, because there is
     nothing to prove.
2. **Preflight.** This step reads only and changes nothing. The run is
   refused (exit 2) in two cases:
   - **The package exists.** The run is refused whether the package is
     empty or not, and whether or not a repository is registered for it.
     The message says how to inspect it (SE80 or ADT, abapGit's
     repository list) and to remove it by hand or pick another
     `--package`.
   - **An object of the zip already exists in TADIR, in any package.** An
     import would take it over. The refusal names each object and its
     package.
3. **Package.** The tool runs `create DEVC $X`.
4. **Import.** vsp's `git_import_zip` with the zip as `zip_base64`, the
   package, `repo_name` = `OSDPROVE <package>`, `overwrite: false` and
   `wait_seconds: 300`. abapGit on the system imports it as background job
   `ZVSP_GIT_IMPORT`: an offline repository, `set_files_remote`,
   `deserialize_checks`, `deserialize`, with vsp's policy (an existing
   object is never updated without `overwrite`, an object of another
   package, a package move, data loss or unmet requirements refuse). If the
   job is still running when the call returns, the tool asks
   `git_import_status` up to 20 times, 15 s apart. The answer is judged:
   - `imported` passes; W lines of its log are shown, an E or A line fails;
   - `imported_with_errors`, `refused` and `failed` fail the run, with the
     whole log;
   - any other status (still pending, unknown, missing) fails it, and the
     cleanup is skipped (the job may still be writing);
   - a TADIR row the import wrote into another package fails it;
   - the repository key must be there (else the cleanup refuses any
     repository) and the repository must be named `OSDPROVE <package>`.

   Objects can be on the system after `imported`, `imported_with_errors`
   and `failed`, so those get a receipt; `refused` wrote nothing and gets
   none.
5. **Classes.** For each class, the tool reads
   `SEOCLASSDF-WITH_UNIT_TESTS` and the line count of the CCAU include
   (`cl_oo_classname_service=>get_ccau_name`, `READ REPORT`). Every class
   of the zip must have an entry.
6. **ABAP Unit.** For each class, the tool runs `test CLAS X` with
   `include_dangerous`.
   - **The result must be vsp's report.** It must be JSON with `ok` and
     `counts`, list every method (not `only_failures`), its
     `counts.methods` must equal the methods it lists, and it must name a
     test class of that class. Anything else fails.
   - **Methods are compared by identity, not by count.** The set of
     `TESTCLASS->METHOD` names the system ran (case-insensitive) must equal
     the set of `FOR TESTING` methods in the source. With `--osg run`, it
     must equal the set that OSG ran. The run names what is missing on
     either side.
   - **Unnamed method entries.** An entry without a name does not count.
     If such an entry carries an alert, it fails the run as "an unnamed
     test method failed".
   - **Not ok.** A class vsp lists as not run fails; a run vsp calls not ok
     with no failure behind it fails with vsp's note.
   - **A class with no tests on either side is not called.** That means no
     tests on OSG and, by step 5, none on the system (WITH_UNIT_TESTS not
     set, empty CCAU). Its row says so.
   - **Something must run.** If no test method ran on the system at all,
     the run fails because there is nothing to prove.
   - **Known limit: inherited test methods.** The source parse credits a
     test method inherited from an abstract local test class to the class
     that declares it, while ADT names the subclass. Such a class shows as
     a difference, not as a pass.
7. **Cleanup.** Three calls, in this order:
   1. **The decision** (our snippet, reads only). If the package has a
      repository, it must be the tool's own by name and the one this run
      imported into, by the key from step 4; otherwise nothing at all is
      deleted. If the import reported no key, any repository refuses the
      cleanup. Then, for each object in the receipt, the snippet reads its
      TADIR row and decides it for deletion only if `DEVCLASS` is this
      package **and** the stamp it reads now equals the receipt's stamp,
      **or** its stamp moved and the files abapGit serialises now are the
      receipt's hashed files (see the content hash above).
      - A changed object is kept and reported, and the run fails (exit 1).
      - An object that is missing or in another package is reported and
        not touched.
      - With no receipt, no object is decided.
   2. **The deletion**: vsp's `git_delete_objects` with exactly the decided
      objects (the tool drops anything the decision named that is not in
      the receipt). With none, the package's own entry is named instead,
      which vsp skips, so that vsp still removes the package when it is
      empty. `delete_repo` is true only when this run's import created the
      repository and the decision saw that same row, by key and name. vsp
      deletes only items of the package's TADIR, stops on a failure (the
      repository and the package are then kept), drops the offline
      repository only of an emptied package, and deletes the package only
      when nothing is in it, no subpackage and no repository. Every
      requested object must come back `deleted`; a `skipped` or `failed` one
      is a problem, and so is an outcome for an object the tool did not ask
      about, or a repository unregistered that is not the run's.
   3. **The residue**, read twice. Our snippet counts the repository rows
      with the run's key, the receipt's objects still in the package, the
      REPOSRC / DD rows of a receipt object whose TADIR row is gone (its
      stamp must read empty), everything else in the package, its
      subpackages and the package itself. vsp's inventory (`read DEVC
      <package>` with `inventory`) must list the same objects, subpackages
      and repository; an inventory that is truncated or could not check
      the repositories fails. Anything left is a problem: a foreign object
      or a subpackage keeps the package, and they are listed.

   `--keep` skips this step and prints the `--cleanup` command. That
   command needs the receipt. Without one it refuses (exit 2) before it
   connects to anything, and it says how to inspect the package by hand.
   With a receipt, it does the same work with the receipt's objects,
   stamps, repository key and `repoCreated`, and it removes the receipt
   when the cleanup is complete.

The result is a table:

```
class              | methods on OSG | methods on system | failing on system
```

The tool exits with 1 if any of these happens:

- an import error, or an import that did not finish;
- missing or unreadable evidence;
- a difference in test methods;
- a failing method;
- a refused cleanup;
- anything left after the cleanup.

It exits with 2 on a refusal before anything was written.

The last line says what was established and no more:

- in the default count mode: `system: N tests pass; OSG: N test methods
  counted from source, not run`;
- with `--osg run`: `proved: the same N tests pass on OSG and on the
  system`;
- on any failure: `NOT proved: k problem(s)`.

## The OSG side

By default (`--osg count`), the tool collects the `FOR TESTING` methods of
each class from abaplint's parse of the folder (helper methods are not
included). It does not run them. With `--osg run`, it runs the class through
`tools/osd-unit.mjs` on this runtime. That needs the folder in the build
(`abap_transpile.json`), and any method that fails on OSG also fails the
run. The output states which of the two modes was used.

## What a system catches that OSG does not

The first manual run of this walk (L2 rules on A4H, 2026-10-01, #354) found
two defects that no run here could find:

- **A malformed table XML.** `zosd_l2_cargo.tabl.xml` had no closing
  `</abapGit>`. The transpiler and the runtime never parse that file, but
  abapGit's XML parser rejects it at import. The tool reports this as an
  import log message with type E, together with its text.
- **A class without `WITH_UNIT_TESTS`.** abapGit writes the class, and the
  system creates no CCAU include for it: 0 lines. ADT then runs no test
  class, and the run reports nothing at all, not a failure. OSG runs the
  tests from `.clas.testclasses.abap` no matter what the flag says. The
  method comparison catches this case (for example, 2 methods on OSG and 0
  on the system), and step 5 gives the reason: WITH_UNIT_TESTS is not set
  and there is no CCAU include.

## Tests

`test/prove-on-system.mjs` runs the tool against a fake transport that
models what vsp v2.58.0-54 answers, in the shapes its source gives them:
`execute_abap` as JSON whose `result_text` is the snippet's
`RETURN_VALUE( lt_out )` table, ABAP Unit as `{ok, counts, classes}`,
`git_import_zip` / `git_import_status`, `git_delete_objects` and `read DEVC`
with `inventory`.

- **The fake reads the real zip.** It reads the zip that the tool hands to
  `git_import_zip`, so the WITH_UNIT_TESTS case comes from the class XML and
  is not a canned answer.
- **The fake models the system state.** It keeps packages with their
  parents, TADIR rows, version stamps, serialised files and abapGit
  repositories. Its `git_delete_objects` does what vsp does and nothing more
  (only the package's TADIR items, stop on a failure, the offline repository
  only on `delete_repo` from an emptied package, the package only when
  empty), so a test can see what survives.
- **Some properties are checked as text.** The fake does not execute ABAP.
  So the snippets' own properties (the `DEVCLASS` check, the subpackage
  query, the stamp comparison, a decision that deletes nothing itself, one
  `RETURN_VALUE( )` after the end row, ASCII) are checked on the snippet's
  text, and every snippet is parsed by abaplint inside the shape of vsp's
  execute wrapper.

The tests cover:

- **Basic runs:** the happy path (the exact call sequence, the zip vsp
  receives, the `git_delete_objects` parameters); `imported_with_errors`
  and its log; a class without CCAU; a failing test method; an object vsp
  could not delete; `--keep` followed by `--cleanup`; the refusal of a
  package that does not start with `$`.
- **Preflight refusals:** an existing package (empty, with a foreign object,
  with a repository); a zip object that already exists in another package.
- **Cleanup scope:** `git_delete_objects` is handed exactly the decided
  objects (a changed one is never in the list: the mutant that hands vsp the
  whole receipt deletes the edited class and fails the test); an outcome
  for an object the tool did not ask about; a foreign object and a
  subpackage that survive and are reported; a zip item found in another
  package; a deleted object whose REPOSRC / DD rows survived; vsp's
  inventory disagreeing with our count, truncated, or unable to check the
  repositories.
- **Repository ownership:** a foreign repository that appears after the
  preflight (vsp refuses the import, the decision refuses the cleanup, no
  delete is sent); a key that changed; a renamed repository; an answer
  without a key; `repoCreated: false` keeps the row (`delete_repo: false`);
  a receipt without `repoCreated` never deletes it; vsp unregistering
  another key is reported.
- **The import's evidence:** no status; W lines shown and passing; an E
  line under `imported`; `refused`, `failed`, `imported_with_errors` and an
  unknown status, each with its log; a refused import gets no receipt even
  when its answer names a repository; a failed import's partial objects are
  cleaned by the receipt; a pending job is polled through
  `git_import_status`, and one that never ends, or a call that broke,
  deletes nothing.
- **The snippets' results:** a `result_text` cut in half, one without its
  end row, an answer in the old text shape, a snippet that died (with its
  line), two values instead of one, rows that are not `{K, V}`.
- **The unit result:** not JSON; the old shape without `ok`/`counts`;
  counts that do not match the listed methods; a failures-only answer; a
  class not run; `ok: false` with nothing named; the class not named;
  nameless entries, with and without an alert; the same count with
  different names; `--osg run` against the methods OSG ran; no class in the
  zip; no test method run.
- **The receipt's content hashes** (`describe("the receipt's content hashes")`):
  the receipt carries each object's per-file hash and a canonical digest for
  XML; stamp moved and hash equal: deleted; stamp moved and hash differs:
  kept, also by a later `--cleanup`; stamp unchanged and hash differs:
  deleted as before; an old receipt, or an object that could not be hashed:
  as before, and the log says so; XML that abapGit rewrote: deleted through
  the second decision, which carries the current hashes; a changed XML
  value, a malformed XML, a source file that differs beside an XML that only
  moved, a receipt without `cx`: kept; DDLS: stamped, hashed and deleted, a
  changed `.asddls` kept. In `test/prove-inplace.mjs` the whole sequence: a
  fresh `--keep` run, an in-place run on its package (the fake re-activates
  every object a deploy writes), then `--cleanup`: deleted by hash; the same
  with the hashes stripped: refused as measured; one object edited after:
  kept, the other deleted.
- **The wording of the verdict** in both modes.

No child process is spawned: the fake reads the in-process zip in process.
Each rule was checked to fail when the code it covers is removed or bent:
handing vsp the whole receipt, `delete_repo` always, no end-row check, a cut
`result_text` tolerated, `imported_with_errors` passing, a receipt after a
refused import, the inventory not compared, a not-ok unit run ignored, a
cleanup while the job may run, an unasked outcome ignored, `repoCreated`
ignored, residual REPOSRC / DD rows ignored: each makes at least one test
fail.

## Measured on the sandbox: what abapGit's overwrite list holds

(This was measured with the tool's own import snippet, which vsp's
`git_import_zip` has replaced in the fresh mode; vsp's job applies the same
rule -- an existing object is never updated without `overwrite` -- and
leaves an existing package's own entry as it is. The `--in-place` deploy
snippet still decides on this list itself.)

`deserialize_checks( )` lists every object it would write in `overwrite`, new ones included, each with an
`action` (`zif_abapgit_objects=>c_deserialize_action`: add 1, update 2, overwrite 3, delete 4, delete_add 5,
packmove 6). Because the run creates its package and the preflight finds none of the zip's objects, the import
approves only `add`, plus the package's own `DEVC` entry, which `package.devc.xml` updates (action 2). Any other entry is an object
that appeared after the preflight, so the import is refused and nothing is overwritten. Measured 2026-10-01:
a guard that refused every entry stopped a clean import on the first new class, and one that approved only `add`
stopped it on the run's own package. Both were caught by real runs and are the reason for this rule.

## `--in-place`: prove a rewrite inside an existing package, then roll back

```
node tools/osd-prove-on-system.mjs --in-place --package $ZPKG <folder-with-AFTER> --unit <unit> [--keep]
node tools/osd-prove-on-system.mjs --rollback --package $ZPKG     # needs the snapshot of a --keep run
```

The perimeter is a **snapshot**, not the package (`tools/osd-prove-inplace.mjs`).

1. **Snapshot.** Every TADIR object of the package (no DEVC, no subpackage) is
   serialised with `zcl_abapgit_objects=>serialize`; each file is hashed
   (SHA-256) on the system, fetched in chunks, checked against that hash and
   stored under `.local/prove-runs/<package>-snapshot/` with `snapshot.json`
   (an object's hash is the SHA-256 of its sorted `name=sha256` lines). This is
   the rollback source and replaces the receipt. A repository of somebody else
   in the package, an object that cannot be serialised, or a leftover snapshot
   of an earlier run refuses the run (exit 2).
2. **Perimeter.** Every object of the AFTER zip (built without
   `package.devc.xml`) must be in the snapshot: no new objects, else refused.
   Every object of the snapshot is hashed again and must equal its snapshot
   hash, else refused and nothing is deployed. The deploy snippet serialises
   the objects once more inside the call that deserialises, so nothing slips in
   between.
3. **Deploy.** Through the tool's own offline repository and its own deploy
   snippet, not vsp's `git_import_zip` (see "What goes through vsp" above: an
   update there needs `overwrite`, which needs deletes allowed, and this mode
   must decline the deletes abapGit plans). An overwrite is approved only for
   an item of the AFTER list with action update or overwrite; any other entry,
   any data loss, any other repository refuses the import. Like every snippet,
   it reports through `RETURN_VALUE( lt_out )`.
4. **Tests.** The same comparison as the fresh mode (`proveClasses`).
5. **Rollback, always.** The deployed version's hashes are recorded only if
   abapGit reported a status, and they are not read by a later call: the
   deploy snippet serialises and hashes the AFTER objects again right after
   `deserialize`, in the same dialog step, with the same serialisation and
   SHA-256 lines as the hash snippet (`dep_file=` / `dep_obj=` in its report).
   A separate read after the call returned would record a colleague's save in
   that gap as this run's output, and the rollback would then overwrite it.
   Each object is then decided file by file, and is recorded as this run's
   only when every file passes one of:
   (a) its in-step hash equals the zip's file;
   (b) read back by chunks (each carrying the in-step hash, so it is that
   version), it equals the zip's file -- a source after the normalisation a
   system applies (BOM, CRLF, trailing blanks, trailing empty lines), an XML
   file as a canonical element tree (`canonicalXml`: attributes sorted,
   whitespace-only text dropped, entities and CDATA read, the declaration and
   comments ignored; a file that is not one well-formed tree is not equal);
   (c) an XML file, or a file the zip lacks: its in-step hash equals the
   snapshot's file of that name, so the deploy did not change it and nothing
   of ours is in it.
   A file the zip carries that the system does not show is a failed deploy of
   that file; a source the zip rewrites that still reads as the snapshot's
   was not applied (the tests would run against BEFORE). Anything else refuses
   the object: it is **not** recorded in `state.deployed`, the run fails
   naming the file, and the rollback leaves the object alone and prints the
   snapshot files (`files/<n>-<k>.bin = <name>`) to import it by hand.
   An object whose current hash equals its recorded deployed hash is
   re-imported from the snapshot's files; one that differs from both is
   reported and left alone. Then every object is hashed again and must equal
   its snapshot hash; only then does the run succeed and the snapshot go.
   The tool's repository row is deleted only if **this run created it**: the
   deploy (or a restore) reports `repo_new=<key>` when it calls `new_offline`,
   and that key is kept as `createdRepo` in `snapshot.json`, so `--rollback`
   from a saved state decides the same way. A row with the tool's name that
   was there at the snapshot (`repoAtSnapshot`; a fresh-mode `--keep` run
   leaves exactly that) is used for the import and left in place; a
   `snapshot.json` written before `createdRepo` existed deletes no row and
   says so. Objects that appeared since are listed as notes, not touched.
6. `--keep` leaves AFTER deployed and prints the `--rollback` command.

Content hashes close the stamp limits above (one-second resolution, active rows
only). Limits: a restore does not delete a file the AFTER version added to an
object (the verification then fails, honestly); a run that dies between deploy
and the hash read leaves unknown deployed hashes, so `--rollback` refuses to
touch any object that differs. Every file of a deployed object is decided by
(a), (b) or (c) above, so no file rests on the in-step hash alone. What
remains: (c) adopts an XML file that equals the snapshot even when the zip
wanted a different one (abapGit may keep attributes the zip does not carry;
the tests then run against that metadata, which the class check shows); a
foreign write between `deserialize` and the serialise inside the one call
that restores exactly the zip's content, or exactly the snapshot's XML, cannot
be told from ours, and is harmless for the rollback (it re-imports what was
there). A system that rewrites XML beyond canonical equality (fields added or
dropped, values reformatted), or a source beyond the listed rules, makes the
run fail closed (never adopted) -- how abapGit's serialiser rewrites the XML
of a deserialised object is not yet measured on A4H.
That `serialize` in the same step sees what `deserialize` just activated is
read off the abapGit source, not yet measured on A4H; the post-deploy report
also lengthens the deploy's answer by one row per file, and a cut answer
fails the run (no end row, or a `result_text` that is not JSON) rather than
adopting anything. The abapGit calls the snippets assume
(`zcl_abapgit_objects=>serialize( is_item io_i18n_params )`,
`zcl_abapgit_i18n_params=>new`, `cl_abap_message_digest=>calculate_hash_for_raw`)
are measured only against the abapGit source, not yet on a system.
Tests: `test/prove-inplace.mjs` (fake system; each rule checked failing without it).

### Measured on A4H for `--in-place` (2026-10-01)

- `cl_abap_message_digest` SHA-256 over abapGit's serialized files works on the sandbox; snapshot and verification hashed 13 objects.
- An AFTER zip without `package.devc.xml` makes abapGit plan a **delete** (action 4) of the package's own DEVC entry. In place nothing is deleted: a delete action is declined (decision no) and reported as `keep=`, never approved.
- A deploy re-activates DDIC objects even when their content is unchanged, so after an in-place run on a package that a fresh run installed with `--keep`, that fresh run's receipt stamps are stale and its `--cleanup` refuses those objects as changed. The content hashes of the in-place snapshot are unaffected (13/13 equal after rollback). (The fresh-mode receipt now also holds content hashes, and its cleanup deletes a stamp-moved object whose hash equals the receipt's; not yet measured on A4H.)
- End to end: snapshot of 13 objects, one class changed in AFTER, 127 system tests passed, rollback re-imported that class, 13/13 hashes equal to the snapshot.

- Second run, after the adoption rules above (same day, a fresh package): the hash read inside the deploy's own call works. For every one of the 13 objects, the class and DDIC XML that abapGit wrote back was byte-equal to the snapshot's, so the XML was adopted under "unchanged since the snapshot" and no canonical comparison was needed. The changed class source matched the zip. The abapGit repository row that the earlier `--keep` run had left was used for the import, and the rollback left it in place ("not created by this run"). Rollback re-imported one class and 13/13 hashes were equal to the snapshot. The fresh receipt's `--cleanup` again refused the six re-activated objects, as described above.

### Measured on A4H: cleanup by content hash (2026-10-01)

The sequence was a fresh `--keep` run, then `--in-place` on the same package, then `--cleanup`. Before this change it needed manual deletion of six objects. Now it completes on its own. The cleanup reported one class and five DDIC objects (one data element, four tables) as "stamp moved … but the content equals the receipt's hash (re-activated, not edited)" and deleted them. The repository row and the package went with them, and the residue was zero. abapGit's serialisation of an unedited object was byte-stable between the receipt and the cleanup, so no XML needed the canonical comparison. A DDLS object has not been run through this yet.
